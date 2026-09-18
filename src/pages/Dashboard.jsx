import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp, useFetch } from '../lib/app-context.jsx'
import { api } from '../lib/api.js'
import {
  ALERT_META,
  OTA_LABELS,
  OTA_STYLES,
  cx,
  relativeTime,
  rm,
  roomsLabel,
  roomsTone,
  comparison,
} from '../lib/format.js'
import {
  Badge,
  Card,
  Dot,
  EmptyState,
  Modal,
  SectionTitle,
  Skeleton,
  Sparkline,
  Spinner,
  Toggle,
} from '../components/ui.jsx'

const TONE_BG = {
  emerald: 'text-emerald-700',
  amber: 'text-amber-700',
  red: 'text-red-600',
  slate: 'text-ink-400',
}

export default function Dashboard() {
  const { dashboard, runCheckAll, busy, status, refreshDashboard, toast } = useApp()
  const { data: series } = useFetch('/dashboard/series?days=14')
  const [actionAlert, setActionAlert] = useState(null)

  const checkingAll = busy === 'check-all'
  const checkAge = dashboard?.lastCheckAt
    ? (Date.now() - new Date(dashboard.lastCheckAt).getTime()) / 60000
    : Infinity
  const stale = checkAge > 90

  if (!dashboard) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-5">
            <Skeleton className="mb-3 h-4 w-1/3" />
            <Skeleton className="mb-2 h-8 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </Card>
        ))}
      </div>
    )
  }

  const { myHotel, competitors, compSet, unreadAlerts, health, usage, handover } = dashboard

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">
            {new Date().toLocaleDateString('en-MY', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: 'Asia/Kuala_Lumpur',
            })}
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
            {greeting()}, {myHotel.name}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={stale ? 'amber' : 'emerald'}>
            <Dot tone={stale ? 'amber' : 'emerald'} pulse={!stale} />
            Last check: {dashboard.lastCheckAt ? relativeTime(dashboard.lastCheckAt) : 'never'}
          </Badge>
          {stale && dashboard.lastCheckAt && (
            <span className="text-[11px] text-amber-700">
              Scheduler may be down — expected hourly
            </span>
          )}
        </div>
      </div>

      {status?.gemini === 'simulated' && (
        <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
          <span aria-hidden className="text-sm">
            🧪
          </span>
          <p>
            <strong className="font-semibold">Simulated data.</strong> No{' '}
            <code className="rounded bg-amber-100 px-1">GEMINI_API_KEY</code> is set, so readings
            are generated locally for demonstration. Add the key to read real OTA pages.
          </p>
        </div>
      )}

      <HandoverNote current={handover?.current} history={handover?.notes} onSaved={refreshDashboard} toast={toast} />

      {/* Comp-set positioning */}
      <section>
        <SectionTitle hint="Latest non-suspect, non-sold-out readings for tonight, mapped rooms only">
          Your position vs the comp set
        </SectionTitle>
        {compSet.length === 0 ? (
          <EmptyState
            icon="📊"
            title="No comparable rates yet"
            hint="Add competitors with room mappings, then run a check to see where your rates sit."
            action={
              <Link to="/competitors" className="btn-primary btn-sm mt-1">
                Add competitors
              </Link>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {compSet.map((row) => (
              <CompSetCard key={row.myRoomTypeId} row={row} />
            ))}
          </div>
        )}
      </section>

      {/* Alerts + health */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base font-semibold text-ink-900">Unread alerts</h2>
              {unreadAlerts.length > 0 && <Badge tone="amber">{unreadAlerts.length}</Badge>}
            </div>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={async () => {
                await api.post('/alerts/read-all')
                await refreshDashboard()
                toast('All alerts marked as read', 'emerald')
              }}
              disabled={!unreadAlerts.length}
            >
              Mark all read
            </button>
          </div>
          <div className="divide-y divide-ink-100">
            {unreadAlerts.length === 0 ? (
              <EmptyState
                icon="🔔"
                title="No unread alerts"
                hint="Sales, sell-outs, undercuts and price moves will appear here the moment they're detected."
              />
            ) : (
              unreadAlerts.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  onChanged={refreshDashboard}
                  onLogAction={() => setActionAlert(alert)}
                />
              ))
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="font-display text-base font-semibold text-ink-900">OTA health</h2>
            <p className="mt-0.5 text-xs text-ink-500">One dead OTA never blocks the others.</p>
            <ul className="mt-3 space-y-2">
              {health?.map((h) => (
                <li key={h.ota} className="flex items-center gap-2.5">
                  <Dot tone={h.healthy ? 'emerald' : 'red'} pulse={!h.healthy} />
                  <span className="flex-1 text-sm font-medium text-ink-700">{h.otaLabel}</span>
                  <span className="text-[11px] text-ink-400">
                    {h.healthy
                      ? h.lastSuccessAt
                        ? relativeTime(h.lastSuccessAt)
                        : 'no data yet'
                      : `${h.consecutiveFailures} fails`}
                  </span>
                </li>
              ))}
            </ul>
            {health?.some((h) => !h.healthy) && (
              <p className="mt-3 rounded-lg bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
                {health
                  .filter((h) => !h.healthy)
                  .map((h) => `${h.otaLabel} check failed — page may have changed`)
                  .join(' · ')}
              </p>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="font-display text-base font-semibold text-ink-900">Gemini usage</h2>
            <p className="mt-0.5 text-xs text-ink-500">Free-tier budget, resets at midnight MYT.</p>
            <div className="mt-3">
              <div className="flex items-baseline justify-between">
                <span className="nums text-2xl font-semibold text-ink-900">{usage?.count ?? 0}</span>
                <span className="text-xs text-ink-400">/ {usage?.limit ?? 1500}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                <div
                  className={cnBar(usage?.count, usage?.limit)}
                  style={{
                    width: `${Math.min(100, ((usage?.count || 0) / (usage?.limit || 1500)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Competitor cards */}
      <section>
        <SectionTitle
          hint="Live readings per OTA with your own rate as the benchmark"
          action={
            <button
              type="button"
              onClick={() => runCheckAll()}
              disabled={checkingAll}
              className="btn-primary btn-sm"
            >
              {checkingAll ? <Spinner className="h-3.5 w-3.5" /> : '🔄'} Check all competitors
            </button>
          }
        >
          Competitors
        </SectionTitle>

        {competitors.length === 0 ? (
          <EmptyState
            icon="🏨"
            title="No competitors yet"
            hint="Add your first competitor to start monitoring their rates."
            action={
              <Link to="/competitors" className="btn-primary btn-sm mt-1">
                Add your first competitor
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {competitors.map(({ competitor, byOta, lastCheckAt }) => (
              <CompetitorCard
                key={competitor.id}
                competitor={competitor}
                byOta={byOta}
                lastCheckAt={lastCheckAt}
                myHotel={myHotel}
                series={series}
                onChanged={refreshDashboard}
                onLogAction={setActionAlert}
                busy={busy}
                runCheckAll={runCheckAll}
                toast={toast}
              />
            ))}
          </div>
        )}
      </section>

      <LogActionModal
        alert={actionAlert}
        onClose={() => setActionAlert(null)}
        onSaved={async () => {
          await refreshDashboard()
          toast('Action logged', 'emerald')
        }}
      />
    </div>
  )
}

function cnBar(count = 0, limit = 1500) {
  const pct = count / limit
  if (pct > 0.85) return 'h-full rounded-full bg-red-500 transition-all'
  if (pct > 0.6) return 'h-full rounded-full bg-amber-500 transition-all'
  return 'h-full rounded-full bg-brand-500 transition-all'
}

function greeting() {
  const h = Number(
    new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', hour12: false }),
  )
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function CompSetCard({ row }) {
  const tone = row.delta <= 5 ? 'emerald' : row.delta <= 20 ? 'amber' : 'red'
  const label =
    row.delta > 0
      ? `RM ${row.delta} above average`
      : row.delta < 0
        ? `RM ${Math.abs(row.delta)} below average`
        : 'exactly at average'
  return (
    <Card className={`p-4 ring-1 ring-inset ${RING[tone]}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ink-800">{row.roomName}</span>
        <Badge tone={tone}>
          {row.rank ? `${ordinal(row.rank)} cheapest of ${row.of}` : 'no rank'}
        </Badge>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-400">Comp-set avg</p>
          <p className="nums font-display text-xl font-semibold text-ink-900">{rm(row.avg)}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-ink-400">You</p>
          <p className="nums font-display text-xl font-semibold text-brand-800">{rm(row.myPrice)}</p>
        </div>
      </div>
      <p className={`mt-2 text-xs font-medium ${TONE_BG[tone]}`}>{label}</p>
      <p className="mt-0.5 text-[11px] text-ink-400">
        {row.samples} competitor rate{row.samples === 1 ? '' : 's'} sampled
      </p>
    </Card>
  )
}

const RING = {
  emerald: 'ring-emerald-200',
  amber: 'ring-amber-200',
  red: 'ring-red-200',
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function AlertRow({ alert, onChanged, onLogAction }) {
  const meta = ALERT_META[alert.type] || ALERT_META.PRICE_DROP
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="px-4 py-3 transition hover:bg-ink-50/60">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-base" aria-hidden>
          {meta.emoji}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="text-sm text-ink-800">{alert.message}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-400">
            <span>{relativeTime(alert.createdAt)}</span>
            <span aria-hidden>·</span>
            <span>{alert.otaLabel}</span>
            {alert.notified === false && <Badge tone="slate">not sent</Badge>}
            {alert.mergedOtas?.length > 1 && (
              <Badge tone="brand">merged: {alert.mergedOtas.join(', ')}</Badge>
            )}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="btn-ghost btn-sm" onClick={onLogAction}>
            Log action
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={async () => {
              await api.post(`/alerts/${alert.id}/read`)
              onChanged()
            }}
            aria-label="Mark read"
          >
            ✓
          </button>
        </div>
      </div>
      {expanded && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg bg-ink-50 px-3 py-2.5 text-xs sm:grid-cols-4">
          <Detail label="Room" value={alert.roomType} />
          <Detail label="OTA room name" value={alert.otaRoomName} />
          <Detail label="Stay" value={alert.checkInLabel} />
          <Detail label="Price" value={rm(alert.price)} />
          {alert.myPrice != null && <Detail label="Your rate" value={rm(alert.myPrice)} />}
          {alert.roomsLeft != null && <Detail label="Rooms left" value={alert.roomsLeft} />}
        </dl>
      )}
    </div>
  )
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="font-medium text-ink-700">{value ?? '—'}</dd>
    </div>
  )
}

function CompetitorCard({
  competitor,
  byOta,
  lastCheckAt,
  myHotel,
  series,
  onChanged,
  onLogAction,
  busy,
  runCheckAll,
  toast,
}) {
  const checking = busy === `checking-${competitor.id}`
  const otas = Object.keys(competitor.otaUrls || {}).filter((k) => competitor.otaUrls[k])

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate font-display text-base font-semibold text-ink-900">
            {competitor.name}
          </h3>
          {competitor.isOwn && <Badge tone="brand">Your hotel</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-[11px] text-ink-400 sm:inline">
            {lastCheckAt ? relativeTime(lastCheckAt) : 'never checked'}
          </span>
          <button
            type="button"
            disabled={checking}
            onClick={async () => {
              try {
                await runCheckAll(competitor.id)
              } catch {
                /* toast already surfaced */
              }
            }}
            className="btn-ghost btn-sm"
          >
            {checking ? <Spinner className="h-3.5 w-3.5" /> : '🔄'} Check now
          </button>
        </div>
      </div>

      <div className="divide-y divide-ink-100">
        {otas.map((ota) => {
          const check = byOta[ota]
          return (
            <OtaPanel
              key={ota}
              ota={ota}
              check={check}
              myHotel={myHotel}
              series={series}
              competitorId={competitor.id}
              onChanged={onChanged}
              onLogAction={onLogAction}
              toast={toast}
            />
          )
        })}
      </div>
    </Card>
  )
}

function OtaPanel({ ota, check, myHotel, series, competitorId, onChanged, onLogAction, toast }) {
  const [reported, setReported] = useState(false)

  if (!check) {
    return (
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`badge ${OTA_STYLES[ota]}`}>{OTA_LABELS[ota]}</span>
          <span className="text-xs text-ink-400">no check yet</span>
        </div>
      </div>
    )
  }

  if (check.status === 'error') {
    return (
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`badge ${OTA_STYLES[ota]}`}>{OTA_LABELS[ota]}</span>
          <Badge tone="red">failed</Badge>
          <span className="text-[11px] text-ink-400">{relativeTime(check.checkedAt)}</span>
        </div>
        <p className="mt-1.5 text-xs text-red-700">{check.error}</p>
      </div>
    )
  }

  const rooms = (check.roomTypes || []).filter((r) => r.checkInDate === tonightIso())
  const display = rooms.length ? rooms : (check.roomTypes || []).slice(0, 4)

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`badge ${OTA_STYLES[ota]}`}>{OTA_LABELS[ota]}</span>
        {check.status === 'suspect' && <Badge tone="amber">verify manually 🚩</Badge>}
        {reported && <Badge tone="red">reported</Badge>}
        <span className="text-[11px] text-ink-400">{relativeTime(check.checkedAt)}</span>
        <span className="ml-auto text-[11px] text-ink-400">
          {check.method === 'google_search' ? 'via search fallback' : ''}
        </span>
      </div>

      <div className="mt-2.5 space-y-2">
        {display.map((room, i) => {
          const myRoom = findMyRoom(myHotel, room.name)
          const cmp = comparison(room.price, myRoom?.basePrice)
          const sparkKey = `${competitorId}|${room.name}`
          const points = (series?.[sparkKey] || []).map((p) => ({ price: p.price }))
          return (
            <div
              key={`${room.name}-${room.checkInDate}-${i}`}
              className="flex items-center gap-3 rounded-lg bg-ink-50/60 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-medium text-ink-800">{room.name}</p>
                  {room.suspect && (
                    <span title={room.suspectReason} className="text-[10px]">
                      🚩
                    </span>
                  )}
                  {room.converted && (
                    <span className="text-[10px] text-ink-400" title={`${room.originalPrice} ${room.originalCurrency}`}>
                      fx
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                  <span className={`font-semibold ${TONE_BG[cmp.tone]}`}>{cmp.text}</span>
                  <span className="text-ink-400">{stayLabel(room.checkInDate)}</span>
                </div>
              </div>
              <div className="hidden sm:block">
                <Sparkline points={points} width={80} height={26} />
              </div>
              <div className="text-right">
                <p className="nums text-sm font-semibold text-ink-900">{rm(room.price)}</p>
                <span className={`badge ${TONE_CLASS_SM[roomsTone(room.roomsLeft, room.soldOut)]}`}>
                  {roomsLabel(room.roomsLeft, room.soldOut)}
                </span>
              </div>
              <button
                type="button"
                title="Report wrong reading"
                className="shrink-0 rounded p-1 text-ink-300 transition hover:bg-white hover:text-red-500"
                onClick={async () => {
                  await api.post(`/checks/${check.id}/report`, { roomType: room.name })
                  setReported(true)
                  toast('Reported — flagged for manual verification', 'amber')
                  onChanged()
                }}
              >
                🚩
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className="mt-2 text-[11px] font-semibold text-brand-700 hover:underline"
        onClick={() => onLogAction({ id: null, roomType: display[0]?.name, otaLabel: OTA_LABELS[ota] })}
      >
        Log a rate action →
      </button>
    </div>
  )
}

const TONE_CLASS_SM = {
  emerald: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-600',
  slate: 'bg-ink-100 text-ink-500',
}

function tonightIso() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

function stayLabel(checkInDate) {
  const today = tonightIso()
  const plus7 = new Date(Date.now() + (8 * 3600_000 + 7 * 86_400_000)).toISOString().slice(0, 10)
  if (checkInDate === today) return 'tonight'
  if (checkInDate === plus7) return '+7d'
  return checkInDate
}

function findMyRoom(myHotel, otaRoomName) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(room|rm|the|with|and|breakfast|bed|beds)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const target = norm(otaRoomName)
  return (myHotel?.roomTypes || []).find((r) => {
    const mine = norm(r.name)
    return mine && target && (mine === target || mine.includes(target) || target.includes(mine))
  })
}

function HandoverNote({ current, history, onSaved, toast }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [author, setAuthor] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (current) setText(current.text)
  }, [current])

  const save = async () => {
    if (!text.trim()) return
    setSaving(true)
    try {
      await api.post('/settings/handover', { text, author })
      setEditing(false)
      onSaved()
      toast('Handover note updated', 'emerald')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-l-4 border-l-sand-400 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="text-base" aria-hidden>
            📝
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-sand-700">
              Shift handover
            </p>
            {editing ? (
              <div className="mt-2 w-full space-y-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={2}
                  className="input w-full sm:min-w-[28rem]"
                  placeholder="What should the next shift know?"
                  autoFocus
                />
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="input sm:max-w-[14rem]"
                  placeholder="Your name"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={save} disabled={saving} className="btn-primary btn-sm">
                    {saving ? <Spinner className="h-3.5 w-3.5" /> : null} Save note
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="btn-ghost btn-sm">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="mt-0.5 max-w-3xl text-sm text-ink-800">
                  {current?.text || 'No note yet — leave one for the next shift.'}
                </p>
                {current && (
                  <p className="mt-1 text-[11px] text-ink-400">
                    {current.author} · {relativeTime(current.createdAt)}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        {!editing && (
          <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => setEditing(true)}>
            {current ? 'Edit' : 'Add note'}
          </button>
        )}
      </div>

      {history?.length > 1 && !editing && (
        <details className="mt-3 border-t border-ink-100 pt-2.5">
          <summary className="cursor-pointer text-[11px] font-semibold text-ink-500 hover:text-ink-700">
            Previous {history.length - 1} note{history.length - 1 === 1 ? '' : 's'}
          </summary>
          <ul className="mt-2 space-y-2">
            {history.slice(1).map((n) => (
              <li key={n.id} className="text-xs text-ink-500">
                <span className="text-ink-700">{n.text}</span>
                <span className="ml-1 text-[11px] text-ink-400">
                  — {n.author}, {relativeTime(n.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}

export function LogActionModal({ alert, onClose, onSaved }) {
  const [action, setAction] = useState('held')
  const [newPrice, setNewPrice] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setAction('held')
    setNewPrice('')
    setNote('')
  }, [alert?.id])

  const save = async () => {
    setSaving(true)
    try {
      await api.post('/actions', {
        alertId: alert?.id || null,
        roomType: alert?.roomType || null,
        action,
        newPrice: newPrice === '' ? null : Number(newPrice),
        note,
      })
      onClose()
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  const actions = [
    { value: 'raised', label: 'Raised my rate' },
    { value: 'matched', label: 'Matched them' },
    { value: 'held', label: 'Held my rate' },
    { value: 'lowered', label: 'Lowered my rate' },
  ]

  return (
    <Modal
      open={Boolean(alert)}
      onClose={onClose}
      title="Log my action"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={save} disabled={saving}>
            {saving && <Spinner className="h-3.5 w-3.5" />} Save action
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {alert?.roomType && (
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
            Logging for <strong className="font-semibold">{alert.roomType}</strong>
            {alert.otaLabel ? ` · ${alert.otaLabel}` : ''}
          </p>
        )}
        <div>
          <span className="label mb-1.5">What did you do?</span>
          <div className="grid grid-cols-2 gap-2">
            {actions.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => setAction(a.value)}
                className={`rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset transition ${
                  action === a.value
                    ? 'bg-brand-50 text-brand-800 ring-brand-300'
                    : 'bg-white text-ink-600 ring-ink-200 hover:bg-ink-50'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label mb-1.5" htmlFor="action-price">
            New price (RM, optional)
          </label>
          <input
            id="action-price"
            type="number"
            min="0"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            className="input"
            placeholder="e.g. 175"
          />
        </div>
        <div>
          <label className="label mb-1.5" htmlFor="action-note">
            Note (optional)
          </label>
          <textarea
            id="action-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="input"
            placeholder="Why this decision?"
          />
        </div>
      </div>
    </Modal>
  )
}