import { useMemo, useState } from 'react'
import { api, downloadFile } from '../lib/api.js'
import { useApp, useFetch } from '../lib/app-context.jsx'
import {
  ALERT_META,
  OTA_LABELS,
  cx,
  formatKL,
  relativeTime,
  rm,
  roomsLabel,
  roomsTone,
} from '../lib/format.js'
import { Badge, Card, EmptyState, SectionTitle, Skeleton, Tabs, Spinner } from '../components/ui.jsx'

const TONE_CLASS = {
  emerald: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-600',
  slate: 'bg-ink-100 text-ink-500',
}

export default function History() {
  const { toast, refreshDashboard } = useApp()
  const { data: competitors } = useFetch('/competitors')
  const [tab, setTab] = useState('checks')

  const [filters, setFilters] = useState({
    competitorId: '',
    ota: '',
    roomType: '',
    status: '',
    from: '',
    to: '',
  })

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (filters.competitorId) params.set('competitorId', filters.competitorId)
    if (filters.ota) params.set('ota', filters.ota)
    if (filters.status) params.set('status', filters.status)
    if (filters.from) params.set('from', `${filters.from}T00:00:00.000Z`)
    if (filters.to) params.set('to', `${filters.to}T23:59:59.999Z`)
    const qs = params.toString()
    return `/checks${qs ? `?${qs}` : ''}`
  }, [filters])

  const { data: checks, loading, reload } = useFetch(query, [query])
  const { data: stats } = useFetch('/history/stats')

  // Room-type filtering is done client-side because the room name lives inside
  // each check's nested roomTypes array rather than on the check itself.
  const filteredChecks = useMemo(() => {
    const rows = checks || []
    if (!filters.roomType) return rows
    const needle = filters.roomType.toLowerCase()
    return rows
      .map((c) => ({
        ...c,
        roomTypes: (c.roomTypes || []).filter((r) => r.name.toLowerCase().includes(needle)),
      }))
      .filter((c) => c.roomTypes.length > 0)
  }, [checks, filters.roomType])

  const flatRows = useMemo(() => {
    const rows = []
    for (const check of filteredChecks) {
      for (const rt of check.roomTypes?.length ? check.roomTypes : [null]) {
        rows.push({ check, rt })
      }
    }
    return rows
  }, [filteredChecks])

  const exportCsv = () => {
    const params = new URLSearchParams()
    if (filters.competitorId) params.set('competitorId', filters.competitorId)
    if (filters.ota) params.set('ota', filters.ota)
    if (filters.status) params.set('status', filters.status)
    if (filters.from) params.set('from', `${filters.from}T00:00:00.000Z`)
    if (filters.to) params.set('to', `${filters.to}T23:59:59.999Z`)
    const qs = params.toString()
    downloadFile(`/export/checks.csv${qs ? `?${qs}` : ''}`, `hoteltrackr-checks.csv`)
      .then(() => toast('CSV exported', 'emerald'))
      .catch((err) => toast('Export failed', 'red', err.message))
  }

  const exportConfig = () => {
    downloadFile('/export/config.json', 'hoteltrackr-config.json')
      .then(() => toast('Config backup downloaded', 'emerald', 'Competitors, mappings and settings.'))
      .catch((err) => toast('Backup failed', 'red', err.message))
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">History</h1>
          <p className="mt-1 text-sm text-ink-500">
            Every reading, alert and logged action — filterable and exportable.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={exportCsv} className="btn-ghost">
            ︎ Export CSV
          </button>
          <button type="button" onClick={exportConfig} className="btn-ghost">
            ︎ Config backup
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Total checks" value={stats.totalChecks} />
          <Stat label="Failed" value={stats.errors} tone="red" />
          <Stat label="Suspect" value={stats.suspect} tone="amber" />
          <Stat label="Reported" value={stats.reported} tone="red" />
          <Stat label="Alerts" value={stats.totalAlerts} />
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'checks', label: 'Price checks' },
          { value: 'alerts', label: 'Alerts' },
          { value: 'actions', label: 'Actions log' },
        ]}
      />

      {tab === 'checks' && (
        <>
          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <label className="label mb-1.5" htmlFor="f-comp">
                  Competitor
                </label>
                <select
                  id="f-comp"
                  value={filters.competitorId}
                  onChange={(e) => setFilters({ ...filters, competitorId: e.target.value })}
                  className="input"
                >
                  <option value="">All</option>
                  {(competitors || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label mb-1.5" htmlFor="f-ota">
                  OTA
                </label>
                <select
                  id="f-ota"
                  value={filters.ota}
                  onChange={(e) => setFilters({ ...filters, ota: e.target.value })}
                  className="input"
                >
                  <option value="">All</option>
                  {Object.entries(OTA_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label mb-1.5" htmlFor="f-room">
                  Room type
                </label>
                <input
                  id="f-room"
                  value={filters.roomType}
                  onChange={(e) => setFilters({ ...filters, roomType: e.target.value })}
                  className="input"
                  placeholder="Contains…"
                />
              </div>
              <div>
                <label className="label mb-1.5" htmlFor="f-status">
                  Status
                </label>
                <select
                  id="f-status"
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  className="input"
                >
                  <option value="">All</option>
                  <option value="ok">OK</option>
                  <option value="suspect">Suspect</option>
                  <option value="error">Error</option>
                </select>
              </div>
              <div>
                <label className="label mb-1.5" htmlFor="f-from">
                  From
                </label>
                <input
                  id="f-from"
                  type="date"
                  value={filters.from}
                  onChange={(e) => setFilters({ ...filters, from: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="label mb-1.5" htmlFor="f-to">
                  To
                </label>
                <input
                  id="f-to"
                  type="date"
                  value={filters.to}
                  onChange={(e) => setFilters({ ...filters, to: e.target.value })}
                  className="input"
                />
              </div>
            </div>
            {activeFilterCount > 0 && (
              <button
                type="button"
                className="mt-3 text-xs font-semibold text-brand-700 hover:underline"
                onClick={() =>
                  setFilters({ competitorId: '', ota: '', roomType: '', status: '', from: '', to: '' })
                }
              >
                Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
              </button>
            )}
          </Card>

          {loading ? (
            <Card className="p-4">
              <Skeleton className="h-40 w-full" />
            </Card>
          ) : flatRows.length === 0 ? (
            <EmptyState
              icon="🗃️"
              title="No checks match these filters"
              hint="Run a check, or widen the date range."
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full min-w-[54rem] text-sm">
                  <thead className="table-head">
                    <tr>
                      {['Checked (MYT)', 'Competitor', 'OTA', 'Room type', 'Stay', 'Price', 'Rooms', 'Status'].map(
                        (h) => (
                          <th key={h} className="px-3 py-2.5 text-left font-semibold">
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {flatRows.slice(0, 300).map(({ check, rt }, i) => (
                      <tr key={`${check.id}-${i}`} className="transition hover:bg-ink-50/50">
                        <td className="nums whitespace-nowrap px-3 py-2 text-xs text-ink-500">
                          {formatKL(check.checkedAt, { short: true })}
                        </td>
                        <td className="px-3 py-2 text-ink-800">{check.competitorName}</td>
                        <td className="px-3 py-2 text-xs text-ink-600">
                          {check.otaLabel || OTA_LABELS[check.ota]}
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-ink-800">{rt?.name || '—'}</span>
                          {rt?.suspect && (
                            <span className="ml-1 text-[10px]" title={rt.suspectReason}>
                              🚩
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-500">{rt?.checkInDate || '—'}</td>
                        <td className="nums px-3 py-2 font-medium text-ink-900">
                          {rt ? rm(rt.price) : '—'}
                          {rt?.converted && (
                            <span className="ml-1 text-[10px] font-normal text-ink-400">
                              from {rt.originalPrice} {rt.originalCurrency}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {rt ? (
                            <span
                              className={cx('badge', TONE_CLASS[roomsTone(rt.roomsLeft, rt.soldOut)])}
                            >
                              {roomsLabel(rt.roomsLeft, rt.soldOut)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={check.status} reported={check.reported} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {flatRows.length > 300 && (
                <p className="border-t border-ink-100 px-3 py-2 text-[11px] text-ink-400">
                  Showing the 300 most recent rows of {flatRows.length}. Export CSV for the full set.
                </p>
              )}
            </Card>
          )}
        </>
      )}

      {tab === 'alerts' && <AlertsTab />}
      {tab === 'actions' && <ActionsTab />}
    </div>
  )
}

function StatusBadge({ status, reported }) {
  const tone = status === 'error' ? 'red' : status === 'suspect' ? 'amber' : 'emerald'
  return (
    <span className="flex items-center gap-1.5">
      <Badge tone={tone}>{status}</Badge>
      {reported && <Badge tone="red">reported</Badge>}
    </span>
  )
}

function AlertsTab() {
  const { refreshDashboard } = useApp()
  const [type, setType] = useState('')
  const [readState, setReadState] = useState('')
  const params = new URLSearchParams()
  if (type) params.set('type', type)
  if (readState) params.set('read', readState)
  const qs = params.toString()
  const { data: alerts, loading, reload } = useFetch(`/alerts${qs ? `?${qs}` : ''}`, [qs])

  const counts = useMemo(() => {
    const acc = {}
    for (const a of alerts || []) acc[a.type] = (acc[a.type] || 0) + 1
    return acc
  }, [alerts])

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)} className="input max-w-[12rem]">
            <option value="">All alert types</option>
            {Object.entries(ALERT_META).map(([k, v]) => (
              <option key={k} value={k}>
                {v.emoji} {v.label}
              </option>
            ))}
          </select>
          <select
            value={readState}
            onChange={(e) => setReadState(e.target.value)}
            className="input max-w-[10rem]"
          >
            <option value="">Read + unread</option>
            <option value="false">Unread only</option>
            <option value="true">Read only</option>
          </select>
          <span className="text-xs text-ink-400">{alerts?.length ?? 0} alerts</span>
        </div>
      </Card>

      {loading ? (
        <Card className="p-4">
          <Skeleton className="h-32 w-full" />
        </Card>
      ) : (alerts || []).length === 0 ? (
        <EmptyState
          icon="🔔"
          title="No alerts match"
          hint="Alerts appear when a competitor sells a room, sells out, undercuts you or moves price by RM 10+."
        />
      ) : (
        <Card className="divide-y divide-ink-100">
          {alerts.map((alert) => {
            const meta = ALERT_META[alert.type] || ALERT_META.PRICE_DROP
            return (
              <div key={alert.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5" aria-hidden>
                  {meta.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-800">{alert.message}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-400">
                    <span className="nums">{formatKL(alert.createdAt, { short: true })}</span>
                    <span aria-hidden>·</span>
                    <span>{relativeTime(alert.createdAt)}</span>
                    {!alert.read && <Badge tone="amber">unread</Badge>}
                    {alert.notified === false && <Badge tone="slate">not sent</Badge>}
                  </p>
                </div>
                {!alert.read && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={async () => {
                      await api.post(`/alerts/${alert.id}/read`)
                      await Promise.all([reload(), refreshDashboard()])
                    }}
                  >
                    ✓
                  </button>
                )}
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}

function ActionsTab() {
  const { data: actions, loading } = useFetch('/actions')
  if (loading) {
    return (
      <Card className="p-4">
        <Skeleton className="h-24 w-full" />
      </Card>
    )
  }
  if (!(actions || []).length) {
    return (
      <EmptyState
        icon="📋"
        title="No actions logged"
        hint="Use “Log my action” on an alert or a competitor card to record what you did about a rate."
      />
    )
  }
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="table-head">
            <tr>
              {['When (MYT)', 'Room type', 'Action', 'New price', 'Note'].map((h) => (
                <th key={h} className="px-3 py-2.5 text-left font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {actions.map((a) => (
              <tr key={a.id} className="transition hover:bg-ink-50/50">
                <td className="nums whitespace-nowrap px-3 py-2 text-xs text-ink-500">
                  {formatKL(a.createdAt, { short: true })}
                </td>
                <td className="px-3 py-2 text-ink-800">{a.roomType || '—'}</td>
                <td className="px-3 py-2">
                  <Badge tone="brand">{a.action}</Badge>
                </td>
                <td className="nums px-3 py-2 text-ink-800">{a.newPrice != null ? rm(a.newPrice) : '—'}</td>
                <td className="px-3 py-2 text-xs text-ink-500">{a.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Stat({ label, value, tone = 'slate' }) {
  return (
    <Card className="px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-ink-400">{label}</p>
      <p
        className={cx(
          'nums mt-0.5 text-lg font-semibold',
          tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-ink-900',
        )}
      >
        {value ?? '—'}
      </p>
    </Card>
  )
}