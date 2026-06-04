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
| Data | Supabase only — static sample files kept but not used in UI |

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
| `custody_status` | text | `"in_custody"` or `"bonded_out"` |
| `bond_amount` | numeric | optional |
| `da_name` | text | DA assigned to this client — shown on client file header |
| `relieved_as_counsel` | boolean | `true` = relieved section; `false` = active |
| `relieved_closed` | boolean | shows CLOSED badge when true |
| `criminal_history` | text | legacy text field (not actively used in UI) |
| `criminal_history_url` | text | Supabase Storage public URL for criminal history PDF |

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
| `warrant_url` | text | Supabase Storage signed URL for warrant PDF |
| `bond_amount` | numeric | 0 displays as "$0 bond" |
| `da_name` | text | legacy — no longer shown in UI (DA moved to client level) |
| `notes` | text | free-text, editable on case view with Save button |
| `disposition` | text | null = open; shown when set |
| `status` | text | default "open" |
| `warrant_status` | text | legacy — UI now derives status from `warrant_url` |

> Warrant status is derived purely from `warrant_url`: "Warrant on File" if set, "No Warrant" if null.
> `warrant_status` column still exists in DB but is ignored by the UI.

### `hours`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto |
| `client_id` | uuid FK → clients | |
| `entry_date` | text | e.g. "6/1/2026" |
| `hours` | numeric | selected from 0.1–0.9 dropdown |
| `description` | text | |

---

## Supabase Storage

| Bucket | Path pattern | Used for |
|---|---|---|
| `warrants` | `warrants/[case_number].pdf` | Case warrant PDFs |
| `warrants` | `criminal-history/[client_id].pdf` | Criminal history PDFs |

> Bucket is named `warrants` but serves both use cases via path prefixes.
> Files are uploaded with `upsert: true` (replace on re-upload).
> Viewed via `createSignedUrl` (1-hour TTL) opened in a new tab — not public URLs.

---

## Completed Features

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
- Each row: Last name, First name (Gender, Age) #OCA, custody badge
- **In Custody** (orange badge) / **Bonded Out** (green badge)
- Relieved rows: dimmed, "Relieved as Counsel" + "CLOSED" badge
- `+` button top-right → Add Client form
- "Sign out" small muted text in top-right corner above header
- `ClientRow` already renders a next-hearing line ("Next: day, date at time") if `nextHearing` data is present — UI stub complete, DB join to `next_events` not yet wired up in `useClients`

### Add Client (`/client/new`)
- Fields: Last Name, First Name, Gender, Age, OCA #, Custody Status, Bond Amount, DA Name
- Inserts into `clients` table, redirects to client list

### Client File (`/client/:id`)
- **Header:** full name, custody badge, bond amount, DA name on same line as bond (`Bond: $X | DA: Ms. Smith`)
- **Next Event block** (blue `#1E3A5F`): "NEXT EVENT" label + Edit button integrated into blue block
  - Docket type, reason (if set), date/time, courtroom (prefixed "Courtroom"), judge
- **Add/Edit Next Event** inline form:
  - Docket Type + Reason dropdowns side by side
  - Date field: auto-formats digits to MM/DD/YYYY with smart single/double-digit month+day detection
  - Time field: auto-formats digits to H:MM AM/PM
  - Courtroom: dropdown (3A, 3B, 3C, 4B, 4C, 4D, 5C, 5D)
  - Judge: dropdown of named judges + "Other" with custom text input
  - Subpoenas: dropdown
- **Incidents** section:
  - Collapsible accordion — each incident shows "Description (Date)" header row
  - Sorted most recent first
  - Expand/collapse state persisted in `sessionStorage` — survives navigate-away and back
  - Inline editing: tap "edit incident" → both description AND date become editable inputs in the header row; save on blur (focus leaves both) or Enter; Escape cancels
  - "+ add incident" opens inline form (description + date with auto-format)
  - Each expanded incident shows case rows + "+ add a case" at bottom
  - Case rows link to `/case/:caseNumber`
