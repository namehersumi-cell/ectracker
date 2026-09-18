# EC Price Tracker

> Internal repo name: `EC Price Tracker`. The application name throughout the
> code and UI is also EC Price Tracker.

A competitor rate monitor for an independent hotel. It reads competitor
nightly rates off Booking.com, Agoda and Trip.com, stores the history, and
tells you when a competitor undercuts you, sells a room, sells out, or moves
price — by dashboard and by Telegram.

This is the merged implementation of **both** specification documents:

- `PRICE TRACKER 1.docx` — Phases 1–5 (Prompts 1–13), the original build plan.
- `PRICE TRACKER 2.docx` — the updated version (Prompts 5A–14 plus optional
  Phase 6). Where the two conflict, **v2 supersedes v1**.

Nothing in the repo has been skipped silently; the reconciliation notes at the
bottom list exactly how the numbering conflict was resolved.

---

## Quick start

```bash
npm install
npm run seed          # optional: 45 days of realistic demo data
npm start             # http://localhost:12000
```

That's it — no cloud project, no API key, no database to provision. The app
boots, seeds a six-hotel comp set, and runs end to end.

| Command | What it does |
| --- | --- |
| `npm start` | Serves the built SPA and the API on one port (12000) |
| `npm run dev:server` | API with auto-reload |
| `npm run dev:client` | Vite dev server on 5173, proxying `/api` to 12000 |
| `npm run build` | Builds the React frontend into `dist/` |
| `npm test` | Runs the alert-engine and pipeline tests |
| `npm run seed` | Replaces the local database with demo data |

### Going live

Copy `.env.example` to `.env` and fill in the four things that matter:

| Variable | Effect when set | Effect when missing |
| --- | --- | --- |
| `GEMINI_API_KEY` | Real OTA extraction | **Simulated** readings, clearly labelled 🧪 in the UI |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Alerts reach your phone | Alerts are stored, sends are logged and skipped |
| `CRON_SECRET` | `/api/cron/*` accepts the key | Endpoints return 503 rather than running unauthenticated |
| `APP_PIN` (or `APP_PIN_HASH`) | PIN gate locks the app | App is open; Settings says so |

**Simulated mode is deliberate and honest.** With no API key the app still runs
the entire product — extraction, alerts, digests, history, heatmap — but every
reading carries `simulated: true` and the dashboard shows a 🧪 banner. It never
pretends a generated number came from an OTA.

---

## Architecture

```
server/
  index.js              Express: API + static SPA on one port
  store.js              Document store — Firestore, or a JSON file fallback
  routes/api.js         All HTTP endpoints
  lib/
    gemini.js           Extraction: URL Context, Search fallback, simulator
    checks.js           Check pipeline + daily Gemini usage counter
    alerts.js           Alert detection, dedup, currency + sanity guards
    telegram.js         Delivery, quiet hours, digests, failure watchdog
    auth.js             PIN gate and signed session cookie
    dates.js            Asia/Kuala_Lumpur date handling
  scripts/seed.js       Demo dataset generator
  test/alerts.test.js   Business-logic tests
src/
  lib/format.js         RM formatting, KL time, heat colours, comparisons
  lib/api.js            Fetch wrapper + file download
  lib/app-context.jsx   Shared state, polling, toasts
  components/           Layout, PIN gate, toasts, UI kit
  pages/                Dashboard, My Hotel, Competitors, Calendar, History, Settings
```

### Storage

Firestore is the production target. Because a front desk may not have a cloud
project configured, `store.js` falls back to a JSON document store with the
same tiny API (`list/get/set/add/delete/query`), so route handlers never care
which one is live. Enable Firestore with `FIRESTORE_ENABLED=true` plus
credentials; the status appears in Settings.

### Collections

| Collection | Shape |
| --- | --- |
| `settings/myHotel` | `{ name, roomTypes: [{ id, name, basePrice, capacity }] }` |
| `settings/notifications` | per-type toggles, quiet hours, digest times |
| `settings/handover` | `{ current, notes[3] }` — shift handover |
| `competitors/{id}` | `{ name, otaUrls: { booking, agoda, tripcom }, active, isOwn }` |
| `roomMappings/{id}` | `{ competitorId, myRoomTypeId, otaRoomName }` |
| `priceChecks/{id}` | `{ competitorId, ota, checkedAt, status, method, simulated, roomTypes[] }` |
| `alerts/{id}` | `{ type, ..., read, notify, notified, mergedOtas, checkInDate }` |
| `actions/{id}` | `{ alertId, roomType, action, newPrice, note }` |
| `alertEvents/{id}` | dedup ledger, so an event never fires twice in a day |
| `otaHealth/{ota}` | consecutive failures, last success — drives the watchdog |
| `telegramQueue/{id}` | messages held during quiet hours |
| `meta/*` | Gemini usage counter, scheduler heartbeat |

Each `priceChecks` room entry carries `checkInDate`, `suspect`, `reported` and
optional `originalCurrency`/`originalPrice` — the v2 additions.

---

## How the hard parts behave

### Extraction is per check-in date

Every check evaluates **three stays**: tonight, +7 days, +30 days. Each reading
stores its own `checkInDate`, and every comparison, alert, sparkline and
heatmap cell keys on competitor + OTA + room + check-in date. Without this a
Saturday night rate reads as a price crash against a Tuesday night.

Occupancy is pinned to *2 adults, 1 room* so a single-adult rate can't appear
as a price drop, and the prompt forbids member-only, crossed-out and promo
prices in favour of the cheapest bookable public rate.

### Two grounding strategies

