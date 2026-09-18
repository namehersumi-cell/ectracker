import { useEffect, useMemo, useState } from 'react'
import { useFetch } from '../lib/app-context.jsx'
import { ALERT_META, DOW_LABELS, cx, heatColor, rm } from '../lib/format.js'
import { Badge, Card, EmptyState, SectionTitle, Skeleton, Tabs } from '../components/ui.jsx'

const MONTHS_BACK = 3

export default function CalendarPage() {
  const { data: competitors } = useFetch('/competitors')
  const { data: myHotel } = useFetch('/settings/my-hotel')
  const [competitorId, setCompetitorId] = useState('')
  const [roomType, setRoomType] = useState('')
  const [stayView, setStayView] = useState('all')
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!competitorId && competitors?.length) setCompetitorId(competitors[0].id)
  }, [competitors, competitorId])

  const { data: mappings } = useFetch(
    competitorId ? `/room-mappings?competitorId=${competitorId}` : null,
    [competitorId],
  )

  // Offer the competitor's own OTA room names plus my room types, because the
  // stored room name may be either depending on how the mapping was written.
  const roomOptions = useMemo(() => {
    const names = new Set()
    for (const m of mappings || []) names.add(m.otaRoomName)
    for (const r of myHotel?.roomTypes || []) names.add(r.name)
    return [...names].filter(Boolean)
  }, [mappings, myHotel])

  useEffect(() => {
    if (roomOptions.length && !roomOptions.includes(roomType)) setRoomType(roomOptions[0])
  }, [roomOptions, roomType])

  const query =
    competitorId && roomType
      ? `/calendar?competitorId=${competitorId}&roomType=${encodeURIComponent(roomType)}&checkInDate=${stayView}`
      : null
  const { data, loading } = useFetch(query, [competitorId, roomType, stayView])

  const cells = data?.cells || []
  const stats = data?.stats
  const byDay = useMemo(() => Object.fromEntries(cells.map((c) => [c.day, c])), [cells])
  const prices = cells.map((c) => c.median).filter((p) => p != null)
  const min = prices.length ? Math.min(...prices) : null
  const max = prices.length ? Math.max(...prices) : null

  const months = useMemo(() => buildMonths(MONTHS_BACK), [])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">Calendar</h1>
        <p className="mt-1 text-sm text-ink-500">
          Median rate per day, coloured from cheapest to most expensive. Grey means no reading.
        </p>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label mb-1.5" htmlFor="cal-competitor">
              Competitor
            </label>
            <select
              id="cal-competitor"
              value={competitorId}
              onChange={(e) => setCompetitorId(e.target.value)}
              className="input"
            >
              {(competitors || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isOwn ? ' (you)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label mb-1.5" htmlFor="cal-room">
              Room type
            </label>
            <select
              id="cal-room"
              value={roomType}
              onChange={(e) => setRoomType(e.target.value)}
              className="input"
            >
              {roomOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="label mb-1.5">Stay view</span>
            <Tabs
              value={stayView}
              onChange={setStayView}
              tabs={[
                { value: 'all', label: 'All' },
                { value: 'tonight', label: 'Tonight' },
                { value: '+7d', label: '+7d' },
                { value: '+30d', label: '+30d' },
              ]}
            />
          </div>
        </div>
        {stayView !== 'all' && (
          <p className="mt-2 text-[11px] text-ink-400">
            Filtering by the check-in date that was priced, not the day the check ran.
          </p>
        )}
      </Card>

      {loading ? (
        <Card className="p-5">
          <Skeleton className="h-64 w-full" />
        </Card>
      ) : !competitorId || !roomType ? (
        <EmptyState
          icon="📅"
          title="Nothing to plot yet"
          hint="Add a competitor with a room mapping, then run a check to build history."
        />
      ) : cells.length === 0 ? (
        <EmptyState
          icon="📅"
          title="No readings for this selection"
          hint="Run a check, or pick a different competitor, room type or stay view."
        />
      ) : (
        <>
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs text-ink-500">
                {cells.length} day{cells.length === 1 ? '' : 's'} with data
              </p>
              <HeatLegend min={min} max={max} />
            </div>
            <div className="space-y-5">
              {months.map((month) => (
                <MonthGrid
                  key={month.key}
                  month={month}
                  byDay={byDay}
                  min={min}
                  max={max}
                  onSelect={setSelected}
                  selectedDay={selected?.day}
                />
              ))}
            </div>
          </Card>

          {stats && <StatsPanel stats={stats} />}
        </>
      )}

      {selected && (
        <Card className="animate-fade-up p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-semibold text-ink-900">
                {formatDayLong(selected.day)}
              </h3>
              <p className="mt-0.5 text-xs text-ink-500">
                {selected.samples} reading{selected.samples === 1 ? '' : 's'} that day
              </p>
            </div>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Median" value={rm(selected.median)} />
            <Stat label="Lowest" value={rm(selected.min)} />
            <Stat label="Highest" value={rm(selected.max)} />
            <Stat
              label="Rooms left (min)"
              value={selected.roomsLeft == null ? 'n/a' : selected.roomsLeft}
            />
          </div>

          {selected.alerts?.length > 0 && (
            <div className="mt-4">
              <p className="label mb-2">Alerts that day</p>
              <ul className="space-y-1.5">
                {selected.alerts.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-ink-700">
                    <span aria-hidden>{ALERT_META[a.type]?.emoji || '•'}</span>
                    <span>{a.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {selected.actions?.length > 0 && (
            <div className="mt-4">
              <p className="label mb-2">Actions logged</p>
              <ul className="space-y-1.5">
                {selected.actions.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-ink-700">
                    <Badge tone="brand">{a.action}</Badge>
                    {a.newPrice != null && <span className="nums">{rm(a.newPrice)}</span>}
                    {a.note && <span className="text-ink-500">— {a.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function buildMonths(back) {
  const now = new Date(Date.now() + 8 * 3600_000)
  const months = []
  for (let i = back - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    months.push({
      key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`,
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      label: d.toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    })
  }
  return months
}

function MonthGrid({ month, byDay, min, max, onSelect, selectedDay }) {
  const first = new Date(Date.UTC(month.year, month.month, 1))
  const daysInMonth = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate()
  const leading = first.getUTCDay()
  const cells = []
  for (let i = 0; i < leading; i += 1) cells.push(null)
  for (let d = 1; d <= daysInMonth; d += 1) {
    const iso = new Date(Date.UTC(month.year, month.month, d)).toISOString().slice(0, 10)
    cells.push({ day: iso, data: byDay[iso] || null })
  }

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
        {month.label}
      </p>
      <div className="grid grid-cols-7 gap-1">
        {DOW_LABELS.map((d) => (
          <span key={d} className="pb-1 text-center text-[10px] font-semibold text-ink-400">
            {d.slice(0, 1)}
          </span>
        ))}
        {cells.map((cell, i) =>
          cell === null ? (
            <span key={`pad-${i}`} />
          ) : (
            <button
              key={cell.day}
              type="button"
              disabled={!cell.data}
              onClick={() => cell.data && onSelect(cell.data)}
              title={
                cell.data
                  ? `${cell.day}: ${rm(cell.data.median)} median`
                  : `${cell.day}: no data`
              }
              className={cx(
                'relative flex aspect-square flex-col items-center justify-center rounded-md text-[10px] font-semibold transition',
                cell.data ? 'cursor-pointer hover:scale-[1.06] hover:shadow-md' : 'cursor-default',
                selectedDay === cell.day && 'ring-2 ring-brand-600 ring-offset-1',
              )}
              style={{
                backgroundColor: cell.data ? heatColor(cell.data.median, min, max) : '#f6f7f9',
                color: cell.data ? 'white' : '#b0bac9',
              }}
            >
              <span>{Number(cell.day.slice(-2))}</span>
              {cell.data && (
                <span className="nums text-[8px] font-normal opacity-90">
                  {Math.round(cell.data.median)}
                </span>
              )}
              {cell.data?.alerts?.length > 0 && (
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-ink-950/70" />
              )}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

function HeatLegend({ min, max }) {
  if (min == null) return null
  const steps = 5
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-ink-400">{rm(min)}</span>
      <div className="flex overflow-hidden rounded">
        {Array.from({ length: steps }, (_, i) => (
          <span
            key={i}
            className="h-2.5 w-5"
            style={{ backgroundColor: heatColor(min + ((max - min) * i) / (steps - 1), min, max) }}
          />
        ))}
      </div>
      <span className="text-[10px] text-ink-400">{rm(max)}</span>
    </div>
  )
}

function StatsPanel({ stats }) {
  return (
    <Card className="p-4">
      <SectionTitle hint="Computed only from days with real readings — no invented numbers">
        Patterns
      </SectionTitle>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="label mb-2">Average by day of week</p>
          <ul className="space-y-1.5">
            {stats.dowAverages.map((row) => (
              <li key={row.dayOfWeek} className="flex items-center gap-2">
                <span className="w-9 text-xs font-medium text-ink-600">
                  {DOW_LABELS[row.dayOfWeek]}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{
                      width: `${(row.avg / Math.max(...stats.dowAverages.map((d) => d.avg))) * 100}%`,
                    }}
                  />
                </div>
                <span className="nums w-16 text-right text-xs text-ink-700">{rm(row.avg)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-3">
          <Stat label="Weekend average" value={rm(stats.weekendAvg)} />
          <Stat label="Weekday average" value={rm(stats.weekdayAvg)} />
          {stats.weekendAvg != null && stats.weekdayAvg != null && (
            <p className="text-[11px] text-ink-500">
              Weekends run {stats.weekendAvg >= stats.weekdayAvg ? 'RM ' + (stats.weekendAvg - stats.weekdayAvg) + ' higher' : 'RM ' + (stats.weekdayAvg - stats.weekendAvg) + ' lower'} than weekdays.
            </p>
          )}
        </div>
        <div className="space-y-3">
          <Stat label="Sell-outs in period" value={stats.soldOutCount} />
          {stats.cheapestDayOfWeek != null && (
            <Stat label="Cheapest day of week" value={DOW_LABELS[stats.cheapestDayOfWeek]} />
          )}
        </div>
      </div>
    </Card>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-ink-50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-ink-400">{label}</p>
      <p className="nums mt-0.5 text-sm font-semibold text-ink-900">{value ?? '—'}</p>
    </div>
  )
}

function formatDayLong(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-MY', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}