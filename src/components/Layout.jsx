import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useApp } from '../lib/app-context.jsx'
import { cx } from '../lib/format.js'
import { Dot, Spinner } from './ui.jsx'

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'grid', end: true },
  { to: '/hotel', label: 'My Hotel', icon: 'building' },
  { to: '/competitors', label: 'Competitors', icon: 'users' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/history', label: 'History', icon: 'list' },
  { to: '/settings', label: 'Settings', icon: 'cog' },
]

const ICONS = {
  grid: 'M3 3h6v6H3V3zm0 8h6v6H3v-6zm8-8h6v6h-6V3zm0 8h6v6h-6v-6z',
  building:
    'M4 3h8v14H4V3zm2 2v2h2V5H6zm0 4v2h2V9H6zm0 4v2h2v-2H6zm10-6h2v10h-2V7zm-4 4h2v6h-2v-6z',
  users:
    'M7 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1 17c0-2.8 2.7-5 6-5s6 2.2 6 5v1H1v-1zm14.5 1H19v-1c0-1.7-.8-3.2-2-4.2.5-.1 1-.2 1.5-.2 2.5 0 4.5 1.6 4.5 3.6V18h-7.5z',
  calendar:
    'M6 2v2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H8V2H6zM4 9h12v9H4V9z',
  list: 'M4 5h16v2H4V5zm0 4h16v2H4V9zm0 4h10v2H4v-2z',
  cog: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4a9 9 0 0 0-.1-1.3l2-1.5-2-3.5-2.3 1a9 9 0 0 0-2.2-1.3L16 3H8l-.4 2.4a9 9 0 0 0-2.2 1.3l-2.3-1-2 3.5 2 1.5a9 9 0 0 0 0 2.6l-2 1.5 2 3.5 2.3-1a9 9 0 0 0 2.2 1.3L8 21h8l.4-2.4a9 9 0 0 0 2.2-1.3l2.3 1 2-3.5-2-1.5c.1-.4.1-.9.1-1.3z',
}

function Icon({ name, className = 'h-4.5 w-4.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  )
}

export default function Layout() {
  const { dashboard, status, runCheckAll, busy, lock } = useApp()
  const location = useLocation()
  const checking = busy === 'check-all'

  const current = NAV.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))

  return (
    <div className="min-h-screen bg-ink-50 pb-20 md:pb-0">
      <header className="sticky top-0 z-30 border-b border-ink-900/5 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-950 text-sm font-bold text-brand-100 shadow-sm">
              EC
            </span>
            <div className="leading-tight">
              <p className="font-display text-base font-semibold tracking-tight text-ink-900">
                EC Price Tracker
              </p>
              <p className="hidden text-[11px] text-ink-500 sm:block">
                {dashboard?.myHotel?.name || 'Competitor rate monitor'}
              </p>
            </div>
          </div>

          <nav className="ml-6 hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
                    isActive
                      ? 'bg-brand-50 text-brand-800'
                      : 'text-ink-500 hover:bg-ink-50 hover:text-ink-800',
                  )
                }
              >
                <Icon name={item.icon} className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {status && !status.locked && (
              <span className="hidden items-center gap-1.5 rounded-md bg-ink-50 px-2 py-1 text-[11px] font-medium text-ink-500 sm:flex">
                <Dot
                  tone={status.gemini === 'live' ? 'emerald' : 'amber'}
                  pulse={status.gemini === 'live'}
                />
                {status.gemini === 'live' ? 'Gemini live' : 'Simulated'}
              </span>
            )}
            <button
              type="button"
              onClick={() => runCheckAll()}
              disabled={checking}
              className="btn-primary btn-sm sm:px-3.5 sm:py-2 sm:text-sm"
            >
              {checking ? <Spinner /> : <span aria-hidden>🔄</span>}
              <span className="hidden sm:inline">{checking ? 'Checking…' : 'Check Now'}</span>
              <span className="sm:hidden">Check</span>
            </button>
            {status?.pinGate === 'enabled' && (
              <button
                type="button"
                onClick={lock}
                className="btn-ghost btn-sm"
                title="Lock the app"
              >
                Lock 🔒
              </button>
            )}
          </div>
        </div>
        {checking && (
          <div className="h-0.5 w-full overflow-hidden bg-brand-100">
            <div className="h-full w-1/3 animate-[shimmer_1.2s_infinite] bg-brand-500" />
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7">
        <div key={location.pathname} className="animate-fade-up">
          <Outlet />
        </div>
      </main>

      {/* Bottom nav on phones — the spec's mobile requirement. */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-ink-900/5 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        <div className="flex items-stretch">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx(
                  'flex flex-1 flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] font-semibold transition',
                  isActive ? 'text-brand-700' : 'text-ink-400',
                )
              }
            >
              <Icon name={item.icon} className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </div>
        <span className="sr-only">{current?.label}</span>
      </nav>
    </div>
  )
}