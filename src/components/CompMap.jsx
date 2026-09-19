import { useEffect, useMemo, useState } from 'react'
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { OTA_LABELS } from '../lib/format.js'

/**
 * Comp-set map: my property, the discovery radius, and every tracked hotel.
 *
 * Leaflet needs its marker icons wired up manually under a bundler, and the
 * coloured pins are built as divIcons so tracked hotels, candidates and my own
 * property are visually distinct without shipping image assets.
 */
function pinIcon({ color, label, ring = false }) {
  return L.divIcon({
    className: '',
    html: `<span style="
      display:grid;place-items:center;
      width:26px;height:26px;border-radius:9999px 9999px 9999px 4px;
      transform:rotate(-45deg);
      background:${color};
      border:2px solid white;
      box-shadow:0 1px 4px rgba(15,23,42,.35)${ring ? `,0 0 0 4px ${color}33` : ''};
    "><span style="transform:rotate(45deg);font-size:11px;font-weight:700;color:white">${label}</span></span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  })
}

const MINE_COLOR = '#1c8386'
const TRACKED_COLOR = '#4f46e5'
const CANDIDATE_COLOR = '#f59e0b'

/** Keep the viewport on the data as it changes, without fighting user panning. */
function FitBounds({ points, radiusM, centre }) {
  const map = useMap()
  const key = useMemo(
    () => `${points.map((p) => `${p.lat},${p.lng}`).join('|')}|${radiusM}`,
    [points, radiusM],
  )

  useEffect(() => {
    if (!centre) return
    const pts = [centre, ...points].filter((p) => p.lat != null && p.lng != null)
    if (pts.length <= 1) {
      map.setView([centre.lat, centre.lng], 14)
      return
    }
    const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lng]))
    // The radius circle can extend past the outermost pin, so include it.
    if (radiusM) {
      const latDelta = radiusM / 111320
      bounds.extend([centre.lat + latDelta, centre.lng + latDelta])
      bounds.extend([centre.lat - latDelta, centre.lng - latDelta])
    }
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 })
    // `key` captures the data; map/centre are stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return null
}

export default function CompMap({
  centre,
  radiusM = 2000,
  competitors = [],
  candidates = [],
  selectedPlaceIds = [],
  onToggleCandidate,
  height = '28rem',
}) {
  const [tilesFailed, setTilesFailed] = useState(false)

  const points = useMemo(
    () => [
      ...competitors.filter((c) => c.location?.lat != null).map((c) => c.location),
      ...candidates.filter((c) => c.lat != null).map((c) => ({ lat: c.lat, lng: c.lng })),
    ],
    [competitors, candidates],
  )

  if (!centre) {
    return (
      <div
        className="grid place-items-center rounded-xl bg-ink-50 text-sm text-ink-500 ring-1 ring-ink-900/5"
        style={{ height }}
      >
        Set your hotel location to see the map.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-ink-900/10" style={{ height }}>
      <MapContainer
        center={[centre.lat, centre.lng]}
        zoom={14}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          eventHandlers={{ tileerror: () => setTilesFailed(true) }}
        />

        <Circle
          center={[centre.lat, centre.lng]}
          radius={radiusM}
          pathOptions={{ color: MINE_COLOR, weight: 1.5, fillColor: MINE_COLOR, fillOpacity: 0.08 }}
        />

        <Marker position={[centre.lat, centre.lng]} icon={pinIcon({ color: MINE_COLOR, label: '★', ring: true })}>
          <Popup>
            <strong>My hotel</strong>
            <br />
            {centre.address || `${centre.lat.toFixed(5)}, ${centre.lng.toFixed(5)}`}
            <br />
            <span className="text-xs">Search radius: {radiusM} m</span>
          </Popup>
        </Marker>

        {competitors
          .filter((c) => c.location?.lat != null)
          .map((c) => (
            <Marker
              key={c.id}
              position={[c.location.lat, c.location.lng]}
              icon={pinIcon({ color: c.isOwn ? MINE_COLOR : TRACKED_COLOR, label: c.isOwn ? '★' : '✓' })}
            >
              <Popup>
                <strong>{c.name}</strong>
                {c.isOwn && <em> (my hotel)</em>}
                <br />
                {c.address || 'No address stored'}
                <br />
                <span className="text-xs">
                  {['booking', 'agoda', 'tripcom']
                    .filter((o) => c.otaUrls?.[o])
                    .map((o) => OTA_LABELS[o])
                    .join(' · ') || 'No OTA pages yet'}
                </span>
              </Popup>
            </Marker>
          ))}

        {candidates
          .filter((h) => h.lat != null)
          .map((h) => {
            const selected = selectedPlaceIds.includes(h.placeId)
            return (
              <Marker
                key={h.placeId}
                position={[h.lat, h.lng]}
                icon={pinIcon({
                  color: h.alreadyTracked ? TRACKED_COLOR : selected ? MINE_COLOR : CANDIDATE_COLOR,
                  label: h.alreadyTracked ? '✓' : selected ? '✓' : '+',
                })}
                eventHandlers={{
                  click: () => !h.alreadyTracked && onToggleCandidate?.(h),
                }}
              >
                <Popup>
                  <strong>{h.name}</strong>
                  <br />
                  {h.address}
                  <br />
                  <span className="text-xs">
                    {h.distanceM} m away
                    {h.rating ? ` · ★ ${h.rating}` : ''}
                  </span>
                  <br />
                  {h.alreadyTracked ? (
                    <em className="text-xs">Already tracked</em>
                  ) : (
                    <button
                      type="button"
                      className="mt-1 rounded bg-ink-900 px-2 py-0.5 text-xs text-white"
                      onClick={() => onToggleCandidate?.(h)}
                    >
                      {selected ? 'Remove from selection' : 'Add to selection'}
                    </button>
                  )}
                </Popup>
              </Marker>
            )
          })}

        <FitBounds points={points} radiusM={radiusM} centre={centre} />
      </MapContainer>

      {tilesFailed && (
        <p className="bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          Map tiles could not load (no internet?). Pins, radius and hotels below are still accurate.
        </p>
      )}
    </div>
  )
}