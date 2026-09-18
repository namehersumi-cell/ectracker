import { useApp } from '../lib/app-context.jsx'
import { cx } from '../lib/format.js'

const TONE = {
  brand: 'bg-white ring-brand-200',
  emerald: 'bg-emerald-50 ring-emerald-200',
  amber: 'bg-amber-50 ring-amber-200',
  red: 'bg-red-50 ring-red-200',
}

const ACCENT = {
  brand: 'bg-brand-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
}

export default function Toasts() {
  const { toasts, dismissToast } = useApp()
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-24 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:top-20 sm:bottom-auto sm:items-end">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            'pointer-events-auto flex w-full max-w-sm animate-slide-in items-start gap-2.5 overflow-hidden rounded-xl px-3.5 py-3 shadow-lift ring-1',
            TONE[t.tone] || TONE.brand,
          )}
        >
          <span className={cx('mt-0.5 h-2 w-2 shrink-0 rounded-full', ACCENT[t.tone] || ACCENT.brand)} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900">{t.message}</p>
            {t.detail && <p className="mt-0.5 text-xs text-ink-600">{t.detail}</p>}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="shrink-0 rounded p-0.5 text-ink-400 transition hover:bg-black/5 hover:text-ink-700"
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}