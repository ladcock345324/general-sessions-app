# General Sessions — Progress & Onboarding

## What This App Is

A mobile-first PWA for a criminal defense attorney to manage clients, cases, hearings, and hours. Built with React + Vite, backed by Supabase. Runs at `localhost:5173` in dev.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 19, Vite 8, React Router v7 |
| Styling | CSS Modules (per-page/component) |
| Backend | Supabase (Postgres + REST via supabase-js v2) |
| Auth | Supabase Auth (email/password) |
| Storage | Supabase Storage (`warrants` bucket) |
| PWA | vite-plugin-pwa, workbox-window |
| Data | Supabase only — static sample files deleted |

---

## Supabase Project

- **URL:** `https://afhzkqjrciyoeizrpaxt.supabase.co`
- **Client file:** `src/supabaseClient.js`
- **RLS:** Enabled on all 7 tables. Each table has an "authenticated users only" policy applied to all commands. The policy expression was updated **2026-06-24 via MCP** to wrap the auth call in a subquery — `USING ((select auth.role()) = 'authenticated')` (was `USING (auth.role() = 'authenticated')`) — so Postgres evaluates `auth.role()` once per query instead of once per row. This cleared the "Auth RLS Initialization Plan" performance advisor on all 7 tables (see Known Issues). RLS was applied to `clients`, `incidents`, `cases`, `hours`, `next_events` at some prior point; applied to `courtroom_documents` and `personal_notes` on 2026-06-17 via Supabase migration (see `supabase_migration_enable_rls_courtroom_personal_notes.sql`).
- **Auth:** Email/password. One user account.

---

## Database Schema

### `clients`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto |
| `last_name` | text | |
| `first_name` | text | |
| `gender` | text | "M" or "F" |
| `age` | int | legacy/dormant column — kept for reversibility; UI no longer reads, writes, or displays it (same pattern as `relieved_as_counsel`) |
| `oca` | text | optional OCA # |
| `custody_status` | text | `"in_custody"`, `"bonded_out"`, or `"out"` |
| `relieved_as_counsel` | boolean | legacy column — kept for reversibility; not read by app logic; section placement driven by `relieved_closed` |
| `relieved_closed` | boolean | shows CLOSED badge when true |
| `closed_at` | timestamptz | set when a client is closed, null when reopened; used to sort the Closed section (most recently closed first) |
| `criminal_history_url` | text | Supabase Storage public URL for criminal history PDF |
| `criminal_history_text` | text | extracted text from criminal history PDF — populated on upload |
| `booking_date` | text | "M/D/YYYY" — date booked / initial appearance before magistrate; optional. Added 2026-06-24 via MCP. Used to compute the in-custody prelim-hearing cutoff (see entry below). |
| `booking_time` | text | "h:MM AM/PM" (same format as `next_events.event_time`) — time of booking; optional, hour-only in the UI. Added 2026-06-24 via MCP. |

### `next_events`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto |
| `client_id` | uuid FK → clients | |
| `docket_type` | text | edited as a preset `<select>` ("Jail Docket", "Bond Docket", "Review Docket", "Settlement Docket") + an optional append-text input; the two are combined into this single column on save (e.g. "Jail Docket Judge Smith covering") and split back on load (2026-06-24, revised from the broken datalist combobox) |
| `reason` | text | optional — "Trial", "Settlement", or blank |
| `event_date` | text | e.g. "6/7/2026" |
| `event_time` | text | e.g. "9:05 AM" |
| `courtroom` | text | e.g. "4B" — displayed as "Courtroom 4B" |
| `judge` | text | selected from dropdown or custom "Other" value |
| ~~`subpoenas`~~ | — | **DROPPED 2026-06-24 via MCP.** Previously deprecated (data cleared, all app code references removed); the column itself has now been dropped from `next_events`. No app code reads or writes it; kept here struck-through for history only. |
| `ada_name` | text | Assistant DA name — entered in the Next Event form; displayed in single-client view only |

> One row per client (maybeSingle query). Add/Edit Next Event form upserts this row.

### `incidents`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto |
| `client_id` | uuid FK → clients | |
| `incident_date` | text | e.g. "7/16/2026" — used as display label |
| `incident_description` | text | e.g. "Watch Theft Incident" — shown as header with date in parens |

> Incidents are collapsible on the client file page. Sorted most recent first.
> Description is inline-editable (click "edit incident" to type directly into the header).

### `cases`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto |
| `incident_id` | uuid FK → incidents | |
| `case_number` | text | e.g. "GS1041482" |
| `charge` | text | required |
| `charge_abbrev` | text | optional short label shown in client list and case rows |
| `classification` | text | optional charge classification — one of "C MIS", "B MIS", "A MIS", "E FEL", "D FEL", "C FEL", "B FEL", "A FEL", "CAPITAL" (all uppercase; least→most serious); null = unset. Added 2026-06-24 via MCP. Shown in parens after the charge abbrev (client list) / charge (single view). |
| `warrant_url` | text | Supabase Storage path for affidavit PDF (e.g. `warrants/GS1041482.pdf`) — signed URL generated on demand |
| `bond_amount` | numeric | 0 displays as "$0 bond" |
| `notes` | text | free-text, editable on case view with Save button |
| `disposition` | text | null = open; shown when set |
| `status` | text | default "open" |
| `warrant_text` | text | extracted text from warrant PDF — populated on upload |

> Affidavit status is derived purely from `warrant_url`: "Affidavit on File" if set, "No Affidavit" if null.

### `courtroom_documents`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto |
| `client_id` | uuid FK → clients | |
| `name` | text | display label (e.g. "Motion to Suppress") |
| `file_url` | text | Supabase Storage path (not full URL) — e.g. `courtroom-docs/[client_id]/[ts]_[filename]` |
| `extracted_text` | text | extracted text from the PDF — populated on upload |

> Up to 5 documents per client. Viewed via `createSignedUrl` (1-hour TTL). Stored in the `warrants` bucket under `courtroom-docs/` prefix.

### `hours`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto |
| `client_id` | uuid FK → clients | |
| `entry_date` | text | e.g. "6/1/2026" |
| `hours` | numeric | selected from 0.1–0.9 dropdown |
| `description` | text | |

### `personal_notes`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto |
| `client_id` | uuid FK → clients | unique — one note per client |
| `note` | text | free-text personal note |
| `updated_at` | timestamptz | auto-updated on save |

> One row per client (maybeSingle query). Fetched in `useClientFile`.

---

## Supabase Storage

| Bucket | Path pattern | Used for |
|---|---|---|
| `warrants` | `warrants/[case_number].pdf` | Case warrant PDFs |
| `warrants` | `criminal-history/[client_id].pdf` | Criminal history PDFs |
| `warrants` | `courtroom-docs/[client_id]/[timestamp]_[filename]` | Courtroom document PDFs |

> Bucket is named `warrants` but serves all three use cases via path prefixes.
> Files are uploaded with `upsert: true` (replace on re-upload).
> Viewed via `createSignedUrl` (1-hour TTL) opened in a new tab — not public URLs.

---

## Completed Features

### Cleanup Batch — OCA "#", name order, subpoenas, docket combobox, classification (2026-06-24)

Five independent UI/data cleanups:

1. **"#" removed from OCA/inmate number display.** The leading `#` was dropped from the rendered OCA in both the client list row (`ClientRow.jsx`) and the single-client view header (`ClientFile.jsx`). Reads "Boykins, Michael (M) 295180" now. The stored value is unchanged.
2. **New Client form name order swapped.** In `NewClient.jsx` the First Name input is now above Last Name (autoFocus moved to First Name so the top field still focuses on load). `EditClient.jsx` untouched; storage/display of names unchanged everywhere.
3. **Subpoenas removed from Next Event.** Removed the Subpoenas `<select>` from the Next Event form, its display in the Next Event block, and every code reference (`EMPTY_EVENT`, form init, payloads, and `seed.js`). Data was cleared via MCP and all app code references removed; the `next_events.subpoenas` column was subsequently **dropped via MCP (2026-06-24)** — no app code read or wrote it, so nothing broke when it was dropped.
4. **Docket Type → preset select + optional append text.** ~~Initially shipped as an `<input>+<datalist>` combobox~~ — **revised same day** because the datalist dropdown never opened on iOS or desktop. Now a real native `<select>` (blank + the four presets) plus a separate optional `<input>` ("Add'l text (optional)") right after it. On save the two are combined into the single `docket_type` column via `[docketPreset, docketCustom].filter(Boolean).join(' ').trim() || null`; on load `splitDocketType()` peels a leading known preset back into the select and puts the remainder (or any legacy/custom value) into the text box. Flows through the existing `...rest` save payload to both Dexie and the sync queue. Display renders the combined `docket_type` as-is.
5. **`cases.classification` added (field + two display spots).** New optional `<select>` placed immediately after "Abbrev. (for client list)" in **both** `CaseView.jsx`'s edit form and `ClientFile.jsx`'s inline `AddCaseForm`. Options in order (**uppercased same-day; existing row migrated via MCP**): blank, "C MIS", "B MIS", "A MIS", "E FEL", "D FEL", "C FEL", "B FEL", "A FEL", "CAPITAL" (least→most serious); blank stores null. Included in both the Dexie write and the sync-queue payload for case INSERT (AddCaseForm) and UPDATE (CaseView); CaseView pre-populates from the existing value. Displayed in parentheses after the charge in the single-client case rows (`ClientFile.jsx`), inheriting the charge-text font exactly, only when set (no empty parens). In the **client list** (`ClientRow.jsx`) it's in its own span styled to match the **next-event info line** (`.caseClassification` ≈ `.next`: blue `#6b9fd4`, normal weight 400, 13px desktop / 11px mobile) — ~~originally matched case-number style (bold, 10/11px); restyled same-day~~. A `{' '}` fragment before the span guarantees exactly one space between the charge abbrev and the `(CLASSIFICATION)`. `classification` reaches `ClientRow` via the full case objects already carried in `ClientList.jsx` `toRowProps` — no extra threading needed.

