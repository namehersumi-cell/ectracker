import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/app-context.jsx'
import { cx } from '../lib/format.js'
import { Spinner } from './ui.jsx'

/**
 * Fullscreen PIN gate. Deliberately not Firebase Auth: a single-user tool on a
 * front desk phone needs a lock, not an identity system.
 */
export default function PinGate() {
  const { unlock } = useApp()
  const [digits, setDigits] = useState(['', '', '', ''])
  const [error, setError] = useState(null)
  const [checking, setChecking] = useState(false)
  const refs = useRef([])

  useEffect(() => {
    refs.current[0]?.focus()
  }, [])

  const submit = async (pin) => {
    setChecking(true)
    setError(null)
    try {
      await unlock(pin)
    } catch (err) {
      setError(err.message === 'Incorrect PIN' ? 'Incorrect PIN — try again' : err.message)
      setDigits(['', '', '', ''])
      refs.current[0]?.focus()
    } finally {
      setChecking(false)
    }
  }

  const setDigit = (index, value) => {
    const clean = value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[index] = clean
    setDigits(next)
    if (clean && index < 3) refs.current[index + 1]?.focus()
    if (next.every((d) => d)) submit(next.join(''))
  }

  const onKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus()
    }
  }

  const onPaste = (e) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    if (!text) return
    e.preventDefault()
    const next = ['', '', '', '']
    for (let i = 0; i < text.length; i += 1) next[i] = text[i]
    setDigits(next)
    if (text.length === 4) submit(text)
    else refs.current[text.length]?.focus()
  }

  return (
    <div className="grid min-h-screen place-items-center bg-ink-950 px-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-7 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-900 text-lg font-bold text-brand-100 shadow-lift">
            EC
          </span>
          <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight text-white">
            EC Price Tracker
          </h1>
          <p className="mt-1 text-sm text-ink-300">Enter your PIN to unlock the rate monitor</p>
        </div>

        <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-inset ring-white/10 backdrop-blur">
          <div className="flex justify-center gap-2.5" onPaste={onPaste}>
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  refs.current[i] = el
                }}
                value={digit}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
                inputMode="numeric"
                autoComplete="one-time-code"
                type="password"
                aria-label={`PIN digit ${i + 1}`}
                disabled={checking}
                className={cx(
                  'h-14 w-12 rounded-xl bg-white/10 text-center text-xl font-semibold text-white',
                  'ring-1 ring-inset transition focus:bg-white/15 focus:outline-none focus:ring-2',
                  error ? 'ring-red-400/60 focus:ring-red-400' : 'ring-white/15 focus:ring-brand-400',
                )}
              />
            ))}
          </div>

          {error && (
            <p className="mt-3 text-center text-xs font-medium text-red-300" role="alert">
              {error}
            </p>
          )}

          {checking && (
            <p className="mt-3 flex items-center justify-center gap-2 text-xs text-ink-300">
              <Spinner className="h-3.5 w-3.5" /> Unlocking…
            </p>
          )}

          <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-400">
            Session lasts 30 days on this device. Use “Lock 🔒” in the nav to sign out
            immediately.
          </p>
        </div>
      </div>
    </div>
  )
}