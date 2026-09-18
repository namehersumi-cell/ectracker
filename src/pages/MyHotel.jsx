import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useApp } from '../lib/app-context.jsx'
import { rm, cx } from '../lib/format.js'
import { Card, ConfirmButton, EmptyState, ErrorNote, SectionTitle, Skeleton, Spinner } from '../components/ui.jsx'

export default function MyHotel() {
  const { toast, refreshDashboard } = useApp()
  const [hotel, setHotel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    api
      .get('/settings/my-hotel')
      .then((data) => {
        setHotel({
          name: data.name || '',
          roomTypes: data.roomTypes || [],
          location: data.location || null,
        })
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const update = (patch) => {
    setHotel((prev) => ({ ...prev, ...patch }))
    setDirty(true)
  }

  const updateRoom = (id, patch) => {
    update({
      roomTypes: hotel.roomTypes.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    })
  }

  const addRoom = () => {
    update({
      roomTypes: [
        ...hotel.roomTypes,
        { id: `new-${Date.now()}`, name: '', basePrice: '', capacity: 2 },
      ],
    })
  }

  const removeRoom = (id) => {
    update({ roomTypes: hotel.roomTypes.filter((r) => r.id !== id) })
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const saved = await api.put('/settings/my-hotel', {
        name: hotel.name,
        roomTypes: hotel.roomTypes.map((r) => ({
          id: r.id?.startsWith('new-') ? undefined : r.id,
          name: r.name,
          basePrice: Number(r.basePrice),
          capacity: Number(r.capacity) || 2,
        })),
      })
      setHotel({
        name: saved.name,
        roomTypes: saved.roomTypes,
        location: saved.location ?? null,
      })
      setDirty(false)
      await refreshDashboard()
      toast('Your rates were saved', 'emerald', 'Undercut alerts now compare against these.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Prices feed the undercut alert engine, so a bad value must be caught before
  // it silently disables those alerts.
  const invalid = hotel?.roomTypes.some(
    (r) => !r.name?.trim() || r.basePrice === '' || Number(r.basePrice) < 0,
  )

  if (loading) {
    return (
      <Card className="p-5">
        <Skeleton className="mb-4 h-5 w-1/4" />
        <Skeleton className="mb-2 h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </Card>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">My Hotel</h1>
        <p className="mt-1 text-sm text-ink-500">
          Your own selling rates. These are the benchmark for undercut alerts and the comp-set
          comparison, so keep them current when you change a rate.
        </p>
      </div>

      <ErrorNote>{error}</ErrorNote>

      <Card className="p-5">
        <label className="label mb-1.5" htmlFor="hotel-name">
          Hotel name
        </label>
        <input
          id="hotel-name"
          value={hotel.name}
          onChange={(e) => update({ name: e.target.value })}
          className="input max-w-md"
          placeholder="e.g. Rumah Ku Boutique Hotel"
        />

        <div className="mt-4 border-t border-ink-100 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="label">Map location</p>
              {hotel.location?.lat != null ? (
                <p className="mt-1 text-sm text-ink-600">
                  📍 {hotel.location.address || `${hotel.location.lat.toFixed(5)}, ${hotel.location.lng.toFixed(5)}`}
                </p>
              ) : (
                <p className="mt-1 text-sm text-ink-500">
                  Not set. Setting your property on the map lets EC Price Tracker find the hotels
                  around you automatically.
                </p>
              )}
            </div>
            <Link to="/map" className="btn-secondary btn-sm whitespace-nowrap">
              {hotel.location?.lat != null ? 'Change on map' : 'Set on map'}
            </Link>
          </div>
        </div>
      </Card>

      <section>
        <SectionTitle hint="Room type names are matched loosely against OTA names, so 'Deluxe' and 'Deluxe Room' line up.">
          My room types
        </SectionTitle>

        <Card className="overflow-hidden">
          {hotel.roomTypes.length === 0 ? (
            <EmptyState
              icon="🛏️"
              title="No room types yet"
              hint="Add the rooms you sell so competitor rates can be compared against yours."
              action={
                <button type="button" onClick={addRoom} className="btn-primary btn-sm mt-1">
                  Add your first room type
                </button>
              }
            />
          ) : (
            <>
              <div className="hidden grid-cols-[1fr_10rem_6rem_2.5rem] gap-3 border-b border-ink-100 px-4 py-2.5 sm:grid">
                <span className="label">Room type</span>
                <span className="label">My price (RM)</span>
                <span className="label">Sleeps</span>
                <span className="sr-only">Actions</span>
              </div>
              <ul className="divide-y divide-ink-100">
                {hotel.roomTypes.map((room) => {
                  const priceInvalid =
                    room.basePrice === '' || Number(room.basePrice) < 0 || Number.isNaN(Number(room.basePrice))
                  return (
                    <li
                      key={room.id}
                      className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_10rem_6rem_2.5rem] sm:items-center"
                    >
                      <div>
                        <label className="label mb-1 sm:hidden" htmlFor={`name-${room.id}`}>
                          Room type
                        </label>
                        <input
                          id={`name-${room.id}`}
                          value={room.name}
                          onChange={(e) => updateRoom(room.id, { name: e.target.value })}
                          className={cx('input', !room.name?.trim() && 'ring-red-300')}
                          placeholder="Deluxe Room"
                        />
                      </div>
                      <div>
                        <label className="label mb-1 sm:hidden" htmlFor={`price-${room.id}`}>
                          My price (RM)
                        </label>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-400">
                            RM
                          </span>
                          <input
                            id={`price-${room.id}`}
                            type="number"
                            min="0"
                            inputMode="decimal"
                            value={room.basePrice}
                            onChange={(e) => updateRoom(room.id, { basePrice: e.target.value })}
                            className={cx('input nums pl-9', priceInvalid && 'ring-red-300')}
                            placeholder="160"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="label mb-1 sm:hidden" htmlFor={`cap-${room.id}`}>
                          Sleeps
                        </label>
                        <input
                          id={`cap-${room.id}`}
                          type="number"
                          min="1"
                          value={room.capacity}
                          onChange={(e) => updateRoom(room.id, { capacity: e.target.value })}
                          className="input nums"
                        />
                      </div>
                      <div className="flex justify-end">
                        <ConfirmButton
                          className="btn-danger btn-sm"
                          confirmLabel="Delete?"
                          onConfirm={() => removeRoom(room.id)}
                        >
                          Delete
                        </ConfirmButton>
                      </div>
                      {priceInvalid && (
                        <p className="text-[11px] text-red-600 sm:col-span-4">
                          Price must be a positive number — undercut alerts can't compare this room
                          type without it.
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </Card>

        {hotel.roomTypes.length > 0 && (
          <button type="button" onClick={addRoom} className="btn-ghost mt-3">
            + Add room type
          </button>
        )}
      </section>

      <div className="sticky bottom-20 flex items-center justify-between gap-3 rounded-xl bg-white/95 px-4 py-3 shadow-lift ring-1 ring-ink-900/5 backdrop-blur md:bottom-4">
        <p className="text-xs text-ink-500">
          {dirty ? 'You have unsaved changes.' : 'All changes saved.'}
          {hotel.roomTypes.length > 0 && (
            <span className="ml-1 hidden sm:inline">
              Current: {hotel.roomTypes.map((r) => `${r.name || 'unnamed'} ${rm(r.basePrice)}`).join(' · ')}
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty || invalid}
          className="btn-primary"
        >
          {saving && <Spinner className="h-3.5 w-3.5" />}
          Save rates
        </button>
      </div>
    </div>
  )
}