### In-Custody Preliminary-Hearing Countdown (2026-06-24)

Adds a per-client preliminary-hearing deadline line to the client list for in-custody defendants.

- **Legal basis.** Tenn. R. Crim. P. 5 requires the preliminary hearing within **14 days** of the initial appearance before the magistrate. The computation follows **Rule 45(a)**: count calendar days from the initial appearance. In Davidson County the commissioner review happens at booking, so the client's **booking date is used as a proxy** for that initial appearance. **Cutoff = booking date + 14 calendar days**, then a **weekend-only rollover** (lands on Saturday → +2 to Monday; Sunday → +1 to Monday). **Rule 45 holidays are intentionally NOT applied** — weekends only. The cutoff is **computed client-side at render time and never stored** — no cutoff column exists.
- **New columns** (added via Supabase MCP, no migration in-repo): `clients.booking_date` (text, "M/D/YYYY") and `clients.booking_time` (text, "h:MM AM/PM"). Both optional/nullable.
- **New util `src/prelimDeadline.js`** — pure date math, no deps:
  - `computePrelimCutoff(bookingDateStr)` → "M/D/YYYY" (+14 days, weekend rollover).
  - `shortWeekday(dateStr)` → "Sun".."Sat".
  - `formatMD(dateStr)` → "M/D" (strips year).
  - `formatBookingTimeCompact(timeStr)` → compact "2PM" (hour + AM/PM, no minutes/space).
  - **Timezone-safe parsing:** all functions split "M/D/YYYY" into numeric parts and build dates with `new Date(y, m-1, d)` — never `new Date(string)` — to avoid UTC shifting the weekday/date by a day.
- **Form field** (`NewClient.jsx` + `EditClient.jsx`): a "BOOKED/INITIAL APPEARANCE" group placed **between Gender and OCA #**, laid out in a 3-column `.bookingGrid`:
  - **Date** — native `<input type="date">` (unchanged throughout; works correctly everywhere).
  - **Hour** — `<select>` with blank + 1–12. *(A native `<input type="time" step="3600">` was the initial implementation but was replaced because it failed to suppress the minutes wheel on both iOS Safari and desktop.)*
  - **AM/PM** — `<select>` with blank + AM/PM.
  - **Clear button** — reddish, shown only when at least one field has a value. iOS Safari's native date picker has no working clear (its "Reset" does nothing), so this button zeroes all three controlled React state fields, works on every platform.
  - Form state holds `booking_date`, `booking_hour`, `booking_period`; `combineTime()` joins hour + period to "h:00 AM/PM" (null if either blank); `parseTime()` reverses on load. Stored as `booking_date` = "M/D/YYYY" and `booking_time` = "h:MM AM/PM" (same format as `next_events.event_time`). Optional (blank → null). Offline-first: Dexie first, then `addToSyncQueue`, with both fields in the Dexie and sync-queue payloads (INSERT and UPDATE). After Clear + Save, both columns write null and the client-list info lines disappear.
- **Client-list display** (`ClientRow.jsx` + `ClientRow.module.css`): rendered **only when `custody_status === "in_custody"` AND `booking_date` is set**. Two compact lines (`.prelimBlock`, color `#d96a6a` as `--prelim-color`, ~8.5px desktop / 8px mobile, tight line-height), **centered over the custody badge** (the `.right` wrapper is right-anchored via `position: absolute`; the `.badgeArea` column uses `align-items: center` so the lines center over the badge — badge is the widest child so it stays flush right for all statuses):
  - Line 1 (normal weight): `{time} {bookWeekday} {bookMD}` — e.g. `7AM Wed 6/10`
  - Line 2 (**bold**, the cutoff deadline): `→ {cutoffWeekday} {cutoffMD}` — e.g. `→ Wed 6/24` (real U+2192 arrow)
  - Booking time shown as-is (no offset). No label; no time on the cutoff side.

### Indigent Circle — 4-Color Cycle, Gray Removed, Red Default (2026-06-22)

Replaced the indigent-status circle's old 3-state cycle with a 4-state one and removed gray entirely. **Supersedes the cycle/default described in the 2026-06-10 "UI Polish" entry below.**

- **New cycle (wrapping):** `red → yellow → green → gold → red → …` (was `gray → red → green → gray`).
- **Colors (full map set explicitly):** red `#b85555` (kept), yellow `#E8913A` (warm orange-leaning amber), green `#3d9e6a` (kept), gold `#FFD700` (bright metallic gold). yellow and gold are intentionally distinct at a glance.
- **Gray fully removed** as a state, default, and fallback. Any non-cycle value (legacy `gray`, null, empty) normalizes to red and advances to yellow on first tap, so no path can render gray. (Unrelated `badgeGray` custody-badge styling was left untouched.)
- **Red is the new unset default.** Migration `supabase_migration_indigent_default_red.sql` changed the `clients.indigent_status` column DEFAULT from `'gray'` to `'red'` and ran `UPDATE clients SET indigent_status = 'red'` — applied via the Supabase MCP connector; **all 9 client rows set to red**, verified 0 non-red.
- **Both render sites updated identically** — `ClientRow` (client list) and `ClientFile` header — plus the `ClientList` fallback. Size, hit-area, position, and offline-first sync behavior unchanged.

### Automated Nightly Backups — DB + Storage (2026-06-22)

Free ($0/month) self-built nightly backup that covers the gap Supabase's own backup products leave: **Supabase Daily Backups and the paid PITR add-on only cover the Postgres database — they explicitly exclude files stored via the Storage API.** No Supabase plan, paid or free, protects the PDFs in the `warrants` bucket (warrant affidavits, criminal history, courtroom documents) on its own. This system backs up both the database and those Storage files. Chosen over Supabase Pro ($25/mo, DB-only) and PITR (~$100+/mo, overkill for current volume).

**The script (`scripts/backup.js`)** — Node, ESM, run by the workflow (not locally):
- Reads the service role key **only** from `process.env.SUPABASE_SERVICE_ROLE_KEY`; if missing, errors and exits non-zero **without printing the key**. The key is never logged, printed, or written to disk anywhere.
- Creates a service-role `@supabase/supabase-js` client (bypasses RLS by design, so it can read every row and file).
- **DB dump:** all 7 tables (`clients`, `incidents`, `cases`, `hours`, `next_events`, `personal_notes`, `courtroom_documents`) → `backup/db/<table>.json`, **paginated via `.range()`** (1000/page) so it never truncates at the supabase-js 1000-row default.
- **Storage dump:** walks the `warrants` bucket recursively from the root — `.list()` is non-recursive and paginated (100/page), so each level is paginated and subfolders are recursed — covering `warrants/`, `criminal-history/`, and the nested `courtroom-docs/<client_id>/<timestamp>_<filename>`. Every file's bytes are saved under `backup/storage/<same path>` (skips the `.emptyFolderPlaceholder` markers).
- **`backup/manifest.json`:** UTC ISO timestamp, per-table row counts, total file count, total bytes — a quick integrity summary.
- **Fails loudly** (non-zero exit) on any select/list/download error, so a broken backup can never report success.

