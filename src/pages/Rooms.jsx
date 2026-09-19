import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useApp, useFetch } from '../lib/app-context.jsx'
import { OTA_LABELS, OTA_STYLES, cx, relativeTime, rm } from '../lib/format.js'
import { Badge, Card, EmptyState, ErrorNote, Modal, SectionTitle, Skeleton, Spinner } from '../components/ui.jsx'

const OTAS = ['booking', 'agoda', 'tripcom']
const STAYS = [
  { offset: 0, label: 'Tonight' },
  { offset: 7, label: '+7 days' },
  { offset: 30, label: '+30 days' },
]

/**
 * Per-room-type, per-OTA price view.
 *
 * The core requirement: one row per room type, showing what each OTA charges.
 * The same room is deliberately priced differently across Booking.com, Agoda
 * and Trip.com, so each price carries its OTA tag and the spread is called out.
 */
export default function Rooms() {
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [linking, setLinking] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get(`/room-prices?offset=${offset}`)
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [offset])

  const totals = useMemo(() => {
    const rooms = data?.rooms || []
    const withMarket = rooms.filter((r) => r.marketLow)
    return {
      rooms: rooms.length,
      priced: withMarket.length,
      undercut: withMarket.filter((r) => r.myPriceVsMarket != null && r.myPriceVsMarket > 0).length,
      spread: withMarket.length
        ? Math.round(withMarket.reduce((s, r) => s + (r.otaSpread || 0), 0) / withMarket.length)
        : null,
    }
  }, [data])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
            Room Prices
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            What every OTA charges for each of your room types, compared against the hotels around
            you.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 rounded-full bg-white p-1 ring-1 ring-ink-200">
          {STAYS.map((s) => (
            <button
              key={s.offset}
              type="button"
              onClick={() => setOffset(s.offset)}
              className={cx(
                'rounded-full px-3 py-1 text-sm font-medium transition',
                offset === s.offset ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-50',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <ErrorNote>{error}</ErrorNote>

      {data?.simulated && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 ring-1 ring-amber-200">
          🧪 Simulated readings — set <code className="font-mono">GEMINI_API_KEY</code> to read live
          OTA prices.
        </p>
      )}

      {loading ? (
        <Card className="p-5">
          <Skeleton className="mb-3 h-5 w-1/4" />
          <Skeleton className="mb-2 h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </Card>
      ) : !data || data.rooms.length === 0 ? (
        <Card>
          <EmptyState
            icon="🛏️"
            title="No room types yet"
            hint="Add your room types first, then their OTA prices appear here."
            action={
              <Link to="/hotel" className="btn-primary btn-sm mt-1">
                Add room types
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Room types" value={totals.rooms} />
            <Stat label="With market prices" value={totals.priced} />
            <Stat
              label="Above market low"
              value={totals.undercut}
              tone={totals.undercut > 0 ? 'amber' : 'emerald'}
            />
            <Stat
              label="Avg OTA spread"
              value={totals.spread == null ? '—' : rm(totals.spread)}
            />
          </div>

          {data.rooms.map((room) => (
            <Card key={room.myRoomTypeId} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-ink-900">{room.myRoomName}</h2>
                  <p className="text-xs text-ink-500">
                    My price {rm(room.myBasePrice)}
                    {room.cheapestOta && (
                      <>
                        {' · '}
                        cheapest on{' '}
                        <span className="font-medium text-ink-700">
                          {OTA_LABELS[room.cheapestOta.ota]}
                        </span>{' '}
                        at {rm(room.cheapestOta.price)}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {room.myPriceVsMarket != null && (
                    <Badge tone={room.myPriceVsMarket > 0 ? 'red' : 'emerald'}>
                      {room.myPriceVsMarket > 0
                        ? room.marketLowHotel && !room.marketLowHotelIsOwn
                          ? `${rm(room.myPriceVsMarket)} above ${room.marketLowHotel}`
                          : `${rm(room.myPriceVsMarket)} above market low`
                        : room.myPriceVsMarket === 0
                          ? 'Matching market low'
                          : `${rm(Math.abs(room.myPriceVsMarket))} below market low`}
                    </Badge>
                  )}
                  {room.otaSpread > 0 && <Badge tone="slate">OTA spread {rm(room.otaSpread)}</Badge>}
                  <button
                    type="button"
                    onClick={() => setLinking(room)}
                    className="btn-ghost btn-sm"
                  >
                    Link rooms
                  </button>
                </div>
              </div>

              <div className="grid gap-px bg-ink-100 sm:grid-cols-3">
                {OTAS.map((ota) => {
                  const cell = room.otas[ota]
                  const price = cell?.price
                  const isCheapest = room.cheapestOta?.ota === ota
                  return (
                    <div key={ota} className="bg-white px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cx(
                            'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                            OTA_STYLES[ota],
                          )}
                        >
                          {OTA_LABELS[ota]}
                        </span>
                        {isCheapest && price && <Badge tone="emerald">cheapest</Badge>}
                      </div>
                      <p
                        className={cx(
                          'nums mt-2 text-xl font-semibold',
                          price ? 'text-ink-900' : 'text-ink-300',
                        )}
                      >
                        {price ? rm(price) : '—'}
                      </p>
                      {price ? (
                        <p className="mt-0.5 truncate text-[11px] text-ink-500">
                          {cell.competitorIsOwn ? 'your own listing' : cell.competitorName}
                          {cell.roomsLeft != null && cell.roomsLeft <= 3 && (
                            <span className="ml-1 font-medium text-red-600">
                              {cell.roomsLeft} left
                            </span>
                          )}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[11px] text-ink-400">No reading</p>
                      )}
                    </div>
                  )
                })}
              </div>

              {room.competitors.length > 0 && (
                <details className="border-t border-ink-100">
                  <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-ink-600 hover:bg-ink-50">
                    {room.competitors.length} hotel{room.competitors.length === 1 ? '' : 's'} selling
                    this room type
                  </summary>
                  <ul className="divide-y divide-ink-100">
                    {room.competitors.map((c) => (
                      <li key={c.competitorId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                        <span className="min-w-0 flex-1 truncate text-sm text-ink-800">
                          {c.competitorName}
                          {c.isOwn && <span className="ml-1.5 text-[10px] text-ink-400">(mine)</span>}
                        </span>
                        {OTAS.map((ota) =>
                          c.perOta[ota] ? (
                            <span key={ota} className="flex items-center gap-1.5">
                              <span
                                className={cx(
                                  'rounded px-1 py-0.5 text-[9px] font-semibold uppercase',
                                  OTA_STYLES[ota],
                                )}
                              >
                                {OTA_LABELS[ota].slice(0, 2)}
                              </span>
                              <span
                                className={cx(
                                  'nums text-sm',
                                  c.cheapest === c.perOta[ota].price
                                    ? 'font-semibold text-ink-900'
                                    : 'text-ink-600',
                                )}
                              >
                                {rm(c.perOta[ota].price)}
                              </span>
                            </span>
                          ) : (
                            <span key={ota} className="text-xs text-ink-300">
                              —
                            </span>
                          ),
                        )}
                        <span className="nums text-xs text-ink-400">{relativeTime(c.perOta.booking?.asOf || c.perOta.agoda?.asOf || c.perOta.tripcom?.asOf)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          ))}
        </>
      )}

      {linking && (
        <RoomLinkModal
          room={linking}
          onClose={() => setLinking(null)}
        />
      )}
    </div>
  )
}

function Stat({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'text-ink-900',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
  }
  return (
    <Card className="px-4 py-3">
      <p className="label">{label}</p>
      <p className={cx('nums mt-1 text-2xl font-semibold', tones[tone])}>{value}</p>
    </Card>
  )
}

/**
 * Room-linking dialog.
 *
 * Shows what each competitor calls this room, ranked by match confidence, with
 * the reason spelled out. Confirming a link is what makes the comparison
 * trustworthy, so the reasoning is always visible rather than a bare score.
 */
function RoomLinkModal({ room, onClose }) {
  const { toast, refreshDashboard } = useApp()
  const { data: suggestions, loading, reload } = useFetch('/room-links/suggestions')
  const { data: mappings, reload: reloadMappings } = useFetch('/room-mappings')

  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const competitors = suggestions?.competitors || []

  useEffect(() => {
    if (!suggestions) return
    // Pre-fill with what is already linked so the dialog opens in the saved
    // state, and applying it is idempotent.
    const next = {}
    for (const comp of competitors) {
      const mine = comp.existing.find((m) => m.myRoomTypeId === room.myRoomTypeId)
      next[comp.competitorId] = mine?.otaRoomName || ''
    }
    setDraft(next)
  }, [suggestions, room.myRoomTypeId])

  const linkCountFor = (competitorId) =>
    (mappings || []).filter((m) => m.competitorId === competitorId).length

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      // One call per competitor: it owns the room names on its own listings.
      for (const comp of competitors) {
        await api.put('/room-links/bulk', {
          competitorId: comp.competitorId,
          links: [
            { myRoomTypeId: room.myRoomTypeId, otaRoomName: draft[comp.competitorId] || '' },
          ],
        })
      }
      await Promise.all([reload(), reloadMappings(), refreshDashboard()])
      const linked = Object.values(draft).filter(Boolean).length
      toast(
        linked > 0 ? `${linked} link${linked === 1 ? '' : 's'} saved` : 'Links cleared',
        'emerald',
        linked > 0 ? 'Undercut alerts will use these matches.' : undefined,
      )
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Link "${room.myRoomName}"`}
      width="max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ink-500">
            A link tells EC Price Tracker which competitor room is the same product as yours.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancel
            </button>
            <button type="button" onClick={save} disabled={saving} className="btn-primary">
              {saving && <Spinner className="h-3.5 w-3.5" />}
              Save links
            </button>
          </div>
        </div>
      }
    >
      <ErrorNote>{error}</ErrorNote>

      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : competitors.length === 0 ? (
        <EmptyState
          icon="🏨"
          title="No competitors yet"
          hint="Discover hotels from the map first."
        />
      ) : (
        <div className="space-y-4">
          {competitors.map((comp) => {
            const suggestion = comp.suggestions.find((s) => s.myRoomTypeId === room.myRoomTypeId)
            const options = comp.discoveredRoomNames
            return (
              <div key={comp.competitorId}>
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <label
                    className="text-sm font-medium text-ink-900"
                    htmlFor={`link-${comp.competitorId}`}
                  >
                    {comp.competitorName}
                  </label>
                  {comp.isOwn && <Badge tone="brand">my own listing</Badge>}
                  <span className="text-[11px] text-ink-400">
                    {linkCountFor(comp.competitorId)} of {suggestions.myRoomTypes.length} rooms
                    linked
                  </span>
                </div>

                {options.length === 0 ? (
                  <p className="text-xs text-ink-500">
                    No room types read yet for this hotel.{' '}
                    <Link to="/competitors" className="underline">
                      Refresh it
                    </Link>
                    .
                  </p>
                ) : (
                  <>
                    <select
                      id={`link-${comp.competitorId}`}
                      value={draft[comp.competitorId] || ''}
                      onChange={(e) =>
                        setDraft({ ...draft, [comp.competitorId]: e.target.value })
                      }
                      className="input"
                    >
                      <option value="">Not linked</option>
                      {options.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>

                    {suggestion && (
                      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {suggestion.autoLink ? (
                          <Badge tone="emerald">strong match</Badge>
                        ) : (
                          <Badge tone="amber">please confirm</Badge>
                        )}
                        <span className="text-ink-500">
                          {suggestion.reason} · {Math.round(suggestion.score * 100)}% confident
                        </span>
                        {draft[comp.competitorId] !== suggestion.otaRoomName && (
                          <button
                            type="button"
                            onClick={() =>
                              setDraft({ ...draft, [comp.competitorId]: suggestion.otaRoomName })
                            }
                            className="font-medium text-brand-700 underline"
                          >
                            use “{suggestion.otaRoomName}”
                          </button>
                        )}
                      </p>
                    )}

                    {!suggestion && options.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-ink-400">
                        No confident match — pick one if they are the same room.
                      </p>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}