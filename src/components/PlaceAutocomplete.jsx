import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { cx } from '../lib/format.js'
import { Spinner } from './ui.jsx'

/**
 * Hotel/address search box.
 *
 * Type a property name and pick it from the list; the chosen place carries the
 * full address and coordinates, so the operator never types a location by hand.
 * Choosing a suggestion resolves it to coordinates via place details, because
 * autocomplete itself does not return them.
 */
export default function PlaceAutocomplete({ onSelect, placeholder = 'Start typing a hotel name…', autoFocus = false }) {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState(null)
  const [error, setError] = useState(null)
  const [simulated, setSimulated] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const boxRef = useRef(null)
  const abortRef = useRef(null)

  // Debounced so a fast typist does not fire a request per keystroke.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 3) {
      setOptions([])
      setError(null)
      return undefined
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      setError(null)
      try {
        const res = await api.get(`/places/autocomplete?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        if (controller.signal.aborted) return
        setOptions(res.suggestions || [])
        setSimulated(Boolean(res.simulated))
        setOpen(true)
        setHighlight(0)
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const onClickAway = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [])

  const choose = async (option) => {
    setResolving(option.placeId)
    setError(null)
    try {
      const details = await api.get(`/places/${encodeURIComponent(option.placeId)}`)
      onSelect?.({
        placeId: details.placeId,
        name: details.name ?? option.name,
        address: details.address ?? option.address,
        city: details.city || null,
        lat: details.lat,
        lng: details.lng,
        simulated: details.simulated,
      })
      setQuery('')
      setOptions([])
      setOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setResolving(null)
    }
  }

  const onKeyDown = (e) => {
    if (!open || options.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(options[highlight])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
          🔍
        </span>
        <input
          className="input pl-9"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => options.length && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls="place-options"
        />
        {(loading || resolving) && (
          <Spinner className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
        )}
      </div>

      {error && <p className="mt-1.5 text-[11px] text-red-600">{error}</p>}

      {open && options.length > 0 && (
        <ul
          id="place-options"
          className="absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-xl bg-white py-1 shadow-lift ring-1 ring-ink-900/10"
          role="listbox"
        >
          {options.map((o, i) => (
            <li key={o.placeId} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(o)}
                disabled={Boolean(resolving)}
                className={cx(
                  'flex w-full items-start gap-2.5 px-3 py-2 text-left',
                  i === highlight && 'bg-brand-50',
                )}
              >
                <span className="mt-0.5 text-ink-400">📍</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-900">{o.name}</span>
                  {o.address && (
                    <span className="block truncate text-[11px] text-ink-500">{o.address}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && !loading && options.length === 0 && query.trim().length >= 3 && (
        <p className="mt-1.5 text-[11px] text-ink-500">
          No matching places. Try a fuller name or the street address.
        </p>
      )}

      {simulated && (
        <p className="mt-1.5 text-[11px] text-amber-700">
          🧪 Simulated places — add <code className="font-mono">GOOGLE_MAPS_API_KEY</code> for real
          Google Maps results.
        </p>
      )}
    </div>
  )
}