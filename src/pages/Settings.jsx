import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useApp, useFetch } from '../lib/app-context.jsx'
import { ALERT_META, cx, relativeTime } from '../lib/format.js'
import { Badge, Card, EmptyState, SectionTitle, Skeleton, Spinner, Toggle } from '../components/ui.jsx'

export default function Settings() {
  const { toast, status } = useApp()
  const { data: notifications, loading, reload } = useFetch('/settings/notifications')
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (notifications && !draft) setDraft(notifications)
  }, [notifications, draft])

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/settings/notifications', draft)
      await reload()
      toast('Notification settings saved', 'emerald')
    } catch (err) {
      toast('Could not save settings', 'red', err.message)
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const result = await api.get('/notifications/test')
      if (result.ok) toast('Telegram message sent', 'emerald', 'Check your phone.')
      else if (result.skipped)
        toast('Telegram not configured', 'amber', 'Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to the server env.')
      else toast('Telegram send failed', 'red', result.error || 'Check the bot token and chat ID.')
    } catch (err) {
      toast('Test failed', 'red', err.message)
    } finally {
      setTesting(false)
    }
  }

  if (loading || !draft) {
    return (
      <Card className="p-5">
        <Skeleton className="mb-3 h-5 w-1/4" />
        <Skeleton className="h-32 w-full" />
      </Card>
    )
  }

  const quietSummary = draft.quietHours.enabled
    ? `Held ${draft.quietHours.start}–${draft.quietHours.end}, delivered as one digest at ${draft.quietDigestTime}`
    : 'Messages sent immediately, any hour'

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">Settings</h1>
        <p className="mt-1 text-sm text-ink-500">
          Notification behaviour and system status. Credentials live in server environment variables,
          never in the browser.
        </p>
      </div>

      <Card className="p-5">
        <SectionTitle hint="Which alerts reach your phone. Unchecked types are still stored in History.">
          Alert notifications
        </SectionTitle>
        <ul className="divide-y divide-ink-100">
          {Object.entries(ALERT_META).map(([key, meta]) => (
            <li key={key} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <span aria-hidden>{meta.emoji}</span>
                <div>
                  <p className="text-sm font-medium text-ink-800">{meta.label}</p>
                  <p className="text-[11px] text-ink-400">{DESCRIPTIONS[key]}</p>
                </div>
              </div>
              <Toggle
                checked={Boolean(draft.toggles[key])}
                onChange={(v) => setDraft({ ...draft, toggles: { ...draft.toggles, [key]: v } })}
                label={`Notify on ${meta.label}`}
              />
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5">
        <SectionTitle hint={quietSummary}>Quiet hours & digests</SectionTitle>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink-800">Quiet hours</p>
              <p className="text-[11px] text-ink-400">
                Nothing is dropped — alerts are queued and sent as one combined digest.
              </p>
            </div>
            <Toggle
              checked={draft.quietHours.enabled}
              onChange={(v) => setDraft({ ...draft, quietHours: { ...draft.quietHours, enabled: v } })}
              label="Enable quiet hours"
            />
          </div>

          {draft.quietHours.enabled && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label mb-1.5" htmlFor="q-start">
                  Quiet from
                </label>
                <input
                  id="q-start"
                  type="time"
                  value={draft.quietHours.start}
                  onChange={(e) =>
                    setDraft({ ...draft, quietHours: { ...draft.quietHours, start: e.target.value } })
                  }
                  className="input nums"
                />
              </div>
              <div>
                <label className="label mb-1.5" htmlFor="q-end">
                  Quiet until
                </label>
                <input
                  id="q-end"
                  type="time"
                  value={draft.quietHours.end}
                  onChange={(e) =>
                    setDraft({ ...draft, quietHours: { ...draft.quietHours, end: e.target.value } })
                  }
                  className="input nums"
                />
              </div>
              <div>
                <label className="label mb-1.5" htmlFor="q-digest">
                  Overnight digest at
                </label>
                <input
                  id="q-digest"
                  type="time"
                  value={draft.quietDigestTime}
                  onChange={(e) => setDraft({ ...draft, quietDigestTime: e.target.value })}
                  className="input nums"
                />
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label mb-1.5" htmlFor="d-digest">
                Daily digest at
              </label>
              <input
                id="d-digest"
                type="time"
                value={draft.digestTime}
                onChange={(e) => setDraft({ ...draft, digestTime: e.target.value })}
                className="input nums"
              />
              <p className="mt-1 text-[11px] text-ink-400">
                Summarises the last 24h plus tonight's comp-set average.
              </p>
            </div>
            <div>
              <label className="label mb-1.5" htmlFor="f-threshold">
                OTA failure alert after
              </label>
              <input
                id="f-threshold"
                type="number"
                min="1"
                max="50"
                value={draft.failureThreshold}
                onChange={(e) => setDraft({ ...draft, failureThreshold: Number(e.target.value) })}
                className="input nums"
              />
              <p className="mt-1 text-[11px] text-ink-400">
                Consecutive failures before one warning per OTA per day.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
          <button type="button" onClick={save} disabled={saving} className="btn-primary">
            {saving && <Spinner className="h-3.5 w-3.5" />} Save settings
          </button>
          <button type="button" onClick={test} disabled={testing} className="btn-ghost">
            {testing && <Spinner className="h-3.5 w-3.5" />} Test Telegram
          </button>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle hint="What the server is actually connected to.">System status</SectionTitle>
        {status ? (
          <ul className="space-y-2.5 text-sm">
            <StatusRow
              label="Gemini extraction"
              value={status.gemini === 'live' ? 'Live API' : 'Simulated (no API key)'}
              tone={status.gemini === 'live' ? 'emerald' : 'amber'}
            />
            <StatusRow
              label="Google Maps"
              value={status.maps === 'live' ? 'Live API' : 'Simulated (no API key)'}
              tone={status.maps === 'live' ? 'emerald' : 'amber'}
            />
            <StatusRow
              label="Telegram"
              value={status.telegram === 'configured' ? 'Configured' : 'Not configured'}
              tone={status.telegram === 'configured' ? 'emerald' : 'amber'}
            />
            <StatusRow
              label="PIN gate"
              value={status.pinGate === 'enabled' ? 'Enabled' : 'Disabled (open access)'}
              tone={status.pinGate === 'enabled' ? 'emerald' : 'amber'}
            />
            <StatusRow label="Storage" value={status.store === 'firestore' ? 'Firestore' : 'Local JSON'} tone="brand" />
            <StatusRow
              label="Check-in dates tracked"
              value={status.checkInDates?.map((d) => `${d.label} (${d.date})`).join(' · ')}
              tone="slate"
            />
          </ul>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
        <p className="mt-4 rounded-lg bg-ink-50 px-3 py-2.5 text-[11px] leading-relaxed text-ink-500">
          To go live, set these server environment variables:{' '}
          <code className="rounded bg-white px-1 py-0.5 text-ink-700">GEMINI_API_KEY</code>,{' '}
          <code className="rounded bg-white px-1 py-0.5 text-ink-700">TELEGRAM_BOT_TOKEN</code>,{' '}
          <code className="rounded bg-white px-1 py-0.5 text-ink-700">TELEGRAM_CHAT_ID</code>,{' '}
          <code className="rounded bg-white px-1 py-0.5 text-ink-700">CRON_SECRET</code>,{' '}
          <code className="rounded bg-white px-1 py-0.5 text-ink-700">APP_PIN</code>. See{' '}
          <code className="rounded bg-white px-1 py-0.5 text-ink-700">.env.example</code>.
        </p>
      </Card>

      <Card className="p-5">
        <SectionTitle hint="Set the CRON_SECRET env var, then point Cloud Scheduler at this path.">
          Hourly auto-checks
        </SectionTitle>
        <div className="space-y-2 text-sm text-ink-600">
          <p>
            Endpoint:{' '}
            <code className="rounded bg-ink-50 px-1.5 py-0.5 text-xs text-ink-800">
              GET /api/cron/run-checks
            </code>{' '}
            with header{' '}
            <code className="rounded bg-ink-50 px-1.5 py-0.5 text-xs text-ink-800">
              x-cron-key
            </code>
            .
          </p>
          <p>
            Digest endpoint:{' '}
            <code className="rounded bg-ink-50 px-1.5 py-0.5 text-xs text-ink-800">
              GET /api/cron/digest
            </code>{' '}
            — flushes the overnight queue and sends the daily digest.
          </p>
          <p className="text-xs text-ink-400">
            Schedule {draft?.digestTime ? `08:00 and ${draft.quietDigestTime}` : 'hourly 08:00–22:00'} in
            Asia/Kuala_Lumpur — not UTC. Cloud Scheduler's free tier covers three jobs.
          </p>
        </div>
      </Card>
    </div>
  )
}

const DESCRIPTIONS = {
  SALE: 'A competitor sold rooms — estimated from the last price before inventory dropped.',
  SOLDOUT: 'A competitor exhausted a room type. Usually a pricing opportunity for you.',
  UNDERCUT: 'A mapped room is priced RM 10+ below your rate for the same stay.',
  PRICE_DROP: 'Price fell RM 10 or more without crossing below your rate.',
  PRICE_RISE: 'Price rose RM 10 or more. Off by default to reduce noise.',
}

function StatusRow({ label, value, tone }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 pb-2 last:border-0 last:pb-0">
      <span className="text-ink-600">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </li>
  )
}