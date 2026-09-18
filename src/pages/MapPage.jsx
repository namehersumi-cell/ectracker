import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useApp, useFetch } from '../lib/app-context.jsx'
import { OTA_LABELS, cx, rm } from '../lib/format.js'
import PlaceAutocomplete from '../components/PlaceAutocomplete.jsx'
import CompMap from '../components/CompMap.jsx'
import { Badge, Card, EmptyState, ErrorNote, SectionTitle, Skeleton, Spinner } from '../components/ui.jsx'

const RADIUS_PRESETS = [500, 1000, 2000, 5000]
const MIN_RADIUS = 200
const MAX_RADIUS = 10000

export default function MapPage() {
  const { toast, refreshDashboard } = useApp()
  const navigate = useNavigate()
  const { data: myHotel, reload: reloadHotel } = useFetch('/settings/my-hotel')
  const { data: competitors, reload: reloadCompetitors } = useFetch('/competitors')
  const { data: settings } = useFetch('/discovery/settings')

  const [radiusM, setRadiusM] = useState(2000)
  const [radiusTouched, setRadiusTouched] = useState(false)
  const [scan, setScan] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState([])
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)

  useEffect(() => {
    if (settings?.radiusM && !radiusTouched) setRadiusM(settings.radiusM)
  }, [settings, radiusTouched])

  const centre = myHotel?.location?.lat != null ? myHotel.location : null
  const tracked = competitors || []

  const runScan = useCallback(
    async (radius = radiusM) => {
      setScanning(true)
      setError(null)
      try {
        const res = await api.get(`/discovery/scan?radiusM=${radius}`)
        setScan(res)
        // Keep any still-visible selections so a radius tweak does not wipe them.
        const visible = new Set((res.hotels || []).map((h) => h.placeId))
        setSelected((prev) => prev.filter((h) => visible.has(h.placeId)))
      } catch (err) {
        setError(err.message)
        setScan(null)
      } finally {
        setScanning(false)
      }
    },
    [radiusM],
  )

  useEffect(() => {
    if (centre) runScan(radiusM)
    // Only re-scan automatically when the centre itself changes; radius changes
    // are explicit so we don't hammer the Places API while dragging a slider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centre?.lat, centre?.lng])

  const setLocation = async (place) => {
    setSaving(true)
    setError(null)
    try {
      const body = {
        name: myHotel.name,
        roomTypes: (myHotel.roomTypes || []).map((r) => ({
          id: r.id,
          name: r.name,
          basePrice: Number(r.basePrice),
          capacity: Number(r.capacity) || 2,
        })),
        location: {
          lat: place.lat,
          lng: place.lng,
          address: place.address,
          city: place.city,
          placeId: place.placeId,
        },
      }
      await api.put('/settings/my-hotel', body)
      await reloadHotel()
      setSelected([])
      await runScan(radiusM)
      toast('Property location set', 'emerald', 'Now scan the area for nearby hotels.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const clearLocation = async () => {
    setSaving(true)
    try {
      await api.put('/settings/my-hotel', {
        name: myHotel.name,
        roomTypes: myHotel.roomTypes || [],
        location: null,
      })
      await reloadHotel()
      setScan(null)
      setSelected([])
      toast('Location cleared', 'slate')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const applyRadius = async (value) => {
    const clamped = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Math.round(value)))
    setRadiusTouched(true)
    setRadiusM(clamped)
    await api.put('/discovery/settings', { radiusM: clamped }).catch(() => {})
    if (centre) runScan(clamped)
  }

  const toggle = (hotel) => {
    setSelected((prev) =>
      prev.some((h) => h.placeId === hotel.placeId)
        ? prev.filter((h) => h.placeId !== hotel.placeId)
        : [...prev, hotel],
    )
  }

  const addSelected = async () => {
    if (selected.length === 0) return
    setAdding(true)
    setError(null)
    setProgress(null)
    try {
      // The add flow resolves OTA pages and reads rates for every hotel, which
      // takes a while, so the UI shows hotel-by-hotel progress instead of
      // appearing hung.
      let i = 0
      const ticker = setInterval(() => {
        i = Math.min(i + 1, selected.length)
        setProgress(`Working on hotel ${i} of ${selected.length}…`)
      }, 1200)

      const res = await api.post('/discovery/add', { hotels: selected, radiusM })
      clearInterval(ticker)

      const added = (res.results || []).filter((r) => !r.skipped)
      const skipped = (res.results || []).filter((r) => r.skipped)
      const rooms = added.reduce((n, r) => n + (r.discoveredRoomNames?.length || 0), 0)
      const auto = added.reduce((n, r) => n + (r.autoLinked || 0), 0)

      await Promise.all([reloadCompetitors(), refreshDashboard(), runScan(radiusM)])
      setSelected([])

      if (added.length === 0) {
        toast('Nothing added', 'amber', skipped[0]?.reason || 'No OTA pages were found.')
      } else {
        toast(
          `${added.length} hotel${added.length > 1 ? 's' : ''} added`,
          'emerald',
          `${rooms} room types and rates read from ${OTA_LABELS.booking}, ${OTA_LABELS.agoda} and ${OTA_LABELS.tripcom}.`,
        )
        // Linking is the one step that needs a human, so go straight there.
        navigate(auto > 0 ? '/rooms' : '/competitors')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setProgress(null)
      setAdding(false)
    }
  }

  const notTracked = (scan?.hotels || []).filter((h) => !h.alreadyTracked)
  const alreadyTracked = (scan?.hotels || []).filter((h) => h.alreadyTracked)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
          My Hotel &amp; Map
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Set your property on the map, choose a radius, and EC Price Tracker finds the hotels
          around you — then reads their room types and rates on all three OTAs automatically.
        </p>
      </div>

      <ErrorNote>{error}</ErrorNote>

      <Card className="p-5">
        <SectionTitle hint="Type your hotel name and pick it from the list. The address comes from Google Maps.">
          1 · Where is your property?
        </SectionTitle>

        {!centre ? (
          <ol className="mb-4 space-y-1.5 text-sm text-ink-600">
            <li>
              <strong className="text-ink-900">Step 1.</strong> Search for your hotel below.
            </li>
            <li>
              <strong className="text-ink-900">Step 2.</strong> Set the radius around it.
            </li>
            <li>
              <strong className="text-ink-900">Step 3.</strong> Tick the hotels to track and add
              them.
            </li>
          </ol>
        ) : (
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-xl bg-brand-50/60 px-3.5 py-3 ring-1 ring-brand-100">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="mt-0.5">📍</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-900">{myHotel.name}</p>
                <p className="truncate text-xs text-ink-600">
                  {centre.address || `${centre.lat.toFixed(5)}, ${centre.lng.toFixed(5)}`}
                </p>
              </div>
            </div>
            <button type="button" onClick={clearLocation} disabled={saving} className="btn-ghost btn-sm">
              Change location
            </button>
          </div>
        )}

        {saving && !centre ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <PlaceAutocomplete onSelect={setLocation} />
        )}
      </Card>

      {centre && (
        <>
          <Card className="p-5">
            <SectionTitle hint="Every hotel inside this circle is a candidate competitor.">
              2 · How far should we look?
            </SectionTitle>

            <div className="flex flex-wrap items-center gap-2">
              {RADIUS_PRESETS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => applyRadius(r)}
                  className={cx(
                    'rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 transition',
                    radiusM === r
                      ? 'bg-ink-900 text-white ring-ink-900'
                      : 'bg-white text-ink-700 ring-ink-200 hover:bg-ink-50',
                  )}
                >
                  {r >= 1000 ? `${r / 1000} km` : `${r} m`}
                </button>
              ))}
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={MIN_RADIUS}
                  max={MAX_RADIUS}
                  step={100}
                  value={radiusM}
                  onChange={(e) => setRadiusM(Number(e.target.value))}
                  onMouseUp={(e) => applyRadius(Number(e.target.value))}
                  onTouchEnd={(e) => applyRadius(Number(e.target.value))}
                  onKeyUp={(e) => applyRadius(Number(e.target.value))}
                  className="w-40 accent-brand-600"
                  aria-label="Search radius in metres"
                />
                <span className="nums w-20 text-sm font-semibold text-ink-900">
                  {radiusM >= 1000 ? `${(radiusM / 1000).toFixed(1)} km` : `${radiusM} m`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => runScan(radiusM)}
                disabled={scanning}
                className="btn-secondary btn-sm ml-auto"
              >
                {scanning ? <Spinner className="h-3.5 w-3.5" /> : ''} Re-scan
              </button>
            </div>

            <div className="mt-4">
              <CompMap
                centre={centre}
                radiusM={radiusM}
                competitors={tracked}
                candidates={scan?.hotels || []}
                selectedPlaceIds={selected.map((h) => h.placeId)}
                onToggleCandidate={toggle}
              />
            </div>

            {scan?.simulated && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 ring-1 ring-amber-200">
                🧪 Simulated map search — set <code className="font-mono">GOOGLE_MAPS_API_KEY</code>{' '}
                to search real Google Maps places. The flow is identical either way.
              </p>
            )}
          </Card>

          <Card className="p-5">
            <SectionTitle
              hint={
                scan
                  ? `${notTracked.length} new hotel${notTracked.length === 1 ? '' : 's'} within ${radiusM} m.${
                      alreadyTracked.length ? ` ${alreadyTracked.length} already tracked.` : ''
                    }`
                  : 'Scan the area to find hotels.'
              }
              action={
                notTracked.length > 0 && (
                  <button type="button" onClick={() => setSelected(notTracked)} className="btn-ghost btn-sm">
                    Select all {notTracked.length}
                  </button>
                )
              }
            >
              3 · Hotels found nearby
            </SectionTitle>

            {scanning && !scan ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : notTracked.length === 0 ? (
              <EmptyState
                icon="🔭"
                title={scan ? 'No new hotels in this radius' : 'Not scanned yet'}
                hint={
                  scan
                    ? 'Widen the radius to include more hotels.'
                    : 'Set your location and press Re-scan.'
                }
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {notTracked.map((h) => {
                  const isSelected = selected.some((s) => s.placeId === h.placeId)
                  return (
                    <li key={h.placeId}>
                      <label
                        className={cx(
                          'flex cursor-pointer items-start gap-3 px-1 py-3 transition',
                          isSelected && 'bg-brand-50/50',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(h)}
                          className="mt-0.5 h-4 w-4 accent-brand-600"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-ink-900">{h.name}</span>
                            {h.rating && (
                              <Badge tone="amber">
                                ★ {h.rating}
                                {h.reviews ? ` (${h.reviews})` : ''}
                              </Badge>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-ink-500">
                            {h.address}
                          </span>
                        </span>
                        <span className="nums shrink-0 text-xs font-semibold text-ink-600">
                          {h.distanceM >= 1000 ? `${(h.distanceM / 1000).toFixed(1)} km` : `${h.distanceM} m`}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}

            {alreadyTracked.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-ink-500">
                  {alreadyTracked.length} hotel{alreadyTracked.length === 1 ? '' : 's'} already
                  tracked
                </summary>
                <ul className="mt-2 space-y-1">
                  {alreadyTracked.map((h) => (
                    <li key={h.placeId} className="flex items-center gap-2 text-xs text-ink-500">
                      <span className="text-emerald-600">✓</span>
                      <span className="truncate">{h.name}</span>
                      <Link to="/competitors" className="ml-auto shrink-0 underline">
                        manage
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          {selected.length > 0 && (
            <div className="sticky bottom-20 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/95 px-4 py-3 shadow-lift ring-1 ring-ink-900/5 backdrop-blur md:bottom-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-900">
                  {selected.length} hotel{selected.length === 1 ? '' : 's'} selected
                </p>
                <p className="truncate text-xs text-ink-500">
                  {selected.map((h) => h.name).join(', ')}
                </p>
                {progress && <p className="mt-0.5 text-xs text-brand-700">{progress}</p>}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setSelected([])} className="btn-ghost">
                  Clear
                </button>
                <button type="button" onClick={addSelected} disabled={adding} className="btn-primary">
                  {adding && <Spinner className="h-3.5 w-3.5" />}
                  {adding ? 'Reading rates…' : `Add ${selected.length} & read rates`}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}