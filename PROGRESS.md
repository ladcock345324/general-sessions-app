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
- **RLS:** Disabled on all tables (development mode)
- **Auth:** Email/password. One user account. RLS not yet enforced.

---

## Database Schema

### `clients`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto |
| `last_name` | text | |
| `first_name` | text | |
| `gender` | text | "M" or "F" |
| `age` | int | |
| `oca` | text | optional OCA # |
| `custody_status` | text | `"in_custody"`, `"bonded_out"`, or `"out"` |
| `da_name` | text | DA assigned to this client — shown on client file header |
| `relieved_as_counsel` | boolean | `true` = relieved section; `false` = active |
| `relieved_closed` | boolean | shows CLOSED badge when true |
| `criminal_history_url` | text | Supabase Storage public URL for criminal history PDF |
| `criminal_history_text` | text | extracted text from criminal history PDF — populated on upload |

### `next_events`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto |
| `client_id` | uuid FK → clients | |
| `docket_type` | text | "Jail Docket", "Bond Docket", "Review Docket" |
| `reason` | text | optional — "Trial", "Settlement", or blank |
| `event_date` | text | e.g. "6/7/2026" |
| `event_time` | text | e.g. "9:05 AM" |
| `courtroom` | text | e.g. "4B" — displayed as "Courtroom 4B" |
| `judge` | text | selected from dropdown or custom "Other" value |
| `subpoenas` | text | "w/ subs", "w/out subs", or blank |

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
- **Indigent status circle** — new `indigent_status text DEFAULT 'gray'` column on `clients` table; Dexie schema bumped to version 2 with `indigent_status` indexed; 14px visible dot inside a 28px transparent hit-area container (`display: inline-flex`, centered); pointer events on the outer container only — inner circle has `pointer-events: none`; cycles gray → red → green → gray on tap; offline-first writes via Dexie + `addToSyncQueue`; renders in `ClientRow` (to the right of the OCA number) and `ClientFile` header (line 1, after name/gender/age); both views stay in sync via `useLiveQuery`
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

### Authentication
- Login page at `/login` — email/password via `supabase.auth.signInWithPassword()`
- All routes protected by `RequireAuth` — redirects to `/login` if no session
- "Sign out" button in top-right corner of client list
- Session persists via `onAuthStateChange`

### Client List (`/`)
- Fetches all clients from Supabase via `useClients` hook
- Two sections: **Active** (`relieved_as_counsel = false`) and **Relieved as Counsel** (`true`)
- Both sorted alphabetically by last name
- Each section header shows a count badge (e.g. "Active 12")
- Each row shows: name, next hearing (blue), case numbers + charge abbrevs, custody badge
- **Case table** in each row: flexbox column of rows (`caseNum` fixed at `56px`, charge takes remaining space), `position: absolute` right-anchored so all case number left edges are flush; charge_abbrev shown if set, falls back to charge
- Badge colors: **In Custody** → muted crimson (`#b85555`); **Bonded Out** / **Out** → muted green (`#3d9e6a`); **CLOSED** / relieved clients → gray
- Active clients with `relieved_closed = true` show all custody badges in gray (same as CLOSED badge)
- `+` button top-right → Add Client form
- **Mobile layout** (`max-width: 768px`): 3-line stacked layout — name, next event, case table + badge on same line. Desktop layout unchanged.

### Add Client (`/client/new`)
- Fields: Last Name, First Name, Gender, Age, OCA #, Custody Status (In Custody / Bonded Out / Out), DA Name
- Inserts into `clients` table, redirects to client list

### Client File (`/client/:id`)
- **Header:** full name, custody badge, Total Bond (summed from all associated cases), DA name
- **Back button** navigates directly to `/` (not history-based)
- **Edit button** navigates to `/client/:id/edit`
- **Next Event block** (blue `#1E3A5F`): "NEXT EVENT" label + Edit button integrated into blue block
  - Docket type, reason (if set), date/time, courtroom (prefixed "Courtroom"), judge
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
- **Close Case / Relieve as Counsel / Reopen Case / Delete Client** action buttons

### Edit Client (`/client/:id/edit`)
- Pre-populated with live Supabase data
- Save uses `navigate('/client/:id', { replace: true })` — edit page is replaced in history, so Back from client file returns to client list

### Next Event Block
- Display format: `Jail Docket  |  Thursday 7/16/2026  |  9:00 AM`
- Weekday derived from `event_date` via `new Date()` + `toLocaleDateString`
- Time is optional — omitted from display if blank
- **Clear button** in edit form deletes the record entirely

### Case View (`/case/:caseNumber`)
- Header shows client name (`LASTNAME, FIRSTNAME`) centered between Back and Edit buttons
- **Upload Affidavit** / **Replace Affidavit** — drag-and-drop or tap; uploads PDF to Supabase Storage; "Replace Affidavit" button resized to match "View Affidavit" and "View Text" buttons
- **View Affidavit** button when affidavit is on file
- **Notes** textarea with Save/Saved confirmation
- **Disposition**, **Edit** (inline form includes `charge_abbrev` field), **Delete Case**

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
| Relieved as Counsel button | orange `#c87060` |

---

## File Structure

```
src/
  App.jsx                  # Routes + AuthProvider
  main.jsx                 # BrowserRouter wrapper
  App.css                  # Global reset + body bg
  AuthContext.jsx          # Supabase auth session context
  RequireAuth.jsx          # Route guard — redirects to /login if no session
  supabaseClient.js        # Supabase client singleton
  extractPdfText.js        # PDF text extraction utility — pdfjs-dist v6 + CDN worker
  seed.js                  # One-time seed script (node src/seed.js)

  hooks/
    useClients.js          # Fetches all clients + next_events + cases (with charge_abbrev)
    useClientFile.js       # Fetches client + incidents + cases + hours + nextEvent + personalNote; exposes refetch()

  pages/
    Login.jsx / .module.css
    ClientList.jsx / .module.css
    ClientFile.jsx / .module.css
    NewClient.jsx / .module.css
    EditClient.jsx          # Reuses NewClient.module.css
    CaseView.jsx / .module.css

  components/
    ClientRow.jsx / .module.css   # Single row in client list; mobile-responsive

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
- **RLS policies** — enable Row Level Security on all tables once auth is stable

### Known Issues / Things to Revisit
- Incident date sorting uses `new Date(incident_date)` which is fragile for non-standard date strings — acceptable while dates are entered via the auto-format field
- No pagination — all clients/cases load at once; fine for current scale
- All PDFs uploaded before the offline layer session have `null` text columns (`warrant_text`, `criminal_history_text`, `extracted_text`) — being resolved manually by re-uploading each PDF; not a code issue
- Sync status indicator not showing on iPhone PWA (cosmetic — indicator renders but may be hidden behind safe area or PWA chrome)
