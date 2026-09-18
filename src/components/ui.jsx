import { useEffect, useState } from 'react'
import { cx } from '../lib/format.js'

export function Spinner({ className = 'h-4 w-4' }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Badge({ children, className = '', tone = 'slate' }) {
  return <span className={cx('badge', TONE_CLASS[tone], className)}>{children}</span>
}

const TONE_CLASS = {
  slate: 'bg-ink-100 text-ink-600',
  brand: 'bg-brand-100 text-brand-800',
  emerald: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  teal: 'bg-teal-100 text-teal-800',
}

export function Dot({ tone = 'emerald', pulse = false }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && (
        <span
          className={cx(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
            DOT_BG[tone],
          )}
        />
      )}
      <span className={cx('relative inline-flex h-2 w-2 rounded-full', DOT_BG[tone])} />
    </span>
  )
}

const DOT_BG = {
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  slate: 'bg-ink-400',
  brand: 'bg-brand-500',
}

export function Card({ children, className = '', as: Tag = 'div' }) {
  return <Tag className={cx('card', className)}>{children}</Tag>
}

export function SectionTitle({ children, hint, action }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight text-ink-900">{children}</h2>
        {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ icon = '🗂️', title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-200 bg-white/60 px-6 py-10 text-center">
      <span className="text-2xl" aria-hidden>
        {icon}
      </span>
      <p className="text-sm font-semibold text-ink-700">{title}</p>
      {hint && <p className="max-w-sm text-xs text-ink-500">{hint}</p>}
      {action}
    </div>
  )
}

export function Skeleton({ className = 'h-4 w-full' }) {
  return (
    <div className={cx('relative overflow-hidden rounded-md bg-ink-100', className)}>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/70 to-transparent" />
    </div>
  )
}

export function ErrorNote({ children, onRetry }) {
  if (!children) return null
  return (
    <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-200">
      <span aria-hidden>⚠️</span>
      <div className="flex-1">{children}</div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold underline">
          Retry
        </button>
      )}
    </div>
  )
}

/** Modal with Escape-to-close and focus containment. */
export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'relative z-10 w-full animate-fade-up rounded-t-2xl bg-white shadow-lift sm:rounded-2xl',
          width,
        )}
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
          <h3 className="font-display text-base font-semibold text-ink-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
            aria-label="Close dialog"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 scroll-thin">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/** Inline sparkline. Pure SVG so it stays crisp and dependency-free. */
export function Sparkline({ points, width = 120, height = 32, tone = '#1c8386' }) {
  if (!points || points.length < 2) {
    return <div className="text-[11px] text-ink-400">not enough data</div>
  }
  const values = points.map((p) => p.price)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const step = width / (points.length - 1)
  const coords = points.map((p, i) => [i * step, height - ((p.price - min) / range) * (height - 6) - 3])
  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${path} L${width},${height} L0,${height} Z`
  const id = `spark-${tone.replace('#', '')}-${points.length}`

  return (
    <svg width={width} height={height} className="overflow-visible" role="img" aria-label="Price trend">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.24" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={path} fill="none" stroke={tone} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="2.5" fill={tone} />
    </svg>
  )
}

export function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-brand-600' : 'bg-ink-300',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cx(
          'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[1.15rem]' : 'translate-x-[0.2rem]',
        )}
      />
    </button>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-ink-100 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cx(
            'rounded-md px-3 py-1.5 text-xs font-semibold transition',
            value === tab.value
              ? 'bg-white text-ink-900 shadow-sm'
              : 'text-ink-500 hover:text-ink-800',
          )}
        >
          {tab.label}
          {tab.count != null && (
            <span className="ml-1.5 text-[10px] font-bold text-ink-400">{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

/** Confirmation step for destructive actions, inline rather than window.confirm. */
export function ConfirmButton({ onConfirm, children, confirmLabel = 'Confirm?', className = 'btn-danger' }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return undefined
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      className={cx(className, armed && 'bg-red-600 text-white ring-red-600 hover:bg-red-700')}
      onClick={() => {
        if (armed) {
          onConfirm()
          setArmed(false)
        } else {
          setArmed(true)
        }
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  )
}