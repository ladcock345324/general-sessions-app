# General Sessions — Progress & Onboarding

## What This App Is

A mobile-first PWA for a criminal defense attorney to manage clients, cases, hearings, and hours. Built with React + Vite, backed by Supabase. Verified exclusively on the Vercel production URL (`https://general-sessions-app.vercel.app`) — not localhost.

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
- **Auth:** Email/password. One user account. **Self-signup DISABLED (2026-07-23)** — "Allow new users to sign up" is OFF in Auth → Sign In / Providers. This is a load-bearing security control, not a preference: RLS policies are role-scoped (`(select auth.role()) = 'authenticated'`), so ANY authenticated account would have full read/write on all 7 tables. With the anon key public in the client bundle, leaving signup enabled would allow anyone to self-register and read all client data. Do not re-enable. New accounts, if ever needed, are created manually via Auth → Users → Add user.

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
| `custody_status` | text | `"in_custody"`, `"no_bond_held"`, `"bonded_out"`, `"pretrialed_out"`, `"ror"`, or `"out"`. `pretrialed_out` added 2026-06-25; `ror` ("ROR'd") and `no_bond_held` ("No Bond/Held") added 2026-07-23 — all front-end only (existing text column, no schema change). `out`/`ror`/`pretrialed_out`/`bonded_out` display a muted-green badge (`#3d9e6a`); `in_custody` and `no_bond_held` are muted crimson (`#b85555`) — both are physically in custody. **Client-level** — where the client physically is, net of all cases; independent of the case-level `cases.release_status`. |
| `bond_amount` | int4 | legacy/dormant column — kept for reversibility; the field was removed from the New/Edit Client forms and bond now lives per-case on `cases.bond_amount`. The column itself still exists and was never dropped (same pattern as `age` and `relieved_as_counsel`). Not read or written by app logic. |
| `relieved_as_counsel` | boolean | legacy column — kept for reversibility; not read by app logic; section placement driven by `relieved_closed` |
| `created_at` | timestamp | row creation timestamp, default `now()`. Not read or displayed by the app. |
| `relieved_closed` | boolean | shows CLOSED badge when true |
| `closed_at` | timestamptz | set when a client is closed, null when reopened; used to sort the Closed section (most recently closed first) |
| `criminal_history_url` | text | Supabase Storage public URL for criminal history PDF |
| `criminal_history_text` | text | extracted text from criminal history PDF — populated on upload |
| `booking_date` | text | "M/D/YYYY" — date booked / initial appearance before magistrate; optional. Added 2026-06-24 via MCP. Originally added to compute the in-custody prelim-hearing cutoff; **that countdown was removed 2026-08-10 and this column was deliberately KEPT** — still written by the New/Edit Client forms, still a useful fact on its own, and retained so the countdown can be rebuilt without data loss. **Do not drop.** |
| `booking_time` | text | "h:MM AM/PM" (same format as `next_events.event_time`) — time of booking; optional, hour-only in the UI. Added 2026-06-24 via MCP. **Kept deliberately** when the prelim countdown was removed 2026-08-10, same reasoning as `booking_date`. **Do not drop.** |

### `next_events`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto |
| `client_id` | uuid FK → clients | |
| `docket_type` | text | edited as a preset `<select>` ("Jail Docket", "Bond Docket", "Review Docket", "Settlement Docket", "Criminal Court", **"PV"** — PV added 2026-08-19) + an optional append-text input; the two are combined into this single column on save (e.g. "Jail Docket Judge Smith covering") and split back on load (2026-06-24, revised from the broken datalist combobox). *(This row listed only the first four presets until 2026-08-19; "Criminal Court" had been live since 2026-07-23.)* |
| `reason` | text | optional — blank, "Review", "Trial", "Settlement", "Discussion", or "PV Hearing". Free text, no enum: the `<select>` is the only constraint, so options are added front-end with no migration. *(This row previously read "Trial, Settlement, or blank" — stale since 2026-07-23; corrected 2026-08-10.)* |
| `event_date` | text | e.g. "6/7/2026" |
| `event_time` | text | e.g. "9:05 AM" |
| `courtroom` | text | e.g. "4B" — displayed as "Courtroom 4B" |
| `judge` | text | selected from dropdown or custom "Other" value. **Free text — no enum**, so a label change in the dropdown does NOT migrate rows already saved with the old string. The dropdown entry for Judge Holt was corrected from "J. Holt" to **"A. Holt"** (first name Aaron) on 2026-08-19; the live table was checked first and held **zero** rows matching `%holt%`, so nothing needed migrating. |
| ~~`subpoenas`~~ | — | **DROPPED 2026-06-24 via MCP.** Previously deprecated (data cleared, all app code references removed); the column itself has now been dropped from `next_events`. No app code reads or writes it; kept here struck-through for history only. |
| `ada_name` | text | Assistant DA name — displayed in the single-client Next Event block only ("ADA: [name]"), never in the client list. ⚠️ **The input was REMOVED from the Next Event form 2026-08-19** and the column deliberately KEPT: the form no longer holds state for it and **omits the key entirely on save**, so existing values survive an edit instead of being nulled. **There is currently no UI to set or clear an ADA name** — re-adding one means re-adding the input. *(This row read "entered in the Next Event form" until 2026-08-20.)* |

> One row per client (maybeSingle query). Add/Edit Next Event form upserts this row.

### `incidents`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto |
| `client_id` | uuid FK → clients | |
| `incident_date` | text | e.g. "7/16/2026" — used as display label. **NULLABLE as of 2026-07-28** (migration applied outside the app); the Add Incident form and the inline edit both accept a blank date and write `null`. |
| `incident_description` | text | e.g. "Watch Theft Incident". Rendered in the **right cell** of the two-column Incidents grid (2026-08-10). **Descriptions written from affidavit text must follow the house style in "Incident Description Writing Standard"** — affiant opening clause, short sentences, 3–6 key facts, 400-character hard limit |
| `location` | text | nullable — free-text incident location (e.g. "TJ Maxx (Madison, TN) parking lot"). Added 2026-08-09 via MCP (applied outside the app). Set on the Add Incident form and editable afterwards via "edit incident". Displayed on line 1 of the incident header, after the date. Not indexed, so no Dexie version bump was needed. |
| `is_pv` | boolean | **NOT NULL, default `false`.** Added via MCP 2026-08-19 (applied outside the app); wired up the same day. Marks the incident as a **probation-violation container**: created with `incident_date`, `location` and `incident_description` all null, holding **exactly one** case which is itself `cases.is_pv = true`. Set **only** by the Add Incident form's "Probation Violation" checkbox, which writes both rows in one action. In the Incidents section a true value collapses the row's chrome — no date/location lines, no "+ add a case", no "Awaiting details" placeholder, no "edit incident" — leaving the case line as the left cell's only content and the case's **PV detail block** (or nothing) in the right. Not indexed, so **no Dexie version bump** was needed. |

> Incidents are collapsible on the client file page. Sorted most recent first.
> Header is two lines: `{incident_date} — {location}` (blue), then the description flush left beneath it.
> All three fields are inline-editable (click "edit incident").

### `cases`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto |
| `incident_id` | uuid FK → incidents | |
| `case_number` | text | e.g. "GS1041482". **NULLABLE as of 2026-07-28.** ⚠️ This column is also the URL key (`/case/:caseNumber`), so a case without one is addressed by its `id` instead — see the 2026-07-28 entry. |
| `charge` | text | **NULLABLE as of 2026-07-28** (was required). |
| `charge_abbrev` | text | optional short label shown in client list and case rows |
| `classification` | text | optional charge classification — one of "MIS", "C MIS", "B MIS", "A MIS", "E FEL", "D FEL", "C FEL", "B FEL", "A FEL", "CAPITAL" (all uppercase); null = unset. Added 2026-06-24 via MCP; generic "MIS" option added 2026-06-25 (front-end only — same existing text column). **Dropdown order reversed to most→least serious 2026-08-09** (CAPITAL first, MIS last, blank still on top) — display order only, no value strings changed. Shown in parens after the charge abbrev (client list) / charge (single view). |
| `warrant_url` | text | Supabase Storage path for affidavit PDF (e.g. `warrants/GS1041482.pdf`) — signed URL generated on demand |
| `bond_amount` | int4 | **integer**, not numeric — cents are not storable. Nullable: `null` = unset (no bond figure); an explicit `0` is a real value and displays "$0 bond". The edit form saves `null` on a blank field, never `0` (see 2026-07-23 feature entry). |
| `release_status` | text | nullable release condition for **this specific case**: `"held_without_bond"` \| `"pretrial_released"` \| `"ror"`; `null` = unset. Added 2026-07-23 via MCP (no in-repo migration). Displays "Held without bond" / "Pretrial Released" / "ROR'd". **Independent of the client-level `clients.custody_status`** — this is the condition on the case; custody_status is where the client physically is, net of all cases. |
| `notes` | text | free-text, editable on case view with Save button |
| `disposition` | text | null = open; shown when set |
| `status` | text | default "open" |
| `warrant_text` | text | extracted text from warrant PDF — populated on upload |
| `is_pv` | boolean | **NOT NULL, default `false`.** Marks the case as a **probation violation** rather than a charged offense. Schema added ahead of the front-end; wired up 2026-08-19. When true the case carries **no** `charge`, `charge_abbrev`, `classification`, `bond_amount` or `release_status` (all written as explicit nulls), and every display site renders **"[case number] - PV"** in place of the charge/classification text. ⚠️ **Written by the Add INCIDENT form only**, alongside its `incidents.is_pv` parent — the two rows are created together in one action. It was briefly written by a checkbox inside "+ add a case" earlier on 2026-08-19; **that entry point was removed the same day** and `AddCaseForm` reverted byte-for-byte to its pre-PV state. `status` is `'open'` as normal (sent explicitly on this path, see `pv_sentence`). **Not indexed in Dexie** (the `cases` store is `'id, incident_id, case_number'`), so it needed no version bump — same as `release_status` and `classification` before it. |
| `pv_sentence` | text | ⚠️ **DEPRECATED 2026-08-20 — kept, never read or written.** Replaced by the four `pv_*` columns below. Same "legacy/dormant column" pattern as `clients.age` and `clients.bond_amount`: **the column was deliberately NOT dropped** (reversibility), but no app code reads or writes it — the only remaining mentions in `src/` are comments saying so. **Do not re-wire it.** ⚠️ **Rows written before 2026-08-20 still hold data here that now displays nowhere** — see the migration note in the 2026-08-20 entry. |
| `pv_conviction_date` | text | nullable — `"M/D/YYYY"`, the date the client was convicted / pled guilty on the underlying offense. Added via MCP 2026-08-20 (applied outside the app). Edited through the standard `<input type="date">` + `toDateInput`/`fromDateInput` + `pickerHandlers()` convention, so it stores the same string format as every other date in the app. **Line 1** of the Incidents right-cell PV block (rendered through `formatDateDisplay`). |
| `pv_crime` | text | nullable — free text, what the client was convicted of (e.g. "DUI (MIS)"). Added via MCP 2026-08-20. **Line 2** of the Incidents right-cell PV block. |
| `pv_probation_length` | text | nullable — free text, the length of probation (e.g. "11 months 29 days"). Added via MCP 2026-08-20. **Line 3** of the Incidents right-cell PV block, joined to `pv_special_info` with `" · "` when both are set. |
| `pv_special_info` | text | nullable — free text, probation conditions / notes. Explicitly optional. Added via MCP 2026-08-20. Shares **line 3** with `pv_probation_length`. **This is what replaced Notes for PV cases** — `cases.notes` is not shown on a PV Case View. |

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
| `hours` | numeric | selected from 0.1–2.5 dropdown |
| `description` | text | |
| `created_at` | timestamptz | row creation timestamp |
| `sort_order` | double precision | drag-to-reorder position, lowest = top of list; added 2026-07-06 via MCP, backfilled to existing date-desc order (newest date on top, same-day rows by `created_at` ascending). See "Hours: Drag-to-Reorder..." entry below. |

> **Note:** a `checked` boolean column was added **and then dropped the same day (2026-07-23)** — the check-off feature was reworked from persisted to **session-only** (ephemeral React state, no DB column). No `checked` column exists on `hours`. See the revised check-off note in the 2026-07-23 feature entries.

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

## ✍️ Incident Description Writing Standard

**House style for every `incidents.incident_description` written from affidavit text.** This is a **standing standard, not a note about one record** — it governs all future affidavit parsing, whether done by hand, over MCP from `warrant_text`, or by any tooling built later. Established 2026-08-10.

| Rule | |
|---|---|
| **Opening** | Always begins **`The affiant believes that on [M/D/YYYY],`** — the exact string the Add Incident form's `affiantTemplate()` generates from the incident date. No leading zeros (it runs through `formatDateDisplay()`). |
| **Sentences** | Short. |
| **Content** | The **3–6 most important facts only.** Not a summary of the affidavit — a selection from it. |
| **Register** | **Clarity over elegance.** Plain statement beats good prose. |
| **Length** | **400 characters, hard limit.** |

Why it matters beyond tidiness: the description is the widest cell in the Incidents row and the only free text on the client file, so an unbounded one is what makes that row unreadable. The 400-character ceiling is what keeps the two-column layout scannable at a glance, which is the entire point of that redesign.

> **Related, and deliberately separate:** the Add Incident form's affiant auto-text (2026-08-09) writes the opening clause automatically and then gets out of the way — it never rewrites what the user has typed, and it is **add-form only**, so editing an existing incident's date never touches its description. That guard exists precisely so this standard is applied by a person reading the affidavit, not by a heuristic.

---

## ✅ Settled Decisions — do not re-open

Decisions that were raised, considered, and closed. Recorded so they are not re-litigated from either side.

### SD1. Inline "edit incident" field order stays description → location → date (2026-08-10) — **REJECTED, not deferred**

A reorder to **date → location → description** was requested and then **withdrawn after review**. The current order stands, and the divergence from the Add Incident form (which *is* Date → Location → Description) is **intentional**.

Three reasons, in order of weight:

1. **The iOS date picker opens as a bottom sheet.** It covers the lower part of the viewport regardless of where the input sits in the DOM, so it obscures whatever is *below* the date field. With the date last there is nothing below it. Putting it first puts the picker on top of Location and Description — which is precisely the bug fixed on **2026-06-10** and recorded then as the "Incident edit calendar overlap fix". This is an observed on-device fix, not a layout preference.
2. **`autoFocus` sits on the description textarea**, moved there as part of that same June 2026 fix. Reordering would leave it focusing the *last* field, or force it onto the date input — which on mobile means the form opens with the picker already covering the other two.
3. **The commit-on-blur handler could close the form before any edit is made.** `onEditContainerBlur` fires `commitEdit()` when focus leaves the container with a `relatedTarget` outside it. If opening the native picker does that, the form commits and closes. *(Unverified on-device.)* Today that costs nothing, because the user reaches the date last, after making their other edits. With the date first it would fire before they had touched anything.

> **The only acceptable version of this change would also drop `autoFocus` entirely**, so the form opens with nothing focused and neither the picker nor the keyboard covering a field. That is a behaviour change beyond field order and would need to be asked for explicitly.

---

## Completed Features

### Dead-Code Sweep — 15 Unreferenced CSS Classes Removed (2026-08-20, fifth batch, commit `f87f2f7`)

Repo hygiene only. **No schema change, no behaviour change, no JS/JSX change** — the entire diff is 121 deleted lines across five `.module.css` files. Same conservative bar as the 2026-06-24 housekeeping session: nothing removed without a zero-reference result confirmed by search.

**Lint baseline confirmed first: still 20 errors, unchanged**, and all 20 are the long-standing ones (Node globals in `scripts/` + `seed.js`, 3 × react-refresh on the context files, 3 × setState-in-effect, 1 × empty block in `extractPdfText`). **None originates from the PV / Next Event / Reason work.**

**What the linter already guarantees.** `eslint.config.js` extends `js.configs.recommended`, which enables `no-unused-vars` — so unused imports and unused in-module symbols are already impossible at a clean baseline. That narrowed the sweep to the two things ESLint cannot see: **CSS-module classes** and **cross-file exports**.

⚠️ **A first pass at the CSS detector reported 321 of 321 classes unused** — obviously wrong. The cause was backslash mangling in the shell heredoc: `\b`/`\w` reached the file as `\b`/`\w`, so the regex compiled to `[A-Za-z_$][w$]*.row` and matched nothing. **The detector now runs a self-test** (`styles.row` must match) and aborts if it fails. Worth remembering: a dead-code result of "everything is dead" is a broken tool, not a finding.

**Removed — 15 classes, 17 rule blocks** (including `:focus`/`:active`/`:focus-within` companions), each verified by raw text search across every `.js`/`.jsx` file, plus `index.html`, `App.css` and `index.css`:

| File | Classes | Why they were dead |
|---|---|---|
| `ClientRow.module.css` | `.dimmed` | — |
| `CaseView.module.css` | `.daText`, `.notFound` | `.daText` is left from the removed DA section; `.notFound` was one half of a grouped `.notFound, .placeholder` selector — **`.placeholder` is live and was kept** |
| `ClientFile.module.css` | `.sectionHeaderRowDark`, `.formHint`, `.incidentSectionAddBtn`, `.sectionHeaderRowLeft`, `.sectionHeaderRow`, `.clientListSectionHeader`, `.reopenCaseBtn` | The section headers moved to **inline styles** (`background: #0f1820`) — already documented in the UI reference. `.reopenCaseBtn` is dead because **Close/Reopen is one button whose label toggles**, styled `.closeCaseBtn` |
| `ClientList.module.css` | `.headerActions` | — |
| `NewClient.module.css` | `.twoCol`, `.prefixInput`, `.prefix`, `.inputPrefixed` | Leftovers from the `$`-prefixed **bond field removed from the New/Edit Client forms** (bond moved to `cases.bond_amount`). Checked against **both** consumers — `NewClient.jsx` and `EditClient.jsx` share this stylesheet |

⚠️ **Near-miss worth recording:** `NewClient.module.css`'s `.prefixInput` / `.prefix` / `.inputPrefixed` are dead, but `ClientFile.module.css`'s almost identically named **`.formPrefixInput` / `.formPrefix` / `.formInputPrefixed` are LIVE** (the Add Case bond field). A substring-based search would have deleted working styles. The four orphaned comments above the removed blocks went with them.

**Everything the session's churn was suspected of leaving behind came back clean:**
- **`pv_sentence`** — zero live-code references anywhere in `src/`; the only three mentions are comments marking it deprecated. Confirmed still correct.
- **AddCaseForm PV-checkbox CSS** — **not orphaned.** `.formCheckRow`, `.formCheckRowEnd`, `.formCheckbox` and `.formCheckLabel` are all still referenced, because the checkbox **moved** to `AddIncidentForm` rather than disappearing. The byte-for-byte JS revert did not strand its stylesheet.
- **`ada_name` in the Next Event form** — exactly one live reference in the whole app: the display line in `NextEventBlock`. The form holds no state for it and writes no key. Precisely the intended end state.
- **Docket `PV` / `REASON_OPTIONS`** — both fully wired. `DOCKET_PRESETS` is read by `splitDocketType()` **and** the dropdown; `REASON_OPTIONS` is read by the off-list guard **and** rendered via `reasonOptions`.

**Flagged, deliberately NOT removed:**
- **`processSyncQueue` is exported from `syncManager.js` with no importer** — but it is **called three times inside its own module** (`fullSync`, the background interval, and the `online` handler). It is live code; only the `export` keyword is redundant. Left alone: it reads as the module's public API alongside `fullSync`, and dropping the keyword buys nothing.
- **`src/seed.js` is imported by nothing** — already the documented **D1 deferral** ("repair it against the current schema, or delete it — decision pending"). Not touched, per that standing decision.

**Verification:** `npm run build` clean and `npx eslint .` at **20 errors** after each removal batch and again at the end. The detector re-run reports **306 classes, zero unreferenced**. Diff confirmed to be **pure deletions** — 17 removed blank lines, exactly one per block, no added lines beyond the surviving `.placeholder` selector.

**Confirmed on production by diffing the deployed stylesheet before and after.** The live CSS went from **263 to 248 class names (45,136 → 43,567 bytes)**, and the set difference is **exactly the 15 intended classes, with zero unexpected removals and zero additions** — a mechanical proof that nothing else in the app's styling moved.

> **A first attempt at tidying the blank lines was reverted.** A blanket "collapse doubled blank lines" pass also touched two pre-existing blank lines and the trailing newline in `ClientRow.module.css` — unrelated formatting churn in a diff that was supposed to be dead-code-only. The removals were redone with a remover that consumes each block plus exactly one trailing blank line, so nothing outside a dead rule is touched.

### Reason Dropdown Off-List Guard + `warrant_text` Triage Refresh (2026-08-20, fourth batch, commit `8ab7035`)

**One code change and one doc correction. No schema change.**

**1. The Next Event Reason `<select>` now preserves an off-list stored value**, closing a silent data-loss path that had been sitting in Known Issues since 2026-08-10.

**The bug:** `next_events.reason` is plain nullable text with no enum or check constraint, so the dropdown is the only thing constraining it — and off-list values existed in real data. When the stored value matched no option, the select rendered **blank** while `form.reason` still held the real string. Saving *without touching the dropdown* preserved it, so the value looked safe; but the form misrepresented what was stored, and **a single interaction with the select overwrote it permanently with no way back.**

**The fix** is the exact pattern `TIME_OPTIONS` has used since 2026-07-28: an unlisted stored value is kept as an extra option at the top of the list, and drops off once a listed value is picked.
- `REASON_OPTIONS` was **extracted from inline `<option>` elements into a constant**, so the guard has a list to test against. Same order, same five values, no behaviour change for listed values.
- The select's `value` is now `form.reason ?? ''`, matching how the Time select guards against an undefined value making it uncontrolled.

⚠️ **The one live row this was written about no longer exists.** The Known Issues note (and the 2026-08-10 entry) cited `"Shelter Court Review (reset from 7/31/2026 — client missed)"` as the live off-list value. **A direct query on 2026-08-20 found it gone:** all 30 `next_events` rows now hold listed values (Trial ×24, Settlement ×3, Review ×2, Discussion ×1), with **zero** null, zero empty, and zero reasons longer than 20 characters. Whether it was edited deliberately or lost to this exact bug is not determinable from the data — but the guard now prevents a recurrence, and **the fix could not be verified end-to-end against that record because there is no longer a record to open.** No test data was written to production to manufacture one.

**Verified instead by unit-testing the shipped derivation** against that exact string: 10 value shapes (the Shelter string, each preset, blank/null/undefined, other off-list text, and case- and whitespace- near-misses like `"trial"` / `"Trial "` which correctly count as off-list). Assertions cover that the stored value becomes the first option, that all five presets survive alongside it, that the select would show it selected, that picking a preset drops the extra option — plus a **regression assertion that the pre-fix option list would NOT have rendered it**, which is the bug itself. The tested derivation was diffed against the shipped source and confirmed identical apart from taking the value as a parameter.

