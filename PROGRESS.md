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
| `warrant_url` | text | Supabase Storage signed URL for warrant PDF |
| `bond_amount` | numeric | 0 displays as "$0 bond" |
| `notes` | text | free-text, editable on case view with Save button |
| `disposition` | text | null = open; shown when set |
| `status` | text | default "open" |
| `warrant_text` | text | extracted text from warrant PDF — populated on upload |

> Warrant status is derived purely from `warrant_url`: "Warrant on File" if set, "No Warrant" if null.

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

### Offline Layer — Phase 2b: offline-first writes (2026-06-10)
- All INSERT/UPDATE/DELETE operations across the app now write to Dexie first, then enqueue via `addToSyncQueue` for background Supabase sync
- **`src/pages/NewClient.jsx`**: client INSERT → Dexie put + queue; `crypto.randomUUID()` generates id client-side; Supabase import removed
- **`src/pages/EditClient.jsx`**: client UPDATE → Dexie update + queue; initial load still reads from Supabase (CaseView pattern)
- **`src/pages/ClientFile.jsx`**: all write paths migrated:
  - Incidents: add (INSERT), inline edit (UPDATE), delete cascade (DELETE cases → DELETE incident)
  - Cases: add under incident (INSERT)
  - Next event: save (INSERT or UPDATE), clear (DELETE)
  - Personal notes: save add/edit (INSERT/UPDATE), delete (DELETE)
  - Hours: add (INSERT), edit (UPDATE), delete (DELETE); local `hours` state removed — component reads prop from `useClientFile` useLiveQuery directly
  - Criminal history: Storage upload stays direct; `criminal_history_url` update → Dexie + queue; extracted text → Supabase (direct) + Dexie (rule 7)
  - Courtroom documents: Storage upload stays direct; doc record INSERT → Dexie + queue; rename (UPDATE), delete (DELETE) → Dexie + queue; `useEffect fetchDocs` replaced by `useLiveQuery` for reactive doc list; extracted text → Supabase + Dexie (rule 7)
  - Relieve/Close/Reopen/Delete client → all client UPDATEs and cascading DELETEs through Dexie + queue
- **`src/pages/CaseView.jsx`**: case UPDATE (notes, edit form), DELETE (with incident orphan cleanup), warrant URL update → Dexie + queue; extracted text → Supabase + Dexie (rule 7); `handleSaved` re-fetch reads from Dexie (merges into existing state to preserve nested client name)
- `processSyncQueue` (already implemented) uses `supabase.upsert` for INSERT/UPDATE and `delete` for DELETE — no syncManager changes needed
- All `refetch()` calls retained as harmless no-ops; useLiveQuery in `useClientFile` provides automatic reactivity for Dexie-sourced writes

### Offline Layer — Phase 2a: offline-first reads (2026-06-10)
- `dexie-react-hooks` installed; `useClients` and `useClientFile` rewritten to use `useLiveQuery`
- App loads instantly from IndexedDB; UI auto-updates whenever `fullSync` refreshes local data
- Return shapes identical — no UI component changes needed

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
- **Case table** in each row: two-column grid (`56px auto`), `position: absolute` right-anchored so all case number left edges are flush; charge_abbrev shown if set, falls back to charge
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
- **Upload Warrant** / **Replace Warrant** — drag-and-drop or tap; uploads PDF to Supabase Storage
- **View Warrant** button when warrant is on file
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

### Clean text viewer UI
- In-app panel to read extracted PDF text (`warrant_text`, `criminal_history_text`, `extracted_text`) without opening the PDF
- Styled for mobile readability; available offline since text is stored locally in Dexie after sync

### Features
- **Automation layer** — recurring tasks, reminders, or hooks (e.g. auto-notify before hearing dates)
- **RLS policies** — enable Row Level Security on all tables once auth is stable

### Known Issues / Things to Revisit
- Incident date sorting uses `new Date(incident_date)` which is fragile for non-standard date strings — acceptable while dates are entered via the auto-format field
- No pagination — all clients/cases load at once; fine for current scale
- Diagnostic `console.warn`/`console.log` statements from PDF text extraction (`extractPdfText.js` and all three upload handlers) are still present — should be removed in a future cleanup pass once extraction is confirmed stable
- All PDFs uploaded before today's session have `null` text columns (`warrant_text`, `criminal_history_text`, `extracted_text`) — must be re-uploaded once to populate extracted text