- **Hours** table: date, hours (green), description, × delete button per row
  - Running total at bottom
  - `+` button opens inline form (date defaults to today, hours dropdown 0.1–0.9)
  - Saves to Supabase, sorted most recent first
- **Section headers** (Incidents, Hours, Criminal History) use inline styles (`background: #0f1820`, matching the Active/Relieved As Counsel dark strips on the client list) — implemented as inline styles rather than CSS module classes due to a Vite CSS module build artifact issue
- **Criminal History** section: Upload/Replace/View Criminal History PDF
- **Edit Client** button → Edit Client form (same fields as Add including DA Name)
- **Close Case** button → confirms → sets `relieved_as_counsel + relieved_closed = true`
- **Reopen Case** button (shown when already relieved) → reverses both flags
- **Delete Client** button (muted red) → confirmation → deletes client + all related records

### Edit Client (`/client/:id/edit`)
- Pre-populated with live Supabase data including DA Name
- Updates record, returns to client file

### Case View (`/case/:caseNumber`)
- Header: case number, charge, warrant status (derived from `warrant_url`), bond amount
- **Upload Warrant** / **Replace Warrant** button — uploads PDF to Supabase Storage
- **View Warrant** button (shown when `warrant_url` set) — opens via signed URL in new tab
- **Notes** textarea with "Save Notes" button + "Saved" confirmation
- **Disposition** (shown when set)
- **Edit** button → inline edit form (Case Number, Charge, Bond Amount)
- **Delete Case** button (muted red) → confirmation → deletes case, cleans up orphaned incident

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
| In Custody badge | orange `#f4923a` |
| Bonded Out badge | green `#5ecf90` |
| Hours value / Saved confirmation | green `#5ecf90` |
| Section headers (client list) | background `#0f1820`, text `#c8d0db` |
| Delete buttons | muted red `#7a3a30` border / `#c97060` text |

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
  seed.js                  # One-time seed script (node src/seed.js)

  hooks/
    useClients.js          # Fetches all clients
    useClientFile.js       # Fetches client + related data; exposes refetch()

  pages/
    Login.jsx / .module.css
    ClientList.jsx / .module.css
    ClientFile.jsx / .module.css
    NewClient.jsx / .module.css
    EditClient.jsx          # Reuses NewClient.module.css
    CaseView.jsx / .module.css

  components/
    ClientRow.jsx / .module.css   # Single row in client list

  data/
    clients.js             # Static sample data (NOT used in UI)
    cases.js               # Static sample data (NOT used in UI)
    index.js               # Placeholder
```

---

## Coming Next

### Deployment
- **PWA / iPhone install** — test Add to Home Screen flow; verify service worker and manifest are serving correctly on the production Vercel URL

### Features
- **Documents At-Ready section** — per-client document uploads beyond warrants/criminal history (motions, plea agreements, discovery, etc.)
- **Automation layer** — recurring tasks, reminders, or hooks (e.g. auto-notify before hearing dates)
- **RLS policies** — enable Row Level Security on all tables once auth is stable, so data is locked to the authenticated user
- **Next hearing on client list** — `ClientRow` UI is already built (renders "Next: day, date at time"); need to update `useClients` to join `next_events` and surface `next_hearing_day`, `next_hearing_date`, `next_hearing_time` on each client row

### Known Issues / Things to Revisit
- `warrant_status` column still exists in DB but is fully ignored by the UI — could be dropped with a migration
- `da_name` column still exists on `cases` table but is no longer shown anywhere in the UI — could be dropped
- `criminal_history` (text) column on `clients` is legacy and unused — could be dropped
- Incident date sorting uses `new Date(incident_date)` which is fragile for non-standard date strings — acceptable while dates are entered via the auto-format field
- No delete for hours entries older than the current session if they lack an `id` (edge case from early prompt()-based implementation — all new entries have IDs)
- Static files `src/data/clients.js` and `src/data/cases.js` can be deleted
- `EditIncidentForm` component in `ClientFile.jsx` is defined but never rendered — can be deleted (actual editing uses inline inputs directly inside `IncidentGroup`)
- No pagination — all clients/cases load at once; fine for current scale