**2. NULL `warrant_text` triage refreshed** — doc-only, no code change. The Known Issues note still reflected the 2026-07-28 count of 4. **The current count is 10**, split 6 confirmed scans / 4 presumed-by-file-size, all permanently unrecoverable without OCR. The refreshed table also records two things worth keeping: **the file-size heuristic is a hint, not a rule** (GS1121356 is ~74 KB and still a confirmed scan, exactly the profile that predicted recoverable text in July), and **why some scans extract cleanly anyway** — `extractPdfText` reads an existing text layer and never runs OCR, so a scan OCR'd upstream extracts normally while one without a layer returns NULL every time. Full table under Known Issues.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` still **20 errors**, unchanged.

### PV Round 4 — Centred Case Label + Underlined Field Labels (2026-08-20, third batch, commit `4482bcb`)

Two display-only follow-ups to Round 3. **No schema change, no data change, no new columns.** Both are scoped to `is_pv`; normal incident rows are untouched.

**1. The "[case number] - PV" label is now vertically centred in its cell.** `.incidentLeftCellPv` gains `justify-content: center`. The grid stretches both cells to the row height, and the row is sized by the **right** cell's 1–3 line PV block — so the label previously sat pinned to the top of a cell up to three lines tall while the block opposite it was already centred. Both cells centre now, so the pairing stays aligned at 1, 2 or 3 lines. The zeroed first-item top margin from Round 3 is what keeps that centring honest — without it the label would sit 9px below true centre.

**2. Three of the four PV fields are now labelled, with the label underlined and nothing else.**

| Line | Renders as |
|---|---|
| 1 | <u>Conviction Date</u>`: 5/4/2026` |
| 2 | <u>Convicted Crime</u>`: DUI (MIS)` |
| 3 | <u>Probation Length</u>`: 11 months 29 days · no alcohol` |

⚠️ **Only the label text is underlined — not the colon, not the value.** The mechanism is placement: the colon sits **outside** the `.pvLineLabel` span in the JSX rather than inside its text. `.pvLineLabel` is just `text-decoration: underline` plus a 2px underline offset to keep the rule off the descenders. **Do not fold the colon into the label string** — that is the one thing that would break this.

⚠️ **`pv_special_info` is deliberately unlabelled**, and this is the subtle case: it is a free-text remark, not a named field. On line 3 it either **trails a labelled probation length** after `" · "`, or — **when the probation length is blank — stands alone with no label at all**, because there is nothing to label it as. Both blank still drops line 3 entirely. The Round 3 drop-out rules are otherwise unchanged.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` still **20 errors**, unchanged. The line derivation was rendered through `react-dom/server` and asserted on the **actual HTML output** — 8 field combinations covering all four line counts, plus 5 structural assertions proving the colon and the value fall outside the underlined span, the label text falls inside it, and unlabelled special info emits no span at all. The tested derivation was then diffed against the shipped source and confirmed identical apart from the `const pvLines =` → `return` wrapper.

### PV Round 3 — Four Detail Fields, Matched "PV" Styling, Streamlined Case View (2026-08-20, commit `9f9f38c`)

**Schema (applied via Supabase MCP outside the app, four columns on `cases`):** `pv_conviction_date`, `pv_crime`, `pv_probation_length`, `pv_special_info` — all `text`, all nullable. **`cases.pv_sentence` is now DEPRECATED**: no longer read or written anywhere, **column deliberately kept**, same pattern as `clients.age` / `clients.bond_amount`. **No Dexie version bump** — none of the four is indexed (`cases` is `'id, incident_id, case_number'`), so they ride the existing `select('*')` fullSync and insert payloads.

> ⚠️ **Everything in this entry is gated on `is_pv`. The normal case/incident workflow is untouched** — every change is inside an `is_pv` branch, and the non-PV render paths are byte-identical to before.

**1. Layout gap above the PV case line (Incidents section).** `.incidentCaseItem` carries `margin-top: 9px` to separate the first case from the **location line above it**. A PV row has no date or location, so that margin became unexplained empty space at the top of the left cell. New `.incidentLeftCellPv` zeroes it — scoped to the first item, and applied only when `is_pv`, so normal rows keep their spacing exactly.

**2. "PV" now renders in the case number's exact type**, everywhere the pairing appears. It previously used the muted charge styling (8.8px/500/`#4a5a70` in the lists, 11px/400/`#6b7a99` in Incidents), which read as a faint annotation hanging off the number rather than part of the label.
- **Incidents section:** the "- PV" text is now **bare, unwrapped** inside the case-number span instead of wrapped in `.incidentCaseAbbrev`. Inheriting the parent's family, size, weight, colour and tracking means there is no second declaration that can drift out of sync.
- **Client list + header case mini-list:** new `.casePv` class mirroring `.caseNum`'s type (10px/700/`#6b9fd4`, 11px on mobile — re-declared in the ≤768px block alongside `.caseNum`). It stays a **sibling** span rather than moving inside `.caseNum`, because that span is the tap target and is width-locked to the 56px number column. `.caseNum`'s layout properties are deliberately **not** copied.

**3. Incidents right cell — 4-field / 3-line PV block**, replacing the single "Sentence: […]" line. Each line renders only when it has content, so the block is **0, 1, 2 or 3 lines** and never leaves an empty row:

| Line | Content |
|---|---|
| 1 | `pv_conviction_date` (through `formatDateDisplay`) |
| 2 | `pv_crime` |
| 3 | `pv_probation_length` **·** `pv_special_info` — joined with `" · "` when both are set, whichever is set alone when only one is, **line dropped entirely** when neither is |

The `" · "` separator is the one `bondReleaseText()` already uses for bond + release status. New `.incidentDescCellPv` centres the block vertically (`justify-content: center`) so it stays centred at any line count, with `gap` tightened to 2px — these are three lines of one record, not three separate entries. Unit-tested across 12 shapes covering all four line counts.

**4. PV creation form** (`AddIncidentForm`, PV checkbox checked): **Case Number, Conviction Date, Crime, Probation Length, Special Info**, replacing "Case Number + Sentence". Conviction Date uses the app's standard date-input convention. **All fields optional** — no validation, consistent with the rest of the app; blanks save as `null`, never `''`. `pv_sentence` is no longer written.

**5. Case View streamlined for PV cases only.** Removed, all gated on `is_pv`: the **Upload/Replace/View Affidavit row**, the **affidavit + bond meta line**, the **Notes section** (`pv_special_info` covers it), and the **top-right Edit button** with the case-number/charge/classification/bond/status form it opens. In their place the four PV fields render **always editable — no edit mode, no Save button, no extra click**.
- New `PvField` component. **Commits on blur and on Enter; Escape restores the last saved value** — the same convention the inline "edit incident" fields use. Each field writes only its own column via one Dexie update + one sync-queue UPDATE. Blank → `null`.
- **The date variant commits on `change`, not blur** — picking a date is a discrete action, not typing, and a native mobile date picker does not reliably produce a blur to hang the save on. It deliberately does **not** also commit on blur, which would enqueue a duplicate UPDATE per pick.
- Draft state is re-seeded from the stored value using React's **"adjust state while rendering"** pattern, not a `useEffect`. A `setState` in an effect body causes a cascading second render and **the repo's lint rule rejects it** (it is the one pre-existing error on the Notes effect). Typing changes only the draft, never the stored value, so the re-seed cannot clobber an edit in progress.
- **Deliberately kept:** the "PV" page label, client-name header, Back, Delete Case, and **Disposition** (still useful for recording how a violation resolved — not removed, as instructed).

**~~⚠️ Pre-existing data — `GS955160P1` (Richard Bravo).~~ — RESOLVED by the user 2026-08-20.** *(Retained as the build record.)* At the time of this entry its PV information lived entirely in the deprecated `pv_sentence` (`"DUI (MIS) - Guilty 5/4/2026"`) with all four new columns `null`, so the text displayed nowhere once `pv_sentence` stopped being read. **Left untouched and flagged rather than migrated**, per the standing rule that data changes are the user's call. **The user has since re-entered it through the always-editable Case View fields.** Live state as of 2026-08-20: `pv_conviction_date` = `5/4/2026`, `pv_crime` = `DUI (MIS)`, `pv_sentence` now `null`, probation length and special info unset — so the incident row renders a **two-line** PV block. No orphaned `pv_sentence` data remains anywhere in the table.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` back to **20 errors** — a 21st was introduced by the first draft of the re-seed effect and fixed, not accepted. `grep` confirms `pv_sentence` survives in `src/` only inside three comments marking it deprecated. PV line derivation unit-tested (12 cases, all four line counts).

### PV Creation Moved to the Add Incident Form + "Courtroom wait time" Pinned Top (2026-08-19, second batch, commit `be13a22`)

> ⚠️ **PARTLY SUPERSEDED the next day by "PV Round 3" above — read that entry for current behaviour.** What still stands here: **where** PV creation lives (the Add Incident form), the **two-row creation and its FK ordering**, and the **collapsed incident chrome** (no date/location, no "+ add a case", no "Awaiting details", no "edit incident"). What changed on 2026-08-20: the PV form's fields are now **Case Number + Conviction Date, Crime, Probation Length, Special Info** (not "Case Number + Sentence"), the right cell renders the **4-field / 3-line labelled block** (not `Sentence: [text]`), and **`pv_sentence` is deprecated and no longer written**. Retained unrewritten as the build record.

Two follow-ups to the batch below, same day. **One schema change, applied via Supabase MCP outside the app: `incidents.is_pv` (boolean, NOT NULL, default false).** `cases.is_pv` and `cases.pv_sentence` are **reused, not replaced** — nothing was dropped *(true as written; `pv_sentence` was deprecated the following day — still not dropped)*. **No Dexie version bump:** `incidents` is `'id, client_id'` and `cases` is `'id, incident_id, case_number'`, so neither `is_pv` is indexed; both flow through the existing `select('*')` fullSync and insert payloads untouched.

**1. "Courtroom wait time" pinned to the top of `DESCRIPTION_OPTIONS`**, ahead of every other option — it is the one picked most often. Still deliberately outside the alphabetical run, and still carries **no** entry in `DEFAULT_HOURS_BY_DESCRIPTION`, so picking it leaves the Hours field alone.

**2. PV creation moved out of `AddCaseForm` and into `AddIncidentForm`.**

**Why:** creating a PV from inside an existing incident left an awkward record behind it — a blank-dated, unlocated incident showing the "Awaiting details" placeholder, wrapped around an otherwise-clean PV case. A PV is not an incident that later grows cases; it is one incident and one case that exist together.

- **`AddCaseForm` reverted byte-for-byte to its pre-PV state** (spliced from commit `328ec40` and diff-verified, not hand-edited). The checkbox, the collapsed-field logic and the branched save payload are all gone; it no longer references `is_pv` or `pv_sentence` at all. PV entries can no longer be created from inside an existing incident.
- **`AddIncidentForm` gained the "Probation Violation" checkbox**, positioned **top-right above the fields** — it decides which form you are filling in, so it has to be read before anything below it. Unchecked, the form behaves exactly as before. Checked, Date/Location/Description are replaced by **Case Number** and **Sentence (if known)**. Hidden fields keep their React state, so unchecking restores anything already typed; only the save branch decides what is written.
- **Both rows are created in one action**, modeled directly on `AffidavitFirstUpload`'s two-row creation and inheriting its ordering rule: **the incident is enqueued BEFORE the case**, so the FIFO sync queue can never push a `cases` row whose `incident_id` FK has not landed on the server yet. Both go Dexie → `addToSyncQueue`; never a direct Supabase write. The incident is written with `incident_date`/`location`/`incident_description` null and `is_pv: true`; the case with `case_number`, `is_pv: true`, `pv_sentence` (or null), the five charge/bond columns as explicit nulls, and `status: 'open'`.
- ⚠️ **`status` is sent explicitly on this path**, unlike the normal case insert which lets Postgres default it — so the local Dexie row is correct immediately rather than only after the next fullSync.
- **`is_pv` is deliberately NOT sent on the normal incident path.** The column is NOT NULL DEFAULT false, and leaving it off keeps all three incident-creation paths consistent with how they behaved before PV existed.

**Incidents-section display when `incidents.is_pv` is true** — the only rendering this task touched:

| | Normal incident | PV incident |
|---|---|---|
| Left cell | date line, location line, cases, "+ add a case" | **the one case line only** ("[case number] - PV") |
| Right cell | description, or "Awaiting details" when undescribed; "edit incident" | `Sentence: [text]` when set, **otherwise genuinely empty** — no placeholder |
| "+ add a case" | shown | **hidden** — a PV incident holds exactly one case |
| "edit incident" | shown | **hidden** (judgment call, see below) |
| × delete | shown | shown, unchanged |

> **"edit incident" is hidden on PV rows — a judgment call, not a spec item.** That button edits precisely the three fields (date, location, description) the PV design hides and never renders. Leaving it would let the user type a description that then displays nowhere. Deleting and re-creating is the intended path for a mistyped PV. Re-adding the button means deciding where its text would show.

**Everything else PV was left exactly as-is** — the client list case row, header case mini-list and CaseView all already rendered correctly from the first batch and were not touched.

**~~Pre-existing data:~~ — RESOLVED; that row no longer exists.** *(Retained as the build record.)* At the time of this entry one `cases.is_pv = true` row survived from the removed flow (**Richard Bravo, `GS955160`**, no sentence, on incident `4035446a…` whose date/location/description were already all null and whose `is_pv` was `false`). **Left alone pending the user's decision** — flagged, not migrated or deleted. **The user resolved it by deleting and re-creating through the new flow:** as of 2026-08-20 the only PV case in the table is `GS955160P1`, on a proper `is_pv = true` incident. The old `GS955160` row is gone.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` still **20 errors**, unchanged. `AddCaseForm` confirmed byte-identical to `328ec40` by diff, and confirmed to contain none of `is_pv` / `pv_sentence` / `Probation Violation` / `formCheckbox`. `DESCRIPTION_OPTIONS` re-checked after the move: still 25 entries, "Courtroom wait time" at index 0, all 11 `DEFAULT_HOURS_BY_DESCRIPTION` keys still matching byte-for-byte and all 11 values still valid `HOURS_OPTIONS` entries.

### Eight-Change Batch — PV Cases, Overdue Indicator, Form Reorders (2026-08-19, commit `4496af6`)

Eight requested changes in one session. **No schema change was made in this session** — `cases.is_pv` and `cases.pv_sentence` already existed (added ahead of the front-end) and were built against as-is. **No Dexie version bump:** the `cases` store is `'id, incident_id, case_number'`, so neither new column is indexed; both flow through the existing `select('*')` fullSync and the case insert payload untouched, the same pattern as `release_status` and `classification`. Verified against `localDB.js` rather than assumed.

**1. Judge "J. Holt" → "A. Holt"** (first name Aaron). Label string only, same position in `JUDGES`, no other entry touched. `next_events.judge` is free text, so a dropdown rename does **not** migrate saved rows — **the live table was queried first and held zero rows matching `%holt%`**, so no historical data needed fixing and none was touched. (Same check-before-swap sequence used for the "Probation" → "PV Hearing" correction on 2026-08-10.)

**2. Red-when-overdue next-event line — client list only.** See the Next Event Block section above for the full rules. Summary: `ClientRow.jsx`'s one-line next-event span turns muted crimson (`#b85555`) once `event_date` + `event_time` is more than **3 hours** past. **Scoped to `ClientRow.jsx` alone** — ClientFile's blue block, CaseView and everything else are untouched. **Both fields required**: a blank date or time skips the check entirely rather than assuming midnight. **No stored flag** — derived at render, so it clears itself the instant the next event is updated. It does not re-evaluate on a timer; a row flips on its next render. `isOverdue()` was unit-tested across 20 cases including the exact worked example from the request (10:00 AM event, 1:01 PM the same day → red), the 12:59/1:00/1:01 boundary, noon and midnight-hour AM/PM parsing, midnight-crossing, and every blank/null/garbage combination.

**3. "PV" added to the docket type presets.** Appended last. Added to **both** `DOCKET_PRESETS` (the dropdown) **and** — critically — the same list `splitDocketType()` reads, so a saved "PV [+ append]" round-trips back into the `<select>` instead of falling through to the free-text box. This is the exact failure mode called out when "Criminal Court" was added on 2026-07-23. Round-trip verified for `"PV"`, `"PV covering for Smith"`, and the non-match `"PVsomething"` (correctly falls to free text).

**4. Probation-violation case creation.** ⚠️ **SUPERSEDED the same day — see "PV Creation Moved to the Add Incident Form" above.** The creation entry point described in this paragraph (a checkbox inside "+ add a case") no longer exists; `AddCaseForm` was reverted byte-for-byte to its pre-PV state. **The display half of this item still stands** — the four "[case number] - PV" sites and the CaseView `pv_sentence` section were kept and are unchanged. Retained as the build record. `AddCaseForm` gained a **"Probation Violation"** checkbox at the top. Checked, the form collapses to **case number + "Sentence (if known)"**; charge, abbrev, classification, bond amount and release status are hidden and written as **explicit nulls** (not omitted — the record shape stays identical either way, so a PV can never inherit a stale value). `status` is still left off the payload in both branches and defaults to "open" in Postgres, unchanged. Hidden fields keep their React state, so unchecking restores anything already typed — only the save branch decides what is written. Unchecked, the form behaves exactly as before and `is_pv` saves `false`.

Display — **"[case number] - PV"** replaces the charge/classification text at all four sites: the client-list case row, the ClientFile header case mini-list, the incidents left-cell case line, and the CaseView header. **Case-number tap-to-navigate is unchanged everywhere** — on the incidents line the "- PV" sits inside the same nested span the abbrev used, so it shares the enlarged tap target. CaseView drops the `[case number] - ` prefix only (see Case View section for why). `pv_sentence` is editable on CaseView in its own section above Notes.

**The first checkbox in the app.** There was no `type="checkbox"` anywhere in `src/` before this, so rather than invent a control vocabulary the new `.formCheckRow` / `.formCheckbox` / `.formCheckLabel` classes reuse the existing one: `.formCheckLabel` is `.formLabel`'s exact type treatment, and `accent-color` tints the native box to the form's blue. The whole row is a `<label>`, so the text is a tap target too.