`URL Context` is tried first (Gemini fetches the OTA page). If that fails —
which is the norm for JavaScript-heavy Trip.com and Agoda pages — it retries
with `Google Search` grounding and records `method: 'google_search'`. A failing
OTA is stored as `status: 'error'` and never blocks the others.

### Guards before anything is trusted

1. **Currency.** A non-MYR price is either converted (with the original kept)
   or flagged `suspect` with `currency: XXX`. A "$45" reading can never be
   compared as RM 45 — there is a test for exactly that.
2. **Deviation.** A price more than 40% away from the previous reading is
   stored with `suspect: true`, shown with a 🚩 "verify manually" badge, and is
   **never allowed to fire an alert**.

### Alert rules

| Type | Trigger | Notified by default |
| --- | --- | --- |
| `SALE` | rooms-left decreased | yes |
| `SOLDOUT` | became unavailable while previously available | yes |
| `UNDERCUT` | mapped room RM 10+ below your rate | yes |
| `PRICE_DROP` | fell RM 10+, not crossing your rate | yes |
| `PRICE_RISE` | rose RM 10+ | no (noise reduction) |

Hard rules: suspect entries never alert; an event never fires twice for the
same competitor + room + check-in date; and the same event seen on multiple
OTAs within 30 minutes is **merged into one alert** naming both OTAs.

> Ordering matters here. The cross-OTA merge is evaluated *before* the day-level
> dedup, because the two rules share the same identity key — checking "already
> fired today" first silently swallows every merge. This was caught by the test
> suite, not by inspection.

### Telegram

Quiet hours (default 23:00–07:00 KL) **queue** rather than drop: held messages
go to `telegramQueue` and arrive as one combined overnight digest at 07:30. A
daily 08:00 digest summarises the last 24h plus tonight's comp-set average. If
one OTA fails five times in a row, a single warning per OTA per day is sent.
All messages carry the check-in label (Tonight / +7d / +30d).

### Automation

```
GET /api/cron/run-checks   header: x-cron-key   → runs the full batch
GET /api/cron/digest       header: x-cron-key   → flushes queue, sends digest
```

Point Cloud Scheduler at these with timezone **Asia/Kuala_Lumpur, not UTC**.
`0 8-22 * * *` for hourly checks, `30 7 * * *` for the overnight digest. The
free tier covers three jobs. The dashboard's "Last check" badge turns amber
past 90 minutes, which is how you notice a dead scheduler.

---

## Design notes

- **Timezone is a first-class citizen.** Every date the hotel cares about is
  computed at UTC+8 in one module (`lib/dates.js`); Malaysia has had no DST
  since 1982 so a fixed offset is exact and avoids a tz database. Prices render
  as `RM 150` and times as KL everywhere.
- **Numbers don't jitter.** Price columns and cells use tabular figures so
  values don't reflow as they update.
- **Live-ish updates without a realtime dependency.** A 15-second poll, paused
  when the tab is hidden, keeps a phone and a desktop in sync without a socket
  that a flaky hotel wifi would kill.
- **Destructive actions need two taps.** Delete uses an inline confirm that
  disarms itself after four seconds, rather than a browser `confirm()`.
- **Mobile is the primary target.** Bottom nav on small screens, safe-area
  padding, touch-sized controls, and a sticky save bar in My Hotel.
- **`prefers-reduced-motion` is respected**; animations collapse to nothing.
- **Accessibility basics:** labelled inputs, `role="switch"` toggles, focus
  rings, Escape-to-close modals, `aria-label`s on icon-only buttons.

---

## Testing

`npm test` runs 26 tests over the logic that costs money when it's wrong:
currency mixing, the 40% sanity check, the RM 10 undercut threshold,
suspect-suppresses-alerts, per-day dedup, cross-OTA merging, independent
check-in dates, PRICE_RISE defaulting to silent, one-OTA-failure isolation,
KL date boundaries, and cron key auth.

These tests are not decorative: the cross-OTA merge test failed on first run
and exposed a real ordering bug.

---

## Spec reconciliation

Where the two documents disagreed, v2 won. Concretely:

- **Prompt numbering.** v2 inserts *5A (extraction retrofit)*, *9 (Actions Log +
  Handover)* and *Phase 6*, shifting everything after v1's Prompt 8 by one.
  This build uses v2's numbering and features.
- **Check-in dates, currency guard, suspect flag, guest standardisation,
  public-rate-only** (v2 Prompt 5A) are all implemented; v1 had none of them.
- **`checkInDate` in the comparison identity** replaces v1's competitor + OTA +
  room key throughout history, alerts and the calendar.
- **`notify: false` for PRICE_RISE** is v2-only and is the default here.
- **Cross-OTA merge, per-event dedup and "Report wrong reading 🚩"** are v2-only.
- **Quiet hours, digests, notification toggles, failure watchdog** (v2 Prompt 7)
  replace v1's plain send-every-alert behaviour.
- **Comp-set positioning, Gemini usage counter, OTA health strip, "Last check"
  staleness indicator** (v2 Prompt 8) are all on the dashboard.
- **Actions Log and Shift Handover** (v2 Prompt 9) are implemented as their own
  collection and settings document.
- **Config JSON backup** (v2 Prompt 11) is on the History page alongside CSV.
- v1's **"Order Summary" table** and closing "make-or-break moments" note were
  dropped in v2 and are not reproduced.

### Deliberately not built

Per v2's own "do not build" list: WhatsApp notifications (the free path is
unofficial and fragile), an AI price-prediction panel (not enough data to be
honest), multi-user logins, native mobile apps, and support for more than ten
competitors.

Phase 6's optional items are also absent by design: the weekly behaviour
summary, length-of-stay checks, per-room-type thresholds, PWA install and
12-month retention. They are documented in v2 as "only after 2–3 weeks of real
use", so building them now would be premature.