**The workflow (`.github/workflows/backup.yml`):**
- Triggers: nightly `schedule` cron **`0 8 * * *` (08:00 UTC ≈ 2–3am US Central)** plus `workflow_dispatch` (manual button).
- `permissions: contents: write`; checkout main → setup Node 20 → `npm ci` → `node scripts/backup.js` with `SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}`.
- **Publishes a rolling single snapshot to the dedicated `backups` branch**: creates a fresh orphan branch, force-adds `backup/` (which is gitignored on main), commits one snapshot, and **force-pushes one orphan commit** to `backups` each run — so the branch always holds exactly the latest snapshot and old PDF blobs never accumulate in git history (bounds repo size). Uses the built-in `GITHUB_TOKEN`. **Writes only to `backups` — never to main.**

**Housekeeping:** `backup/` added to `.gitignore` on main so the local output dir can never be committed there. The `backups` branch is created by the first workflow run (not pre-created).

**One manual setup step only Lucas can do** (the key must never go into chat or any file): copy the Supabase service role key from Project Settings → API Keys, and paste it as a GitHub Actions repo secret named `SUPABASE_SERVICE_ROLE_KEY`. The workflow won't succeed until that secret exists.

**Restore test — COMPLETE (2026-06-22):** the latest snapshot from the `backups` branch was restored into a **throwaway second Supabase project** (never touching production) via `scripts/restore-test.js`. Results:
- **All row counts matched the manifest exactly** — clients 9, incidents 10, cases 18, hours 12, next_events 6, personal_notes 5, courtroom_documents 0 (9/10/18/12/6/5/0).
- Rows were inserted with their **explicit ids** in FK-safe order (clients → incidents → cases → the rest), so the **client→incident→case relationships reconnected with zero orphans**.
- All **33 Storage files** re-uploaded to a fresh private `warrants` bucket, and one PDF (`warrants/11111111.pdf`) passed a **byte-for-byte round-trip check** — downloaded back from the test project, 90,424 bytes in and out, `%PDF` header intact.

This confirms the backup is genuinely restorable, not just that the script ran. The restore script reads test-only credentials from a gitignored `.env.restore-test` and hard-asserts the test project ref before any write; that creds file was deleted after the test.

### Offline Cold-Launch Fix — SW Update Model "Option 1" + Offline-Readiness Status Line (2026-06-22)

Fixes the **blank-screen-on-offline-cold-launch** bug: launching the app offline from the iOS home-screen icon showed a completely blank screen (no app shell at all). **This is distinct from the 2026-06-21 data-layer cache-wipe fix** — that one showed "No clients yet" with the shell intact (a Dexie data problem); this one was the shell/JS bundle not being served at all (a service-worker lifecycle/timing problem).

**Root cause:** `vite-plugin-pwa` was set to `registerType: 'autoUpdate'` with no explicit workbox block, so the generated `sw.js` had `skipWaiting` + `clientsClaim` both ON. That let a new, **not-yet-fully-precached** service worker seize control of the page mid-update. Combined with `no-store` on `index.html` and hash-named assets that change every deploy, a cold launch could land in a half-cached state where the served `index.html` referenced a JS bundle that wasn't in the cache → blank screen offline. The React render path was already confirmed innocent (getSession reads localStorage; SyncContext renders children regardless), so this was purely a SW timing fix.

**The fix — "Option 1" update model (`vite.config.js`):**
- `registerType: 'prompt'` (no immediate takeover) and `injectRegister: null` (registration now happens in-app — see below — preventing double registration).
- Explicit `workbox` block: **`skipWaiting: false`** (the gate — a new SW only reaches "waiting" *after* its install/precache completes, then activates on the next full launch when all instances are closed and reopened, so a partially-cached SW never controls a page), `clientsClaim: true` (first-ever install still protects the current session ASAP; does not reintroduce the race because skipWaiting is false), `cleanupOutdatedCaches: true`, `globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}']`, `navigateFallback: 'index.html'`.
- **Updates apply only on the next full launch.** We deliberately never call `updateServiceWorker()` and never force a reload. `needRefresh` is used for DISPLAY ONLY.

**In-app registration (`src/PWAContext.jsx`):** `useRegisterSW` from `virtual:pwa-register/react`, called once in `PWAProvider` (mounted as the outermost provider in `App.jsx`). Exposes `offlineReady`, `needRefresh`, and a live **`controlled`** signal (`navigator.serviceWorker.controller !== null`, kept current via a `controllerchange` listener) to the UI via context.

**Offline-readiness status line (`src/components/OfflineStatus.jsx` + `.module.css`):** one shared, low-contrast component rendered on **both** the Login screen (standalone line, top of screen, respects `env(safe-area-inset-top)`, with an Online/Offline segment) and the ClientList shell (next to the existing sync bar, connectivity omitted there to avoid duplicating the sync bar). States:
- **Offline-ready** (green dot) — `controlled` is true: a SW actively controls the page, so the shell is served from cache and the app will open offline. This is the live truth to check before going underground.
- **Preparing offline…** (amber dot) — registered/installing but `controlled` still null (first-ever visit before claim).
- **Update ready — opens on next launch** (muted) — `needRefresh` true; the visible confirmation Option 1 is working. **No reload/refresh button** by design.

**Verified from the generated `dist/sw.js`:** unconditional `self.skipWaiting()` is **gone** (replaced by the prompt-mode `SKIP_WAITING` message listener that only fires if we post to it — which we never do, so the SW waits); `clientsClaim()` present; precache manifest includes `index.html` **and** the main hashed JS/CSS bundles; `NavigationRoute` → `index.html` wired. The auto-injected `registerSW.js` script is no longer in `dist/index.html` (confirming `injectRegister: null`).

#### How to verify on-device (iPhone)