**5. "Courtroom wait time"** added to the shared `DESCRIPTION_OPTIONS`, initially positioned **between "Initial client meeting" and "Met with ADA"**. *(**Moved again the same day to the very TOP of the list**, ahead of every other option — see the entry above. The rest of this item stands.)* This **intentionally breaks the otherwise-alphabetical run, by request**. Commented in place so it does not get "fixed" later. It deliberately carries **no** default hours (see #7).

**6. Next Event form reorder + ADA input removed.** New order: Date + Time · Judge · Courtroom · Docket Type + Reason · Add'l Text. See the Next Event Block section. Two things deliberately **not** changed: the display order anywhere in the app, and `next_events.ada_name` itself — the input is gone, but the column, its stored values, and the "ADA: [name]" display line are all intact, and `save()` omits the key entirely so editing an event can never null it out.

**7. Default hours by description.** New shared `DEFAULT_HOURS_BY_DESCRIPTION` map applied in **both** hours forms via a shared `applyDescriptionPick()`. Full list in the Hours UI section. The field stays manually overridable, and anything not in the map — including "Courtroom wait time" and hand-typed text — gets no forced default. All 11 keys were verified to match `DESCRIPTION_OPTIONS` byte for byte and all 11 values to exist in `HOURS_OPTIONS`; a typo in either would silently do nothing.

**8. Hours form field order** changed to date → description → hours in both forms.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` still **20 errors**, unchanged from baseline. `isOverdue()` and `splitDocketType()` unit-tested (26 assertions, all passing), with the tested `isOverdue` body diffed against the shipped source to confirm the test exercises the real logic rather than a drifted copy.

### Next Event Reason — "PV Hearing" Added (2026-08-10)

One option appended to the Next Event form's **Reason** `<select>`, at the bottom after "Discussion". **Front-end only — no schema change and none needed:** `next_events.reason` is a plain nullable text column with no enum or check constraint, so the dropdown is the only thing that constrains it. The control, its styling, and the save path are untouched; the value flows through the existing `...rest` payload to Dexie and the sync queue like every other Reason value, and displays as-is in both views.

Options are now: blank, **Review, Trial, Settlement, Discussion, PV Hearing**.

> **Shipped first as "Probation", corrected to "PV Hearing" the same day.** The live DB was checked before the swap: **zero `next_events` rows held "Probation"**, so nothing needed migrating and no data was touched. The wrong label was only in the dropdown, never in a saved record.

> **The request described the existing options as "Trial, Settlement, or blank".** That came from this document, not the code — the `next_events.reason` schema row still carried its original 2026-06 description and had been stale since 2026-07-23, when the list became Review/Trial/Settlement/Discussion. **The schema row is now corrected**, and the new option was appended at the bottom (matching how "Criminal Court" and courtrooms 6A–6D were added) rather than inserted third.

**Live `reason` values as of 2026-08-10** (19 rows): Trial ×13, Discussion ×2, Review ×1, Settlement ×1, `''` ×1, and one free-text entry — `"Shelter Court Review (reset from 7/31/2026 — client missed)"`. That last one was the evidence behind the Known Issues note: off-list values exist in real data. *(⚠️ **Both facts have since changed.** The off-list guard was added 2026-08-20, and a query that day found **the free-text row gone** — 30 rows, all listed values, none blank. See the 2026-08-20 entry.)*

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` still **20 errors**, unchanged.

### Custody Badge Top-Aligned + Prelim-Hearing Countdown REMOVED (2026-08-10, commit `9c03ca1`)

**No schema change — no column was dropped.** `CaseView.jsx` untouched, client-list custody badge untouched, Incidents section untouched at both breakpoints, no collapse/expand.

#### 1. Single-client header custody badge moved to the top of the row

**Horizontal position is unchanged** — still `grid-column: 3`, still `align-items: flex-end`, so the badge stays flush right exactly where it was. Only the vertical changed: `align-items: center` on the row is now overridden by `align-self: start` on `.badgeStack`, at **both** breakpoints.

**The target was the top of the visible name text, not the top of the grid area**, and those differ for two stacked reasons:

1. the name shares a flex row with the **28px** indigent circle, whose `align-items: center` centres the name's ~20px line box inside it;
2. inside that line box sits the font's own leading above the cap height (ascent − cap height).

`margin-top: 9px` is the sum of the two. **It lands within a pixel at both breakpoints** — the mobile name is smaller (15px vs 17px) but sits in the same 28px circle row, so the larger centring offset almost exactly cancels the smaller leading. **That 9px is the knob:** raise it to push the badge down, lower it to pull it up.

> ⚠️ **The single value works by coincidence, not by design — it depends on those two offsets cancelling.** The cancellation rests on exactly two numbers: the **mobile name font-size (15px)** and the **28px indigent-circle container** that both breakpoints share. **Change either one and 9px stops being correct at one breakpoint**, and the fix is to split it into two values — a base `margin-top` plus a `@media (max-width: 768px)` override — rather than hunting for a new single number that happens to fit both. Worth knowing before touching `.name`'s mobile size or the circle's dimensions.

- **Mobile specifically:** the badge spans grid rows 1–2 there, and the row's `align-items: center` was centring it against *name block + mini-list*, which is what put it low on multi-case clients. `align-self: start` fixes exactly that.
- **`.nameRowLeft` also gained `align-self: start`.** In the usual case it is the tallest item and already filled the row, so this is a no-op. It matters only on desktop for a client whose **case mini-list is taller than the name block** (roughly 5+ cases): without it the name would drift down while the badge stayed pinned to the top, and the two would no longer share a top edge — defeating the whole point.

#### 2. In-custody preliminary-hearing countdown — REMOVED

**Deliberately removed 2026-08-10.** The 14-day countdown, its date math, the weekend rollover, its render site, and all CSS that became dead with it are gone. Swept repo-wide rather than removing only the obvious render site:

| Removed | |
|---|---|
| `src/prelimDeadline.js` | **File deleted.** `computePrelimCutoff`, `shortWeekday`, `formatMD`, `formatBookingTimeCompact` existed only to serve this feature and had no other callers |
| `ClientRow.jsx` | Import, `showPrelim`, `cutoffDate`, and the two-line render block |
| `ClientRow.module.css` | `.prelimBlock`, `.prelimRow1`, `.prelimRow2`, and the `≤768px` `.prelimRow1, .prelimRow2` font-size override |
| `ClientList.jsx` | `bookingDate` / `bookingTime` no longer threaded through `toRowProps` (nothing consumed them once the block was gone) |

> **`clients.booking_date` and `clients.booking_time` were deliberately RETAINED** — the columns, their "BOOKED/INITIAL APPEARANCE" fields in the New and Edit Client forms (date + hour + AM/PM + Clear), and their offline-first save path are all untouched and still work. Booking date and time are useful facts in their own right, and keeping them means **the countdown can be rebuilt later with no data loss and no backfill**. Do not drop these columns.

> **The Rule 5 research in this document is KEPT ON PURPOSE.** The 14-day figure, the 2018 amendment that raised it from 10 days (and the warning not to "correct" it back), the misdemeanor-coverage caveat, the booking-date-as-proxy assumption, the Rule 45 holiday simplification, and the note on why a misdemeanor *trial* countdown can't be built on this model — all of it stays under Known Issues as reference for a future rebuild. **It was not deleted just because the feature was.**

**One knock-on effect, expected and not a regression:** in the client list, an in-custody client with a booking date previously had its custody badge pushed down by the two prelim lines sitting above it in `.badgeArea`. With those lines gone the badge is centred like every other client's. `.badgeArea` itself and every badge rule were left untouched — this is the absence of the block above it, not a change to the badge.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` still **20 errors**, unchanged. ⚠️ **Not yet verified on production.**

### Mobile Incident Separators Reworked + "+ add a case" Unbolded (2026-08-10, commit `d677276`)

**No DB or schema change. `CaseView.jsx`, the header mini-list and its brackets, and the desktop grid — proportions, 2px row divider and 1px column split — are all untouched.** One file: `ClientFile.module.css`.

1. **"+ add a case" is normal weight** (`600` → `400`) at **both** breakpoints. Size, colour and family unchanged. It's a secondary action and the bold read as a heading.

2. **The rule between an incident's two stacked mobile blocks is gone.** `.incidentLeftCell`'s `border-bottom` (the 1px stand-in for the desktop column split) is removed. Those blocks are the same incident's own case info and its own description — splitting them made one incident read as two things.

   > **Halving the number of rules mattered more than the weight of any one of them.** Before this, the mobile list alternated strong rule / weak rule / strong rule / weak rule, so the eye had no reliable signal telling it which lines were structural — the boundaries weren't only faint, they were *ambiguous*. Removing the internal rule means **every horizontal line left on the screen is a real incident boundary**. That is the larger half of the fix; the thickness, colour and padding changes in #3 are the smaller half, applied to a signal that is now unambiguous. **If the separators ever need re-tuning, do not reintroduce a rule inside an incident to "balance" them** — that is the thing that broke scannability in the first place.

3. **The incident boundary rule strengthened on three axes at once**, because no single one does the job without overshooting:

   | Axis | Before | After | Why |
   |---|---|---|---|
   | Thickness | 2px | **3px** | Present without being a slab |
   | Colour | `#2C3A4F` | **`#4a5a70`** | **The biggest win.** Against the `#16212F` row the old colour sits at roughly **1.5:1** contrast — which is why it vanished at a glance; the new one is roughly **2.4:1**. Already in the palette (the "edit incident" control) |
   | Breathing room | — | **14px** above an incident's first line, **16px** below its last | Each incident occupies its own padded band. The whitespace is what keeps the rule from having to shout |

   The delete-confirmation wrapper (`.incidentGroup`) matches, so the boundary doesn't visibly weaken while a confirm is open.

   > **Knobs, in the order worth turning if this reads wrong: the colour, then the padding, then the thickness.** All three live in the `@media (max-width: 768px)` block.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` still **20 errors**, unchanged. ⚠️ **Not yet verified on production.**

### Charge Abbrev on the Incidents Case Line + Wider First Column (2026-08-10, commit `976dbaa`)

**No DB or schema change; `CaseView.jsx`, the header mini-list and its brackets, and the `@media (max-width: 768px)` block are all untouched; no collapse/expand.** Two files: `ClientFile.jsx` + `.module.css`.

#### 1. `charge_abbrev` after the case number

Renders immediately after the case number, one space between, e.g. `GS1121243 THEFT`. **`charge_abbrev` only — never the full `charge`.**

- **Styling matches the bond line beneath it** (11px, `#6b7a99`, inherited family) while the number keeps its own blue link styling.
- **It sits INSIDE the case-number `<span>`**, which is what makes it part of the same click target and the same enlarged hit area — clicking either half navigates to that case.
- **The nested class resets `font-weight`, `letter-spacing` and `font-style`.** Those resets are load-bearing, not tidiness: without them the abbrev inherits the number's `700` weight and `0.02em` tracking, and on an unnumbered case it would also inherit the `.caseNumberPending` italic.
- **`charge_abbrev` is frequently null** — every affidavit-first case starts without one. **The separating space lives inside the conditional**, so a null abbrev renders the case number alone with **no trailing space and no placeholder text**.

#### 2. First column widened (desktop only)

| | Before | After |
|---|---|---|
| `grid-template-columns` | `minmax(180px, 1fr) minmax(0, 5fr)` | **`minmax(246px, 2fr) minmax(0, 7fr)`** |
| Split | 16.7% / 83.3% | **22.2% / 77.8%** |
| At 1126px | ~188px / ~938px | **~250px / ~876px** |

**The +62px is roughly one rendered case number** — "GS1121243" is ~66px at 12px/700 with 0.02em tracking — which is the room the abbreviation needed.

**The floor moved with it, 180px → 246px**, so it still can't squeeze the cell under its own content: `GS1121243 THEFT` is ~109px at these sizes, plus the number span's 14px hit-area padding and 32px of cell padding, ≈155px. **The floor only starts binding below about a 1107px viewport**, so the fr ratio is what governs at the app's normal desktop width — the same relationship the previous pair had.

> **Mobile cannot be reached by this change**: the ≤768px block already overrides `grid-template-columns` to a single column, so the base rule has no effect there. No mobile rule was edited.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` still **20 errors**, unchanged. ⚠️ **Not yet verified on production.**

### Same-Incident Bracket Retargeted to the Header Mini-List + Restyled (2026-08-10, commit `bb1ef7b`)

Corrects the target of the bracket shipped in `8d51a54` and restyles it. **No DB or schema change; `CaseView.jsx` untouched; no collapse/expand.** New file `src/caseGrouping.js`; changes to `ClientFile.jsx` + `.module.css` and `ClientRow.jsx` + `.module.css`.

#### 1. Removed from the Incidents first column

The bracket added there in `8d51a54` is gone. Those case numbers are **already grouped by incident by construction** — each incident's cell contains only its own cases — so the bracket added nothing. `.incidentCaseGroup` and its wrapper div are removed; **everything else in that column is unchanged**.

#### 2. Added to the header case mini-list

The correct second target: the flat case list in the single-client header row, alongside the name, OCA and gender. It uses the **identical rules and the identical guard** as the client list — 2+ cases, bracketed only when all of an incident's cases occupy consecutive positions, no bracket for a split group, **no change to sort order**.

**The guard now lives in [`src/caseGrouping.js`](src/caseGrouping.js) and is imported by both views** instead of being duplicated. This app duplicates most small helpers by convention, but this one is deliberately shared: it is what stands between a correct bracket and one that silently misstates which cases share an incident, and two copies would be free to drift apart.

**Solving the `overflow: hidden` clip — without removing it.** That declaration is load-bearing (it is what stops a long charge forcing the grid wider and shoving the custody badge around), so it stays. The fix rests on a CSS detail: **`overflow` clips at the *padding* box, not the content box**, so anything drawn inside `padding-left` survives the clip.

```css
.headerCaseList { padding-left: 9px; margin-left: -9px; }   /* bracket lives in the 9px */
.headerCaseGroup::before { left: -8px; width: 6px; }        /* 1px inside the clip edge */
```

**The equal and opposite `-9px` margin makes the change invisible at both breakpoints**, which is why **no rule inside the `@media (max-width: 768px)` block was needed for alignment**:

- **Desktop (`justify-self: center`)** — the margin box is content-width again (`-9 + 9 + content`), so it centres exactly where it did and the content starts at the same x.
- **Mobile (`justify-self: start`)** — the margin box's start edge sits at the column start, so `content_left = column_start + (−9) + 9 = column_start`. The 2026-08-09 flush-left alignment under "Total Bond" is preserved **to the pixel**.

In both cases the bracket hangs 8px left of the case numbers — into the grid column gap on desktop, into `.nameRow`'s own 16px padding on mobile. Neither clips.

> ⚠️ **One mobile-block edit WAS required, for a different reason.** The tightening rule `.headerCaseList > div { padding: 0 }` became **`.headerCaseList div`** (child combinator → descendant). A bracketed group wraps its rows in an extra div, so those rows are no longer direct children of `.headerCaseList`; under the old selector they would have kept the borrowed `.caseTableRow` 1px padding and rendered **taller than unbracketed rows** on mobile. Matching the wrapper as well is harmless — it has no padding of its own. **That is the only change inside the ≤768px block**; the sibling `.headerCaseList span { line-height: 1.35 }` rule is a descendant selector already and needed nothing.

#### 3. Bracket colour

Both brackets recoloured from muted `#4a5a70` to **`#6b9fd4`** — the colour of the case numbers they capture. Both views resolve to the same value: the client list uses `.caseNum` (`#6b9fd4`) and the header mini-list *borrows that same class*, so one colour covers both correctly. **Line width unchanged at 1px.**

#### 4. Arm length

Top and bottom arms extended **4px → 6px**, reaching further right toward the numbers. **That is the maximum available with the spine left where it is:** the spine sits 8px left of the text, so 6px arms stop **2px short** of the case numbers — decisively enclosing, with a clear gap and no overlap. The spine did not move and **no case number moved**.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` still **20 errors**, unchanged. ⚠️ **Not yet verified on production.**

### Affidavit Text Harmonized, Release Status Restored, Same-Incident Bracket (2026-08-10, commit `8d51a54`)

Seven changes. **No DB or schema change; the `@media (max-width: 768px)` block was not touched; no collapse/expand reintroduced.** Files: `CaseView.jsx` + `.module.css` (item 1 only), `ClientFile.jsx` + `.module.css`, `ClientRow.jsx` + `.module.css`.

#### 1. CaseView affidavit text harmonized — the one sanctioned CaseView edit

The meta line now renders a green **"Affidavit"** when one is on file and **nothing at all** when there isn't, matching the incidents case line. **`"Affidavit on File"` and `"No Affidavit"` are now gone from the app entirely**, closing the conflict recorded as Open Item 0 the same day.

- **The separator is conditional on both sides** (`hasAffidavit && bondText`), not just on the bond. Since the affidavit segment can now be absent, a separator conditioned only on the bond would leave the line opening with a stray `|`.
- **Segment order was deliberately NOT changed** — affidavit first, bond second, exactly as before. Reordering would have been a second change to a file cleared for one.
- New `.affidavitTag` in `CaseView.module.css` (`#5ecf90`, weight 400). Nothing else in CaseView was touched.

#### 2. `release_status` restored to the incidents case line

Reverses the loss recorded in the previous entry. New `bondReleaseText()` in `ClientFile.jsx` composes bond and release exactly the way the old `bondStatusText()` did (`·` between them), and the affidavit is appended with ` | `:

| bond | release | affidavit | Renders |
|---|---|---|---|
| `0` | held | yes | `$0 Bond · Held without bond \| Affidavit` |
| `0` | held | no | `$0 Bond · Held without bond` |
| `1500` | — | yes | `$1,500 Bond \| Affidavit` |
| — | ror | yes | `ROR'd \| Affidavit` |
| — | — | no | *nothing — no line at all* |

> **The third row is the normal case, not an edge case.** `release_status` is unset on most cases because the client-level `custody_status` already carries that information. Segments are joined only when present, so there is no dangling `·`, no trailing space and no empty segment — verified across all five shapes above. `RELEASE_LABELS` came back with it.

The line **wraps** in the narrow column rather than truncating, and the column width was not changed.

#### 3–6. Case line and description

3. **"Affidavit" dropped to normal weight** (`font-weight: 400`) in both views. Colour `#5ecf90` and size unchanged.
4. **The whole bond/affidavit line navigates to the same case as the number above it**, via the same `tapHandlers` (so drag and long-press still suppress it). **Styling is deliberately unchanged** — only `cursor: pointer` signals it; the text is not restyled to look like a link. The case number's own enlarged hit area overlaps the top of this line, which is harmless since both go to the same case.
5. **"edit incident" now flows inline** after the last word of the description instead of starting its own line. **Its `font-size` had to become an absolute `11px`:** it was `0.7em`, which resolved against the 16px cell to ~11.2px, but nesting it inside the 13px description would have shrunk it to 9.1px. Colour, weight and family are unchanged.
6. **Description `line-height: 1.4`** (was inheriting, and reading as roughly double-spaced).

#### 7. Same-incident bracket

A light `[` — left, top and bottom borders with **no right border**, which is the bracket shape — in muted `#4a5a70`, for groups of **2+** cases from one incident. A lone case gets none. **Drawn in existing empty gutter space** (`left: -8px` / `-9px`) in both views, so **not one case number moves** and the client-list case table's carefully preserved geometry is untouched. **No sort order was changed anywhere.**

- **Single-client view — the Incidents left column.** Every case in an incident's cell belongs to that incident by construction, so the bracket is unconditional on `cases.length > 1`. The group wrapper carries the first item's 9px top margin itself (`.incidentCaseGroup { margin-top: 9px }` + `:first-child { margin-top: 0 }`) because a flex item establishes its own formatting context and would otherwise trap that margin inside, starting the bracket 9px above the first case number.
- **Client list — bracketed conditionally, after verifying contiguity.** ⚠️ **The finding: same-incident cases are NOT guaranteed to be adjacent there.** `toRowProps` in [`ClientList.jsx`](src/pages/ClientList.jsx:75) flattens every incident's cases and sorts purely on the numeric part of the case number — **incident is not part of the sort at all**. Interleaving is structurally possible: incident A holding GS1000 and GS3000 with incident B holding GS2000 sorts to A, B, A.
  - `bracketBlocks()` in [`ClientRow.jsx`](src/components/ClientRow.jsx) therefore draws a bracket **only when every case of an incident occupies consecutive positions**. A split group gets **no bracket at all** rather than one that would appear to capture the neighbouring incident's case.
  - In practice court-assigned numbers are usually sequential per incident, so groups will normally bracket; the guard is there for when they aren't.

> **The header case mini-list was deliberately left unbracketed.** It is also flat, but `.headerCaseList` has `overflow: hidden`, which would clip a bracket drawn in the gutter; the alternative — padding the list to make interior room — would shift it right and break the flush-left mobile alignment that this pass was told not to touch. The user's own framing ("in the client list view, the case list is flat rather than grouped by incident") also points at the Incidents column as the single-client target.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` still **20 errors**, unchanged — the one error reported in `CaseView.jsx` is the pre-existing `react-hooks/set-state-in-effect`, which moved from line 146 to 148 as the comment above it grew. ⚠️ **Not yet verified on production.**

### Incidents First Column Refinements (2026-08-10, commit `cc66ba3`)

Seven scoped changes to the **left cell** of the two-column Incidents grid, plus the affidavit-upload target picker. **No DB or schema change; `CaseView.jsx` untouched; no collapse/expand reintroduced.**

> **Scope note.** These were specified as desktop refinements, but every rule changed is a **base rule**, so they reach mobile as well. **No rule inside the `@media (max-width: 768px)` block was edited** — the phone pass is still outstanding and separate.

1. **Date and location sit close together.** `line-height: 1.25` on both and the location's `margin-top` removed, so they read as one two-line block rather than two separate entries.
2. **Both recoloured to `#c8d0dc`** — the description's text colour. **Font sizes deliberately unchanged** (13px date / 12px location). The blue `#6b9fd4` accent the date inherited from the old combined "date — location" line is gone from this column.
3. **Charge and charge abbreviation: already absent, no change needed.** The 2026-08-09→10 redesign never rendered either in this cell (see "What is no longer shown" in the entry below). Verified by search: `charge` appears in `ClientFile.jsx` only in the Add Case *form*, in the affidavit-first record where it is written `null`, and in the **header case mini-list**, which is a different block at the top of the page.
4. **Case number and the line beneath it tightened** — `line-height: 1.25` on the number, `1.3` and a 1px top margin on the meta line.
5. **Bond and affidavit collapsed onto one line** beneath the case number, with new wording:

   | Bond | Affidavit | Renders |
   |---|---|---|
   | set | on file | `$1,500 Bond \| Affidavit` |
   | set | none | `$1,000 Bond` |
   | none | on file | `Affidavit` |
   | none | none | *nothing — the line is not rendered at all* |

   Each half drops out independently, so the `|` separator can never be stranded and no empty row is left behind. **A `0` bond is still a real value** (`bond_amount != null`, not truthiness) and renders `$0 Bond`.
   - **"Affidavit" renders in `#5ecf90`** (`.affidavitTag`) — the light green the app already uses for hours values and the Saved confirmation, so **no new colour entered the palette**.
   - **`"Affidavit on File"` and `"No Affidavit"` are gone from this column.** ⚠️ **They still exist at [`CaseView.jsx:258`](src/pages/CaseView.jsx:258)**, which this pass was explicitly forbidden to touch — see Open Items.
6. **Case-number hit area enlarged without changing its visual size.** `padding: 7px 14px 7px 0` grows the click box 7px up, 7px down and 14px right; `margin: -7px 0` cancels the extra height so the text sits exactly where it did and the meta line stays tight beneath it.
   - **No negative left margin, deliberately** — it would outdent the number from the date and location above it.
   - **The upward growth lands inside the 9px `margin-top` gap above the line, so it never overlaps the location text.** Downward it covers the top few pixels of the bond line, which is harmless (that click should navigate anyway).
   - `.incidentCaseItem` also gained `line-height: 1.25` so the parent's strut can't reintroduce the height the negative margins remove — an inline-block's line box is sized against the parent strut as well as its own margin box.
7. **Affidavit-upload target picker relabelled**, in strict priority: **location → incident date → `[blank incident]`**. Description is no longer used as a fallback tier.
   - **Repeated labels get a 1-based counter** (`[blank incident] (1)`, `(2)`, …). A client can legitimately have several location-less, date-less incidents, and identical option text would make them impossible to tell apart. A label occurring **once** is left exactly as-is, and the disambiguation applies to *any* repeat (two incidents at the same location, too), not just blank ones.
   - Options remain **keyed and valued by `id`**, so every incident is selectable whichever tier its label falls to.

**Dead code removed:** `RELEASE_LABELS` and `bondStatusText()` in `ClientFile.jsx` had no remaining caller once the bond line was rewritten. `CaseView.jsx` keeps **its own copies** — the two were already byte-duplicates, not a shared import, which is why deleting ClientFile's pair changes nothing there.

> ⚠️ **Consequence worth knowing: `cases.release_status` is no longer displayed anywhere in `ClientFile`.** The old `bondStatusText()` appended "Held without bond" / "Pretrial Released" / "ROR'd" to the bond text; the new line is bond + affidavit only, per spec. Release status is now visible **only in CaseView**. Restoring it is a one-line change to the bond line if wanted.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` still **20 errors**, unchanged — none in either edited file. ⚠️ **Not yet verified on production.**

### Incidents Two-Column Layout — Accordion Removed (2026-08-10, commit `9e5b33c`)

**Replaces the click-to-expand behavior entirely.** The Incidents section is now a two-column grid, **one grid row per incident**, with every incident's cases always visible. There is no open/collapsed state anywhere in the section — `IncidentGroup`'s `open` state, its toggle, and the `.incidentBody` wrapper are all gone.

**No DB or schema change; `CaseView.jsx` untouched; the affidavit-first upload flow from earlier the same day untouched.** Two files changed: [`ClientFile.jsx`](src/pages/ClientFile.jsx) and [`ClientFile.module.css`](src/pages/ClientFile.module.css).

#### Proportions

`grid-template-columns: minmax(180px, 1fr) minmax(0, 5fr)` — the left cell is **one sixth** of the section. At the app's 1126px desktop width that lands at roughly **188px / 938px (16.7% / 83.3%)**. The **180px floor** exists so the cell can't be squeezed below its own content: "Affidavit on File" is ~92px at 12px plus 32px of cell padding. The floor only starts binding below about a 1080px viewport, so it never affects the normal desktop width. **These two numbers — the `5fr` ratio and the `180px` floor — are the knobs if the split reads wrong on-device.**

#### Cell contents

- **Left cell:** incident date (blue `#6b9fd4`, the accent the old combined "date — location" line used), incident location (dropped to muted `#9faab8` now that it's on its own line), then **each case** as three stacked lines — case number, bond/release text via the shared `bondStatusText()`, and affidavit status — followed by that incident's own **"+ add a case"**.
  - **Stacked rather than inline, deliberately:** ~156px of usable cell width can't hold `$2,500 bond | Affidavit on File` on one line without truncating one of them.
  - **The case number is the only tap target**, matching the client list's deliberately tightened hit area (2026-06-10), and still routes through `case_number || id` so a numberless case stays reachable via CaseView's primary-key fallback.
- **Right cell:** the description, with the delete `×` pinned to its top-right corner (`position: absolute` inside a `position: relative` cell, replacing its old role as a flex sibling of the header row) and **"edit incident" beneath it**.
  - **The edit affordance is now permanent.** It used to render only when the accordion was open (`open && !editing`); with no expanded state there is nothing left to reveal it, so it is always visible.

#### Inline editing spans the full row

`.incidentEditCell` is `grid-column: 1 / -1`. **The three fields belong to different cells**, so editing one while another still showed its old value would read as two competing sources of truth. The commit-on-blur / Enter / Escape logic, the unchanged-check, and the Dexie + sync-queue UPDATE are all carried over untouched — including **the date input staying LAST**, for the 2026-06-10 reason (the native mobile date picker must not cover the fields above it). The add-case form is full-width for the same structural reason: its own two-column bond/status row has no room in a one-sixth-width cell.

#### Gridlines

The old dividers (`1px solid rgba(255, 255, 255, 0.05)`) did not read as a grid. Now:

| Line | Weight | Colour |
|---|---|---|
| Row divider (between incidents) | **2px** | `#2C3A4F` |
| Column split (left/right cells) | **1px** | `#2C3A4F` |

`#2C3A4F` is the palette's existing "Root side borders" colour, so nothing new was introduced. The **weight difference is the hierarchy**: the row boundary stays dominant and the column split reads as secondary.

#### Mobile (≤768px)

Stacks to a single column — left-cell block on top, description beneath — via `grid-template-columns: 1fr`. The column split becomes a horizontal `1px` rule between the two stacked blocks (`border-right` → `border-bottom` on `.incidentLeftCell`), while the **2px row divider does the work of separating one incident from the next**, which matters more once everything is in one column.

#### What is no longer shown

**The charge is no longer displayed in the Incidents section** — the spec assigns the left cell to number/bond/affidavit and the right cell to the description, with no slot for it. Not an information loss in practice: the header case mini-list already lists `case number | full charge (CLASSIFICATION)` for every case on the same page, and CaseView shows it in full.

**Dead CSS removed with the accordion:** `.incidentHeader` (+`:active`), `.incidentHeaderLeft`, `.incidentTitleBlock`, `.incidentMetaLine`, `.incidentDescPart`, `.incidentBody`, `.addCaseInlineBtn` (+`:active`), `.caseRow` (+`:last-child`), `.caseInfo`, `.caseNumber`, `.caseCharge`, `.caseMeta`, `.caseChevron`. `.incidentGroup` survives as the delete-confirmation wrapper (it needs the row divider but not the grid). `.caseNumberPending` survives as a **compound** selector, `.incidentCaseNum.caseNumberPending`, so the pending marker beats the case-number link colour regardless of source order.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` still **20 errors**, unchanged — none in either edited file. ⚠️ **Not yet verified on production.**

### Affidavit-First Incident/Case Creation (2026-08-10, commit `179a8a9`)

**Inverts the Incidents flow.** Previously an incident had to exist before a case, and a case before an affidavit. The affidavit is the source document, so it now comes first: uploading a PDF **creates** the incident and its case, with every descriptive field left `null` to be populated separately by reading the extracted `warrant_text` over MCP.

**No DB or schema change, and none was needed** — `incidents.incident_date`, `incidents.location`, `incidents.incident_description` and `cases.case_number` were all already nullable (2026-07-28 and 2026-08-09). **No Dexie version bump**: nothing new is stored, and the one indexed column involved (`cases.case_number`) is written `null`, which IndexedDB simply omits from the index rather than rejecting — the numberless case is addressed by `id`, exactly as the 2026-07-28 entry already established. **`CaseView.jsx` was not touched at all**; its per-case "Replace Affidavit" flow is byte-for-byte unchanged.

Two files changed: [`ClientFile.jsx`](src/pages/ClientFile.jsx) and [`ClientFile.module.css`](src/pages/ClientFile.module.css).

#### The flow

A **"upload affidavit"** text control sits beside the Incidents section's `+` button — the same two-control header pattern the Hours section already uses ("clear checks" + `+`), so `+` stays the primary affordance rather than competing with a second square icon. It is a `<label>` wrapping a hidden `<input type="file" accept="application/pdf">`, the convention all three existing upload paths use.

Picking a file opens a **modal dialog that always asks which incident the affidavit belongs to** — "New incident" (the default, re-selected on every pick) or any existing incident of this client. **Nothing is ever inferred from the file.** Existing incidents are labeled `date — location` through the same filter-then-join convention the incident header uses, falling back to the description (truncated at 60 chars), then to the same `Awaiting details` marker — so an incident created by a *previous* affidavit upload is still selectable and reads consistently.

> **The dialog is a centered modal rather than an inline panel for a structural reason:** the trigger lives inside the section-header flex row, so a panel rendered from the same component would become a child of that row. `z-index: 200` matches the app's other overlays (TextViewerDrawer / DailyHoursDrawer) and clears the sticky name bar at `z-index: 10`.

#### Write order, and why it is in that order

1. **Storage upload first, bailing on failure before any row is written.** A failed upload must not leave a blank incident and an affidavit-less case behind — precisely the confusing state this flow exists to prevent. Same `warrants` bucket and `warrants/` prefix as `CaseView`, reused rather than reinvented.
   - **The path is `warrants/{case id}.pdf`.** That is the *identical* fallback `CaseView`'s own upload applies to a numberless case (`case_number || id`), so a later "Replace Affidavit" from the case view overwrites this same object instead of orphaning it.
2. **Incident row** (only when "New incident"): `incident_date`, `location`, `incident_description` all `null`. Dexie → `addToSyncQueue`.
3. **Case row**: `case_number`, `charge`, `charge_abbrev`, `classification`, `bond_amount`, `release_status` all `null`; `warrant_url` set to the uploaded path. Dexie → `addToSyncQueue`.
   - **The incident is enqueued BEFORE the case, deliberately.** `processSyncQueue` drains oldest-first, so this is what stops a `cases` row being pushed to Supabase ahead of the `incidents` row its `incident_id` FK points at. (`created_at` is millisecond-precision, so a same-millisecond tie is broken by the stable sort falling back to the `++id` retrieval order — the same guarantee the existing multi-row delete path already relies on.)
4. **Text extraction — the 2026-07-28 rule verbatim.** `extractPdfText` → **Dexie then `addToSyncQueue`, never a direct Supabase call**, `await`ed before the handler returns, and a `null` result **skips** the write rather than overwriting. The case row is written at step 3 *before* extraction runs, so the case survives even when nothing extracts (a scanned affidavit, or the unpkg worker unreachable) — the same ordering the courtroom-documents path uses.

> **This path requires network, by design.** The Storage upload is direct (as all three existing upload paths are), so an offline attempt fails at step 1 and creates nothing at all — no half-made incident. Only the *record* writes are offline-first.

#### Blank-record markers

Both are new, and both exist because an affidavit-first record is legitimately empty until it's described:

- **An incident with date, location and description all `null`** renders an explicit italic muted **"Awaiting details"** (`.incidentAwaiting`) instead of the bare `—` it previously showed.
- **A case with no `case_number`** renders an italic muted **"Case # pending"** (`.caseNumberPending`) in the incident's case rows. Previously the number `<span>` was conditional, so a numberless case rendered **nothing at all** there — no identifying line on the row.

> The `—` fallbacks in the **header mini-list** and in **CaseView**'s case-number label were deliberately left alone: neither is blank today, and the mini-list's case-number column is too narrow for a phrase.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` still **20 errors**, unchanged — no new lint errors, and neither edited file appears in the output.

> ✅ **CONFIRMED WORKING END TO END ON PRODUCTION (2026-08-10).** A real affidavit uploaded through this flow created the incident and its case and landed **4,444 characters of `warrant_text` in Supabase**, on a case whose `case_number` is `null`. That single result exercises the entire chain: the always-ask dialog, the storage upload, the incident and case INSERTs, the FK-safe enqueue order, and — the part this whole path exists for — the awaited extraction reaching the server through Dexie and the sync queue rather than a direct write. The null `case_number` also confirms the id-based storage path and the id-based addressing hold in practice, not just in principle.

### Mobile Layout Fix — Single-Client Header Case Mini-List (2026-08-09, commit `25fb88a`)

**The last change of the 2026-08-09 session, and the current shipped state of the header mini-list on phones.** Everything below is inside the existing `@media (max-width: 768px)` block in `ClientFile.module.css`. **No desktop rule was touched, no other file changed, no DB or schema change.** Desktop keeps the centered 3-column grid described in the entry immediately below — this splits the two breakpoints apart rather than replacing that work.

**Why the centered grid doesn't survive a phone.** It reserves a middle track for the mini-list, which is fine at the app's 1126px desktop width but expensive at ~343px of usable width on a 375–390px phone: the mini-list, the name/OCA block and the custody badge all compete for the same row, and the name column is what loses. Showing the **full `charge`** rather than `charge_abbrev` (changed in the entry below) made that materially worse, since a full charge string is several times wider than its abbreviation.

**On mobile the row drops to two columns** (`minmax(0, 1fr) auto`) and the mini-list moves into the **left text stack** — `grid-column: 1; grid-row: 2`, `justify-self: start` — so it renders in ordinary left-aligned block flow as the last item under "Total Bond", sharing the same left edge as the name / OCA / bond lines above it. No centering, no horizontal offset.

- **The custody badge is deliberately unchanged.** It stays right-aligned in its own column, and is given `grid-row: 1 / span 2` so the row's `align-items: center` keeps it centered against the **full** row height exactly as before — adding a second row beneath the name block must not shift it. `span 2` is used rather than `1 / -1`, which would resolve against the explicit grid's single row line and silently span only row 1.
- **`row-gap: 0`** — the base `gap: 12px` sets both axes, and a 12px row gap would have dropped the mini-list well below the bond line. Column gap stays 12px. A 3px `margin-top` on the wrapper matches the bond line's own `padding: 3px 0 0` rhythm.
- **Case lines tightened** from ~18.5px to ~14.9px each: row padding `1px 0` → `0`, `line-height` `1.5` → `1.35` (at the 11px mobile case-number size). A deliberately small reduction — enough that a multi-case client doesn't eat the screen, not enough to look cramped.
- **The tightening is targeted structurally** (`.headerCaseList > div`, `.headerCaseList span`) rather than by class name, because those classes live in `ClientRow.module.css` and are hashed separately by CSS Modules — `ClientFile.module.css` cannot reference them by name. Scoping everything under `.headerCaseList` is what keeps the **client list** rows untouched at both breakpoints. The descendant selectors also out-specify the borrowed single-class rules (0,1,1 vs 0,1,0), so this works regardless of bundle order.

> ⚠️ **NOT verified on a real device.** `npm run build` clean and `npx eslint .` still 20 errors, unchanged — but the intended on-device check (production, narrow mobile width, a multi-case client such as Causey or Wilborn) **was not completed**, so the visual result is reasoned rather than observed. See Open Items.

### Follow-Up Corrections to the 2026-08-09 Batch (2026-08-09)

Three corrections to the entry immediately below, after seeing it on production. **No DB or schema changes; no Dexie version bump.** The two items not listed here (Personal Notes default-expanded, reversed classification dropdown) were confirmed working and are untouched.

#### 1. Incident header restructured to two lines; Location made editable

**The bug:** Location was rendering at the bottom of the incident card, *below the entire description*, so it read as a card footer rather than as part of the header. Root cause was placement, not styling — line 1 was a flex row holding date **and** description inline, so anything stacked beneath that row necessarily landed under the description too.

**New layout**, both lines inside the existing `.incidentTitleBlock` column:

- **Line 1 — `{incident_date} — {location}`**, in the app's blue accent `#6b9fd4` (the same blue as the case numbers). Built with the **filter-then-join** convention the Next Event line already uses (`[date, loc].filter(Boolean).join(' — ')`), so the em dash exists only when both sides do and a blank location leaves the date alone with no trailing separator. Size and weight are the old `.incidentDatePart` values, unchanged — **only the color is new**. The lone-dash fallback still fires, now only when date, location *and* description are all blank, so the header can never collapse to an untappable empty strip.
- **Line 2 — the description**, now its own block directly beneath, flush left at the same starting x-position as line 1. Font size, weight and color are unchanged; only its position moved. **The hanging indent came off** (`padding-left: 1.62em` / `text-indent: -1.62em`, in place since 2026-06-10): it existed solely because the description used to run inline after the date and needed its wrapped lines to clear it. On a standalone block it would produce exactly the left offset relative to line 1 that this layout removes.
- `.incidentLocationLine` and `.incidentNameRow` are gone, replaced by `.incidentMetaLine`.

**Location is now editable.** It is a third field in the inline "edit incident" flow, seeded from `incident.location` in `startEdit()`, included in the unchanged-check, and written through the **same Dexie + sync-queue UPDATE** as the description and date (a blank saves `null` via the same `.trim() || null` pattern). This closes the gap from the original entry, where location could only be set at creation.

> **The date input deliberately stays LAST in the edit form.** It was moved below the description on 2026-06-10 so the native mobile date picker can't cover the fields above it; Location was inserted *between* description and date, never before it. Do not reorder these to match the Add form.

#### 2. Case number size dialled back

`.caseNumberLabel` **19px → 16px** (+45% over the original 11px, rather than +75%). 19px was too large on the real page. The comment on the rule now flags it as the single value to tweak.

#### 3. Case mini-list truly centered, and shows the full charge

> ⚠️ **Everything in this sub-section is DESKTOP-ONLY as of later the same day.** The centered grid was too expensive at phone widths and mobile now uses a left-aligned layout instead — see the "Mobile Layout Fix" entry above for the shipped mobile behavior. The desktop description below is still current and unchanged.

**The problem:** nesting the mini-list inside `.nameRowLeft` pinned it to the bottom-left corner of the header row, tucked under the name/OCA block, rather than reading as its own centered element.

**`.nameRow` is now a 3-column grid** (`1fr minmax(0, 50%) 1fr`) instead of a flex row: name/OCA/Total Bond, case mini-list, custody badge. **The centering is structural, not approximate** — both side tracks are `1fr`, so they stay equal to each other and the middle column sits on the row's true midpoint, independent of how wide the name block or the badge happen to be. `align-items: center` (already present) handles the vertical axis, and because every item is still in normal flow the row grows to fit any number of cases.

Three details that make it hold up:

- **`.badgeStack` is pinned to `grid-column: 3`.** The mini-list wrapper renders even when the client has no cases, but relying on auto-placement alone would let the badge drift into column 2 if that ever changed. Its existing `align-items: flex-end` keeps the badge flush right, exactly where it was.
- **`.nameRowLeft` has `min-width: 0` and `.badgeStack` deliberately does not.** Column 1 can therefore shrink and column 3 cannot fall below the badge's own width — so on a very narrow viewport with a very wide badge the layout gives up a few pixels of centering instead of overlapping the badge. That trade is intentional and in that direction on purpose.
- **The middle track is capped at 50%** so a long charge can't squeeze the name column to nothing, and `.headerCaseList` keeps `overflow: hidden` plus a scoped `span { min-width: 0 }` — without the latter, a flex item's automatic minimum size holds the charge at full text width and the `overflow: hidden` never gets a chance to clip. ~~That 50% is the knob if the middle column ever needs to be narrower on mobile.~~ — **the 50% cap was never the right answer on mobile; the middle track itself is gone there.** It remains the desktop knob only.

**The mini-list now shows the full `charge`, not `charge_abbrev`.** Scoped to the single-client view only — `ClientRow.jsx` and `ClientRow.module.css` were not touched at all in this follow-up, so the client list still uses `charge_abbrev` and its desktop layout is exactly as shipped in the entry below.

**Verification:** `npm run build` clean. `npx eslint .` still **20 errors**, unchanged.

### Incident Location + Affiant Auto-Text, Header Case List, Desktop Row Overflow Fix (2026-08-09)

Six scoped changes. **One DB change, applied via Supabase MCP outside the app and already in place before this work started:** `incidents.location` (text, nullable). Everything else is front-end. **No Dexie version bump** — see the note under #1.

#### 1. Add Incident form — reorder, Location field, affiant auto-text

- **Field order is now Date → Location → Description** (was Description → Date). The date moving to the top is what makes the auto-text below feel natural rather than retroactive.
- **New "Location" field** — a plain free-text input (placeholder "Optional") writing `incidents.location`. Offline-first like every other field: `db.incidents.put(record)` then `addToSyncQueue('incidents', 'INSERT', …)`, with `location` in **both** payloads via the same `.trim() || null` pattern the other two fields use.
- **No Dexie schema change was needed and none was made.** `localDB.js` declares `incidents: 'id, client_id'` — that string lists *indexed* keys only, and Dexie stores the whole object regardless, so a non-indexed field passes through untouched. `fullSync`'s `select('*')` carries it back down. This is the same reasoning that let `cases.release_status` skip a bump on 2026-07-23.
- ~~**Location is set at creation time only.**~~ — **RESOLVED same day (2026-08-09), see the follow-up entry above.** Location is now a third field in the inline "edit incident" flow, saved through the same Dexie + sync-queue UPDATE as the description and date.
- **Description auto-text.** Picking a date fills Description with ``The affiant believes that on {M/D/YYYY},`` built by a new pure `affiantTemplate(mdy)` helper (it runs the date through the shared `formatDateDisplay()`, so no leading zeros).
  - **The guard against clobbering typing is an exact string comparison, not a heuristic.** The fill only happens when Description is empty **or** still exactly equals `affiantTemplate(previousDate)` — i.e. the user hasn't typed past the inserted prefix. Because the template is a pure function of the date, "is this still untouched auto-text?" is decidable with `===`; the moment the user adds a single character the equality fails and every later date change leaves their text alone, permanently.
  - Both the date and the description are updated inside **one** `setForm` updater, so the comparison always reads the pre-change date rather than racing a second state update.
  - **Clearing the date back out** blanks a Description that was purely template, and leaves anything else alone — symmetric with the fill, and it can only ever discard text the app itself wrote.
  - **Add-form only.** Editing an existing incident's date does not trigger it, per the spec.
- ~~**Display:** Location renders on its own line directly under the incident header row, in muted `#9faab8` at 12px.~~ — **SUPERSEDED same day (2026-08-09).** That placement put Location visually *below the whole description*, which read as a footer on the incident card rather than as part of its header. Replaced by the two-line layout in the follow-up entry above. The `.incidentTitleBlock` column wrapper introduced here survives; `.incidentLocationLine` and `.incidentNameRow` did not.

#### 2. Personal Notes default to expanded when populated

`PersonalNotesSection`'s `open` state initializes to `!!initialNote?.note?.trim()` instead of `false` — a client with a note gets it visible on load, an empty/absent note keeps the collapsed default. **Initial state only; the click-to-toggle behavior is untouched.** Safe as a lazy `useState` initializer because `ClientFile` holds this render behind its own `loading` guard, so `initialNote` is already resolved when the component first mounts.

#### 3. Classification dropdown reversed to most→least serious

`CLASSIFICATIONS` is now `['', 'CAPITAL', 'A FEL', 'B FEL', 'C FEL', 'D FEL', 'E FEL', 'A MIS', 'B MIS', 'C MIS', 'MIS']` in **both** `CaseView.jsx` and `ClientFile.jsx` (each file still holds its own copy — no shared constant exists; they are byte-identical and a comment in each now says so). Blank stays first: it is the unset placeholder, not a severity level. **Pure reorder** — no value strings changed, no schema change, no migration, and every stored `classification` still matches an option because the set is identical.

#### 4. Case number font size +75% on Case View

`CaseView.module.css` `.caseNumberLabel`: **11px → 19px** (11 × 1.75 = 19.25, rounded to a whole pixel). **Dialled back to 16px the same day — see the follow-up entry above; 19px read as too large on the real page.** **Checked at both breakpoints and there is no wrapping or overflow risk:** this class has no breakpoint override anywhere in the file (the only media query is the ≤480px `.formTwoCol` stack), and the element is a full-width block *below* the header row rather than a flex sibling of the Back/Edit buttons, so it cannot squeeze them. A 9-character case number at 19px with `letter-spacing: 0.06em` is ~115px, comfortably inside the narrowest realistic viewport (320px − 32px horizontal padding = 288px).

#### 5. Desktop client-list rows overflowed with 5+ cases — FIXED

**Symptom:** on desktop only, a client with 5 or more cases had its case-number/charge/classification lines spill out of its own row and bleed into the rows above and below.

**Root cause:** `.caseTable` was `position: absolute` (`right: 78px`, vertically centered via `top: 50%` + `translateY(-50%)`). An absolutely positioned element is **out of flow and contributes nothing to its parent's height**, so a `.row`'s height was driven entirely by `.info` (name + next-event line) — a fixed ~65px no matter how many cases the client had. Mobile never had the bug because its `@media (max-width: 768px)` block already makes `.caseTable` a `position: static` flex child (`flex: 1`) of `.caseLine`, which is exactly what lets the row grow.

**The fix — the desktop equivalent of what mobile already does**, in a new `@media (min-width: 769px)` block:

- `.caseTable` is now an in-flow flex item of `.row` (reached through `.caseLine`'s `display: contents`) at `flex: 0 0 280px`, so the row grows to fit its own case list.
- **The absolute positioning was removed from the base rule rather than overridden**, so the mobile block's now-redundant `position: static` / `transform: none` become no-ops that render identically.
- **Geometry is deliberately pixel-identical to the absolute version.** `.row` gets `padding-right: 78px`, which puts the content-box right edge exactly where the old `right: 78px` put the table's right edge; the 280px width keeps the left edge — where the case numbers actually sit — unchanged; and `.row`'s existing `align-items: center` reproduces the old `translateY(-50%)` centering. **The custody badge does not move**: `.right` is absolutely positioned at `right: 16px`, which is measured from the padding box and is therefore unaffected by the parent's padding.
- `.info`'s `padding-right: 400px` was removed (it was dead at both breakpoints — mobile already set it to `0`) and replaced with a desktop `padding-right: 60px`. **This is load-bearing, not cosmetic:** the old 400px was implicitly keeping the nowrap next-event line clear of the badge column, and without a replacement a client with *no* cases would have had that line run under the custody badge. 60px clips it ~60px before the case table (was ~42px) and keeps it clear of the widest badge ("Pretrialed Out") when no case table is present.

**Vertical spacing tightened on desktop** so fitting more lines doesn't inflate the row: `.caseTableRow` padding `1px 0` → `0`, and `line-height` `1.5` → `1.25` on `.caseNum` / `.caseCharge` / `.caseClassification`. Roughly 17px → 12.5px per case, so a 5-case row lands at ~82px instead of the ~65px fixed height rather than the ~85px it would otherwise have needed.

> **Every change here is inside `@media (min-width: 769px)`, the exact complement of the existing mobile block, so nothing in it can reach the mobile layout.** The only base-rule edits (dropping `.caseTable`'s absolute positioning and `.info`'s 400px padding) were both already overridden by the mobile block, so **mobile renders pixel-for-pixel identically** — verified rule by rule against the `@media (max-width: 768px)` block.

#### 6. Case mini-list in the single-client header

The client header block (`.nameRow`) now lists every case across every incident — case number, charge, and `(CLASSIFICATION)`.

> ⚠️ **Both of this sub-section's original choices were superseded the same day** and are struck through in place below: it showed `charge_abbrev` (now the full `charge`) and it sat under the name / OCA / Total Bond lines (now a centered grid column on desktop, and a left-aligned block under Total Bond on mobile). The two entries above carry the shipped behavior; what remains current here is the styling-reuse and ordering rationale.

- **Styling is reused, not reinvented.** `ClientFile.jsx` imports `ClientRow.module.css` as `rowStyles` and applies the existing `.caseTableRow` / `.caseNum` / `.caseCharge` / `.caseClassification` classes, so the mini-list matches the client list exactly — same colors, sizes, and the same `{' '}` + parenthetical pattern — and inherits both breakpoints' sizing (including the desktop tightening from #5) for free. Only a thin `.headerCaseList` wrapper was added to `ClientFile.module.css`, and it handles placement only.
- **Ordering matches the client list** — numeric on the case number with the letter prefix stripped, the same key `ClientList.jsx`'s `toRowProps` uses, with a `?? ''` guard since `case_number` is nullable. An unnumbered case shows a `—` like it does everywhere else.
- ~~**Self-contained at both breakpoints, by construction.** It sits in normal flow at the bottom of `.nameRowLeft`.~~ — **SUPERSEDED same day (2026-08-09).** Nesting it inside `.nameRowLeft` pinned it to the bottom-left corner of the header row, tucked under the name/OCA block. Replaced by the 3-column grid in the follow-up entry above. It also showed `charge_abbrev`; it now shows the full `charge`.
- **The list is a summary, not a navigation control** — the tappable copies already exist in the client list and under each incident. The borrowed classes carry `cursor: pointer`, so it is overridden with an inline `style={{ cursor: 'default' }}`; an inline style is the only way to reliably beat a class from a *different* CSS module without depending on bundle order.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` still **20 errors**, unchanged — no new lint errors, and none of the four edited files appears in the output.

### Cross-Client Daily Hours Viewer + Shared `dateUtils.js` (2026-07-28)

New read-only feature: a day-by-day view of every hours entry logged across **all** clients, for reviewing a whole day's work at once instead of clicking into each client individually. **No DB or schema changes; strictly read-only** — no edit/delete/reorder controls, nothing here ever writes to Dexie or Supabase.

**Entry point.** A new **"Hours"** button sits on the right side of `ClientList.jsx`'s `.sortToggleRow`, opposite the existing "Sorting by:" toggle — `.sortToggleRow` changed from `justify-content: flex-start` to `space-between` to place them at opposite ends. It reuses the existing `.sortToggle` class rather than a near-duplicate style, so it's visually identical to the sort toggle.

**`src/components/DailyHoursDrawer.jsx` + `.module.css`** — modeled on `TextViewerDrawer.jsx`'s overlay/slide-up-drawer shell (handle, header, `×` close, click-overlay-to-close) but **full viewport height** (`100vh`, `100dvh` override) with its own internal `.body` scroll, since a day's entries across several clients can run long.
- **Header:** `‹`/`›` buttons step the shown date ±1 day via the new `shiftDate()` helper (see below). The date text itself is a tap target — a `<input type="date">` is absolutely positioned over it at `opacity: 0` (not `display: none`, which would block pointer events), so tapping the visible date opens the native picker directly via `pickerHandlers()`, same convention as every other date field in the app. Both arrows are disabled while the date is still resolving (`selectedDate == null`, the brief window before the default-date effect below resolves).
- **Default date on open:** the most recent date with any hours entry across the whole `db.hours` table (scanned via `dateKey()`, not `new Date()`), falling back to `todayString()` if the table is empty. Recomputed **fresh each time the drawer transitions closed→open** (tracked via a `wasOpenRef`), not on every Dexie update while it's sitting open — otherwise a background sync mid-session could yank the user back to a different day while they're browsing. Two effects: one resets `selectedDate` to `null` on the open transition, a second (guarded on `selectedDate === null`) computes the actual default once the live data is ready.
- **Body:** reads `db.hours` and `db.clients` via a single `useLiveQuery` (reactive, offline-first, same as the rest of the app), filters entries to the selected date by comparing `dateKey()` values (not string equality — a date can be written in more than one literal form), groups by `client_id`, and joins each group's client name. Groups are sorted alphabetically by last name (`byLastName` — a local equivalent of `ClientList.jsx`'s comparator, deliberately **not imported** from there to avoid a component→page circular import, since `ClientList` is what renders this drawer). Within a group, entries are ordered by `sort_order` ascending with the same id tiebreak `useClientFile.js` uses, so the order matches that client's own Hours section exactly.
- **Totals:** a grand total for the day sits in a highlighted band at the **top** of the body (more prominent placement than the per-client subtotals, since it's the headline number for a day-review workflow), plus a per-client subtotal row under each group. Both reuse the exact `total % 1 === 0 ? total : total.toFixed(1)` formatting from `HoursSection` in `ClientFile.jsx`, and the subtotal/value styling is modeled on that section's `.hoursTotal`/`.hoursValue` classes (same colors — green `#5ecf90` bold values, muted uppercase subtotal label) rather than inventing a new visual language, adapted from `HoursSection`'s 6-column drag/checkbox/delete grid to a plain flex row since none of those controls exist here.
- **Empty state:** "No hours logged for [date]." with no error styling — this is an expected, common case when stepping through days, not a fault condition.

**`src/dateUtils.js` (new)** — extracts `dateKey()`, `todayString()`, `toDateInput()`, `fromDateInput()`, `formatDateDisplay()`, and `pickerHandlers()` out of `ClientFile.jsx`, where they were previously defined inline, so the new drawer isn't a second copy. `ClientFile.jsx` now imports all six from here; behavior is unchanged. **New helper `shiftDate(mdy, deltaDays)`** — shifts an `"M/D/YYYY"` string by a signed day count, built from `new Date(year, month, day)` numeric args (never `new Date(string)`) so `setDate()` handles month/year rollover correctly without a locale-parsing footgun. Only `ClientFile.jsx` was migrated to the shared module — `NewClient.jsx` and `EditClient.jsx` keep their own pre-existing duplicated copies of `toDateInput`/`fromDateInput`/`pickerHandlers`, and `ClientRow.jsx` keeps its own duplicated `formatDateDisplay` (per prior entries), all untouched by this change.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice). `npx eslint .` 19 → 20 errors — the one new error is the same `react-hooks/set-state-in-effect` rule already accepted twice elsewhere ([`CaseView.jsx:146`](src/pages/CaseView.jsx:146), [`EditClient.jsx:62`](src/pages/EditClient.jsx:62)), fired on the drawer's default-date-population effect for the same reason. **All six live-UI checks confirmed on production 2026-07-28 by Lucas:** button placement/style matches the sort toggle, opening lands on the most recent day with entries, `‹`/`›` step correctly across a month boundary, tapping the date opens the native picker, a multi-client day groups and subtotals correctly, and an empty day shows the empty-state message cleanly.

### `EditClient.jsx` Migrated to Dexie + Johnson/McMillan `warrant_text` Recovered (2026-07-28)

Closes out both remaining items from the prior session's Open Items list.

**`EditClient.jsx` now reads through `useLiveQuery`** ([`EditClient.jsx`](src/pages/EditClient.jsx)), matching `useClientFile`, instead of a one-shot `supabase.from('clients').select('*').single()` inside a `useEffect`. This was the last offline gap — editing a client previously failed outright (page rendered "Client not found") with no network. A populate-effect runs `setForm(prev => prev ?? {...})` off the live client record so it fires once on first load and does not overwrite an in-progress edit if a background sync updates the same client mid-edit. Save path is unchanged (Dexie write + `addToSyncQueue`, still syncs to Supabase) — read-path fix only.

**GS1115757 (Johnson) and GS1116065 (McMillan) `warrant_text` recovered** via **Replace Affidavit** re-upload on production, same method as GS1120368. Verified against the live DB: 3,971 and 2,778 chars respectively. The remaining 4 NULL `warrant_text` rows (GS1041481, GS1093939, SCE322490, SU26540) are confirmed scans and permanently unrecoverable without OCR. *(⚠️ **The "4" is a 2026-07-28 snapshot — the count is now 10.** See the current triage table under Known Issues.)*

**Verification:** `npm run build` clean. `npx eslint .` 18 → 19 errors — the one new error is `react-hooks/set-state-in-effect` on the new populate effect, the same rule already present at [`CaseView.jsx:146`](src/pages/CaseView.jsx:146) for its analogous pattern. **Both standing live-UI checks confirmed on production 2026-07-28 by Lucas**, closing out the last items tied to commit `b8fcde4`: (1) a case saved with both case number and charge blank displays correctly (dash as tap target), the client file loads without error, and tapping the dash navigates into the case via the id-based fallback; (2) clearing an incident's date and saving persists the blank correctly and does not revert on reload.

### Nullable Incident Date / Case Number / Charge + Narrowed Time Dropdown (2026-07-28, commit `b8fcde4`)

Completes the item 8 work started earlier the same day. **One DB change, applied outside the app and verified against the live schema:** `incidents.incident_date`, `cases.case_number` and `cases.charge` are now **NULLABLE** (they were NOT NULL). Everything else is front-end. No Dexie version bump.

**Validation removed** from the four corresponding forms — Add Incident (date), Add Case and Edit Case (number and charge). A blank field writes `null`, not `''`, via the existing `.trim() || null` pattern used by every other nullable field. The `*` markers came off those labels.

#### The crash this caught

Making `case_number` nullable exposed a latent crash that would have fired the first time a case was saved without a number:

```js
[...cases].sort((a, b) => a.case_number.localeCompare(b.case_number))   // TypeError on null
```

`ClientFile.jsx` sorted an incident's cases this way. On a real `null` this throws `TypeError: Cannot read properties of null (reading 'localeCompare')` — and because the sort runs during render, it takes down **the entire client file**, not just the offending row. Now guarded with `(a.case_number ?? '')`. Confirmed by direct test that the old form threw and the new one doesn't. **This is the reason to sweep display and sort sites whenever a column becomes nullable** — the form change is the easy half.

#### Keeping an unnumbered case reachable

`case_number` is the URL key (`/case/:caseNumber`), so a blank one breaks addressing in several places at once:

- **Client list.** The tap target is the case-number `<span>` alone (deliberately tightened on 2026-06-10), so a blank number meant a **zero-width hit area** — the case would have been permanently unreachable from the list. It now renders a `—` as a tap target.
- **Routing.** Both list views link to `` `/case/${c.case_number || c.id}` ``, and `CaseView`'s lookup falls back to a primary-key `db.cases.get()` when the `case_number` match misses. Normal case numbers resolve exactly as before; the fallback only engages for a UUID.
- **Post-edit navigate.** `onSaved()` passes `changes.case_number || caseData.id`, so blanking the number in the edit form doesn't navigate to `/case/` (which would fall through the catch-all route back to the client list).
- **Warrant upload path.** `` `warrants/${caseData.case_number || caseData.id}.pdf` `` — previously this would have written the literal `warrants/null.pdf` and **every unnumbered case would have overwritten the same file** (uploads use `upsert: true`).

#### Blank-value display

- **Conditional separators.** The client-list case row emitted a bare `| ` with no charge; the incident header emitted a leading `—` with no date. Both now render only when the adjoining value exists, extending the filter-then-join convention already used for the Next Event line.
- **Empty-header fallback.** An incident with neither date nor description, and a case with no number, render a lone `—` so the header stays visible and tappable instead of collapsing to an invisible strip.
- **Inline incident edit no longer discards a cleared date.** The old `if (!newDate || unchanged)` guard silently abandoned the commit when the date was cleared; it now saves `null`.
- **Verified against real `null`, not just `''`** — the incident comparator still sorts nulls to the end, an all-null list is stable with no `NaN` comparison, and `formatDateDisplay`/`toDateInput` return `''` for `null`/`undefined`/`''`.

#### Next Event time dropdown narrowed

Range cut to **8:00 AM – 3:00 PM inclusive** — the span the docket actually runs. **53 options, down from 144.** UI and increment logic unchanged: 5-minute steps at the 8, 9 and 10 o'clock hours (12 each), 15-minute at 11 AM / 12 PM / 1 PM / 2 PM (4 each), plus `3:00 PM` alone to close the window. Everything outside is discarded. Format is still `"h:MM AM/PM"`. **All five distinct `event_time` values in the DB (9:00 AM, 9:15 AM, 1:00 PM, 10:00 AM, 8:30 AM) fall inside the window** — re-verified against the live DB after the change — so no record was altered or blanked. An off-list stored value is still preserved as an extra option at the top rather than silently blanked on edit.

**Verification:** `npm run build` clean; `npx eslint .` still 18 errors.

### Affidavit Text Data-Loss Fix + Seven Form/Display Changes (2026-07-28)

Eight scoped changes. **No DB or schema changes; no Dexie version bump** (nothing added is indexed). The headline item is #1 — a silent data-loss bug, not a feature.

#### 1. PDF text extraction was silently losing data — FIXED

**Symptom:** 7 of the 29 cases with an affidavit on file had `warrant_url` set but `warrant_text` NULL (e.g. GS1120368 / Dicole Slayden). The extracted text was never reaching Supabase.

**Root cause — the extraction write was the one write in the app that bypassed the offline-first path.** All three upload handlers did this:

```js
extractPdfText(file).then(async text => {
  const { error } = await supabase.from('cases').update({ warrant_text: text ?? null })...
  if (error) console.error(...)      // Dexie never written
  else await db.cases.update(...)    // Dexie only on success
})                                    // ← never awaited
```

Four independent failure modes, any one of which loses the text:

- **Supabase-first, Dexie-second.** A failed PATCH discarded the extracted text entirely — not written to Dexie, not queued, nothing to retry from.
- **No sync-queue entry, ever.** Every other write goes Dexie → `addToSyncQueue` (durable, 3 retries). This one didn't. Critically, a Dexie-only write would *also* have been wiped by the next `fullSync` (`clear()` + `bulkPut(server data)`) — **the queue entry is what makes the value survive a sync**, not the Dexie write.
- **Fire-and-forget.** The `.then()` was never awaited; the handler called `setUploading(false)` and returned while extraction was still running. Navigating back — or iOS suspending/killing the PWA, very likely since "View Affidavit" opens a new tab — killed the promise with nothing persisted.
- **Offline extraction wrote NULL.** `extractPdfText` returns `null` when the unpkg worker can't load (see Known Issues), and the old code then actively stamped `warrant_text = null`.

Evidence favors a transient race over the "scanned PDF" explanation: GS1115757 is NULL while same-incident siblings GS1115758/GS1115759 both hold ~4,000 chars; same pattern for GS1093939 vs GS1093937/8.

**The fix — applied identically to all three upload paths** (affidavit in `CaseView.jsx`, criminal history and courtroom documents in `ClientFile.jsx`):

```js
const text = await extractPdfText(file)
if (text != null) {
  await db.cases.update(caseData.id, { warrant_text: text })
  await addToSyncQueue('cases', 'UPDATE', caseData.id, { id: caseData.id, warrant_text: text })
}
```

- **Dexie → `addToSyncQueue`, never Supabase directly.** The direct `supabase.from(...).update()` calls are gone from all three handlers; extraction now follows the same offline-first rule as every other write. (`supabase` is still imported in both files for Storage uploads and signed URLs.) The obsolete "PostgrestFilterBuilder is lazy" comments went with them — there is no longer a direct Postgrest call in these paths.
- **Awaited before the handler returns.** Extraction completes and both writes land before the upload handler exits, so the "Uploading…" / saving state stays up for the duration and navigation can't race it. For courtroom docs this means the form no longer closes until the text is persisted; the document row itself is written *before* extraction, so it survives even if extraction yields nothing.
- **A `null` extraction skips the write entirely** rather than overwriting. Deliberate: a null result means either a scanned PDF with no text layer *or* an unreachable CDN worker, and the two are indistinguishable at the call site — so writing null risks destroying good text on re-upload for no gain. **Trade-off:** replacing a text-PDF with a scanned one leaves the previous text stale. Accepted; losing real text is the worse failure. A `console.warn` records the skip.

**The 7 pre-existing NULL rows are NOT repaired by this change** — it prevents new losses only. See the triage results immediately below.

#### Recoverability triage of the 7 NULL rows (2026-07-28)

Each PDF was pulled from the **`backups` branch** (which holds the real bytes, so no auth or live access was needed) and re-extracted locally with the same pdfjs version. Method validated against a known-good control: GS1041482 extracted 3,967 chars, exactly matching the DB.

| Case | Client | Size | Result |
|---|---|---|---|
| GS1115757 | Johnson | 93 KB | **Recoverable** — 3,971 chars |
| GS1116065 | McMillan | 83 KB | **Recoverable** — 2,778 chars |
| GS1120368 | Slayden | — | ✅ **RECOVERED 2026-07-28** — re-uploaded on production through the fixed path; verified in the live DB at **3,925 chars**, clean electronic extraction. Confirms the fix works end-to-end. |
| GS1041481 | Woods-James | 3.4 MB | Scanned — no text layer |
| GS1093939 | Lee | 3.7 MB | Scanned — no text layer |
| SCE322490 | Roche | 2.7 MB | Scanned — no text layer |
| SU26540 | Granberry | 1.9 MB | Scanned — no text layer |

> ⚠️ **Corrects the "2 scanned PDFs" figure recorded on 2026-06-17 — it is WRONG.** Of the 6 probed here, **4 have no text layer**, not 2. That note dates from when there were only 11 cases; more scanned affidavits have been uploaded since and it was never revisited. Do not rely on the old number.

> **Reliable tell, discovered here: file size predicts the text layer perfectly.** Every multi-megabyte affidavit (1.9–3.7 MB) is a scan with no extractable text; every ~80–105 KB file has a clean text layer. Scanned page images are one to two orders of magnitude larger than the same document as electronic text. This is a much faster triage than running extraction, and it held for all 7 files tested.

**Recovery method — no script.** A temporary in-app trigger was built and then discarded in favour of simply **re-uploading the PDF on production through the fixed upload path**, which is how GS1120368 was repaired. That needs no special tooling, exercises the real code path, and doubles as a live test of the fix. The remaining two are tracked under Open Items.

#### 2–8. Form and display changes

2. **New Case form gained the STATUS field.** `AddCaseForm` (`ClientFile.jsx`) now matches `CaseView`'s edit form: Bond Amount and Status sit side-by-side in a `.formTwoCol`, same four options writing `cases.release_status`, blank → null. Previously only the edit form could set it.
3. **Incidents sort oldest-first.** See the Known Issues entry — `compareIncidentsByDate()` replaces `new Date(b.incident_date) - new Date(a.incident_date)`, reusing the existing `dateKey()` parser rather than adding a second one. Missing/unparseable dates sort to the end. Verified: `12/1/2025, 1/15/2026, 2/28/2026, 7/4/2026, null, "", "December 2025"`.
4. **"No cases yet" empty state removed** from expanded incidents; renders nothing now. Dead `.noCasesMsg` CSS removed with it.
5. **Dates display without leading zeros.** New `formatDateDisplay()` ("08/05/2026" → "8/5/2026"; non-`M/D/YYYY` values pass through untouched) applied at every display site: the Next Event line in both views, incident headers, and hours rows. Duplicated in `ClientFile.jsx` and `ClientRow.jsx`, matching how `toDateInput`/`fromDateInput` are already duplicated across three files. `prelimDeadline.js` already stripped zeros via `Number()`. **No stored date currently has leading zeros** — all four date columns were checked across every row, zero matches and zero non-standard formats, since `fromDateInput` normalizes on write. This is a guarantee against data arriving by another route, not a fix for anything visible today. **Native `<input type="date">` rendering is browser-controlled and was deliberately left alone** in all 7 date fields (Next Event, Add Incident, incident inline edit, Add/Edit Hours, New/Edit Client booking date) — changing it would require a custom picker component.
6. **Whole date field opens the picker.** New `pickerHandlers()` returns `onClick` + `onFocus` calling `input.showPicker()`, guarded both for browsers lacking the method and for the throw when the call isn't user-activated — the field degrades to a plain date input. Applied to all 7 date inputs. Duplicated into `NewClient.jsx` / `EditClient.jsx` per the same per-file helper convention.
7. **Next Event time is a dropdown, not a free `<input type="time">`.** 144 options in chronological order (12 AM → 11:45 PM): 15-minute increments, except the 8, 9 and 10 o'clock hours **in both AM and PM** which step by 5 — the docket-call hours. Emits `"h:MM AM/PM"`, byte-identical to what `next_events.event_time` already holds; **all 5 distinct stored values (9:00 AM, 9:15 AM, 1:00 PM, 10:00 AM, 8:30 AM) are on the list**, so no existing record is blanked or altered. A stored value that *isn't* on the list (legacy/hand-entered) is preserved as an extra option at the top and drops off once a listed value is chosen. The now-unused `toTimeInput`/`fromTimeInput` helpers were deleted.
8. **Required-field validation removed where the column allows it.** Removed: the Next Event **date** requirement (`next_events.event_date` is nullable), the Add Incident **description** requirement (`incident_description` is nullable — now saves `null` when blank, matching the inline-edit path), and both `required` attributes on the Login form (not DB-backed; an empty submit now gets a server-side error instead of a browser tooltip). Because a blank Next Event date would have rendered a stray `|`, the display was extended to drop the date segment like every other blank segment. **Deliberately NOT removed — these columns are NOT NULL in Postgres, and removing the guard would let the Dexie write succeed while the background Supabase sync failed silently:** `clients.first_name`, `clients.last_name`, `incidents.incident_date`, `cases.case_number`, `cases.charge`, `hours.entry_date`, `hours.hours`, `hours.description`, plus `courtroom_documents.name` and `courtroom_documents.file_url`. These stay until a migration makes the columns nullable.

**Verification:** `npm run build` clean (only the pre-existing >500 kB chunk notice); `npx eslint .` still **18 errors**, unchanged.

### Session Summary — 2026-07-23

Everything that shipped 2026-07-23, in commit order (detail lives in the individual entries below and in the schema/Custody/Next Event/Hours sections):

- [`7e63467`](https://github.com/ladcock345324/general-sessions-app/commit/7e63467) — docs: corrected stale `localhost` dev claim and the superseded "RLS disabled" finding.
- [`87240dc`](https://github.com/ladcock345324/general-sessions-app/commit/87240dc) — docs: recorded self-signup DISABLED as a load-bearing, role-scoped-RLS security control.
- [`15d56eb`](https://github.com/ladcock345324/general-sessions-app/commit/15d56eb) — `cases.release_status` (Held without bond / Pretrial Released / ROR'd) + bond NULL-vs-0 fix; **ROR'd** custody status; Next Event reasons (Review/Trial/Settlement/Discussion), Criminal Court docket preset, courtrooms 6A–6D, NEXT EVENT edit-form label; sticky header name+gender+OCA; client-list OCA letter-spacing.
- [`49e461e`](https://github.com/ladcock345324/general-sessions-app/commit/49e461e) — NEXT EVENT label +20%; custody dropdown reorder; Next Event info segment reorder (both views); dual **Close** buttons; Hours: selection-safe tap-to-edit, date-ordered insert, 24-item description list, check-off toggle (initially persisted).
- [`f384ab3`](https://github.com/ladcock345324/general-sessions-app/commit/f384ab3) — sixth custody status **No Bond/Held** (crimson, in-custody; prelim gate widened to `in_custody` OR `no_bond_held`); Hours check-off reworked to **session-only** (ephemeral, no DB persistence). `hours.checked` column dropped afterward.

### Next Event Reorder + Hours Check-off, Date-Ordered Insert, Selection-Safe Tap (2026-07-23, second batch)

Eight changes — four Next Event, four Hours. **One DB change**, applied via Supabase MCP (no in-repo migration): `hours.checked` (boolean, not null, default false). **No Dexie version bump** — `checked` is not indexed, Dexie stores whole objects, so the `hours` store stays at v3. Everything else is front-end.

**Next Event**
1. **"NEXT EVENT" label +20%** — `.nextEventLabel` font-size 10px → 12px; one class change covers both the display block and the edit-form label.
2. **Custody dropdown order** (New + Edit Client) → In Custody, Out, ROR'd, Pretrialed Out, Bonded Out. **Display order only** — stored values, badge colors, and the `in_custody` prelim gate unchanged.
3. **Info segment reorder** (formatting/pipes unchanged; blank segments drop out with their separator via filter-then-join, so no leading/dangling/doubled pipes):
   - **Client list (ClientRow):** `day-of-week → date → time → courtroom → reason`. Docket type **removed** from this view; `reason` **added** (threaded via `toRowProps`, replacing `docket_type` in the `nextHearing` mapping).
   - **Single-client (ClientFile blue block):** line 1 `reason | day & date | time`; line 2 `docket type | "Courtroom" + number | judge | ADA`. `reason` is now the first segment of line 1 and is blank on most records (the common tested case).
4. **Edit/Close buttons.** The expanded edit form gets a **Close** button in the top-right (same slot the display block's **Edit** occupies), and the bottom "Cancel" is renamed **Close**. Both call the same `onCancel` (discard) — identical behavior, intentional.

**Hours**
5. **Selection-safe tap-to-edit.** A row's tap-to-open is suppressed when `window.getSelection().toString()` is non-empty **or** the pointer moved > 8px between pointerdown and pointerup (the movement check is what makes desktop click-drag text selection work — long-press detection alone misses mouse-drag). Implemented as a suppress flag set on the row's own pointer handlers while keeping `onClick`, so the child buttons (which `stopPropagation` their own click) still bypass edit exactly as before. **The @dnd-kit grip handle and its sensors are untouched** — drag-reorder is unaffected.
6. **New entries insert in date order, not at the top.** `sort_order` for a new row is computed by scanning the current displayed order (`sort_order` ASC) top→bottom for the first row whose date is same-or-older than the new entry's, then inserting immediately above it at the midpoint of its neighbors; oldest → bottom (`max + 10`), very top → `min − 10`. Dates parsed to a numeric key `year*10000 + month*100 + day` (new helper `dateKey()`) — **not** `new Date()` and **not** string compare, both unreliable for hand-entered "M/D/YYYY". Yields dates descending with the most-recently-created on top among same-date rows. Only the new row gets a `sort_order`; the existing list is never renumbered, so a manual drag arrangement is preserved (the new entry slots into it).
7. **DESCRIPTION_OPTIONS replaced** with a 24-item process-stage list (verbatim, incl. the `Reviewed () affidavits 0. ; …` fill-in template). Shared by AddHoursForm + EditHoursForm; blank option and select-then-clear behavior unchanged.
8. **Check-off toggle (revised same day to session-only — see below).** A small CSS-drawn checkbox on each row, immediately left of ×. A checked row is grayed with the existing gray tokens (`rgba(74,74,74,0.5)` bg / `#c0c0c0` text) but stays fully readable, clickable, editable, and draggable. A minor **"clear checks"** control on the Hours header (shown only when at least one row is checked) clears all checks in one action. Purely visual — no effect on running total, sort order, or delete. The hours grid gained a 6th column (`24px 90px 60px 1fr 24px 28px`) across head/rows/total.
   - **Revised to session-only (2026-07-23, same day).** Originally persisted to an `hours.checked` boolean column (Dexie + sync-queue UPDATE). Reworked to **ephemeral React state** — a `Set` of checked row ids held in `HoursSection`, toggled in local state only, with **no persistence** (no insert-payload field, no Dexie write, no sync-queue entry, no read of any `checked` field). **Checks reset on every page load** and on navigating away and back — intended. Code was pushed with all `checked` references removed *before* the `hours.checked` column was dropped from the DB, so the sync queue never references a missing column. The toggle button, grayed styling, and "clear checks" control are unchanged.

### Case Release Status + Bond Null Fix, ROR'd Custody, Next-Event/Form Polish (2026-07-23)

Nine scoped changes. **One DB change**, applied via Supabase MCP (no in-repo migration): `cases.release_status` (text, nullable) — `'held_without_bond'` \| `'pretrial_released'` \| `'ror'`, `null` = unset. The two pre-existing $0-bond cases (SCE437694, SU26540) were converted to `bond_amount = NULL, release_status = 'pretrial_released'`. Everything else is front-end.

**Key independence principle:** `cases.release_status` (case-level — the condition on that specific case) and `clients.custody_status` (client-level — where the client physically is, net of all cases) are deliberately **independent**. Neither derives from the other; each is set and displayed on its own.

1. **Next Event REASON options** → exactly Review, Trial, Settlement, Discussion (blank stays on top), in that order. `ClientFile.jsx` `NextEventForm`.
2. **Custody status "ROR'd" (`ror`)** — new option in New/Edit Client `<select>`s (after Pretrialed Out), a `CustodyBadge` label arm in `ClientRow` (falls through to muted green `#3d9e6a`; only `in_custody` is red), and a per-status span in the `ClientFile` header (green, gray when closed). Front-end only. Does **not** trigger the in-custody prelim countdown (ROR'd is out of custody; the countdown fires only for in-custody statuses — `in_custody` OR, as of the 2026-07-23 2nd batch, `no_bond_held`).
3. **Bond Amount / Status split on the CaseView edit form.** Bond Amount is now half-width with a new **Status** `<select>` beside it (blank / Held without bond / Pretrial Released / ROR'd → `release_status`), in a `.formTwoCol` grid that stacks to one column ≤480px. **Bond null fix (root of the ticket):** the save path now writes `null` for a blank bond (`bondRaw === '' ? null : Number(bondRaw)`), and an explicit `0` still saves as `0` and displays "$0 bond". Per-case display (CaseView meta + ClientFile case rows) via a shared `bondStatusText()`: bond set → "$X bond"; release set → its label; both → "$X bond · Label"; both null → nothing. **Total Bond** in the ClientFile header now sums only non-null bonds and the whole line hides when every case's bond is null (a `0` counts as present, so it shows "$0"). `release_status` flows through the offline layer automatically — Dexie stores it as a non-indexed field (no schema bump needed), `fullSync`'s `select('*')` carries it, and the CaseView UPDATE payload includes it. **Per the session decision, the client-list case rows were intentionally left unchanged** (they show no bond text today).
4. **"NEXT EVENT" label** added to the top of the Next Event edit form (reuses `.nextEventLabel`).
5. **ClientFile sticky scroll header** now shows name + gender + OCA as `Aydin, Azad (M) (645261)` (no "#", each parenthetical omitted cleanly when missing). The main header (h1 name + separate OCA line) is unchanged.
6. **Client-list OCA letter-spacing** — OCA wrapped in its own `.oca` span with `letter-spacing: 0.4px`, scoped so it never touches the name, case numbers, or anything else on the line.
7. **Docket Type preset "Criminal Court"** added at the bottom of `DOCKET_PRESETS` **and** the `splitDocketType()` known-preset list, so saved values round-trip back into the select instead of the free-text box.
8. *(Covered by #1.)*
9. **Courtroom options 6A, 6B, 6C, 6D** appended to the bottom of the `COURTROOMS` list.

### Hours: Drag-to-Reorder, Smart Date Default, Description Dropdown (2026-07-06)

Three scoped changes to the Hours section of `ClientFile.jsx` (commit `71804b3`).

1. **Drag-to-reorder.** New `hours.sort_order` column (double precision) added via Supabase MCP and backfilled to the existing date-desc order (newest date on top, same-day rows seeded by `created_at` ascending) — no in-repo migration file. Dexie `hours` store schema bumped to **v3** with `sort_order` indexed; `useClientFile.js`'s read path now sorts by `sort_order` ASC (replacing the old `entry_date` DESC sort). Drag implemented with **@dnd-kit** (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`) via a dedicated ≡ grip handle per row, so dragging never conflicts with the × delete button, tap-to-edit, or text selection. Sensors: `MouseSensor` (desktop) + `TouchSensor` with a 150ms press-delay (iPhone), so normal list scrolling still works. On drop, only the moved row is rewritten to the midpoint of its new neighbors' `sort_order` (top slot = min−10, bottom = max+10), persisted offline-first (Dexie update + `addToSyncQueue` UPDATE) — the rest of the list is never renumbered. New entries get `sort_order` = current minimum − 10 so they land on top; included in the INSERT payload for both Dexie and the sync queue. Running total and delete behavior unchanged.
2. **Date-field default.** `AddHoursForm` now defaults the date to `localStorage` key `gsapp:lastHoursDate`, falling back to today. Every successful add **and** edit save writes that entry's `entry_date` back to the key. `EditHoursForm` still initializes from the entry's own saved date (unchanged; verified no regression).
3. **Description dropdown.** New shared `DESCRIPTION_OPTIONS` constant (same pattern as `HOURS_OPTIONS`) with 9 preset descriptions in alphabetical order. Both `AddHoursForm` and `EditHoursForm` gained a `<select>` (blank + presets) beside the description field; picking one fills the text field and resets the select to blank — the field stays fully editable and remains what saves to `hours.description`. Typing directly is unchanged.

### Hours Dropdown Range Expanded 0.1–0.9 → 0.1–2.5 (2026-07-06)

Small front-end-only change (commit `de736ea`). `ClientFile.jsx`'s shared `HOURS_OPTIONS` constant now generates 0.1–2.5 in 0.1 increments (25 values) instead of the hardcoded 0.1–0.9 list. The first 9 values are byte-identical, so no existing entries or the running total are affected. `HOURS_OPTIONS` is shared by both `AddHoursForm` and `EditHoursForm`, so both dropdowns were updated together **intentionally** — keeping them in sync avoids a latent bug where an entry saved above 0.9 would render an `EditHoursForm` `<select>` with no matching option. No changes to the hours table display, running-total logic, or any other form/file.

### "Pretrialed Out" Custody Status + Generic "MIS" Classification (2026-06-25)

Two small front-end-only additions. **No DB/schema changes** — both reuse existing text columns (`clients.custody_status`, `cases.classification`).

1. **New custody status `pretrialed_out` ("Pretrialed Out").** A fourth option alongside `in_custody` / `bonded_out` / `out`.
   - **Dropdown** (`NewClient.jsx` + `EditClient.jsx`): added `<option value="pretrialed_out">Pretrialed Out</option>` immediately **below** "Bonded Out" — order is now In Custody, Bonded Out, Pretrialed Out, Out.
   - **Badge rendering:** explicit label mapping added at both render sites so it never shows the raw value. `ClientRow.jsx`'s `CustodyBadge` got a `status === 'pretrialed_out' ? 'Pretrialed Out'` arm; `ClientFile.jsx` header got its own conditional span. Both use the same muted green (`#3d9e6a`, `badgeGreen`) as Bonded Out/Out.
   - **No regressions (verified):** the in-custody prelim-hearing countdown does **not** fire for `pretrialed_out` (out of custody) — correct then and now. *(At the time of this entry the gate was `in_custody` only; it was later widened to `in_custody` OR `no_bond_held` on 2026-07-23. `pretrialed_out` still never triggers it.)* The closed-section gray override still applies — `ClientRow`'s color logic is `muted ? badgeGray : in_custody ? badgeRed : badgeGreen` (pretrialed_out falls to green, or gray when closed), and `ClientFile`'s per-span `isClosed ? badgeGray : badgeGreen` covers the new span.
2. **Generic "MIS" classification option.** Added "MIS" as the first **real** option (blank/unset stays at the very top), immediately **above** "C MIS", in the `CLASSIFICATIONS` constant in **both** `CaseView.jsx` and `ClientFile.jsx` (each file holds its own copy of the array — no shared constant exists). No special-casing: both `<select>`s `.map()` over the constant, so it flows through the existing Dexie + sync-queue save payload and the generic `(MIS)` parens display in the client list and single-client view exactly like every other value.

### Cleanup Batch — OCA "#", name order, subpoenas, docket combobox, classification (2026-06-24)

Five independent UI/data cleanups:

1. **"#" removed from OCA/inmate number display.** The leading `#` was dropped from the rendered OCA in both the client list row (`ClientRow.jsx`) and the single-client view header (`ClientFile.jsx`). Reads "Boykins, Michael (M) 295180" now. The stored value is unchanged.
2. **New Client form name order swapped.** In `NewClient.jsx` the First Name input is now above Last Name (autoFocus moved to First Name so the top field still focuses on load). `EditClient.jsx` untouched; storage/display of names unchanged everywhere.
3. **Subpoenas removed from Next Event.** Removed the Subpoenas `<select>` from the Next Event form, its display in the Next Event block, and every code reference (`EMPTY_EVENT`, form init, payloads, and `seed.js`). Data was cleared via MCP and all app code references removed; the `next_events.subpoenas` column was subsequently **dropped via MCP (2026-06-24)** — no app code read or wrote it, so nothing broke when it was dropped.
4. **Docket Type → preset select + optional append text.** ~~Initially shipped as an `<input>+<datalist>` combobox~~ — **revised same day** because the datalist dropdown never opened on iOS or desktop. Now a real native `<select>` (blank + the four presets) plus a separate optional `<input>` ("Add'l text (optional)") right after it. On save the two are combined into the single `docket_type` column via `[docketPreset, docketCustom].filter(Boolean).join(' ').trim() || null`; on load `splitDocketType()` peels a leading known preset back into the select and puts the remainder (or any legacy/custom value) into the text box. Flows through the existing `...rest` save payload to both Dexie and the sync queue. Display renders the combined `docket_type` as-is.
5. **`cases.classification` added (field + two display spots).** New optional `<select>` placed immediately after "Abbrev. (for client list)" in **both** `CaseView.jsx`'s edit form and `ClientFile.jsx`'s inline `AddCaseForm`. Options in order (**uppercased same-day; existing row migrated via MCP**): blank, "C MIS", "B MIS", "A MIS", "E FEL", "D FEL", "C FEL", "B FEL", "A FEL", "CAPITAL" (least→most serious); blank stores null. Included in both the Dexie write and the sync-queue payload for case INSERT (AddCaseForm) and UPDATE (CaseView); CaseView pre-populates from the existing value. Displayed in parentheses after the charge in the single-client case rows (`ClientFile.jsx`), inheriting the charge-text font exactly, only when set (no empty parens). In the **client list** (`ClientRow.jsx`) it's in its own span styled to match the **next-event info line** (`.caseClassification` ≈ `.next`: blue `#6b9fd4`, normal weight 400, 13px desktop / 11px mobile) — ~~originally matched case-number style (bold, 10/11px); restyled same-day~~. A `{' '}` fragment before the span guarantees exactly one space between the charge abbrev and the `(CLASSIFICATION)`. `classification` reaches `ClientRow` via the full case objects already carried in `ClientList.jsx` `toRowProps` — no extra threading needed.

### In-Custody Preliminary-Hearing Countdown (2026-06-24) — ⚠️ REMOVED 2026-08-10

> ⚠️ **THIS FEATURE NO LONGER EXISTS.** It was deliberately removed on 2026-08-10 (see the entry at the top of Completed Features). `src/prelimDeadline.js` is deleted and the render site, its CSS, and the prop threading are all gone.
>
> **The entry below is retained as the build record for a future rebuild** — the columns it added (`clients.booking_date`, `clients.booking_time`) still exist and are still populated by the New/Edit Client forms, so a rebuild needs no migration and no backfill. The legal reasoning is still live and still worth reading before rebuilding: see the Rule 5 discussion under Known Issues, which was also deliberately kept.

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
- **Client-list display** (`ClientRow.jsx` + `ClientRow.module.css`): rendered **only when the client is in custody (`custody_status === "in_custody"` OR `"no_bond_held"`) AND `booking_date` is set** (the gate was `in_custody` only at first; `no_bond_held` was added to it on 2026-07-23 — see the Custody Status section and the 2026-07-23 entries). Two compact lines (`.prelimBlock`, color `#d96a6a` as `--prelim-color`, ~8.5px desktop / 8px mobile, tight line-height), **centered over the custody badge** (the `.right` wrapper is right-anchored via `position: absolute`; the `.badgeArea` column uses `align-items: center` so the lines center over the badge — badge is the widest child so it stays flush right for all statuses):
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
- **All row counts matched the manifest exactly** — clients 9, incidents 10, cases 18, hours 12, next_events 6, personal_notes 5, courtroom_documents 0 (9/10/18/12/6/5/0). *(Those are the counts as of the 2026-06-22 restore test. Live counts as of 2026-07-28 are 20 clients / 22 incidents / 34 cases / 166 hours / 13 next_events / 7 personal_notes / 0 courtroom_documents — the test result is not restated here, only the data volume has grown.)*
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
- Each row shows: name + OCA (no "#" prefix), next hearing (blue), case numbers + charge abbrevs, custody badge. **No prelim-hearing countdown** — that two-line block above the badge was removed 2026-08-10, so the badge is now centred for every client
- **Same-incident bracket (2026-08-10):** cases from one incident that land **contiguously** in this flat list get a `[` in `#6b9fd4` (the case-number colour) drawn in the gutter to the left of the case table. ⚠️ The list is sorted purely on the numeric part of the case number with **no incident component**, so same-incident cases can interleave; a non-contiguous group is deliberately left unbracketed rather than drawn across a foreign case. See the 2026-08-10 entry and Open Items.
- **Case table** in each row: flexbox column of rows (`caseNum` fixed at `56px`, charge takes remaining space), right-anchored so all case number left edges are flush. **As of 2026-08-09 it is an in-flow flex item on desktop, not `position: absolute`** — the absolute version was out of flow, so a row never grew and a client with 5+ cases bled into the neighbouring rows (see the 2026-08-09 entry; mobile was always in-flow and is unchanged). `charge_abbrev` shown if set, falls back to `charge`; if `classification` is set, it follows in parens (e.g. `Sex Offender Registration Viol (A MIS)`), styled to match the next-event info line (`#6b9fd4`, normal weight, 13px desktop / 11px mobile)
- Badge colors: **In Custody** → muted crimson (`#b85555`); **Bonded Out** / **Out** → muted green (`#3d9e6a`); **CLOSED** / relieved clients → gray
- Clients in the Closed section (`relieved_closed = true`) show all custody badges in gray
- `+` button top-right → Add Client form
- **Mobile layout** (`max-width: 768px`): 3-line stacked layout — name, next event, case table + badge on same line. Desktop layout unchanged.

### Add Client (`/client/new`)
- Fields (in order): **First Name**, **Last Name**, Gender, **Booked/Initial Appearance** (date + Hour + AM/PM dropdowns + Clear button), OCA #, Custody Status (In Custody / Bonded Out / Out)
- Inserts into `clients` table, redirects to client list

### Client File (`/client/:id`)
- **Header case mini-list bracket (2026-08-10):** cases from one incident that land **contiguously** in this flat list get a `[` in `#6b9fd4`, drawn inside the list's 9px `padding-left` (which an equal negative margin cancels, so nothing moved at either breakpoint). Same contiguity guard as the client list, shared via `caseGrouping.js`
- **Header (2026-08-09):** on **desktop** a 3-column grid — name / OCA / Total Bond on the left, **case mini-list centered in the row**, custody badge on the right. On **mobile** two columns, with the mini-list moved into the left text stack (left-aligned, directly under "Total Bond") and tighter case-line spacing; the badge is unchanged at both widths. The mini-list shows every case across every incident as `case number | full charge (CLASSIFICATION)` — the **full `charge`**, not the `charge_abbrev` the client list uses — ordered numerically like the client list and styled with the reused `ClientRow.module.css` classes. Everything is in normal flow, so the header grows with the case count; the mini-list is non-interactive
- **Back button** navigates directly to `/` (not history-based)
- **Edit button** navigates to `/client/:id/edit`
- **Next Event block** (blue `#1E3A5F`): "NEXT EVENT" label + Edit button integrated into blue block
  - Docket type, reason (if set), date/time, courtroom (prefixed "Courtroom"), judge, and ADA (shown as "ADA: [name]" only when `ada_name` is set — single-client view only, never in the client list)
  - **Clear button** in the edit form — deletes the `next_events` row for this client, returns block to empty state
- **Personal Notes** section (between Next Event and Incidents): single bar that shows the note inline or a muted "Add a personal note…" placeholder; tap to edit, Save/Cancel/Delete controls; one note per client stored in `personal_notes` table. **Renders already expanded on load when the note is non-empty** (2026-08-09); an empty/absent note still starts collapsed. Click-to-toggle itself is unchanged
- **Incidents** section — **two-column grid, one row per incident, nothing collapsible** (2026-08-10; replaced the click-to-expand accordion):
  - Section header carries two controls (2026-08-10): an **"upload affidavit"** text control (affidavit-first creation — see the 2026-08-10 entry) and the existing `+` button, in that order. The `+` still creates a bare incident with no affidavit — needed for things like probation violations that have no incident date
  - **Left cell** (**22.2%** of the section, `minmax(246px, 2fr)` of a 2fr/7fr split — widened 2026-08-10 from 16.7% to fit the charge abbrev): incident date and location (both `#c8d0dc`, sizes 13px/12px, tight against each other), then each case as `{case number} {charge_abbrev}` — the abbrev in the muted bond styling, omitted entirely with no trailing space when null, and inside the number's span so it shares the click target — with **one** line beneath it reading `$0 Bond · Held without bond | Affidavit` — every segment dropping out independently, the line omitted entirely when nothing is set — then that incident's own "+ add a case". "Affidavit" is green `#5ecf90` at normal weight. **Both the case number and the bond line navigate to that case**; the number has an enlarged hit area (padding cancelled by negative margins, so its visual size is unchanged). Unnumbered cases fall back to the case `id` in the URL
  - **No same-incident bracket here** — added 2026-08-10 and removed the same day: these case numbers are already grouped by incident by construction, so it added nothing. The bracket lives on the two *flat* lists (client list and header mini-list)
  - **Right cell** (~5/6): the incident description at `line-height: 1.4`, with the delete `×` at its top-right and **"edit incident" flowing inline after the last word** of the description
  - **Gridlines (desktop):** 2px `#2C3A4F` row dividers, 1px `#2C3A4F` column split
  - **Mobile (≤768px):** stacks to one column — left block on top, description beneath, **with no rule between them** (they are one incident). Incidents are separated by a **3px `#4a5a70`** rule with 14px/16px of padding around it (2026-08-10)
  - An incident with **date, location and description all null** shows **"Awaiting details"** in the description cell; a case with **no case number** shows **"Case # pending"** (both 2026-08-10) — these are the states an affidavit-first record is created in. ⚠️ **The "Awaiting details" marker is suppressed on PV incidents** (`is_pv`), which are *deliberately* blank on all three columns — showing it there is exactly the bug that moved PV creation to the Add Incident form on 2026-08-19
  - Add Incident form fields, in order: **Date, Location, Description** — picking the date auto-fills Description with "The affiant believes that on M/D/YYYY," unless the user has already typed past it (2026-08-09)
  - **"Probation Violation" checkbox, top-right of the Add Incident form (2026-08-19).** Unchecked (default) the form is exactly as described above. Checked, Date/Location/Description are replaced by **Case Number, Conviction Date, Crime, Probation Length, Special Info** (2026-08-20 — these four replaced a single "Sentence (if known)" field; all optional, no validation), and Save creates **an incident and its one case together** — incident with all three descriptive columns null and `is_pv: true`, case with `is_pv: true`, the entered number and sentence, the five charge/bond columns as explicit nulls and `status: 'open'`. **The incident is enqueued before the case** (FIFO FK ordering, same rule as affidavit-first creation). Hidden fields keep their state, so unchecking restores anything typed. **This is the only way to create a PV** — the checkbox that briefly lived in "+ add a case" was removed on 2026-08-19 and that form reverted to its pre-PV state
  - **A PV incident (`incidents.is_pv`) renders with its chrome collapsed (2026-08-19):** no date or location line (not even a dash), **no "+ add a case"** (it holds exactly one case), **no "Awaiting details"**, and **no "edit incident"** — that button edits the three fields this branch hides, so leaving it would let the user type a description that renders nowhere. The left cell is the one case line ("[case number] - PV"). The `×` delete button is unchanged
  - **PV left cell spacing (2026-08-20):** `.incidentLeftCellPv` zeroes the first `.incidentCaseItem`'s 9px top margin. That margin separates the first case from the **location line**; with no date or location above it, it read as empty space at the top of the cell. Applied only when `is_pv` — normal rows keep their spacing exactly
  - **The PV left cell is vertically centred (2026-08-20):** `.incidentLeftCellPv` also sets `justify-content: center`. The grid stretches both cells to the row height, and the row is sized by the **right** cell's 1–3 line block — so without this the "[case number] - PV" label sat pinned to the top of a cell up to three lines tall while the block opposite it was centred. Both cells centre now, so the pairing stays aligned at any line count. The zeroed top margin above is what keeps that centring true
  - **PV right cell — the 4-field / 3-line detail block (2026-08-20)**, replacing the old single "Sentence: […]" line. **Line 1** `Conviction Date: {pv_conviction_date}` (via `formatDateDisplay`) · **Line 2** `Convicted Crime: {pv_crime}` · **Line 3** `Probation Length: {pv_probation_length}`, with `pv_special_info` joining after `" · "` (the same separator `bondReleaseText()` uses) when both are set. **Each line renders only when it has content**, so the block is 0–3 lines; with nothing filled in the cell is genuinely empty — never a placeholder. `.incidentDescCellPv` centres it vertically so it stays centred at any line count, `gap` tightened to 2px. **`pv_sentence` is not read** — deprecated 2026-08-20
  - **Field labels are underlined; the colon and the value are NOT (2026-08-20).** `.pvLineLabel` carries `text-decoration: underline`, and the **colon sits OUTSIDE that span in the JSX** — that placement is the whole mechanism, so don't fold it into the label text. Renders as <u>Conviction Date</u>`: 5/4/2026`
  - ⚠️ **`pv_special_info` is deliberately UNLABELLED** — it is a free-text remark, not a named field. On line 3 it either trails a labelled probation length after `" · "`, or, **when the probation length is blank, stands alone with no label at all** (there is nothing to label it as). Both blank → no line 3, unchanged
  - Inline "edit incident" edits **all three** fields and **spans the full row**; the date input stays last in that form so the mobile date picker can't cover the others. Save on blur or Enter; Escape cancels
  - **Sorted oldest-first** (earliest `incident_date` at top, latest at bottom) as of 2026-07-28, via `compareIncidentsByDate()`; missing/unparseable dates sort to the end. Case numbers within each incident sorted ascending
  - **The charge is not shown here** as of 2026-08-10 — it lives in the header case mini-list and in CaseView
- **Hours** table: drag grip (≡), date, hours (green), description, check-off toggle, × delete button per row
  - Running total at bottom
  - `+` button opens inline form (date defaults to last-used/today, hours dropdown 0.1–2.5)
  - Rows ordered by `sort_order` ASC; drag-to-reorder. New entries slot in by **date** (see 2026-07-23 feature entry) rather than jumping to the top
  - **Check-off toggle** per row (left of ×) grays a reviewed row — **session-only** local state (a Set of ids in `HoursSection`), **not persisted**; resets on reload. A "clear checks" control appears on the Hours header when any row is checked. Purely visual — no effect on total/sort/delete
  - Tap a row to edit — **except** while selecting text or click-dragging (so descriptions can be copied out for ACAP)
  - **Add/Edit Hours form field order is date → description → hours (2026-08-19)**, in both forms. Hours moved *below* description because picking a common description can now fill Hours in, so the field it drives has to come after it. Date and Hours no longer share a `formTwoCol` row — that pairing is what the reorder breaks; all three are full-width `formRow`s now.
  - **"Courtroom wait time" is pinned FIRST in `DESCRIPTION_OPTIONS`** (2026-08-19), ahead of every other option — the most-picked entry. Deliberately outside the alphabetical run that follows it; do not "restore" it to sort order
  - **Description → default hours (2026-08-19).** Shared `DEFAULT_HOURS_BY_DESCRIPTION` map: picking one of these from the dropdown also sets the Hours field — Opened file `0.5`, Closed file `0.5`, Jail visit with client `0.4`, Initial client meeting `0.3`, Met with ADA `0.1`, Met, negotiated with ADA `0.1`, Rescheduled Appearance `0.1`, Draft, send email requesting client zoom visit `0.2`, Client zoom visit `0.3`, Guilty plea taken by judge `0.2`, Case dismissed `0.1`. **The field stays manually overridable**, exactly as before. Any description *not* in the map — including "Courtroom wait time" and anything typed by hand — gets **no forced default** and leaves Hours untouched. Keys must match the `DESCRIPTION_OPTIONS` strings **byte for byte** (plain case-sensitive lookup, not fuzzy); values are strings so they equal the `HOURS_OPTIONS` `<option>` values and the `<select>` stays controlled. Applied via a shared `applyDescriptionPick()` used by both forms, which sets description and hours in **one** state update.
- **Section headers** (Incidents, Hours, Personal Notes, Criminal History, Courtroom Documents) use inline styles (`background: #0f1820`)
- **Criminal History** section: Upload/Replace/View Criminal History PDF; drag-and-drop supported
- **Courtroom Documents** section: up to 5 documents; rename/delete per document; tappable tiles open via signed URL
- **Edit Client** button → Edit Client form
- **Close Case / Reopen Case / Delete Client** action buttons

### Edit Client (`/client/:id/edit`)
- Fields (in order): Last Name, First Name, Gender, **Booked/Initial Appearance** (date + Hour + AM/PM dropdowns + Clear button), OCA #, Custody Status — same field set as Add Client except name order is Last then First (unchanged from original; only New Client swapped to First-then-Last)
- **Pre-populated from Dexie via `useLiveQuery`** (as of 2026-07-28, see the "`EditClient.jsx` Migrated to Dexie" entry above), including `booking_date`/`booking_time` parsed back into the dropdowns — works offline. Form state is seeded once from the first live value and does not get overwritten by later background-sync updates to the same client.
- Save uses `navigate('/client/:id', { replace: true })` — edit page is replaced in history, so Back from client file returns to client list

### Next Event Block
- **Display segment order (2026-07-23).** Formatting/separators/pipes unchanged — only segment order differs by view, and every blank segment drops out with its separator (built by filtering empties then joining, so no leading/dangling/doubled pipes). `reason`, `time`, and `courtroom` are all optional; `reason` is blank on most records.
  - **Single-client view (ClientFile blue block), two lines:**
    - Line 1: `reason | day-of-week & date | time` — reason is now the FIRST segment and is usually blank (drops cleanly).
    - Line 2: `docket type | "Courtroom" + number | judge | ADA` (ADA still appended when set).
  - **Client list (ClientRow), one line:** `day-of-week → date → time → courtroom → reason`. **Docket type is NOT shown here** (removed); `reason` is now shown (threaded through `toRowProps`).
- **Overdue indicator — CLIENT LIST ONLY (2026-08-19).** The whole one-line client-list next-event span turns muted crimson (`#b85555`, the in-custody badge color) once the event's `event_date` + `event_time` is **more than 3 hours** in the past. `isOverdue()` in `ClientRow.jsx` parses the two columns into a real datetime with numeric `Date(y, m, d, h, min)` args (never `new Date(string)`), adds the 3-hour grace, and compares to `Date.now()`.
  - **Deliberately scoped to `ClientRow.jsx`.** ClientFile's blue block, CaseView, and every other view are untouched — this is the client list's stale-record nudge, not an app-wide state.
  - **Both fields required.** A blank/null `event_date` **or** `event_time` skips the check entirely and never renders red — without both there is no meaningful cutoff, and measuring from an assumed midnight would flag records that are merely undated. (This is why it does not reuse `ClientList.jsx`'s `eventTimestamp()`, which intentionally treats a missing time as start-of-day for *sorting*.)
  - **No stored flag.** Purely derived at render, so it clears itself the moment the next event is updated — nothing to backfill, migrate, or reset. It also does **not** re-evaluate on a timer: a row flips to red on its next render (navigation, or any Dexie change via `useLiveQuery`). That is the accepted trade for having no stored state, not an oversight.
  - `.pipe` sets no color of its own, so one `color` override on the parent span carries every separator with it. The class also bumps weight to 600: this crimson sits at ~3.1:1 on the `#1E2A3A` row against the ~5.2:1 of the blue it replaces, and the line drops to 11px on mobile — `.badgeRed` already pairs this exact hue with weight 600, so it matches existing usage rather than inventing a treatment.
- Legacy display format for reference: `Jail Docket  |  Thursday 7/16/2026  |  9:00 AM`
- **Docket Type** — edited as a native `<select>` (blank + "Jail Docket", "Bond Docket", "Review Docket", "Settlement Docket", "Criminal Court", **"PV"** — appended last 2026-08-19) plus a separate optional "Add'l text" `<input>` (moved to the bottom of the form 2026-08-19, see field order above); combined into the single `docket_type` column on save via `[preset, custom].filter(Boolean).join(' ').trim() || null`; split back on load (`splitDocketType()` peels a leading known preset into the select; any remainder or non-matching legacy value goes into the text box). "Criminal Court" added 2026-07-23 — added to **both** `DOCKET_PRESETS` (the dropdown) and, critically, the same list `splitDocketType()` reads, so a saved "Criminal Court [+ append]" round-trips back into the select rather than dumping into the free-text box.
- **Reason** — `<select>`: blank + Review, Trial, Settlement, Discussion (this exact order, 2026-07-23), **plus "PV Hearing" appended at the bottom 2026-08-10**. Options live in the `REASON_OPTIONS` constant (extracted from inline `<option>` elements 2026-08-20). No enum validation; stored/displayed as-is. **Preserves an off-list stored value as an extra option at the top of the list, exactly like the Time dropdown** (2026-08-20 — it previously did not; see that entry). The extra option drops off once a listed value is picked.
- **Courtroom** — `<select>`: blank + 3A, 3B, 3C, 4B, 4C, 4D, 5C, 5D, 6A, 6B, 6C, 6D (6A–6D added 2026-07-23 at the bottom).
- **Judge** — `<select>`: blank + J. Bell, R. Bell, M. Blackburn, S. Coleman, A. Escobar, R. Hayes (PRESIDING), **A. Holt**, L. Jones, M. Floyd, G. Robinson, A. Walker, Other. Picking "Other" reveals a free-text input. **"J. Holt" was corrected to "A. Holt" 2026-08-19** (first name Aaron) — label string only, same list position, no other entry touched. `next_events.judge` is free text, so the rename does not migrate saved rows; the live table was checked and held **zero** rows matching `%holt%`, so there was nothing to migrate.
- **"NEXT EVENT" label** appears on both the blue display block and the top of the edit form (all-caps/bold `#5b9fd4`, shared `.nextEventLabel` class). Font size bumped 10px → **12px** (+20%, 2026-07-23) — one class change covers both sites.
- **Edit/Close buttons (2026-07-23).** On the display block the top-right button reads **Edit** (opens the form). On the expanded edit form that same top-right slot shows a **Close** button, and the bottom action button (formerly "Cancel") is also renamed **Close**. Both Close buttons call the same `onCancel` (discard, no save) — identical behavior, by design.
- **Time** — a `<select>` as of 2026-07-28, no longer a free `<input type="time">`. Blank + 144 chronological options (12 AM → 11:45 PM): 15-minute increments except the 8, 9 and 10 o'clock hours in **both** AM and PM, which step by 5. Stores `"h:MM AM/PM"` (unchanged format). An off-increment stored value is preserved as an extra option rather than being blanked on edit.
- **Date is optional** as of 2026-07-28 (`event_date` is nullable) — the required-field check was removed, and a blank date drops out of the display line along with its separator.
- Weekday derived from `event_date` via `new Date()` + `toLocaleDateString`
- Time is optional — omitted from display if blank
- **Subpoenas field removed** — all UI/code references removed; the `next_events.subpoenas` column has been **dropped from the DB via MCP (2026-06-24)** (no app code reads or writes it)
- **Form field order (2026-08-19):** **1.** Date + Time (same row) · **2.** Judge · **3.** Courtroom · **4.** Docket Type + Reason (same row) · **5.** Add'l Text. The "Add'l text" input was lifted out of the Docket Type cell into its own full-width row at the bottom; it is still the same `docketCustom` value combined into the single `docket_type` column on save. **This is the INPUT FORM only** — the display order in the blue block and the client-list line is deliberately different and was not touched.
- ~~**Assistant DA Name** input writes to `next_events.ada_name`~~ — **the input was REMOVED from the form 2026-08-19.** The **column and its display are untouched**: `ada_name` still renders as "ADA: [name]" on line 2 of the single-client Next Event box when set (never in the client list). ⚠️ **`save()` deliberately omits the key entirely** — `ada_name` is absent from the form's state object, so neither the Dexie write nor the sync-queue payload mentions it, and editing an event leaves any existing `ada_name` intact instead of nulling it out. Do not "tidy" this by adding `ada_name: null` to the payload. There is currently **no UI to set or clear** an ADA name; re-adding one means re-adding the input.
- **Clear button** in edit form deletes the record entirely

### Case View (`/case/:caseNumber`)
- Header shows client name (`LASTNAME, FIRSTNAME`) centered between Back and Edit buttons
- **Upload Affidavit** / **Replace Affidavit** — drag-and-drop or tap; uploads PDF to Supabase Storage; "Replace Affidavit" button resized to match "View Affidavit" and "View Text" buttons
- **View Affidavit** button when affidavit is on file
- **Notes** textarea with Save/Saved confirmation
- **PV header display:** when `is_pv` is true the charge line reads **`PV`**. The `[case number] - ` prefix used by the client list and both mini-lists is dropped **here only** — the case number is already the large label directly above it, so repeating it would print the number twice within four lines.
- ⚠️ **A PV case (`is_pv`) gets a stripped-down page (2026-08-20).** **Removed**, all gated on `is_pv`: the Upload/Replace/View Affidavit row, the affidavit + bond meta line, the **Notes** section (`pv_special_info` replaces it), and the top-right **Edit** button with the case-number/charge/classification/bond/status form it opens. **Kept:** the "PV" label, client-name header, Back, Delete Case, and **Disposition**. A normal case is completely unaffected — every branch is gated
  - ⚠️ **Consequence: a PV case's `case_number` is no longer editable in the app**, since the Edit form was the only place it could be changed. This follows directly from "a PV case should never expose those fields"; delete-and-recreate is the path for a mistyped number
  - **The four PV fields render always-editable in place** — no edit mode, no Save button, no extra click (`PvField` in `CaseView.jsx`). Order: **Conviction Date, Crime, Probation Length, Special Info**. **Commits on blur and on Enter; Escape restores the last saved value**, the same convention the inline "edit incident" fields use. Each field writes only its own column (one Dexie update + one sync-queue UPDATE); blank → `null`. A transient "Saved" tick appears beside the label for 2s
  - **The date field commits on `change`, not blur** — a date pick is a discrete action, not typing, and a native mobile picker does not reliably fire a usable blur. It deliberately does **not** also commit on blur, which would enqueue a duplicate UPDATE per pick
  - **Draft re-seeding uses React's "adjust state while rendering" pattern, NOT a `useEffect`.** A `setState` in an effect body cascades a second render and the repo's lint rule rejects it — don't "simplify" it back into an effect
- **Disposition**, **Edit** (inline form includes `charge_abbrev`, `classification`, and a half-width **Bond Amount + Status** row — Status is a `<select>` writing `cases.release_status`), **Delete Case**
- **Bond/status meta line** (header, under the charge): a green **"Affidavit"** when one is on file and **nothing at all** when there isn't (2026-08-10 — the old "Affidavit on File" / "No Affidavit" strings are gone from the app), then the per-case bond/status independently: `$X bond` when a bond is set, the release-status label when `release_status` is set, both joined by ` · ` when both are set, and nothing when both are null. **The `|` separator is conditional on both sides**, so an absent affidavit can't leave the line opening with a stray separator. Segment order is unchanged (affidavit first).

### Incident Editing
- Date input constrained to `max-width: 160px`
- Description uses `<textarea rows={3}>` — fully visible while editing
- Edit inputs stacked vertically (`flex-direction: column`), in the order **description → location → date** (2026-08-09). The date stays last so the native mobile date picker can't cover the fields above it — the reason it was moved below the description on 2026-06-10. Do not reorder these to match the Add Incident form, which is Date → Location → Description. **A reorder was formally proposed and rejected on 2026-08-10 — see SD1 under Settled Decisions for the full reasoning before raising it again**
- **The edit form spans the full grid row** as of 2026-08-10 (`grid-column: 1 / -1`), rather than sitting in one cell of the two-column layout: date/location live in the left cell and the description in the right, so editing one field while another still displayed its old value would read as two competing sources of truth
- All three fields (description, location, date) commit together through one Dexie write + sync-queue UPDATE; each saves `null` when blank
- ~~Hanging indent on two-line descriptions: `padding-left: 1.62em; text-indent: -1.62em`~~ — **REMOVED 2026-08-09.** It existed only because the description used to render inline after the date and its wrapped lines needed to clear it. The description is now its own block on line 2, so the indent would have offset it from line 1 rather than aligning it

### Custody Status
- Six options: `out`, `ror` ("ROR'd"), `pretrialed_out`, `bonded_out`, `in_custody`, `no_bond_held` ("No Bond/Held"). **Dropdown display order as of 2026-07-23 (2nd batch): Out, ROR'd, Pretrialed Out, Bonded Out, In Custody, No Bond/Held** — display order only in both New/Edit Client; stored values unchanged. `no_bond_held` added front-end only (existing text column, no schema change).
- **Badge colors:** "Out", "ROR'd", "Pretrialed Out", "Bonded Out" → muted green (`#3d9e6a`); **"In Custody" and "No Bond/Held" → muted crimson (`#b85555`)** — both are physically in custody. The closed-section gray override wins over both. All badges muted from original bright colors.
- Rendered in three places, all kept in sync: `ClientRow`'s `CustodyBadge` (explicit label map + red arm covering `in_custody` **or** `no_bond_held`, else green), the `ClientFile` header (per-status span; gray when the client is closed), and the New/Edit Client `<select>`s.
- ~~**In-custody preliminary-hearing countdown** gates on `custody_status === 'in_custody' || custody_status === 'no_bond_held'`.~~ — **the countdown was REMOVED 2026-08-10.** No custody status triggers anything beyond its badge now. (The gate is recorded here because a rebuild would want the same one.)

### charge_abbrev
- `cases` table has `charge_abbrev text` column (added via `ALTER TABLE cases ADD COLUMN charge_abbrev text`)
- Editable in the case edit form in CaseView
- Client list shows `charge_abbrev` if set, falls back to `charge`
- **Superseded entirely when `cases.is_pv` is true (2026-08-19):** a PV case has no charge, abbrev or classification, and every display site renders "[case number] - PV" instead. The four sites are `ClientRow`'s case row, the ClientFile header case mini-list, the incidents left-cell case line, and the CaseView header — keep them in sync, the same way the three custody-badge sites are kept in sync.
- **"PV" is styled to match the case number exactly (2026-08-20)** — same family, size, weight and colour — not the muted charge style it first shipped with. In the Incidents section it is **bare text inside the case-number span** (inherits everything, so nothing can drift); in the two flat lists it is a sibling span using **`.casePv`**, which mirrors `.caseNum`'s type but not its 56px column width or tap-target cursor. `.casePv`'s mobile size is re-declared alongside `.caseNum`'s in the ≤768px block — **if one moves, move the other.**

### Total Bond
- Computed in ClientFile as the sum of `bond_amount` across the client's cases, counting **only non-null** values
- The entire "Total Bond:" line is **hidden when every case has a null `bond_amount`** (2026-07-23). A case with `bond_amount = 0` counts as present (0 ≠ null), so the line shows and reads "Total Bond: $0"
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
| Blue links/buttons | `#6b9fd4` — also the client-list case numbers and, since 2026-08-09, the incident header's `date — location` line |
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
  PWAContext.jsx           # useRegisterSW wrapper — exposes offlineReady, needRefresh, controlled
  RequireAuth.jsx          # Route guard — redirects to /login if no session
  supabaseClient.js        # Supabase client singleton
  SyncContext.jsx          # Provides isOnline, isSyncing, lastSyncedAt, triggerSync via React context
  localDB.js               # Dexie IndexedDB schema — mirrors 7 Supabase tables + sync_queue
  syncManager.js           # fullSync, processSyncQueue, addToSyncQueue, startBackgroundSync
  extractPdfText.js        # PDF text extraction utility — pdfjs-dist v6 + CDN worker
  caseGrouping.js          # bracketBlocks() — same-incident "[" grouping + contiguity guard, shared by ClientRow and ClientFile
  dateUtils.js             # Shared "M/D/YYYY" helpers — dateKey, todayString, toDateInput, fromDateInput, formatDateDisplay, pickerHandlers, shiftDate
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
    OfflineStatus.jsx / .module.css     # Shared offline-readiness status line; rendered on Login and ClientList
    TextViewerDrawer.jsx / .module.css  # Slide-up drawer for viewing extracted PDF text; used in CaseView and ClientFile
    DailyHoursDrawer.jsx / .module.css  # Full-height, read-only cross-client daily hours viewer; opened from ClientList

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
- Text extraction fires automatically on every new PDF upload, after the storage upload and primary URL/record write succeed. **As of 2026-07-28 it is `await`ed before the upload handler returns** — it is no longer fire-and-forget (see below).
- **Persistence path (2026-07-28):** all three handlers write **Dexie → `addToSyncQueue`, never Supabase directly**, exactly like every other write in the app. A `null` extraction result skips the write rather than overwriting the stored value. See "Affidavit Text Data-Loss Fix" under Completed Features for the full rationale — this replaced a Supabase-first, unqueued, unawaited write that silently lost text on 7 of 29 uploaded PDFs.
- ~~**Key bug fixed:** Supabase JS v2's `PostgrestFilterBuilder` is lazy — the HTTP request only fires when the Promise is `await`ed. All three PATCH calls were inside non-`async` `.then()` callbacks…~~ **Superseded 2026-07-28** — these paths no longer make a direct Postgrest call at all, so the laziness caveat no longer applies to them. Retained for history; it remains true of Postgrest calls elsewhere in the app.

---

## Coming Next

## ⏸ DEFERRED — decided, not forgotten

Three items explicitly parked as of **2026-08-10**. Each is a deliberate deferral with a known reason, not an oversight or a lost thread. Listed most-actionable first.

### D1. `src/seed.js` — broken, and carries a SECOND copy of the Supabase anon key

**The credential duplication is the reason this matters**, more than the breakage. `seed.js` holds its **own hardcoded copy of the Supabase anon key**, entirely independent of the one in `src/supabaseClient.js`. Two copies of a credential means a future key rotation silently misses one, and it widens the surface for no benefit — **nothing in the app imports this file**.

It is also **broken and would fail on first run**: it inserts into columns that no longer exist — `cases.da_name` and `clients.criminal_history` (both dropped 2026-06-09) — and would throw at the first case insert. It additionally writes the dormant `clients.bond_amount`.

**Decision pending: repair it against the current schema, or delete it.** Both are fine; **leaving a broken seed script that looks runnable is the worst of the three options**, which is exactly the state it is in now. If repaired, the anon key must come from `supabaseClient.js` rather than a second literal.

### D2. Extraction progress state during PDF upload

Whether to surface a distinct **"Extracting text…"** state while `extractPdfText` is awaited on upload. The `await` itself is **not** up for debate — it is the 2026-07-28 data-loss fix and must not be reverted to fire-and-forget (see that entry). The open question is purely whether the UI should say what it is doing during that window, rather than sitting on a generic "Uploading…".

**This got more visible on 2026-08-10**, when affidavit upload became the **entry point for creating an incident and its case** rather than the last step on an already-existing case. The wait now sits between the user's action and a record appearing at all, so a large scanned PDF reads as a stall in a place it did not before.

### D3. Automation layer

Recurring tasks, reminders, or hooks — for example auto-notifying before hearing dates. **Not yet scoped**: no trigger mechanism, delivery channel, or storage model has been chosen, and the app currently has no server-side component to run scheduled work.

---

### Features

#### Offline PDF availability (deferred)

Affidavit / criminal-history / courtroom-document PDFs are not cached locally, so the scanned files aren't viewable offline — only their extracted text (`warrant_text`, etc.) is, via the text drawer reading from Dexie. A future option is to cache PDF bytes as Blobs in a new Dexie table (cache-on-upload + cache-on-view as the light version, eager full-download as the heavy version) and render via `pdfjs-dist` canvas in a drawer. Deliberately deferred — extracted text covers the practical need.

### Open Items — from 2026-08-10

0. ~~**`"Affidavit on File"` / `"No Affidavit"` still exist at `CaseView.jsx:258`.**~~ — **RESOLVED 2026-08-10**, commit `8d51a54`, with explicit clearance to edit `CaseView.jsx` for that one change. Both strings are now gone from the app; the meta line shows a green "Affidavit" or nothing, and its separator is conditional on both sides so it cannot open with a stray `|`. Nothing else in CaseView was touched.

1. ~~**The affidavit-first flow has not been exercised on production.**~~ — ✅ **VERIFIED 2026-08-10.** A real upload created the incident and case and produced **4,444 characters of `warrant_text` in Supabase** on a `null`-`case_number` case. See the confirmation note on the affidavit-first entry under Completed Features.

2. ~~**Incidents two-column layout redesign — deliberately deferred to its own pass.**~~ — **DONE 2026-08-10**, same day, commit `9e5b33c`. See the "Incidents Two-Column Layout" entry under Completed Features. **Also unverified on production**, and worth checking together with item 1 in the same pass:
   - **Desktop proportions.** ~~The left cell is one sixth (~188px at 1126px).~~ **Widened 2026-08-10 to 22.2% (`minmax(246px, 2fr)` / `minmax(0, 7fr)`, ~250px at 1126px)** to fit the charge abbrev. If it reads wrong, the two knobs are the `7fr` ratio and the `246px` floor in `.incidentRow` — both in [`ClientFile.module.css`](src/pages/ClientFile.module.css); move them together so the floor keeps binding only below the app's normal width.
   - **Gridline weight (desktop).** 2px rows / 1px column split, both `#2C3A4F`. The brief was "actually delineate the rows at a glance"; if they now read as too heavy, drop the row divider to 1px before changing the colour.
   - ~~**Mobile stacking** at ≤768px, and whether the 2px divider is enough to separate incidents once the columns are stacked.~~ — **it was not**, confirmed on-device and addressed 2026-08-10 (`d677276`): the internal rule was removed and the boundary rule went to 3px `#4a5a70` with padding around it. Still worth re-checking that the new weight reads as obvious without being noisy.
   - **A client with many incidents is now a much longer page** — nothing collapses anymore. Worth a look on a phone with a multi-incident client.
   - **The permanent "edit incident" button** appears on every row now rather than only on an expanded one. Check it doesn't read as clutter at a glance.

3. **The phone pass on the Incidents column is still outstanding.** Several 2026-08-10 changes were **specified as desktop work but implemented as base rules**, so they reach mobile as a side effect. The `@media (max-width: 768px)` block itself was edited only twice all session, both times deliberately and both recorded in their own entries (the `.headerCaseList > div` → `descendant` selector fix, and the separator rework). **The full list of desktop-intent changes that landed at both breakpoints:**

   | Change | Rule | Mobile impact to check |
   |---|---|---|
   | Date + location recoloured `#c8d0dc`, `line-height: 1.25` | `.incidentDateLine`, `.incidentLocLine` | Cosmetic; almost certainly fine |
   | Bond/affidavit on one line, release status restored | JSX + `.incidentCaseMeta` | Longer string in a narrower column — most likely to wrap awkwardly |
   | `.affidavitTag` green, normal weight | `.affidavitTag` | Cosmetic |
   | Enlarged case-number hit area | `.incidentCaseNum` `padding: 7px 14px 7px 0` + `margin: -7px 0` | **Likeliest to need an override** — 14px of right padding is a bigger share of a narrow column |
   | Bond line made clickable | `.incidentCaseMeta` `cursor: pointer` + tap handlers | Behaviour improves on touch; no layout effect |
   | `charge_abbrev` on the case line | `.incidentCaseAbbrev` | Adds width to a line that is already the widest; wrap risk |
   | "edit incident" inline, `font-size: 11px` | `.incidentEditBtn` | Was `0.7em`; the absolute value now applies at both breakpoints |
   | Description `line-height: 1.4` | `.incidentDescText` | Cosmetic |
   | "+ add a case" unbolded | `.incidentAddCaseBtn` | Explicitly requested at both breakpoints — not a side effect |
   | Custody badge `align-self: start` + `margin-top: 9px` | `.badgeStack` | Explicitly requested at both breakpoints — not a side effect |

   The **column widening is NOT on this list**: `grid-template-columns` is overridden to a single column inside the mobile block, so that base change cannot reach it.

4. ~~**`cases.release_status` is no longer shown anywhere in `ClientFile`** as of `cc66ba3`.~~ — **RESOLVED 2026-08-10**, commit `8d51a54`. Restored to the incidents case line via `bondReleaseText()`, composed the way `bondStatusText()` did it, with the affidavit appended.

5. **Same-incident bracket: the client-list case list can interleave.** `toRowProps` sorts the flat case list purely on the numeric part of the case number with no incident component, so two cases from one incident are not guaranteed to be adjacent. Brackets there are drawn only for groups that land contiguously; a split group is silently skipped. **If a bracket you expect to see is missing in the client list, this is why** — it is not a rendering bug. The fix, if it ever matters, is a secondary sort key on `incident_id`, which would change the case display order and so was not done unilaterally.

6. ~~**The header case mini-list has no bracket.**~~ — **RESOLVED 2026-08-10**, commit `bb1ef7b`. `overflow: hidden` was kept (it is load-bearing); the bracket is drawn inside a new 9px `padding-left`, which survives the clip because `overflow` clips at the padding box, and an equal `-9px` `margin-left` keeps the content position pixel-identical at both breakpoints. The Incidents-column bracket was removed in the same commit — that had been the wrong target.

3. **A numberless case is addressed by its `id`, so the new case's URL is a UUID.** Existing, documented behavior (2026-07-28) rather than anything new here, but it is now the *common* case rather than an edge case — every affidavit-first case starts numberless. Tapping the "Case # pending" row resolves through `CaseView`'s primary-key fallback.

4. **Re-uploading an affidavit to a case that has since been given a number leaves the old object orphaned in Storage.** Pre-existing app-wide behavior (the path is derived from `case_number || id` at upload time and never rewritten), not introduced by this flow, and not worth fixing at current volume — noted so it isn't rediscovered as a bug.

### Open Items — from 2026-08-09

1. ~~**`incidents.location` can only be set when the incident is created.**~~ — **RESOLVED 2026-08-09**, same day. Location is now a third field in the inline "edit incident" flow, written through the same Dexie + sync-queue UPDATE as the description and date, and settable whether or not it was filled in at creation.

2. **The affiant auto-text is add-form only, by design.** Changing an existing incident's date never rewrites its description. Do not "fix" this — retroactively rewriting a description the user has lived with is the more destructive behavior.

3. ~~**The single-client header mini-list squeezes the name column on a narrow phone.** It shows the full `charge` inside a middle grid track capped at 50% of the row… lower the cap if it reads badly.~~ — **RESOLVED 2026-08-09**, same day, and **not** by tuning the cap. The centered middle track is gone on mobile entirely: the row drops to two columns and the mini-list renders left-aligned in the left text stack under "Total Bond", so it no longer competes with the name block for horizontal room. Desktop keeps the centered grid. See the "Mobile Layout Fix" entry under Completed Features.

4. **The mobile mini-list layout has not been seen on a real device.** It builds and lints clean and the CSS reasoning is recorded in full, but the intended check — production, narrow mobile width, a multi-case client such as Causey or Wilborn — **was not completed before the session ended**. Specifically worth eyeballing: that the mini-list really does sit flush left under "Total Bond" (not indented or centered), that the custody badge has not moved vertically now that it spans two grid rows, and that the tightened line spacing reads as intentional rather than cramped.

   > **Code audit 2026-08-10 (still not an on-device check).** The rules were re-read against each other and the flush-left half holds up structurally: the mobile `.headerCaseList` overrides the base `justify-self: center` with `justify-self: start` in `grid-column: 1`, the same column `.nameRowLeft` stretches across, and the borrowed `.caseNum` is `text-align: left` with `width: max-content` on mobile (not the desktop fixed 56px), so the case-number *text* starts on the same x as the name/OCA/bond lines rather than inside a padded box. Specificity holds independent of bundle order (`.headerCaseList > div` at 0,1,1 beats `.caseTableRow` at 0,1,0).
   >
   > **One prediction to check rather than assume: the badge will sit lower than it used to.** `grid-row: 1 / span 2` plus the row's `align-items: center` centers it against name-block **+** mini-list, where before the mini-list shared row 1. Relative to the row that is unchanged and correct; relative to the **name** the badge drops by roughly half the mini-list's height on any multi-case client (a client with no cases is pixel-identical to before). That is the designed consequence of the two-row layout, not a regression — but it is a judgment call about whether it looks right, and only the device can settle it.

### Open Items — carried forward from 2026-07-28

Things explicitly identified and **not** done. Rough priority order.

1. ~~`EditClient.jsx` still reads from Supabase, not Dexie — the last remaining offline gap.~~ — **RESOLVED 2026-07-28.** [`EditClient.jsx`](src/pages/EditClient.jsx) now loads the client via `useLiveQuery(() => db.clients.get(id), [id])`, matching `useClientFile`. A `useEffect` populates the form **once** from the first non-`undefined` live value (`setForm(prev => prev ?? {...})`) so a later background-sync update to the same client can't stomp an in-progress edit; `liveClient === null` still surfaces "Client not found." Save path unchanged — writes still go to Dexie + `addToSyncQueue`, which pushes to Supabase. Editing a client now works offline. **New eslint error** (18 → 19): `react-hooks/set-state-in-effect` on the populate effect — the exact same rule already present at [`CaseView.jsx:146`](src/pages/CaseView.jsx:146) for its analogous `liveData` sync effect, not a new class of problem.

2. **`src/seed.js` is broken and carries a duplicate credential.** → **Promoted to [D1](#d1-srcseedjs--broken-and-carries-a-second-copy-of-the-supabase-anon-key) in the DEFERRED section (2026-08-10)**, where the duplicate-anon-key problem is spelled out as the reason it matters. Still unresolved; still a pending repair-or-delete decision.

3. ~~**Out-of-custody preliminary-hearing countdown is not implemented.**~~ — **MOOT as of 2026-08-10: the entire prelim countdown was removed**, so neither branch exists now. The Rule 5 research (including the 30-day out-of-custody period, the misdemeanor-coverage caveat and the Rule 45 holiday simplification) is **deliberately retained** under Known Issues for a future rebuild, and `booking_date`/`booking_time` were kept so a rebuild needs no data work.

4. **Still NOT NULL, still required by design — do not remove these guards without a migration.** `clients.first_name`, `clients.last_name`, `hours.entry_date`, `hours.hours`, `hours.description`, `courtroom_documents.name`, `courtroom_documents.file_url`. Removing client-side validation on any of these would let the Dexie write succeed and the background Supabase sync **fail silently**, which is worse than the validation message.

5. **Uploads are slower now, by design.** PDF text extraction is `await`ed before the upload handler returns, so "Uploading…" / "Saving…" stays up until the text is persisted. **That delay is the fix** — it is exactly the window that was previously losing data — so do not "optimize" it back into a fire-and-forget call. **The open question** — whether to surface a distinct "Extracting text…" state — is **promoted to D2 in the DEFERRED section (2026-08-10)**, where it now matters more because affidavit upload creates the incident and case.

### Known Issues / Things to Revisit
- **Preliminary-hearing countdown — ⚠️ THE FEATURE WAS REMOVED 2026-08-10.** Everything below is **retained deliberately as reference for a possible future rebuild**, not as a description of live behavior. `clients.booking_date` / `clients.booking_time` still exist and are still captured by the New/Edit Client forms, so a rebuild starts with data already in hand. Read this section before rebuilding. The 14-day figure was re-verified against Tenn. R. Crim. P. 5 on 2026-07-23 and is CURRENT. Rule 5 was amended in 2018, raising the in-custody period from 10 days to 14; many practitioners and secondary sources still say "the ten-day rule," which is the pre-2018 version. **Do not "correct" 14 back to 10.** Known gaps in the current implementation, in rough priority order:
  - **Only the in-custody branch is implemented.** Rule 5 also sets a 30-day period for defendants released from custody. The tool shows nothing for out-of-custody clients, who still have a deadline.
  - **The tool implicitly treats this as a felony-only rule. It isn't.** Rule 5 applies the same scheduling requirement to misdemeanors of greater magnitude than a small offense, unless the defendant expressly waives the right to a jury trial and to prosecution by indictment or presentment. A portion of the General Sessions misdemeanor docket is already covered and the tool doesn't distinguish.
  - **Booking date is a proxy for the initial appearance before the magistrate.** Sound in Davidson County, where commissioner review happens at booking. May not hold in other counties (e.g. Rutherford) if the app is ever used there.
  - **Rule 45 holidays are deliberately not applied** — weekend-only rollover. Known simplification; may under- or over-state the cutoff around court holidays.
  - **A misdemeanor TRIAL countdown cannot be built on this model.** Tennessee has no fixed statutory speedy-trial clock analogous to the federal Speedy Trial Act; misdemeanor trial timing is governed by the constitutional speedy-trial right under the Barker v. Wingo balancing factors plus Rule 48(b) discretionary dismissal. There is no date to count down to. If this is built later, the right shape is an ELAPSED-days-since-booking counter with a color threshold flagging cases drifting into viable speedy-trial territory — a judgment prompt, not a deadline.
  - **Verify against primary authority (tncourts.gov) before relying on any of this in practice.** The countdown is a scheduling convenience, not legal advice, and should not be treated as authoritative.
- ~~Incident date sorting uses `new Date(incident_date)` which is fragile for non-standard date strings~~ — **RESOLVED 2026-07-28.** Replaced with `compareIncidentsByDate()`, which sorts on the parsed numeric key from the existing `dateKey()` helper (never `new Date()`, never string compare) and pushes missing/unparseable dates to the end instead of producing `NaN` comparisons. Order also flipped to oldest-first. See the 2026-07-28 feature entry.
- ~~**The Next Event Reason `<select>` does not preserve an off-list stored value, and at least one exists.**~~ — **FIXED 2026-08-20.** `REASON_OPTIONS` now gets the same guard `TIME_OPTIONS` has: an off-list stored value is kept as an extra option at the top of the list rather than rendering the select blank. See the 2026-08-20 entry for the detail, including the note that **the one live off-list row this was written about no longer exists** — every `next_events.reason` row now holds a listed value.
- **`extractPdfText.js` loads its pdfjs worker from `unpkg.com`, so text extraction requires network access** — an offline upload stores the PDF and the record but extracts no text. **Accepted, not a bug:** all uploads happen on a stable connection. Do not "fix" by bundling the worker.
- No pagination — all clients/cases load at once; fine for current scale
- **`fullSync` uses `select('*')`**, which has a default 1,000-row ceiling in `supabase-js`. Fine at current scale (as of 2026-07-28: 20 clients / 22 incidents / 34 cases / **166 hours** — `hours` is the fastest-growing table and the one that will hit the ceiling first); revisit before any large growth.
- **Successful-but-empty fetch clears the table** — in `fullSync`, a clean response with `error` null and `data` `[]` still clears the corresponding Dexie table by design, to propagate cross-device deletions. Correct for current single-user use; worth knowing.
- **NULL `warrant_text` — current picture as of 2026-08-20.** Supersedes both the 2026-06-17 figure ("2") and the 2026-07-28 triage ("4"). **10 cases have a warrant PDF on file with NULL `warrant_text`.** All 10 are **permanently unrecoverable without a proper OCR step, which the app does not have** — re-uploading them will not help.

  | Status | Count | Cases |
  |---|---|---|
  | **Confirmed scans** (visually verified) | 6 | GS1041481, GS1093939, SCE322490, SU26540 *(confirmed 2026-07-28)* · GS1121356 (Francis Walker), SCE439421 (Logan Womack) *(confirmed 2026-08-20)* |
  | **Presumed scans** (file size only, **not** visually confirmed) | 4 | SC1169003, SCE329135, SCE432766, SCE440096 |

  ⚠️ **The file-size heuristic is a hint, not a rule.** The 2–3.7 MB range does correlate with scans, and the 4 presumed rows sit in it — but **GS1121356 is only ~74 KB and is still a confirmed scan**, which is exactly the small-file profile that predicted *recoverable* text for GS1115757 and GS1116065 in July. Size can suggest where to look; only opening the file settles it. The 4 presumed rows have not been visually checked.

  > **Why some scanned PDFs extract cleanly anyway** (e.g. SU27038, confirmed 2026-08-20): **`extractPdfText` reads whatever text layer already exists in the PDF — it does not run OCR.** A scan that was OCR'd *upstream*, by the scanning device or an e-filing system, carries an invisible text layer and extracts normally even though it displays as an image. A scan with no such layer returns NULL **every time, regardless of file size or how many times it is re-uploaded**. "It's a scan" and "it has no text" are therefore two different facts, and only the second one causes a NULL.

- **Other NULL text columns (2026-06-17, unchanged):** `clients`: 1 client with NULL `criminal_history_text` but no PDF uploaded (no action needed); `courtroom_documents`: 0 documents uploaded (no action needed)
- ~~Sync status indicator hidden on iPhone PWA~~ — fixed 2026-06-17: `padding-top: env(safe-area-inset-top, 0px)` added to `.screen` in `ClientList.module.css`; falls back to `0px` on desktop/non-notch devices.
- ~~`.relievedBadge` and `.relievedLabel` CSS classes in `ClientRow.module.css` are dead~~ — removed 2026-06-17
- **Leaked Password Protection Disabled** — low-severity advisory in Supabase Auth settings; not yet addressed; can be toggled on in the Supabase dashboard under Auth → Settings whenever ready
- **RLS policies are role-scoped, not user-scoped.** All 7 tables allow full access to any authenticated user. Safe only while self-signup is disabled and a single account exists — **self-signup is confirmed DISABLED as of 2026-07-23** (Auth → Sign In / Providers), so the single-account precondition is actively enforced, not merely assumed (see Supabase Project → Auth). Must be rewritten to `auth.uid()`-scoped policies before any second user or external sharing.
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
- `cases` (11 total): 3 rows have NULL `warrant_text`; 2 of those have a `warrant_url` — subsequently confirmed (2026-06-17 follow-up) to be scanned/non-OCR'd PDFs with no embedded text layer; `pdfjs-dist` cannot extract text from these; NULL is permanent expected state. 1 NULL row has no PDF and requires no action. **⚠️ Historical snapshot — do not read the "2" as current.** The table has since grown and the 2026-07-28 triage found 4 confirmed scans; more importantly, most later NULLs were caused by the extraction bug, not by scanning. **Current count is 10 — see the NULL `warrant_text` triage table under Known Issues, which supersedes both this and the 2026-07-28 figure.**
- `clients` (5 total): 1 row has NULL `criminal_history_text` but also has no `criminal_history_url` — no PDF on file, nothing to re-upload
- `courtroom_documents` (0 total): no documents uploaded yet; no action needed

**Sync status indicator hidden on iPhone PWA:**
- Root cause identified: no `env(safe-area-inset-top)` applied on `.screen` or `.topBar`. On iPhone X+ in standalone PWA mode, the device status bar/notch covers the top ~47px of the viewport. The sign-out button and sync bar both render at approximately y=10–55px from the page top, putting the sync bar entirely behind the covered zone. The "Clients" header starts at ~55px and clears the notch — which is why everything else appears correct. The sync bar is rendered and present in the DOM; it is simply visually obscured by iOS chrome. Suggested fix (not applied): add `padding-top: env(safe-area-inset-top, 0px)` to `.screen` in `ClientList.module.css`.

### RLS / Credentials Assessment (no changes made)

> ⚠️ **The "RLS disabled" finding below was SUPERSEDED the same day (2026-06-17).** RLS is now **enabled on all 7 tables** with an "authenticated users only" policy — see "RLS Enabled on All Tables (2026-06-17)" and "RLS Security Fix (2026-06-17)" for the actual state. The paragraph is retained struck-through for history only; **do not read it as a live finding.**

**~~RLS disabled:~~** ~~All tables have Row Level Security off. For a single-user local app behind Supabase Auth this is low-risk in practice — the only way to query data is through the Supabase client, which requires the anon key, and in this app there's one authenticated user. The real risk is: (a) if the anon key is ever shared or exposed, anyone can read/write all case data with no row-level check; (b) if Supabase ever adds a multi-user requirement, RLS policies would need to be designed from scratch rather than incrementally. Risk level: **acceptable for current single-user use, but worth enabling before any expansion or external sharing of the URL.**~~

**Hardcoded credentials in `src/supabaseClient.js`:** The Supabase URL and anon key are committed to the repo. The anon key is designed to be public (it is the client-facing key, not the service-role key). Supabase's security model assumes the anon key is visible to users — it is not a secret. The real guard is RLS. **With RLS now enabled on all 7 tables (2026-06-17), the anon key alone no longer grants read/write access — a valid authenticated session is required.** Note, however, that the policies are **role-scoped** (`(select auth.role()) = 'authenticated'`), **not user-scoped**, so **any** authenticated account has full access to all rows. The practical guard is therefore an explicit dependency: **the Supabase project must have self-signup disabled and exactly one user account.** As long as that holds, the anon key in the repo grants nothing without a login. Risk level: **low for current single-account usage; the role-scoped policies must be rewritten to `auth.uid()`-scoped before any second user or external sharing (see Known Issues).**

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
