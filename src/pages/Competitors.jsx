import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { useApp, useFetch } from '../lib/app-context.jsx'
import { OTA_LABELS, OTA_STYLES, cx, relativeTime, rm } from '../lib/format.js'
import {
  Badge,
  Card,
  ConfirmButton,
  EmptyState,
  ErrorNote,
  Modal,
  SectionTitle,
  Skeleton,
  Spinner,
  Toggle,
} from '../components/ui.jsx'

const EMPTY = { name: '', booking: '', agoda: '', tripcom: '' }

export default function Competitors() {
  const { toast, refreshDashboard, runCheckAll, busy, dashboard } = useApp()
  const { data: competitors, loading, reload, setData } = useFetch('/competitors')
  const { data: myHotel } = useFetch('/settings/my-hotel')
  const { data: mappings, reload: reloadMappings } = useFetch('/room-mappings')

  const [form, setForm] = useState(EMPTY)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(null)
  const [mappingFor, setMappingFor] = useState(null)

  const lastCheckByCompetitor = useMemo(() => {
    const map = {}
    for (const row of dashboard?.competitors || []) {
      map[row.competitor.id] = row.lastCheckAt
    }
    return map
  }, [dashboard])

  const add = async (e) => {
    e.preventDefault()
    setAdding(true)
    setError(null)
    try {
      await api.post('/competitors', {
        name: form.name,
        otaUrls: { booking: form.booking, agoda: form.agoda, tripcom: form.tripcom },
      })
      setForm(EMPTY)
      await reload()
      await refreshDashboard()
      toast('Competitor added', 'emerald', 'Map your room types so undercut alerts work.')
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  const toggleActive = async (competitor) => {
    await api.put(`/competitors/${competitor.id}`, { active: !competitor.active })
    setData((prev) => prev.map((c) => (c.id === competitor.id ? { ...c, active: !c.active } : c)))
    await refreshDashboard()
  }

  const remove = async (competitor) => {
    await api.del(`/competitors/${competitor.id}`)
    setData((prev) => prev.filter((c) => c.id !== competitor.id))
    await Promise.all([reloadMappings(), refreshDashboard()])
    toast('Competitor removed', 'slate')
  }

  const mappingCount = (competitorId) =>
    (mappings || []).filter((m) => m.competitorId === competitorId).length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
            Competitors
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Add the hotels you compete with, then map their OTA room names to yours.
          </p>
        </div>
        <button
          type="button"
          onClick={() => runCheckAll()}
          disabled={busy === 'check-all'}
          className="btn-primary"
        >
          {busy === 'check-all' ? <Spinner className="h-3.5 w-3.5" /> : '🔄'} Check all competitors
        </button>
      </div>

      <Card className="p-5">
        <SectionTitle hint="At least one OTA URL is required. Room mapping comes next — it's optional to add the hotel first.">
          Add a competitor
        </SectionTitle>
        <form onSubmit={add} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label mb-1.5" htmlFor="comp-name">
                Hotel name
              </label>
              <input
                id="comp-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input"
                placeholder="e.g. The Sterling Hotel"
              />
            </div>
            {['booking', 'agoda', 'tripcom'].map((ota) => (
              <div key={ota}>
                <label className="label mb-1.5" htmlFor={`comp-${ota}`}>
                  {OTA_LABELS[ota]} URL
                </label>
                <input
                  id={`comp-${ota}`}
                  type="url"
                  value={form[ota]}
                  onChange={(e) => setForm({ ...form, [ota]: e.target.value })}
                  className="input"
                  placeholder={`https://www.${ota === 'tripcom' ? 'trip.com' : ota === 'booking' ? 'booking.com' : 'agoda.com'}/…`}
                />
              </div>
            ))}
          </div>
          <ErrorNote>{error}</ErrorNote>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={adding} className="btn-primary">
              {adding && <Spinner className="h-3.5 w-3.5" />} Add competitor
            </button>
            <p className="text-[11px] text-ink-400">
              Tip: add your own hotel as a competitor too — it gives you free accuracy and OTA
              parity monitoring.
            </p>
          </div>
        </form>
      </Card>

      {loading ? (
        <Card className="space-y-3 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </Card>
      ) : (competitors || []).length === 0 ? (
        <EmptyState
          icon="🏨"
          title="No competitors yet"
          hint="Add your first competitor above with its Booking.com or Agoda URL."
        />
      ) : (
        <div className="space-y-3">
          {competitors.map((competitor) => {
            const otas = Object.keys(competitor.otaUrls || {}).filter((k) => competitor.otaUrls[k])
            const mapped = mappingCount(competitor.id)
            const total = (myHotel?.roomTypes || []).length
            return (
              <Card key={competitor.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-base font-semibold text-ink-900">
                        {competitor.name}
                      </h3>
                      {competitor.isOwn && <Badge tone="brand">Your hotel</Badge>}
                      {competitor.active ? (
                        <Badge tone="emerald">active</Badge>
                      ) : (
                        <Badge tone="slate">inactive</Badge>
                      )}
                      {mapped > 0 && total > 0 && (
                        <Badge tone={mapped === total ? 'teal' : 'amber'}>
                          {mapped}/{total} rooms mapped
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {otas.map((ota) => (
                        <a
                          key={ota}
                          href={competitor.otaUrls[ota]}
                          target="_blank"
                          rel="noreferrer"
                          className={cx('badge transition hover:opacity-80', OTA_STYLES[ota])}
                          title={competitor.otaUrls[ota]}
                        >
                          {OTA_LABELS[ota]} ↗
                        </a>
                      ))}
                      <span className="text-[11px] text-ink-400">
                        {lastCheckByCompetitor[competitor.id]
                          ? `checked ${relativeTime(lastCheckByCompetitor[competitor.id])}`
                          : 'never checked'}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 rounded-lg bg-ink-50 px-2.5 py-1.5">
                      <span className="text-[11px] font-medium text-ink-500">
                        {competitor.active ? 'Tracking' : 'Paused'}
                      </span>
                      <Toggle
                        checked={competitor.active}
                        onChange={() => toggleActive(competitor)}
                        label={`Toggle tracking for ${competitor.name}`}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => runCheckAll(competitor.id)}
                      disabled={busy === `checking-${competitor.id}`}
                    >
                      {busy === `checking-${competitor.id}` ? (
                        <Spinner className="h-3.5 w-3.5" />
                      ) : (
                        '🔄'
                      )}{' '}
                      Check
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => setMappingFor(competitor)}
                    >
                      Room mapping
                    </button>
                    <ConfirmButton
                      className="btn-danger btn-sm"
                      confirmLabel="Delete?"
                      onConfirm={() => remove(competitor)}
                    >
                      Delete
                    </ConfirmButton>
                  </div>
                </div>

                {mapped === 0 && total > 0 && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    No rooms mapped yet — undercut alerts can't compare this competitor's rooms to
                    yours until you map them.
                  </p>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <MappingModal
        competitor={mappingFor}
        myHotel={myHotel}
        mappings={mappings || []}
        onClose={() => setMappingFor(null)}
        onSaved={async () => {
          await Promise.all([reloadMappings(), refreshDashboard()])
        }}
      />
    </div>
  )
}

function MappingModal({ competitor, myHotel, mappings, onClose, onSaved }) {
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!competitor) return
    const initial = {}
    for (const room of myHotel?.roomTypes || []) {
      const existing = mappings.find(
        (m) => m.competitorId === competitor.id && m.myRoomTypeId === room.id,
      )
      initial[room.id] = existing?.otaRoomName || ''
    }
    setValues(initial)
    setError(null)
  }, [competitor, myHotel, mappings])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      for (const room of myHotel?.roomTypes || []) {
        const original =
          mappings.find(
            (m) => m.competitorId === competitor.id && m.myRoomTypeId === room.id,
          )?.otaRoomName || ''
        const next = (values[room.id] || '').trim()
        if (next === original) continue
        await api.put('/room-mappings', {
          competitorId: competitor.id,
          myRoomTypeId: room.id,
          otaRoomName: next,
        })
      }
      await onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={Boolean(competitor)}
      onClose={onClose}
      title={`Room types — ${competitor?.name || ''}`}
      width="max-w-xl"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={save} disabled={saving}>
            {saving && <Spinner className="h-3.5 w-3.5" />} Save mapping
          </button>
        </>
      }
    >
      <p className="mb-4 text-xs text-ink-500">
        OTAs name the same room differently at each hotel. Type the competitor's room name exactly
        as it appears on the OTA so their price is matched to the right room of yours. Leave blank to
        skip a room.
      </p>
      <ErrorNote>{error}</ErrorNote>
      <div className="mt-3 space-y-3">
        {(myHotel?.roomTypes || []).map((room) => (
          <div key={room.id} className="grid gap-2 sm:grid-cols-2 sm:items-center">
            <div>
              <p className="text-sm font-medium text-ink-800">{room.name}</p>
              <p className="text-[11px] text-ink-400">Your rate {rm(room.basePrice)}</p>
            </div>
            <input
              value={values[room.id] || ''}
              onChange={(e) => setValues({ ...values, [room.id]: e.target.value })}
              className="input"
              placeholder={`Their name for it, e.g. "${room.name} (Non-refundable)"`}
            />
          </div>
        ))}
        {!(myHotel?.roomTypes || []).length && (
          <EmptyState
            icon="🛏️"
            title="Add your room types first"
            hint="Room mapping needs your own room types to map onto."
          />
        )}
      </div>
    </Modal>
  )
}