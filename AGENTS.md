# AGENTS.md тАФ EC Price Tracker

Repository knowledge for future sessions. Read this before making changes.

## What this is

A competitor rate monitor for a single independent hotel. It reads competitor
nightly rates off Booking.com, Agoda and Trip.com and alerts the owner when a
competitor undercuts them, sells a room, sells out, or moves price.

Built from two specification documents that shipped in `/workspace`
(`PRICE TRACKER 1.docx` = v1, `PRICE TRACKER 2.docx` = v2). **v2 supersedes v1
wherever they disagree.** The README has the full reconciliation table.

## Commands

```bash
npm start        # server + built SPA on :12000
npm run build    # build the React frontend into dist/
npm test         # business-logic tests (node --test)
npm run seed     # regenerate demo data (destroys data/db.json)
npm run dev:client   # Vite on :5173, proxies /api to :12000
```

`npm test` is not decorative тАФ it caught a real cross-OTA merge ordering bug.
Run it after touching `server/lib/`.

## Layout

- `server/lib/gemini.js` тАФ extraction. URL Context, Google Search fallback,
  offline simulator, and `resolveOtaUrls` for hotels found on the map.
- `server/lib/places.js` тАФ Google Places autocomplete/nearby/details, plus the
  offline simulator and `distanceMeters`. **The only place that talks to Maps.**
- `server/lib/discovery.js` тАФ radius clamp, store-backed discovery settings,
  `scanNearby`, `addDiscoveredHotels`, `refreshCompetitorRooms`.
- `server/lib/room-match.js` тАФ scored room-name matching (`scoreRoomMatch`,
  `suggestLinks`) behind the linking UI.
- `server/lib/checks.js` тАФ the check pipeline, `getRoomPriceMatrix`, and the
  Gemini usage counter.
- `server/lib/alerts.js` тАФ alert detection plus the currency and sanity guards.
- `server/lib/telegram.js` тАФ delivery, quiet hours, digests, failure watchdog.
- `server/lib/dates.js` тАФ **all** Kuala Lumpur date logic.
- `server/store.js` тАФ Firestore, falling back to a JSON document store.
- `src/lib/format.js` тАФ RM formatting, KL time, heat colours.
- `src/components/CompMap.jsx` тАФ Leaflet map + radius circle.
- `src/pages/` тАФ one file per route.

## Invariants тАФ do not break these

1. **Every comparison keys on competitor + OTA + room + `checkInDate`.**
   Dropping the check-in date makes a Saturday rate look like a crash against a
   Tuesday rate. This is the single most important rule in the codebase.

2. **`suspect` entries never fire alerts.** They are stored and shown with a ЁЯЪй
   badge, but `detectAlerts` skips them. A suspect price is by definition one
   we don't trust.

3. **In `detectAlerts`, the cross-OTA merge runs BEFORE the day-level dedup.**
   Both rules share the same identity key, so checking "already fired today"
   first silently swallows every merge. There is a test for this.

4. **A foreign currency is never compared as MYR.** `applyCurrencyGuard`
   either converts (keeping `originalCurrency`/`originalPrice`) or flags it
   suspect. A "$45" reading must never become RM 45.

5. **Timezone is Asia/Kuala_Lumpur (UTC+8) everywhere.** Use `lib/dates.js` on
   the server and `src/lib/format.js` on the client. Never use a bare UTC day
   or the browser's local timezone. Malaysia has had no DST since 1982, so the
   fixed offset is exact and avoids a tz database.

6. **One failing OTA never breaks the others.** `checkCompetitorOta` returns
   `status: 'error'` rather than throwing, and `checkAll` collects failures.

7. **Simulated data must never masquerade as real.** With no `GEMINI_API_KEY`
   the app generates readings, but every one carries `simulated: true` and the
   UI shows a ЁЯзк banner. Keep it that way.

8. **Telegram credentials and the PIN never touch the client or Firestore.**
   Server environment variables only.

9. **`marketLow`/`marketHigh` span every competitor's every OTA, never just the
   headline cell.** The headline cell is the cheapest listing *per OTA*; using
   those three numbers as the market range understates it and can tell the
   operator they are below market while a cheaper rival exists. There is a test
   for exactly this, and it was a real bug.

10. **My own listing only wins a headline cell on a tie.** The own-hotel row is
    useful context, but it must never mask a cheaper competitor.

11. **Room matching treats bed config and occupancy as hard conflicts, and
    marketing tier as soft.** Queen vs Twin is a different product and is never
    suggested; "Standard" vs "Deluxe" is the same room at many hotels and must
    stay linkable. Collapsing these two cases breaks the feature in one
    direction or the other.

12. **A wrong OTA URL is worse than a missing one.** `resolveOtaUrls` returns
    `null` rather than guessing, and rejects search-results URLs. A bad URL
    silently feeds a different hotel's rates into every comparison.

13. **Maps has an offline simulator too.** With no `GOOGLE_MAPS_API_KEY` the
    Map page runs against deterministic fake places, labelled 🧪. The code path
    is identical to the live one — keep it that way so the flow stays testable.

## Conventions

- Prices render as `RM 150` via `rm()`. Times are KL everywhere.
- Numeric columns use the `nums` class (tabular figures) so values don't
  reflow as they update.
- Destructive actions use the two-tap `ConfirmButton`, not `window.confirm`.
- Reusable primitives live in `src/components/ui.jsx`; add there rather than
  re-styling a one-off.
- Comments explain *why*, not *what*. Several non-obvious invariants above are
  documented inline at the point that enforces them тАФ don't strip those.

## Gotchas

- `node --test server/test/` fails; the glob form is required:
  `node --test "server/test/*.test.js"` (already wired as `npm test`).
- The store reads `DATA_DIR` **at import time**. Tests set it before importing
  anything else тАФ keep that ordering if you add test files.
- `data/` is gitignored. Seeding destroys it; there is no migration story.
- Cron endpoints return **503** when `CRON_SECRET` is unset (fail closed) and
  **401** on a wrong key. Don't "fix" the 503 into a 200.
- Vite proxies `/api` to :12000 in dev; `dist/` must exist for `npm start` to
  serve the SPA.

## Deliberately out of scope

Per the v2 spec's own "do not build" list: WhatsApp notifications, AI price
prediction, multi-user logins, native apps, >10 competitors. Phase 6 optional
items (weekly behaviour summary, length-of-stay checks, per-room thresholds,
PWA, 12-month retention) are intentionally unbuilt тАФ the spec says they should
only follow 2тАУ3 weeks of real use.