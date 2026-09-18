import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'

const AppContext = createContext(null)

/**
 * Shared app state.
 *
 * Polling stands in for Firestore's onSnapshot listeners: the dashboard needs
 * to stay live across a phone and a desktop at the front desk, and a 15s poll
 * achieves that against our own API without a realtime channel that would not
 * survive a dropped hotel wifi connection gracefully.
 */
export function AppProvider({ children }) {
  const [status, setStatus] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [toasts, setToasts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const pollRef = useRef(null)

  const toast = useCallback((message, tone = 'brand', detail = null) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { id, message, tone, detail }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 7000)
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const refreshStatus = useCallback(async () => {
    const s = await api.get('/status')
    setStatus(s)
    return s
  }, [])

  const refreshDashboard = useCallback(async () => {
    try {
      const data = await api.get('/dashboard')
      setDashboard(data)
      setError(null)
      return data
    } catch (err) {
      if (!err.locked) setError(err.message)
      return null
    }
  }, [])

  const bootstrap = useCallback(async () => {
    setLoading(true)
    try {
      const auth = await api.get('/auth/status')
      if (!auth.unlocked) {
        setStatus({ locked: true })
        return
      }
      await Promise.all([refreshStatus(), refreshDashboard()])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [refreshDashboard, refreshStatus])

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  // Live-ish updates: 15s while visible, paused when the tab is hidden so a
  // forgotten phone in someone's pocket isn't hammering the API all night.
  useEffect(() => {
    if (!status || status.locked) return undefined
    const tick = () => {
      if (document.visibilityState === 'visible') refreshDashboard()
    }
    pollRef.current = setInterval(tick, 15000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(pollRef.current)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [status, refreshDashboard])

  const unlock = useCallback(
    async (pin) => {
      await api.post('/auth/unlock', { pin })
      await bootstrap()
    },
    [bootstrap],
  )

  const lock = useCallback(async () => {
    await api.post('/auth/lock')
    setStatus({ locked: true })
    setDashboard(null)
  }, [])

  /** Run a batch check and surface the result as a toast summary. */
  const runCheckAll = useCallback(
    async (competitorId = null) => {
      setBusy(competitorId ? `checking-${competitorId}` : 'check-all')
      try {
        const summary = await api.post('/check-all', competitorId ? { competitorId } : {})
        await refreshDashboard()
        if (summary.alerts > 0) {
          toast(
            `${summary.alerts} new alert${summary.alerts === 1 ? '' : 's'}`,
            'amber',
            'Check the alerts panel for details.',
          )
        }
        if (summary.failed > 0) {
          const names = [...new Set(summary.errors.map((e) => e.otaLabel))].join(', ')
          toast(`${summary.failed} check${summary.failed === 1 ? '' : 's'} failed`, 'red', `${names} — page may have changed.`)
        }
        if (summary.failed === 0 && summary.alerts === 0) {
          toast(
            'All checks completed',
            'emerald',
            `${summary.ok} reading${summary.ok === 1 ? '' : 's'} updated.`,
          )
        }
        return summary
      } catch (err) {
        toast('Check failed', 'red', err.message)
        throw err
      } finally {
        setBusy(null)
      }
    },
    [refreshDashboard, toast],
  )

  const value = useMemo(
    () => ({
      status,
      dashboard,
      loading,
      error,
      busy,
      toasts,
      toast,
      dismissToast,
      unlock,
      lock,
      refreshDashboard,
      refreshStatus,
      runCheckAll,
    }),
    [
      status,
      dashboard,
      loading,
      error,
      busy,
      toasts,
      toast,
      dismissToast,
      unlock,
      lock,
      refreshDashboard,
      refreshStatus,
      runCheckAll,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}

/** Generic data-fetch hook with loading/error state. */
export function useFetch(path, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(Boolean(path))
  const [error, setError] = useState(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!path) return undefined
    let cancelled = false
    setLoading(true)
    api
      .get(path)
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps])

  return { data, loading, error, reload: () => setNonce((n) => n + 1), setData }
}