1. **One-time transition (do this first).** The version currently on the phone still runs under the OLD immediate-takeover SW, so this fix *installs* under the old rules. Open the app **online once**, then **fully close it** — swipe it away in the app switcher (don't just background it). This lets the new safe SW activate. From the *next* launch onward the new model is in effect.
2. **Reach the green light.** Open the app **online** and confirm the status line reads **"Offline-ready" (green)** on **both** the Login screen **and** the ClientList screen. Do not trust offline use until you've seen green on both.
3. **The real test.** Turn on **Airplane Mode** *and* confirm **Wi-Fi is off** (no signal at all). Then **fully close** the app and **cold-launch** the home-screen PWA icon (must be a true cold launch, not resuming a backgrounded instance). **Expected:** the shell loads, the client list is visible, **no blank screen**.
4. **Update-on-next-launch behavior.** After a future deploy, open the app online and expect **"Update ready — opens on next launch"** to appear. The new version intentionally does **not** take over on mere backgrounding — it only activates after a **full close (swipe away) and reopen**. This is the expected, safe behavior, not a bug.
5. **If it ever blanks again.** First check whether the **status line itself rendered at all**. If even the status line is missing, the failure is **earlier than the service worker** (the shell/JS never executed) rather than a SW caching problem — note this, as it points the diagnosis in a different direction.

### Critical Offline Cache-Wipe Fix (2026-06-21)

**Important correction to the offline-layer behavior described elsewhere in this doc.** Commit `feffd17`, `src/syncManager.js`.

**Root cause:** `fullSync` destroyed the entire local Dexie cache on any offline launch. `supabase-js` does not throw when offline — it resolves with `{ data: null, error }`. `fullSync` ignored `error`, destructured only `data`, and ran `clear()` then `bulkPut(data ?? [])` → `bulkPut([])` inside a transaction that committed cleanly because nothing threw. The initial sync in `SyncContext` fired on mount with a valid persisted session and no connectivity guard, so opening the app offline (e.g. a courthouse basement) wiped all 7 tables, producing "No clients yet" / "Client not found". **Server data was never affected** — it repopulated on reconnect.

**The fix — three complementary guards:**

- **FIX A** — `fullSync` returns early if `!navigator.onLine`, so an offline launch never reaches the clear/bulkPut block.
- **FIX B (the critical backstop)** — each table's result is destructured as `{ data, error }`; the guard `if (error || !Array.isArray(data)) return Promise.resolve()` skips that table and preserves its existing cache. Only a clean response (error null AND data is an array) proceeds to `clear()` + `bulkPut(data)`. The `?? []` fallback was removed. A legitimately empty array (`data = []`, `error = null`) still clears — this preserves cross-device deletion propagation. FIX B is what protects against "lie-fi" (`navigator.onLine` true but server unreachable, e.g. captive portals), which FIX A alone would miss.
- **FIX C** — `processSyncQueue` returns early if `!navigator.onLine`, preventing offline-created writes from burning their 3-retry limit and being permanently marked `failed`; they stay `pending` until reconnect.

**Verified** via airplane-mode cold-launch test: clients and client files remained fully available offline; a client added offline synced successfully on reconnect.

### Client List + Next Event Batch (2026-06-21)

1. **Settlement Docket** — added as a 4th `docket_type` option alongside Jail/Bond/Review in the Next Event form; behaves identically everywhere `docket_type` is shown.

2. **Age removed from UI** — stripped from the New Client and Edit Client forms and from all name displays (`ClientRow`, `ClientFile` header `nameCore`, and the sticky name bar now read "LASTNAME, FIRSTNAME (gender)" with no age). The `clients.age` column is kept dormant in the DB for reversibility — the app no longer reads, writes, or displays it.

3. **Client List sort toggle** — a badge control (white text, transparent fill, thin rounded-pill border) sits directly above the Active section header. Cycles between "Sorting by: Name" and "Sorting by: Next Event"; selection persisted in `localStorage` (key `clientListSortMode`).
   - **Active section** — Name mode = alphabetical by last name; Next Event mode = ascending by combined event date+time (soonest first), with clients that have no next event grouped at the bottom, alphabetical among themselves. (A missing `event_time` sorts as start of day, so dateless events precede timed events on the same date.)
   - **Closed section** — the toggle does NOT apply; always sorted by `closed_at` DESC (most recently closed at top), with legacy null-`closed_at` clients at the bottom. Close Case stamps `closed_at` (`new Date().toISOString()`); Reopen Case clears it back to null. Both written offline-first to Dexie + enqueued via `addToSyncQueue`, same as `relieved_closed`.

4. **ADA moved to Next Event** — removed `clients.da_name` from the forms, the ClientFile header, and all code references; the column was dropped from the DB. Added an "Assistant DA Name" input to the Next Event form (`next_events.ada_name`). The single-client Next Event box now shows "ADA: [name]" appended (e.g. "Trial  |  Courtroom 5C  |  L. Jones  |  ADA: Mary Hamilton") only when set. **Not shown in the client list view.**

### RLS Enabled on All Tables (2026-06-17)

Supabase's security advisor flagged `courtroom_documents` and `personal_notes` as **CRITICAL** ("RLS Disabled in Public"). These two tables were fully exposed to anyone who had the app's public Supabase anon key — which is visible in the production JS bundle — with no login required, bypassing the app's auth screen entirely. At the time of discovery, `personal_notes` had 3 real rows exposed; `courtroom_documents` had 0 rows.

A check of the other 5 tables confirmed that `clients`, `incidents`, `cases`, `hours`, and `next_events` already had RLS enabled with an identical "authenticated users only" policy (`USING (auth.role() = 'authenticated')`, applies to all commands). This was a partial gap, not a database-wide one. That prior RLS setup had never been reflected in this doc.

**Fix applied:** Enabled RLS and added the matching "authenticated users only" policy to both `courtroom_documents` and `personal_notes`, applied directly as a Supabase migration via the MCP connector (not through the normal app commit flow). Migration SQL is version-controlled in `supabase_migration_enable_rls_courtroom_personal_notes.sql`.

**Verified:** Supabase security advisor cleared both CRITICAL findings after the fix. Remaining advisory items:
- ~~"Auth RLS Initialization Plan" warnings on the original 5 tables — performance-only suggestion (re-evaluating `auth.role()` per row instead of once via subquery); not a security issue; acceptable to leave as-is.~~ **RESOLVED 2026-06-24:** all 7 tables' policies were rewritten to `USING ((select auth.role()) = 'authenticated')` via MCP; the auth call now evaluates once per query. All 7 "Auth RLS Initialization Plan" WARNs cleared in the advisor.
- "Leaked Password Protection Disabled" — low-severity Auth setting; not yet addressed (see Known Issues).

### Collapse "Relieved as Counsel" into "Closed" Model (2026-06-16)

Unified the two-status model (Active / Relieved as Counsel) into a single Active / Closed model. The `relieved_as_counsel` column is kept in the database for reversibility but is no longer used by the app.

- **Section placement** — `ClientList.jsx` now filters Active vs. Closed entirely on `relieved_closed` (`false` → Active, `true` → Closed). `relieved_as_counsel` is no longer read anywhere in app logic.

- **Section header** — "RELIEVED AS COUNSEL" renamed to "CLOSED" in `ClientList.jsx`.

- **"Relieve as Counsel" button removed** — `ClientFile.jsx` no longer has the "Relieved as Counsel" action button, its confirmation dialog, `handleRelieve()`, `handleReopen()` (the dual-flag reset path), `isRelieved` flag, or `showRelieveConfirm` state. Only "Close Case" / "Reopen Case" (toggling `relieved_closed`) and "Delete Client" remain as actions.

- **"Relieved as Counsel" text removed app-wide** — purged from `ClientRow.jsx` (unstyled badge text in closed rows), `ClientList.jsx` (section header), and all `ClientFile.jsx` button/dialog copy.

- **Closed-section row brightness** — removed `opacity: 0.5` (`.dimmed` class) from Closed-section rows. Name, OCA, case numbers, and charge text now render at full brightness matching the Active section.

- **Closed-section custody badge** — Closed rows now show a gray/muted `CustodyBadge` (In Custody / Bonded Out / Out) stacked above the CLOSED pill, matching how closed clients appeared when they were still in the Active section.

- **Data migration** — queried for clients with `relieved_as_counsel = true` and `relieved_closed` not true; zero rows found. The one existing client with `relieved_as_counsel = true` (Test) already had `relieved_closed = true`, so no backfill was needed.

- **Section moves** — Pitts, Terron and Woods-James, Kimberly (both had `relieved_closed = true, relieved_as_counsel = false`, so previously appeared in Active with a gray CLOSED badge) moved to the Closed section as intended.

### Client List + ClientFile Mobile/Desktop Layout Fixes (2026-06-16)

Followed a critical production regression (commit 42dc61b, reverted same day) that caused desktop client-list rows to collapse and badges to bleed into adjacent rows.

- **Desktop row height (no-next-event clients)** — rows with no upcoming hearing collapsed to near-zero height because the `&nbsp;` spacer (`.nextEmpty`) that provided a height floor had been removed in the reverted commit. Fix: keep the `&nbsp;` in the DOM, but hide it on mobile only via `display: none` inside `@media (max-width: 768px)`. Desktop keeps its height; mobile avoids the blank gap.

- **Mobile indigent circle position** — on mobile, all indigent circles were aligning in a vertical column at the far right of the name row regardless of name length. Root cause: the name `<span>` had `flex: 1 1 auto` (flex-grow: 1), causing it to expand to fill the full `.nameLine` container and push the circle to the right edge. Fix: `flex: 0 1 auto` — name takes only its content width, circle sits immediately after the text. Also tightened the name/next-event vertical gap: reduced `.info` gap from 4px to 1px and `.indigentCircle` height from 28px to 22px on mobile.

- **Mobile next-event line reformatting** — removed the leading underlined "Next:" label from the JSX; removed the "Courtroom " prefix (courtroom value like "4B" renders directly); set `white-space: nowrap; overflow: hidden; display: block` on `.next` so the line truncates on narrow screens rather than wrapping; reduced mobile `.next` font-size from 13px to 11px for single-line fit.

- **ClientFile mobile header — badges beside name block** — on mobile, the name/OCA/bond text block and the custody badge now sit in a flex row (`align-items: center; justify-content: space-between`) so the badge is vertically centered beside the text, not stacked below it or anchored with dead space. `badgeStack` gets `flex-shrink: 0`; `nameRowLeft` gets `flex-shrink: 1; min-width: 0`. Badge font-size reduced to 9px / 2px 6px padding (roughly half desktop size) to free width; name font-size set to 15px. At 15px, the worst-case name "Woods-James, Kimberly (F, 56)" (≈14.56em) fits with ~17px margin. Note: two earlier approaches (flex-column override, then display:block override) were each verified present in the compiled bundle with correct cascade order but neither fixed the layout on device — the working fix required no media-query override at all, only flex-shrink tuning.

### Minor Fixes Batch (2026-06-16)
- **ClientFile closed-client badges** — `ClientFile.jsx` header now mirrors `ClientRow`'s "gray everything when relieved_closed" logic: custody badge (`In Custody`/`Bonded Out`/`Out`) renders with `badgeGray` instead of red/green when `relieved_closed = true`, and a `CLOSED` badge now appears next to it. Added `.badgeGray`, `.badgeStack`, `.closedBadge` classes to `ClientFile.module.css` (copied from `ClientRow.module.css`) — previously these existed only in `ClientRow`, so the single client view never reflected closed status.
- **`charge_abbrev` on case creation** — the inline "+ add a case" form (`AddCaseForm` in `ClientFile.jsx`, used under an incident) now has an "Abbrev. (for client list)" input writing to `cases.charge_abbrev`, matching the field already present in `CaseView`'s edit form. Previously cases created from `ClientFile` had no way to set this field until edited from `CaseView`.
- **Sticky client name bar** — `ClientFile.jsx` renders a minimal `position: sticky; top: 0` bar showing `LASTNAME, FIRSTNAME (gender, age)` above the existing header, background `#1E2A3A` matching the page so it blends in; truncates with ellipsis on overflow. Stays visible while scrolling so the client identity is never ambiguous mid-scroll. New `.stickyNameBar` class in `ClientFile.module.css`.
- **Indigent circle mobile overflow fix** — added a `@media (max-width: 768px)` block to `ClientFile.module.css` truncating `.name` (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0`) so unusually long names (e.g. "Woods-James, Kimberly") can't push the indigent status circle out of the flex row on mobile. `IndigentCircle`'s container already had `flexShrink: 0`, so it stays anchored once the name truncates. Desktop layout (no media query match) and normal-length names are unaffected.

### UI Polish (2026-06-10)
- **Indigent status circle** — new `indigent_status text DEFAULT 'gray'` column on `clients` table; Dexie schema bumped to version 2 with `indigent_status` indexed; 14px visible dot inside a 28px transparent hit-area container (`display: inline-flex`, centered); pointer events on the outer container only — inner circle has `pointer-events: none`; cycles gray → red → green → gray on tap; offline-first writes via Dexie + `addToSyncQueue`; renders in `ClientRow` (to the right of the OCA number) and `ClientFile` header (line 1, after name/gender/age); both views stay in sync via `useLiveQuery` *(cycle, colors, and `'gray'` default later superseded — see the 2026-06-22 "Indigent Circle — 4-Color Cycle" entry above)*
- **ClientFile header layout** — `nameCore` (`LASTNAME, FIRSTNAME (gender, age)`) and indigent circle on line 1 as `flex-wrap: nowrap`; OCA number on its own line 2 in muted text (`#9faab8`, `0.85em`) — previously OCA was concatenated into the name string
- **Mobile custody badge** — font-size, padding, and border-radius all reduced 30% on mobile only (inside `@media (max-width: 768px)`); vertically centered against full row height via `position: absolute` on `.right` with `top: 50%; transform: translateY(-50%)`; `.row` gets `position: relative` and `padding-right: 76px` to keep content clear — desktop layout unchanged
- **Incident edit calendar overlap fix** — date `<input>` moved below description `<textarea>` in the incident inline edit form so the native mobile date picker no longer covers the description field; `autoFocus` moved to the textarea
- **Case number tap target tightened** — navigation handler moved from the full `caseTableRow` div onto the `caseNum` span only; charge/abbreviation text and surrounding whitespace no longer trigger case navigation; case table layout switched from CSS grid (`display: contents` rows) to flexbox column so row containers can carry `padding: 1px 0` — both columns share equal vertical breathing room and sit on the same baseline per row; `caseNum` span has `width: 56px; flex-shrink: 0` to preserve column alignment

### Offline Layer — Phase 2 + Text Viewer (2026-06-10)
- **Reads migrated to Dexie** — `useClients` and `useClientFile` rewritten to use `useLiveQuery` from `dexie-react-hooks`; app loads instantly from IndexedDB; UI auto-updates on any Dexie write; return shapes identical so no UI component changes were needed
- **All writes offline-first** — every INSERT/UPDATE/DELETE across `NewClient`, `EditClient`, `ClientFile`, and `CaseView` writes to Dexie first then enqueues via `addToSyncQueue`; Supabase sync happens in the background; Storage uploads (warrants, criminal history, courtroom docs) remain direct
- **`CaseView` initial load from Dexie** — replaced Supabase `useEffect` fetch with a single `useLiveQuery` that reads the case record, walks `incident → client` for the header name, and covers all case fields including `notes` and `warrant_text`
- **`warrant_url` stores storage path** — warrant uploads now store `warrants/[case_number].pdf` in Dexie and Supabase instead of an expiring signed URL; "View Affidavit" generates a fresh signed URL on demand via `createSignedUrl`, matching how courtroom documents work
- **fullSync correctness** — `fullSync` calls `processSyncQueue` first so pending writes reach Supabase before the clear+bulkPut; after repopulating all 7 tables, re-applies any remaining pending queue entries to Dexie so local writes that haven't synced yet are never wiped from the UI; each table's clear+bulkPut is wrapped in a Dexie transaction
- **Deletions propagate across devices** — `fullSync` uses `clear()` + `bulkPut()` instead of `bulkPut` only, so records deleted on one device are removed from Dexie on all other devices at next sync
- **`processSyncQueue` hardened** — INSERT uses `upsert`, UPDATE uses `.update(payload).eq('id')` (avoids partial-payload upsert ambiguity); failures log `console.error('[syncQueue] failed:', table, operation, error)` for visibility during testing
- **TextViewerDrawer** — slide-up drawer component (`position: fixed`, 85% height, `0.28s cubic-bezier` transition, semi-transparent overlay) wired into: CaseView (`warrant_text`), ClientFile criminal history (`criminal_history_text`), ClientFile courtroom document tiles (`extracted_text`); typography: system-ui 13px, line-height 1.7, `#d0d8e4`, `pre-wrap`; fully offline since text is cached in Dexie

### Offline Layer — Phase 1 (2026-06-10)
- **Dexie.js** installed; `src/localDB.js` defines IndexedDB schema mirroring all 7 Supabase data tables plus a `sync_queue` table (auto-increment PK, fields: table_name, operation, record_id, payload, status, created_at, retry_count)
- **`src/syncManager.js`** exports: `fullSync` (parallel-fetches all tables → bulk-puts to Dexie, stamps `lastSyncedAt` in localStorage), `processSyncQueue` (processes pending queue entries oldest-first, upsert/delete via Supabase, retries up to 3×, marks failed after), `addToSyncQueue` (enqueues a local write), `startBackgroundSync` (30s interval + window `online` event → returns cleanup fn)
- **`src/SyncContext.jsx`** provides `isOnline`, `isSyncing`, `lastSyncedAt`, `triggerSync` via React context; initial `fullSync` fires on mount only after confirmed auth session; background sync starts after initial sync and is cleaned up on unmount
- **`App.jsx`** wraps router in `<SyncProvider>` inside `<AuthProvider>`
- **Sync status indicator** added to `ClientList.jsx` below the top bar: green dot + "Synced [time]" (online+synced), yellow dot + "Offline — changes will sync when reconnected" (offline), pulsing blue dot + "Syncing…" (in progress)
- All existing Supabase reads/writes untouched — Phase 1 is infrastructure only

### DB Cleanup (2026-06-09)
- Dropped `warrant_status` column from `cases` (was ignored by UI)
- Dropped `da_name` column from `cases` (legacy, no longer shown)
- Dropped `criminal_history` text column from `clients` (legacy, unused)
- Deleted `src/data/clients.js`, `src/data/cases.js`, `src/data/index.js` (static files, never used in UI)
- Removed unused `EditIncidentForm` component from `ClientFile.jsx` (inline editing replaced it)
- **Bug fix:** `useClientFile.js` nested `cases` select still included `da_name` after the column was dropped — Supabase errored silently, `incidentData` resolved to `null`, and all incidents disappeared from the Client File view. Fixed by removing `da_name` from the select.

### Deployment
- **Production URL:** `https://general-sessions-app.vercel.app` — auto-deploys on every push to `main`
- **GitHub repo:** `ladcock345324/general-sessions-app` — Vercel is connected to this repo/branch
- **vercel.json** — SPA rewrite rule (all paths → `/index.html`) + explicit cache-control headers:
  - `index.html` → `no-cache, no-store, must-revalidate` (always fetches latest)
  - `/assets/*` → `public, max-age=31536000, immutable` (hashed filenames, safe to cache forever)
- **Supabase credentials** are hardcoded in `src/supabaseClient.js` — no env vars needed in Vercel
- ⚠️ Preview URLs (containing a hash segment like `4jtwv04l6` in the hostname) are **immutable snapshots** of a specific deployment — never use these for testing current changes; always use the production URL above
- **Ignored Build Step — main-only builds (2026-06-22):** set in the Vercel dashboard (Project Settings → Git → Ignored Build Step) to the custom command:
  ```
  bash -c '[ "$VERCEL_GIT_COMMIT_REF" = "main" ] && exit 1 || exit 0'
  ```
  Vercel's semantics: **exit 0 = skip the build; exit 1 = proceed with the build.** This command therefore builds `main` (exits 1) and skips all other branches including `backups` (exits 0). This stops the failed Vercel deployment ("red X") that the nightly backup workflow's push to `backups` was triggering (the snapshot has no buildable app, so Vercel's auto-build of that branch always failed). **This is a Vercel dashboard setting, not a repo change** — it lives in Vercel config, not in `vercel.json` or any committed file.
  > ⚠️ **Prior inverted version (stale — do not use):** an earlier version of this command was `bash -c "[ \"$VERCEL_GIT_COMMIT_REF\" = main ]"`, which had the logic backwards — the `[` test exits 0 on success (main branch), which told Vercel to *skip* the main build, and exited 1 on any other branch, which told Vercel to *build* those. The corrected command above uses explicit `&& exit 1 || exit 0` to make the intent unambiguous.

### Authentication
- Login page at `/login` — email/password via `supabase.auth.signInWithPassword()`
- All routes protected by `RequireAuth` — redirects to `/login` if no session
- "Sign out" button in top-right corner of client list
- Session persists via `onAuthStateChange`

### Client List (`/`)
- Fetches all clients from Supabase via `useClients` hook
- Two sections: **Active** (`relieved_closed = false`) and **Closed** (`relieved_closed = true`) — header text rendered as "CLOSED" via CSS `text-transform: uppercase`
- **Sort toggle** (badge above the Active header) controls the **Active** section only: "Sorting by: Name" = alphabetical by last name; "Sorting by: Next Event" = ascending by combined event date+time (no-event clients grouped at the bottom alphabetically). Mode persisted in `localStorage`. The **Closed** section ignores the toggle — always sorted by `closed_at` DESC, null-`closed_at` clients at the bottom. (See the 2026-06-21 "Client List + Next Event Batch" entry.)
- Each section header shows a count badge (e.g. "Active 12")
- Each row shows: name + OCA (no "#" prefix), next hearing (blue), case numbers + charge abbrevs, custody badge
- **Case table** in each row: flexbox column of rows (`caseNum` fixed at `56px`, charge takes remaining space), `position: absolute` right-anchored so all case number left edges are flush; `charge_abbrev` shown if set, falls back to `charge`; if `classification` is set, it follows in parens (e.g. `Sex Offender Registration Viol (A MIS)`), styled to match the next-event info line (`#6b9fd4`, normal weight, 13px desktop / 11px mobile)
- Badge colors: **In Custody** → muted crimson (`#b85555`); **Bonded Out** / **Out** → muted green (`#3d9e6a`); **CLOSED** / relieved clients → gray
- Clients in the Closed section (`relieved_closed = true`) show all custody badges in gray
- `+` button top-right → Add Client form
- **Mobile layout** (`max-width: 768px`): 3-line stacked layout — name, next event, case table + badge on same line. Desktop layout unchanged.

### Add Client (`/client/new`)
- Fields (in order): **First Name**, **Last Name**, Gender, **Booked/Initial Appearance** (date + Hour + AM/PM dropdowns + Clear button), OCA #, Custody Status (In Custody / Bonded Out / Out)
- Inserts into `clients` table, redirects to client list

### Client File (`/client/:id`)
- **Header:** full name, custody badge, Total Bond (summed from all associated cases)
- **Back button** navigates directly to `/` (not history-based)
- **Edit button** navigates to `/client/:id/edit`
- **Next Event block** (blue `#1E3A5F`): "NEXT EVENT" label + Edit button integrated into blue block
  - Docket type, reason (if set), date/time, courtroom (prefixed "Courtroom"), judge, and ADA (shown as "ADA: [name]" only when `ada_name` is set — single-client view only, never in the client list)
  - **Clear button** in the edit form — deletes the `next_events` row for this client, returns block to empty state
- **Personal Notes** section (between Next Event and Incidents): single bar that shows the note inline or a muted "Add a personal note…" placeholder; tap to edit, Save/Cancel/Delete controls; one note per client stored in `personal_notes` table
- **Incidents** section:
  - Collapsible accordion — each incident shows "Description (Date)" header row
  - Sorted most recent first; case numbers within each incident sorted ascending
  - Inline editing: tap "edit incident" → description textarea (3 rows) and date become editable; save on blur or Enter; Escape cancels
  - `+` icon button on section header bar opens inline Add Incident form
  - Each expanded incident shows case rows + "+ add a case" at bottom
  - Case rows link to `/case/:caseNumber`
- **Hours** table: date, hours (green), description, × delete button per row
  - Running total at bottom
  - `+` button opens inline form (date defaults to today, hours dropdown 0.1–0.9)
  - Saves to Supabase, sorted most recent first
- **Section headers** (Incidents, Hours, Personal Notes, Criminal History, Courtroom Documents) use inline styles (`background: #0f1820`)
- **Criminal History** section: Upload/Replace/View Criminal History PDF; drag-and-drop supported
- **Courtroom Documents** section: up to 5 documents; rename/delete per document; tappable tiles open via signed URL
- **Edit Client** button → Edit Client form
- **Close Case / Reopen Case / Delete Client** action buttons

### Edit Client (`/client/:id/edit`)
- Fields (in order): Last Name, First Name, Gender, **Booked/Initial Appearance** (date + Hour + AM/PM dropdowns + Clear button), OCA #, Custody Status — same field set as Add Client except name order is Last then First (unchanged from original; only New Client swapped to First-then-Last)
- Pre-populated from Supabase (including `booking_date`/`booking_time` parsed back into the dropdowns)
- Save uses `navigate('/client/:id', { replace: true })` — edit page is replaced in history, so Back from client file returns to client list

### Next Event Block
- Display format: `Jail Docket  |  Thursday 7/16/2026  |  9:00 AM`
- **Docket Type** — edited as a native `<select>` (blank + "Jail Docket", "Bond Docket", "Review Docket", "Settlement Docket") plus a separate optional "Add'l text" `<input>` immediately after; combined into the single `docket_type` column on save via `[preset, custom].filter(Boolean).join(' ').trim() || null`; split back on load (`splitDocketType()` peels a leading known preset into the select; any remainder or non-matching legacy value goes into the text box)
- Weekday derived from `event_date` via `new Date()` + `toLocaleDateString`
- Time is optional — omitted from display if blank
- **Subpoenas field removed** — all UI/code references removed; the `next_events.subpoenas` column has been **dropped from the DB via MCP (2026-06-24)** (no app code reads or writes it)
- **Assistant DA Name** input writes to `next_events.ada_name`; rendered as "ADA: [name]" in the single-client Next Event box only when set (not in the client list)
- **Clear button** in edit form deletes the record entirely

### Case View (`/case/:caseNumber`)
- Header shows client name (`LASTNAME, FIRSTNAME`) centered between Back and Edit buttons
- **Upload Affidavit** / **Replace Affidavit** — drag-and-drop or tap; uploads PDF to Supabase Storage; "Replace Affidavit" button resized to match "View Affidavit" and "View Text" buttons
- **View Affidavit** button when affidavit is on file
- **Notes** textarea with Save/Saved confirmation
- **Disposition**, **Edit** (inline form includes `charge_abbrev` and `classification` fields), **Delete Case**

### Incident Editing
- Date input constrained to `max-width: 160px`
- Description uses `<textarea rows={3}>` — fully visible while editing
- Edit inputs stacked vertically (`flex-direction: column`)
- Hanging indent on two-line descriptions: `padding-left: 1.62em; text-indent: -1.62em`

### Custody Status
- Three options: `in_custody`, `bonded_out`, `out`
- "Out" badge styled identically to "Bonded Out" (muted green)
- All badges muted from original bright colors

### charge_abbrev
- `cases` table has `charge_abbrev text` column (added via `ALTER TABLE cases ADD COLUMN charge_abbrev text`)
- Editable in the case edit form in CaseView
- Client list shows `charge_abbrev` if set, falls back to `charge`

### Total Bond
- Computed in ClientFile as sum of `bond_amount` across all cases associated with the client
- Labeled "Total Bond:" in the client header
- `bond_amount` field removed from Edit Client and New Client forms

### Touch / Long-Press Handling
- All tappable navigation rows (client rows, case number rows, incident case rows) use a long-press-aware `tapHandlers` helper
- Touch hold ≥ 300ms suppresses navigation and allows native browser text selection
- Desktop mouse behavior completely unchanged

---

## Routes

| Path | Component | Notes |
|---|---|---|
| `/login` | Login | Unprotected |
| `/` | ClientList | |
| `/client/new` | NewClient | Must be before `/client/:id` |
| `/client/:id/edit` | EditClient | Must be before `/client/:id` |
| `/client/:id` | ClientFile | |
| `/case/:caseNumber` | CaseView | |
| `*` | → `/` | Catch-all redirect |

---

## Color Palette

| Role | Hex |
|---|---|
| Page background | `#1E2A3A` |
| Dark section strips / header blocks | `#16212F` |
| Next event block | `#1E3A5F` |
| Inline forms | `#16212F` |
| html/body outer background | `#3B4657` |
| Root side borders | `#2C3A4F` |
| White text | `#f0f2f5` |
| Muted text | `#9faab8` |
| Dim text / empty states | `#6b7a99` |
| Blue links/buttons | `#6b9fd4` |
| Blue accent (next event label) | `#5b9fd4` |
| In Custody badge | muted crimson `#b85555` |
| Bonded Out / Out badge | muted green `#3d9e6a` |
| CLOSED / gray badge | `rgba(74,74,74,0.5)` bg / `#c0c0c0` text |
| Hours value / Saved confirmation | green `#5ecf90` |
| Section headers (client list) | background `#0f1820`, text `#c8d0db` |
| Delete buttons | muted red `#7a3a30` border / `#c97060` text |
| Close/Reopen Case button | yellow `#c8a84b` |

---

## File Structure

```
src/
  App.jsx                  # Routes + AuthProvider + SyncProvider
  main.jsx                 # BrowserRouter wrapper
  App.css                  # Global reset + body bg
  index.css                # Vite entry-point stylesheet (minimal resets)
  AuthContext.jsx          # Supabase auth session context
  RequireAuth.jsx          # Route guard — redirects to /login if no session
  supabaseClient.js        # Supabase client singleton
  SyncContext.jsx          # Provides isOnline, isSyncing, lastSyncedAt, triggerSync via React context
  localDB.js               # Dexie IndexedDB schema — mirrors 7 Supabase tables + sync_queue
  syncManager.js           # fullSync, processSyncQueue, addToSyncQueue, startBackgroundSync
  extractPdfText.js        # PDF text extraction utility — pdfjs-dist v6 + CDN worker
  seed.js                  # One-time seed script (node src/seed.js)

  hooks/
    useClients.js          # Reads all clients + next_events + cases from Dexie via useLiveQuery
    useClientFile.js       # Reads client + incidents + cases + hours + nextEvent + personalNote from Dexie; exposes refetch()

  pages/
    Login.jsx / .module.css
    ClientList.jsx / .module.css
    ClientFile.jsx / .module.css
    NewClient.jsx / .module.css
    EditClient.jsx          # Reuses NewClient.module.css
    CaseView.jsx / .module.css

  components/
    ClientRow.jsx / .module.css         # Single row in client list; mobile-responsive
    TextViewerDrawer.jsx / .module.css  # Slide-up drawer for viewing extracted PDF text; used in CaseView and ClientFile

  data/                    # (deleted — static sample files removed 2026-06-09)
```

---

## Claude Integration

### Supabase MCP
- The Supabase MCP connector is connected to Claude chat (claude.ai) — Claude can directly query all database tables and read client data by asking natural language questions (e.g. "list all in-custody clients", "show warrant text for case GS1041482")
- No additional setup needed; MCP reads from the same Supabase project (`afhzkqjrciyoeizrpaxt`)

### PDF Text Extraction
- Fully implemented and working across all three upload types: warrant PDFs, criminal history PDFs, and courtroom documents
- **New database columns:**
  - `warrant_text` (text) on `cases` table
  - `criminal_history_text` (text) on `clients` table
  - `extracted_text` (text) on `courtroom_documents` table
  - Migration SQL: `supabase_migration_pdf_text.sql` in repo root
- **New utility:** `src/extractPdfText.js` — uses pdfjs-dist v6 with a CDN-hosted worker from `unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs` to extract text from PDF ArrayBuffers. cdnjs does not yet carry pdfjs-dist v6.x.
- **Upload handlers updated:**
  - Warrant upload in `CaseView.jsx` → writes to `cases.warrant_text`
  - Criminal history upload in `ClientFile.jsx` → writes to `clients.criminal_history_text`
  - Courtroom document upload in `ClientFile.jsx` → writes to `courtroom_documents.extracted_text`
- Text extraction fires automatically on every new PDF upload as a fire-and-forget operation after the storage upload and primary URL update succeed — never blocks or errors the upload itself
- **Key bug fixed:** Supabase JS v2's `PostgrestFilterBuilder` is lazy — the HTTP request only fires when the Promise is `await`ed. All three PATCH calls were inside non-`async` `.then()` callbacks, so the query builders were constructed and garbage-collected without ever sending a request. Fix: make each `.then()` callback `async` and `await` the Supabase call.

---

## Coming Next

### Features

- **Automation layer** — recurring tasks, reminders, or hooks (e.g. auto-notify before hearing dates)

#### Offline PDF availability (deferred)

Affidavit / criminal-history / courtroom-document PDFs are not cached locally, so the scanned files aren't viewable offline — only their extracted text (`warrant_text`, etc.) is, via the text drawer reading from Dexie. A future option is to cache PDF bytes as Blobs in a new Dexie table (cache-on-upload + cache-on-view as the light version, eager full-download as the heavy version) and render via `pdfjs-dist` canvas in a drawer. Deliberately deferred — extracted text covers the practical need.

### Known Issues / Things to Revisit
- Incident date sorting uses `new Date(incident_date)` which is fragile for non-standard date strings — acceptable while dates are entered via the auto-format field
- No pagination — all clients/cases load at once; fine for current scale
- **`fullSync` uses `select('*')`**, which has a default 1,000-row ceiling in `supabase-js`. Fine at current scale (9 clients); revisit before any large growth.
- **Successful-but-empty fetch clears the table** — in `fullSync`, a clean response with `error` null and `data` `[]` still clears the corresponding Dexie table by design, to propagate cross-device deletions. Correct for current single-user use; worth knowing.
- **NULL text columns (as of 2026-06-17):** `cases`: 2 warrant PDFs on file have NULL `warrant_text` — confirmed scanned/non-OCR'd PDFs with no embedded text layer; `pdfjs-dist` cannot extract text from these regardless of re-upload. NULL is the permanent expected state for these two cases. `clients`: 1 client with NULL `criminal_history_text` but no PDF uploaded (no action needed); `courtroom_documents`: 0 documents uploaded (no action needed)
- ~~Sync status indicator hidden on iPhone PWA~~ — fixed 2026-06-17: `padding-top: env(safe-area-inset-top, 0px)` added to `.screen` in `ClientList.module.css`; falls back to `0px` on desktop/non-notch devices.
- ~~`.relievedBadge` and `.relievedLabel` CSS classes in `ClientRow.module.css` are dead~~ — removed 2026-06-17
- **Leaked Password Protection Disabled** — low-severity advisory in Supabase Auth settings; not yet addressed; can be toggled on in the Supabase dashboard under Auth → Settings whenever ready
- **FK covering indexes show as "unused index" (INFO)** — the 5 foreign-key indexes added 2026-06-24 (`idx_cases_incident_id`, `idx_courtroom_documents_client_id`, `idx_hours_client_id`, `idx_incidents_client_id`, `idx_next_events_client_id`) currently surface as "unused index" INFO items in the Supabase advisor. **Expected and benign:** the tables are small/new so the planner hasn't needed them yet. Kept deliberately for cascade-delete performance and future growth — do not drop.
- ~~**Verify next backup push: no failed Vercel deploy on `backups`**~~ — **RESOLVED 2026-06-25.** A manual workflow run (Nightly Supabase Backup #5, triggered 2026-06-25) succeeded in **48s** and force-pushed a fresh snapshot (commit `9ea139b`, "Backup snapshot 2026-06-25T05:37:46Z") to `backups`. Vercel's deploy of that push showed status **"Canceled" (not Error)** — confirming the corrected Ignored Build Step command `bash -c '[ "$VERCEL_GIT_COMMIT_REF" = "main" ] && exit 1 || exit 0'` now correctly **skips** the `backups` branch on a live push (this was the verification that had been pending). The three historical **Error** deploys (Jun 22/23/24) predate the corrected command going live and are frozen history; all future backup pushes will show **Canceled**, not Error. **Nightly cron confirmed firing reliably:** scheduled runs **#3 (2026-06-23)** and **#4 (2026-06-24)** both completed successfully, in addition to the manual #5 above.

---

## Housekeeping Session (2026-06-24)

Repo cleanup + three Supabase advisor fixes (DB changes applied via MCP in the main chat; file edits and pushes here). No user-facing behavior changed beyond the classification-tag CSS polish.

### Database (via MCP — no in-repo migration files)

1. **`next_events.subpoenas` column DROPPED.** Previously deprecated (data cleared, all app code references removed in the 2026-06-24 cleanup batch); the column itself has now been dropped. No app code read or wrote it, so nothing broke. Doc updated everywhere it was mentioned (schema table, cleanup-batch entry, Next Event Block section) from "deprecated / pending drop" to "dropped".

2. **RLS policies rewritten to fix the "Auth RLS Initialization Plan" advisor.** All 7 tables' "authenticated users only" policies were changed from `USING (auth.role() = 'authenticated')` to `USING ((select auth.role()) = 'authenticated')`. Wrapping the auth call in a subquery makes Postgres evaluate it **once per query** instead of once per row. **All 7 performance WARNs cleared** in the advisor. Security semantics unchanged — still authenticated-users-only.

3. **5 covering indexes added on foreign keys** to clear the "unindexed foreign keys" advisor: `idx_cases_incident_id`, `idx_courtroom_documents_client_id`, `idx_hours_client_id`, `idx_incidents_client_id`, `idx_next_events_client_id`. These currently surface as **"unused index" (INFO)** — expected and benign at current table sizes; kept for cascade-delete performance and future growth (see Known Issues).

### Repo cleanup (file edits in this session)

- **Deleted `src/pages/Home.jsx`** — unused legacy placeholder, confirmed zero imports/references repo-wide before removal. (PROGRESS.md previously listed it under `src/` root; it actually lived in `src/pages/`.)
- **Dead-code removal** (ESLint-driven, conservative — only genuine zero-reference items; lint dropped 26 → 18, the remaining 18 being intentional Node-globals / react-refresh / set-state-in-effect items left as working code):
  - `src/extractPdfText.js` — dropped the unused `err` binding from `catch (err)` → `catch`.
  - `src/pages/ClientFile.jsx` — removed the unused `useEffect` import; removed the entirely uncalled `formatDateInput()` helper (46 lines, zero callers); removed the unused `clientId` prop from `IncidentGroup` (both the destructure and the `clientId={id}` call site).
- Production build verified clean after removal (only the pre-existing >500 kB single-chunk size notice remains).

### CSS — `.caseClassification` tag polish (client list)

Three small follow-up tweaks to the case-classification tag (e.g. "(A MIS)") shipped earlier in the session, in `src/components/ClientRow.module.css`:
- **font-size:** desktop 13 → 9px; mobile 11 → 8 → **9px** (final).
- **margin-left** (gap from the charge text): added 6 → **5.5px** desktop; 5 → **4.5px** mobile (replaced reliance on the single `{' '}` space in JSX, which left no visible gap).
- **vertical-align: baseline** added so the tag shares the charge-abbrev (`.caseCharge`) baseline (`line-height: 1.5` on both) — fixes the tag sitting slightly low on mobile.
- Color `#6b9fd4` and weight `400` unchanged throughout.

## Maintenance Session (2026-06-17)

Documentation-only pass + dead code removal. No app behavior changed.

### Doc Fixes Applied

1. **`clients.relieved_as_counsel` schema description** — updated from "true = relieved section; false = active" to reflect that the column is now a legacy/reversibility column not read by any app logic; section placement driven by `relieved_closed`.

2. **Client List section description** — rewrote "Two sections: Active (`relieved_as_counsel = false`) and Relieved as Counsel (`true`)" to reflect the current Active/Closed model driven by `relieved_closed`.

3. **Client List badge note** — reworded "Active clients with `relieved_closed = true`…" (contradictory phrasing) to "Clients in the Closed section (`relieved_closed = true`)…".

4. **Client File action buttons** — removed "Relieve as Counsel" from the listed action buttons; current set is Close Case / Reopen Case / Delete Client.

5. **Color Palette table** — removed "Relieved as Counsel button — orange #c87060" row (button removed in the 2026-06-16 Collapse session).

6. **File Structure** — added previously missing files: `SyncContext.jsx`, `localDB.js`, `syncManager.js`, `index.css`, and `components/TextViewerDrawer.jsx / .module.css`. Updated hook descriptions to reflect Dexie reads. Added note that `Home.jsx` is an unused legacy placeholder (exists in repo, not imported anywhere).

### Dead Code Removed

- **`ClientFile.module.css` — `.relieveCaseBtn` / `.relieveCaseBtn:active`** (13 lines): CSS for the removed "Relieve as Counsel" button, never referenced in any JSX. Removed.
- **Flex-column / display:block media-query overrides**: per PROGRESS.md history, two earlier approaches to the ClientFile mobile header fix were superseded. Verified these overrides are not present in the current `ClientFile.module.css` — already clean.

### Known-Issues Findings (no changes made)

**NULL text columns (Supabase query 2026-06-17):**
- `cases` (11 total): 3 rows have NULL `warrant_text`; 2 of those have a `warrant_url` — subsequently confirmed (2026-06-17 follow-up) to be scanned/non-OCR'd PDFs with no embedded text layer; `pdfjs-dist` cannot extract text from these; NULL is permanent expected state. 1 NULL row has no PDF and requires no action.
- `clients` (5 total): 1 row has NULL `criminal_history_text` but also has no `criminal_history_url` — no PDF on file, nothing to re-upload
- `courtroom_documents` (0 total): no documents uploaded yet; no action needed

**Sync status indicator hidden on iPhone PWA:**
- Root cause identified: no `env(safe-area-inset-top)` applied on `.screen` or `.topBar`. On iPhone X+ in standalone PWA mode, the device status bar/notch covers the top ~47px of the viewport. The sign-out button and sync bar both render at approximately y=10–55px from the page top, putting the sync bar entirely behind the covered zone. The "Clients" header starts at ~55px and clears the notch — which is why everything else appears correct. The sync bar is rendered and present in the DOM; it is simply visually obscured by iOS chrome. Suggested fix (not applied): add `padding-top: env(safe-area-inset-top, 0px)` to `.screen` in `ClientList.module.css`.

### RLS / Credentials Assessment (no changes made)

**RLS disabled:** All tables have Row Level Security off. For a single-user local app behind Supabase Auth this is low-risk in practice — the only way to query data is through the Supabase client, which requires the anon key, and in this app there's one authenticated user. The real risk is: (a) if the anon key is ever shared or exposed, anyone can read/write all case data with no row-level check; (b) if Supabase ever adds a multi-user requirement, RLS policies would need to be designed from scratch rather than incrementally. Risk level: **acceptable for current single-user use, but worth enabling before any expansion or external sharing of the URL.**

**Hardcoded credentials in `src/supabaseClient.js`:** The Supabase URL and anon key are committed to the repo. The anon key is designed to be public (it is the client-facing key, not the service-role key). Supabase's security model assumes the anon key is visible to users — it is not a secret. The real guard is RLS. Since RLS is off, anyone with the anon key has full read/write access to all tables. Since this is a private GitHub repo with a single developer and the production URL requires a login, the practical exposure is low. Risk level: **low for current usage, but should be revisited together with RLS enablement if the repo ever becomes public or the app is shared with others.**

---

## Cleanup Pass (2026-06-17)

### Safe-Area Fix
- **`ClientList.module.css` — `.screen`**: added `padding-top: env(safe-area-inset-top, 0px)`. On iPhone X+ in standalone PWA mode this pushes the sign-out button and sync bar below the notch/status bar (~47px). Falls back to `0px` on desktop and non-notch devices — no visual change outside of PWA on notched iPhones.

### Dead Code Removed
- **`ClientRow.module.css` — `.relievedBadge` / `.relievedLabel`**: 13 lines removed. Confirmed zero references in `ClientRow.jsx` via search. Leftover from pre-Closed-model era.

### PROGRESS.md Updates
- NULL `warrant_text` note: updated to reflect that the 2 cases (warrants on file, NULL text) are confirmed scanned/non-OCR'd PDFs — `pdfjs-dist` has no text to extract regardless of re-upload. NULL is the permanent expected state; removed "needs re-upload" framing.
- Marked sync-bar iPhone PWA issue as resolved.
- Marked `.relievedBadge` / `.relievedLabel` dead-CSS note as resolved.

---

## RLS Security Fix (2026-06-17)

Documentation-only entry — all database changes were applied directly via Supabase MCP connector. No app code changes.

See "RLS Enabled on All Tables" under Completed Features for full details. Summary:
- `courtroom_documents` and `personal_notes` were exposed (CRITICAL per Supabase security advisor) — fixed by enabling RLS and adding "authenticated users only" policy to both tables.
- All 7 tables now have RLS enabled. Security advisor CRITICAL findings cleared.
- Migration SQL recorded in `supabase_migration_enable_rls_courtroom_personal_notes.sql`.
- "Leaked Password Protection Disabled" advisory remains (low priority, Auth setting).
