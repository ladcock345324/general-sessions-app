import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useLiveQuery } from 'dexie-react-hooks'
import { useClientFile } from '../hooks/useClientFile'
import { extractPdfText } from '../extractPdfText'
import db from '../localDB'
import { addToSyncQueue } from '../syncManager'
import styles from './ClientFile.module.css'
// Borrowed for the header case mini-list so it matches the client list exactly
// (same colors, sizes, and "(CLASSIFICATION)" parenthetical) instead of a
// near-duplicate set of rules that would drift out of sync.
import rowStyles from '../components/ClientRow.module.css'
import { bracketBlocks } from '../caseGrouping'
import TextViewerDrawer from '../components/TextViewerDrawer'
import { toDateInput, fromDateInput, formatDateDisplay, pickerHandlers, todayString, dateKey } from '../dateUtils'
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// ─── Indigent status circle ──────────────────────────────────────────────────

const INDIGENT_CYCLE = { red: 'yellow', yellow: 'green', green: 'gold', gold: 'red' }
const INDIGENT_COLOR = { red: '#b85555', yellow: '#E8913A', green: '#3d9e6a', gold: '#FFD700' }

function IndigentCircle({ clientId, status }) {
  const current = INDIGENT_COLOR[status] ? status : 'red'
  function handleClick(e) {
    e.stopPropagation()
    const next = INDIGENT_CYCLE[current]
    db.clients.update(clientId, { indigent_status: next })
    addToSyncQueue('clients', 'UPDATE', clientId, { id: clientId, indigent_status: next })
  }
  return (
    <div
      onClick={handleClick}
      onPointerDown={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}
      style={{
        width: 28, height: 28, display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
      }}
    >
      <div style={{
        width: 14, height: 14, borderRadius: '50%',
        backgroundColor: INDIGENT_COLOR[current],
        pointerEvents: 'none',
      }} />
    </div>
  )
}

// ─── Tap-safe click helper ───────────────────────────────────────────────────
// Fires `handler` on tap but not on drag (> 5px) or touch long-press (>= 300ms).
// Long-press suppression lets the browser show native text selection on mobile.
function tapHandlers(handler) {
  if (!handler) return {}
  const state = { x: 0, y: 0, t: 0, touch: false }
  return {
    onPointerDown: e => {
      state.x = e.clientX
      state.y = e.clientY
      state.touch = e.pointerType === 'touch'
      state.t = state.touch ? Date.now() : 0
    },
    onPointerUp: e => {
      if (Math.abs(e.clientX - state.x) >= 5 || Math.abs(e.clientY - state.y) >= 5) return
      if (state.touch && Date.now() - state.t >= 300) return
      handler()
    },
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Case-level release condition labels. release_status is independent of the
// client-level custody_status (a case's condition vs. where the client is).
const RELEASE_LABELS = { held_without_bond: 'Held without bond', pretrial_released: 'Pretrial Released', ror: "ROR'd" }

// Bond + release condition for the incidents case line: "$1,500 Bond", "ROR'd",
// or "$0 Bond · Held without bond". An explicit 0 bond is a real value, so the
// test is `!= null`, not truthiness.
//
// release_status is unset on MOST cases — the client-level custody_status
// already carries that information — so "bond, no release status" is the normal
// case, not an edge case. Joining only the segments that exist is what keeps it
// rendering as a clean "$1,500 Bond" with no dangling "·" and no empty segment.
function bondReleaseText(bondAmount, releaseStatus) {
  const segs = []
  if (bondAmount != null) segs.push(`$${Number(bondAmount).toLocaleString()} Bond`)
  if (releaseStatus && RELEASE_LABELS[releaseStatus]) segs.push(RELEASE_LABELS[releaseStatus])
  return segs.join(' · ')
}

// ─── Next Event block ────────────────────────────────────────────────────────

function NextEventBlock({ event, onEdit }) {
  return (
    <div className={styles.nextEvent}>
      <div className={styles.nextEventTopRow}>
        <span className={styles.nextEventLabel}>Next Event</span>
        {onEdit && <button className={styles.nextEventEditBtn} onClick={onEdit}>{event ? 'Edit' : '+ Add'}</button>}
      </div>
      {event ? (
        <>
          <div className={styles.nextEventDetail}>
            {(() => {
              const d = new Date(event.event_date)
              const day = isNaN(d) ? '' : d.toLocaleDateString('en-US', { weekday: 'long' }) + ' '
              const t = event.event_time
              // The date is optional now that Next Event no longer requires one,
              // so it drops out like every other blank segment instead of leaving
              // a stray pipe behind.
              const dateText = (day + formatDateDisplay(event.event_date)).trim()
              // Line 1: reason | day & date | time. Blank segments drop out with
              // their separator (no leading/doubled pipes) — reason is the common
              // blank case and is now the first segment.
              const parts = [
                ...(event.reason ? [event.reason] : []),
                ...(dateText ? [dateText] : []),
                ...(t && /\d:\d{2}\s*(AM|PM)/i.test(t) ? [t] : []),
              ]
              return parts.map((p, i) => (
                <span key={i}>{i > 0 && <span className={styles.pipe}>|</span>}{p}</span>
              ))
            })()}
          </div>
          <div className={styles.nextEventMeta}>
            {(() => {
              // Line 2: docket type | "Courtroom" + number | judge | ADA.
              const segments = [
                ...(event.docket_type ? [event.docket_type] : []),
                ...(event.courtroom ? [`Courtroom ${event.courtroom}`] : []),
                ...(event.judge ? [event.judge] : []),
                ...(event.ada_name ? [`ADA: ${event.ada_name}`] : []),
              ]
              return segments.map((s, i) => (
                <span key={i}>{i > 0 && <span className={styles.pipe}>|</span>}{s}</span>
              ))
            })()}
          </div>
        </>
      ) : (
        <div className={styles.nextEventEmpty}>No upcoming event</div>
      )}
    </div>
  )
}

// ─── Next Event form ─────────────────────────────────────────────────────────

const DOCKET_PRESETS = ['Jail Docket', 'Bond Docket', 'Review Docket', 'Settlement Docket', 'Criminal Court', 'PV']

// docket_type is one column but edited as a preset <select> + optional append text.
// Split a stored value back into { docketPreset, docketCustom }: if it begins with
// a known preset, peel that off; otherwise treat the whole string as custom.
function splitDocketType(stored) {
  const s = (stored ?? '').trim()
  if (!s) return { docketPreset: '', docketCustom: '' }
  const preset = DOCKET_PRESETS.find(p => s === p || s.startsWith(p + ' '))
  if (preset) return { docketPreset: preset, docketCustom: s.slice(preset.length).trim() }
  return { docketPreset: '', docketCustom: s }
}

// No ada_name key: the Assistant DA Name input was removed from the form
// 2026-08-19. next_events.ada_name is still a live column — it is displayed on
// line 2 of the single-client blue block — so the form deliberately neither
// holds nor writes it, leaving whatever is already stored untouched.
const EMPTY_EVENT = { docketPreset: 'Jail Docket', docketCustom: '', reason: '', event_date: '', event_time: '9:00 AM', courtroom: '', judge: '' }

const COURTROOMS = ['', '3A', '3B', '3C', '4B', '4C', '4D', '5C', '5D', '6A', '6B', '6C', '6D']

const JUDGES = [
  '',
  'J. Bell',
  'R. Bell',
  'M. Blackburn',
  'S. Coleman',
  'A. Escobar',
  'R. Hayes (PRESIDING)',
  'A. Holt',
  'L. Jones',
  'M. Floyd',
  'G. Robinson',
  'A. Walker',
  'Other',
]

// Event time is a dropdown rather than free entry, covering 8:00 AM → 3:00 PM
// inclusive — the span the docket actually runs. 15-minute increments, except
// the 8, 9 and 10 o'clock hours, which step by 5: those are the docket-call
// hours that need the finer granularity. 53 options, listed chronologically.
const HOUR_SLOTS = [
  [8, 'AM'], [9, 'AM'], [10, 'AM'], [11, 'AM'],
  [12, 'PM'], [1, 'PM'], [2, 'PM'], [3, 'PM'],
]
const FINE_HOURS = [8, 9, 10]

// Emits "h:MM AM/PM" — byte-identical to the format next_events.event_time
// already holds (e.g. "9:05 AM"), so existing records keep displaying correctly.
const TIME_OPTIONS = HOUR_SLOTS.flatMap(([h, period]) => {
  // 3 PM closes the window: the :00 slot only, nothing later.
  if (h === 3 && period === 'PM') return ['3:00 PM']
  const step = FINE_HOURS.includes(h) ? 5 : 15
  const slots = []
  for (let m = 0; m < 60; m += step) {
    slots.push(`${h}:${String(m).padStart(2, '0')} ${period}`)
  }
  return slots
})

function NextEventForm({ clientId, existing, onSaved, onCancel, onCleared }) {
  const existingJudge = existing?.judge ?? ''
  const judgeInList = JUDGES.includes(existingJudge)

  const [form, setForm] = useState(
    existing
      ? {
          ...splitDocketType(existing.docket_type),
          reason:      existing.reason ?? '',
          event_date:  existing.event_date,
          event_time:  existing.event_time,
          courtroom:   existing.courtroom,
          judge:       judgeInList ? existingJudge : 'Other',
          judgeOther:  judgeInList ? '' : existingJudge,
        }
      : { ...EMPTY_EVENT, judgeOther: '' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  // A stored time that isn't on the increment list (legacy or hand-entered, e.g.
  // "9:07 AM") is kept as an extra option rather than silently blanked on edit.
  // It drops off once the user picks a listed value.
  const storedTime = form.event_time ?? ''
  const timeOptions = storedTime && !TIME_OPTIONS.includes(storedTime)
    ? [storedTime, ...TIME_OPTIONS]
    : TIME_OPTIONS

  async function clear() {
    setSaving(true)
    setError(null)
    if (existing?.id) {
      await db.next_events.delete(existing.id)
      await addToSyncQueue('next_events', 'DELETE', existing.id, { id: existing.id })
    } else {
      await db.next_events.where('client_id').equals(clientId).delete()
    }
    onCleared()
  }

  async function save() {
    setSaving(true)
    setError(null)

    // `rest` carries no ada_name — the key is absent from form state entirely, so
    // neither the Dexie write nor the sync-queue payload mentions it. Editing an
    // event therefore leaves an existing ada_name alone instead of nulling it out.
    const { judgeOther, docketPreset, docketCustom, ...rest } = form
    const payload = {
      ...rest,
      docket_type: [docketPreset, docketCustom].filter(Boolean).join(' ').trim() || null,
      judge: form.judge === 'Other' ? judgeOther.trim() : form.judge,
    }

    if (existing) {
      await db.next_events.update(existing.id, payload)
      await addToSyncQueue('next_events', 'UPDATE', existing.id, { id: existing.id, client_id: clientId, ...payload })
    } else {
      const newId = crypto.randomUUID()
      const record = { id: newId, client_id: clientId, ...payload }
      await db.next_events.put(record)
      await addToSyncQueue('next_events', 'INSERT', newId, record)
    }
    onSaved()
  }

  return (
    <div className={styles.inlineForm}>
      <div className={styles.nextEventTopRow}>
        <span className={styles.nextEventLabel}>Next Event</span>
        <button className={styles.nextEventEditBtn} onClick={onCancel} disabled={saving}>Close</button>
      </div>
      {/* Field order (2026-08-19): Date + Time, Judge, Courtroom, Docket Type +
          Reason, Add'l Text. FORM ONLY — the display order in the blue block
          above and in the client list row is deliberately different and was not
          touched. The "Assistant DA Name" input was removed in the same change;
          next_events.ada_name is still displayed on line 2 of the blue block,
          and save() no longer sends the key at all so existing values survive. */}
      <div className={styles.formTwoCol}>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Date</label>
          <input
            type="date"
            className={styles.formInput}
            value={toDateInput(form.event_date)}
            onChange={e => set('event_date', fromDateInput(e.target.value))}
            {...pickerHandlers()}
          />
        </div>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Time</label>
          <select className={styles.formSelect} value={form.event_time ?? ''} onChange={e => set('event_time', e.target.value)}>
            <option value="">—</option>
            {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Judge</label>
        <select className={styles.formSelect} value={form.judge} onChange={e => set('judge', e.target.value)}>
          {JUDGES.map(j => <option key={j} value={j}>{j || '—'}</option>)}
        </select>
        {form.judge === 'Other' && (
          <input
            className={styles.formInput}
            style={{ marginTop: 6 }}
            value={form.judgeOther}
            onChange={e => set('judgeOther', e.target.value)}
            placeholder="Enter judge name"
            autoFocus
          />
        )}
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Courtroom</label>
        <select className={styles.formSelect} value={form.courtroom} onChange={e => set('courtroom', e.target.value)}>
          {COURTROOMS.map(c => <option key={c} value={c}>{c || '—'}</option>)}
        </select>
      </div>
      <div className={styles.formTwoCol}>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Docket Type</label>
          <select className={styles.formSelect} value={form.docketPreset} onChange={e => set('docketPreset', e.target.value)}>
            <option value="">—</option>
            {DOCKET_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Reason</label>
          <select className={styles.formSelect} value={form.reason} onChange={e => set('reason', e.target.value)}>
            <option value="">—</option>
            <option>Review</option>
            <option>Trial</option>
            <option>Settlement</option>
            <option>Discussion</option>
            <option>PV Hearing</option>
          </select>
        </div>
      </div>
      {/* Still the same docketCustom field, still combined into the single
          docket_type column on save — only lifted out of the Docket Type cell
          into its own full-width row at the bottom of the form. */}
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Add&apos;l Text</label>
        <input
          className={styles.formInput}
          value={form.docketCustom}
          onChange={e => set('docketCustom', e.target.value)}
          placeholder="Add'l text (optional)"
        />
      </div>
      {error && <div className={styles.formError}>{error}</div>}
      <div className={styles.formActions}>
        <button className={styles.formSave} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className={styles.formCancel} onClick={onCancel} disabled={saving}>Close</button>
        {existing && <button className={styles.formClear} onClick={clear} disabled={saving}>Clear</button>}
      </div>
    </div>
  )
}

// ─── Add Incident form ────────────────────────────────────────────────────────

// Opening clause auto-inserted into the Add Incident description when a date is
// picked. Kept as a pure function of the date so the "has the user typed past
// the template?" check below is an exact string comparison, not a heuristic.
function affiantTemplate(mdy) {
  return `The affiant believes that on ${formatDateDisplay(mdy)},`
}

function AddIncidentForm({ clientId, onSaved, onCancel }) {
  // is_pv / case_number / the four pv_* fields drive the probation-violation
  // branch. A PV
  // is not an incident that later grows cases — it is one incident and one case
  // created together, which is why the entry point lives here rather than in the
  // per-incident "+ add a case" form (where it was first built, 2026-08-19, and
  // from which it was removed the same day: that flow left a blank "Awaiting
  // details" incident wrapped around an otherwise-clean PV case).
  const [form, setForm] = useState({
    incident_date: '', location: '', incident_description: '',
    is_pv: false, case_number: '',
    // The four PV detail columns (2026-08-20). These replaced pv_sentence, which
    // is deprecated — kept in the DB but never read or written, the same pattern
    // as clients.age and clients.bond_amount.
    pv_conviction_date: '', pv_crime: '', pv_probation_length: '', pv_special_info: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  // Picking a date seeds the description with the affiant clause, but must never
  // clobber real typing. It only writes when the description is empty or still
  // exactly equals the template built from the PREVIOUS date — i.e. the user has
  // not typed past the auto-inserted prefix yet. The moment they add anything of
  // their own, the equality fails and later date changes leave the text alone.
  // Add-form only; editing an existing incident's date never triggers this.
  function setIncidentDate(mdy) {
    setForm(f => {
      const wasTemplate = f.incident_date !== '' && f.incident_description === affiantTemplate(f.incident_date)
      const canFill = f.incident_description === '' || wasTemplate
      if (!canFill) return { ...f, incident_date: mdy }
      // Clearing the date back out removes a description that was purely template.
      return { ...f, incident_date: mdy, incident_description: mdy ? affiantTemplate(mdy) : '' }
    })
  }

  // Probation violation: one incident + its single case, created together in one
  // action. Modeled directly on AffidavitFirstUpload's two-row creation, and it
  // inherits that flow's ordering rule — the incident is enqueued BEFORE the
  // case, so the FIFO sync queue can never push a cases row whose incident_id FK
  // has not landed on the server yet. Both rows go Dexie → addToSyncQueue; never
  // a direct Supabase write.
  async function savePv() {
    setSaving(true)
    setError(null)

    const incidentId = crypto.randomUUID()
    // A PV incident has no date, location or description by construction — those
    // are the three fields the form hides. is_pv is what the Incidents section
    // reads to skip rendering them (and the "Awaiting details" placeholder).
    const incidentRecord = {
      id: incidentId,
      client_id: clientId,
      incident_date: null,
      location: null,
      incident_description: null,
      is_pv: true,
    }
    await db.incidents.put(incidentRecord)
    await addToSyncQueue('incidents', 'INSERT', incidentId, incidentRecord)

    // Identical field population to what the old AddCaseForm PV checkbox wrote —
    // only the trigger moved. The charge/bond columns are explicit nulls rather
    // than omitted, so the record shape matches a normal case exactly. `status`
    // IS sent here (unlike the normal case insert, which lets Postgres default
    // it) so the local Dexie row is correct before the next fullSync, not only
    // after it.
    const caseId = crypto.randomUUID()
    const caseRecord = {
      id: caseId,
      incident_id: incidentId,
      case_number: form.case_number.trim() || null,
      charge: null,
      charge_abbrev: null,
      classification: null,
      bond_amount: null,
      release_status: null,
      status: 'open',
      is_pv: true,
      // Every field is optional — validation was removed app-wide for this kind
      // of field, so a blank saves as null rather than ''. pv_sentence is
      // deliberately NOT written: deprecated 2026-08-20, replaced by these four.
      pv_conviction_date: form.pv_conviction_date.trim() || null,
      pv_crime: form.pv_crime.trim() || null,
      pv_probation_length: form.pv_probation_length.trim() || null,
      pv_special_info: form.pv_special_info.trim() || null,
    }
    await db.cases.put(caseRecord)
    await addToSyncQueue('cases', 'INSERT', caseId, caseRecord)

    onSaved()
  }

  async function save() {
    if (form.is_pv) return savePv()
    // All three fields are nullable in Postgres (incident_date became nullable
    // 2026-07-28, location was added nullable), so none is required — a blank
    // saves as null, not ''.
    setSaving(true)
    setError(null)
    const newId = crypto.randomUUID()
    // is_pv is deliberately NOT sent on the normal path: the column is NOT NULL
    // DEFAULT false, and leaving it off keeps all three incident-creation paths
    // (here, affidavit-first, and this form's PV branch writing it explicitly)
    // consistent with how they behaved before PV existed.
    const record = {
      id: newId,
      client_id: clientId,
      incident_description: form.incident_description.trim() || null,
      incident_date: form.incident_date.trim() || null,
      location: form.location.trim() || null,
    }
    await db.incidents.put(record)
    await addToSyncQueue('incidents', 'INSERT', newId, record)
    onSaved()
  }

  return (
    <div className={styles.inlineForm}>
      {/* Top-right, above every field: it decides which form you are filling in,
          so it has to be read before anything below it. Checked, Date/Location/
          Description are replaced by Case Number + Sentence — a PV has no
          incident narrative to record. The hidden fields keep their state, so
          unchecking restores anything already typed; only the save branch
          decides what is actually written. */}
      <label className={`${styles.formCheckRow} ${styles.formCheckRowEnd}`}>
        <input
          type="checkbox"
          className={styles.formCheckbox}
          checked={form.is_pv}
          onChange={e => set('is_pv', e.target.checked)}
        />
        <span className={styles.formCheckLabel}>Probation Violation</span>
      </label>
      {form.is_pv ? (
        <>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Case Number</label>
            <input className={styles.formInput} value={form.case_number} onChange={e => set('case_number', e.target.value)} placeholder="e.g. GS1041482" />
          </div>
          {/* Conviction Date uses the same <input type="date"> + toDateInput /
              fromDateInput + pickerHandlers() convention as every other date
              field in the app, so it stores "M/D/YYYY" like the rest. */}
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Conviction Date</label>
            <input
              type="date"
              className={styles.formInput}
              value={toDateInput(form.pv_conviction_date)}
              onChange={e => set('pv_conviction_date', fromDateInput(e.target.value))}
              {...pickerHandlers()}
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Crime</label>
            <input className={styles.formInput} value={form.pv_crime} onChange={e => set('pv_crime', e.target.value)} placeholder="e.g. DUI (MIS)" />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Probation Length</label>
            <input className={styles.formInput} value={form.pv_probation_length} onChange={e => set('pv_probation_length', e.target.value)} placeholder="e.g. 11 months 29 days" />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Special Info</label>
            <input className={styles.formInput} value={form.pv_special_info} onChange={e => set('pv_special_info', e.target.value)} placeholder="Optional — probation conditions / notes" />
          </div>
        </>
      ) : (
        <>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Date</label>
            <input
              type="date"
              className={styles.formInput}
              value={toDateInput(form.incident_date)}
              onChange={e => setIncidentDate(fromDateInput(e.target.value))}
              {...pickerHandlers()}
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Location</label>
            <input className={styles.formInput} value={form.location} onChange={e => set('location', e.target.value)} placeholder="Optional" />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Description</label>
            <input className={styles.formInput} value={form.incident_description} onChange={e => set('incident_description', e.target.value)} placeholder="e.g. Watch Theft Incident" />
          </div>
        </>
      )}
      {error && <div className={styles.formError}>{error}</div>}
      <div className={styles.formActions}>
        <button className={styles.formSave} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className={styles.formCancel} onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  )
}

// ─── Add Case form (under a specific incident) ────────────────────────────────

// Charge classification, most-serious → least-serious. Blank = unset (stored
// null) and stays first — it's the placeholder, not a severity level.
// Kept byte-identical to the copy in CaseView.jsx.
const CLASSIFICATIONS = ['', 'CAPITAL', 'A FEL', 'B FEL', 'C FEL', 'D FEL', 'E FEL', 'A MIS', 'B MIS', 'C MIS', 'MIS']

const EMPTY_CASE = { case_number: '', charge: '', charge_abbrev: '', classification: '', bond_amount: '', release_status: '' }

function AddCaseForm({ incidentId, onSaved, onCancel }) {
  const [form, setForm] = useState(EMPTY_CASE)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    // case_number and charge became nullable 2026-07-28 — neither is required,
    // and a blank field saves as null rather than ''.
    setSaving(true)
    setError(null)
    const newId = crypto.randomUUID()
    const record = {
      id: newId,
      incident_id: incidentId,
      case_number: form.case_number.trim() || null,
      charge: form.charge.trim() || null,
      charge_abbrev: form.charge_abbrev.trim() || null,
      classification: form.classification || null,
      bond_amount: form.bond_amount ? Number(form.bond_amount) : null,
      release_status: form.release_status || null,
    }
    await db.cases.put(record)
    await addToSyncQueue('cases', 'INSERT', newId, record)
    onSaved()
  }

  return (
    <div className={styles.inlineForm}>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Case Number</label>
        <input className={styles.formInput} value={form.case_number} onChange={e => set('case_number', e.target.value)} placeholder="e.g. GS1041482" />
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Charge</label>
        <input className={styles.formInput} value={form.charge} onChange={e => set('charge', e.target.value)} placeholder="e.g. Vandalism" />
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Abbrev. (for client list)</label>
        <input className={styles.formInput} value={form.charge_abbrev} onChange={e => set('charge_abbrev', e.target.value)} placeholder="Optional" />
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Classification</label>
        <select className={styles.formSelect} value={form.classification} onChange={e => set('classification', e.target.value)}>
          {CLASSIFICATIONS.map(c => <option key={c} value={c}>{c || '—'}</option>)}
        </select>
      </div>
      <div className={styles.formTwoCol}>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Bond Amount</label>
          <div className={styles.formPrefixInput}>
            <span className={styles.formPrefix}>$</span>
            <input className={`${styles.formInput} ${styles.formInputPrefixed}`} type="number" min="0" value={form.bond_amount} onChange={e => set('bond_amount', e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Status</label>
          <select className={styles.formSelect} value={form.release_status} onChange={e => set('release_status', e.target.value)}>
            <option value="">—</option>
            <option value="held_without_bond">Held without bond</option>
            <option value="pretrial_released">Pretrial Released</option>
            <option value="ror">ROR&apos;d</option>
          </select>
        </div>
      </div>
      {error && <div className={styles.formError}>{error}</div>}
      <div className={styles.formActions}>
        <button className={styles.formSave} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className={styles.formCancel} onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  )
}

// ─── Affidavit-first upload ──────────────────────────────────────────────────

// Marker for a record that exists but hasn't been described yet. An affidavit-
// first incident is created with incident_date, location and incident_description
// all null, and its case with a null case_number — without an explicit marker
// both render as an empty strip that reads as a broken row rather than as a
// deliberate "not filled in yet".
const AWAITING_DETAILS = 'Awaiting details'

const NEW_INCIDENT = '__new__'

const BLANK_INCIDENT = '[blank incident]'

// Target-picker label, in strict priority order: location, else the incident
// date, else a blank marker. Location leads because it is what actually
// distinguishes one incident from another when reading an affidavit.
function incidentPickerLabel(incident) {
  const loc = incident.location?.trim()
  if (loc) return loc.length > 60 ? `${loc.slice(0, 60)}…` : loc
  const date = formatDateDisplay(incident.incident_date)
  if (date) return date
  return BLANK_INCIDENT
}

// Several incidents can legitimately land on the same label — most obviously a
// client with more than one location-less, date-less incident, which would give
// a list of identical "[blank incident]" entries. Every option is keyed and
// valued by id so all of them stay selectable regardless, but identical text
// makes them impossible to tell apart, so any repeated label gets a 1-based
// counter. A label that occurs once is left exactly as-is.
function disambiguateLabels(labels) {
  const totals = new Map()
  for (const l of labels) totals.set(l, (totals.get(l) ?? 0) + 1)
  const seen = new Map()
  return labels.map(l => {
    if (totals.get(l) === 1) return l
    const n = (seen.get(l) ?? 0) + 1
    seen.set(l, n)
    return `${l} (${n})`
  })
}

// The affidavit is the source document, so this path runs in the opposite order
// from the rest of the Incidents flow: the PDF comes first and the incident +
// case rows are created FROM it, every descriptive field left null to be filled
// in afterwards from the extracted warrant_text. Which incident the affidavit
// belongs to is always ASKED, never inferred from the file.
function AffidavitFirstUpload({ clientId, incidents }) {
  const [file, setFile] = useState(null)
  const [target, setTarget] = useState(NEW_INCIDENT)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  function handlePick(e) {
    const picked = e.target.files?.[0]
    // Cleared immediately so picking the same file twice still fires onChange.
    e.target.value = ''
    if (!picked) return
    setTarget(NEW_INCIDENT)
    setError(null)
    setFile(picked)
  }

  function cancel() {
    if (uploading) return
    setFile(null)
    setError(null)
  }

  async function confirm() {
    setUploading(true)
    setError(null)

    // Storage upload first, and bail on failure before any row is written: a
    // failed upload must not leave a blank incident and an affidavit-less case
    // behind, which is exactly the confusing state this flow exists to avoid.
    // Same bucket and `warrants/` prefix as CaseView's upload. The case id
    // stands in for the case number in the path — the identical fallback
    // CaseView already applies to a numberless case, so a later "Replace
    // Affidavit" there overwrites this same object rather than orphaning it.
    const caseId = crypto.randomUUID()
    const path = `warrants/${caseId}.pdf`
    const { error: uploadErr } = await supabase.storage
      .from('warrants')
      .upload(path, file, { contentType: 'application/pdf', upsert: true })
    if (uploadErr) { setError(uploadErr.message); setUploading(false); return }

    // Every row goes Dexie → addToSyncQueue, never a direct Supabase write. The
    // incident is enqueued BEFORE the case so the FIFO queue can never push a
    // cases row whose incident_id FK hasn't landed on the server yet.
    let incidentId = target
    if (target === NEW_INCIDENT) {
      const newIncidentId = crypto.randomUUID()
      // All three descriptive columns are nullable; they are deliberately left
      // null here and populated separately from the extracted text.
      const incidentRecord = {
        id: newIncidentId,
        client_id: clientId,
        incident_date: null,
        location: null,
        incident_description: null,
      }
      await db.incidents.put(incidentRecord)
      await addToSyncQueue('incidents', 'INSERT', newIncidentId, incidentRecord)
      incidentId = newIncidentId
    }

    const caseRecord = {
      id: caseId,
      incident_id: incidentId,
      case_number: null,
      charge: null,
      charge_abbrev: null,
      classification: null,
      bond_amount: null,
      release_status: null,
      warrant_url: path,
    }
    await db.cases.put(caseRecord)
    await addToSyncQueue('cases', 'INSERT', caseId, caseRecord)

    // Text extraction — the 2026-07-28 rule verbatim: Dexie then the sync queue,
    // never a direct Supabase call, awaited before this handler returns, and a
    // null result skips the write instead of overwriting. The case row is
    // written above BEFORE extraction runs, so the case survives even when
    // nothing extracts (a scanned affidavit, or the CDN worker unreachable).
    const text = await extractPdfText(file)
    if (text != null) {
      await db.cases.update(caseId, { warrant_text: text })
      await addToSyncQueue('cases', 'UPDATE', caseId, { id: caseId, warrant_text: text })
    } else {
      console.warn('[warrant_text] no text extracted; case created without it')
    }

    setUploading(false)
    setFile(null)
  }

  return (
    <>
      <label className={styles.affidavitUploadBtn}>
        {uploading ? 'uploading…' : 'upload affidavit'}
        <input
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={handlePick}
          disabled={uploading}
        />
      </label>

      {/* A centered modal rather than an inline panel: this component's trigger
          lives inside the section-header flex row, so a panel rendered from here
          would become a child of that row. */}
      {file && (
        <div className={styles.affidavitOverlay} onClick={cancel}>
          <div className={styles.affidavitDialog} onClick={e => e.stopPropagation()}>
            <div className={styles.affidavitDialogTitle}>Which incident?</div>
            <div className={styles.affidavitFileName}>{file.name}</div>
            <div className={styles.formRow}>
              <label className={styles.formLabel}>Incident</label>
              <select
                className={styles.formSelect}
                value={target}
                onChange={e => setTarget(e.target.value)}
                disabled={uploading}
              >
                <option value={NEW_INCIDENT}>New incident</option>
                {disambiguateLabels(incidents.map(incidentPickerLabel)).map((label, i) => (
                  <option key={incidents[i].id} value={incidents[i].id}>{label}</option>
                ))}
              </select>
            </div>
            {error && <div className={styles.formError}>{error}</div>}
            <div className={styles.formActions}>
              <button className={styles.formSave} onClick={confirm} disabled={uploading}>
                {uploading ? 'Uploading…' : 'Create'}
              </button>
              <button className={styles.formCancel} onClick={cancel} disabled={uploading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Incident group ──────────────────────────────────────────────────────────

function IncidentGroup({ incident: initialIncident, onCaseTap, onCaseAdded, onDeleted }) {
  const [incident, setIncident] = useState(initialIncident)
  const [showAddCase, setShowAddCase] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editDesc, setEditDesc] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editLocation, setEditLocation] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const committingRef = useRef(false)

  function startEdit() {
    setEditDesc(incident.incident_description ?? '')
    setEditDate(toDateInput(incident.incident_date ?? ''))
    setEditLocation(incident.location ?? '')
    setEditing(true)
  }

  async function commitEdit() {
    if (committingRef.current) return
    committingRef.current = true
    const newDesc = editDesc.trim()
    const newDate = fromDateInput(editDate)
    const newLocation = editLocation.trim()
    const unchanged = newDesc === (incident.incident_description ?? '') &&
                      newDate === (incident.incident_date ?? '') &&
                      newLocation === (incident.location ?? '')
    // All three columns are nullable, so clearing any of them is a real edit that
    // saves as null — it does not short-circuit out of the commit.
    if (unchanged) {
      setEditing(false)
      committingRef.current = false
      return
    }
    const changes = {
      incident_description: newDesc || null,
      incident_date: newDate || null,
      location: newLocation || null,
    }
    await db.incidents.update(incident.id, changes)
    await addToSyncQueue('incidents', 'UPDATE', incident.id, { id: incident.id, ...changes })
    setIncident(prev => ({ ...prev, ...changes }))
    setEditing(false)
    committingRef.current = false
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitEdit()
    }
    if (e.key === 'Escape') {
      committingRef.current = true
      setEditing(false)
    }
  }

  function onEditContainerBlur(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) commitEdit()
  }

  async function handleDelete() {
    setDeleting(true)
    const cases = await db.cases.where('incident_id').equals(incident.id).toArray()
    for (const c of cases) {
      await addToSyncQueue('cases', 'DELETE', c.id, { id: c.id })
    }
    await db.cases.where('incident_id').equals(incident.id).delete()
    await db.incidents.delete(incident.id)
    await addToSyncQueue('incidents', 'DELETE', incident.id, { id: incident.id })
    setDeleting(false)
    onDeleted(incident.id)
  }

  if (showDeleteConfirm) {
    return (
      <div className={styles.incidentGroup}>
        <div className={styles.incidentConfirmRow}>
          <span className={styles.incidentConfirmText}>Delete this incident?</span>
          <div className={styles.hoursConfirmActions}>
            <button className={styles.hoursConfirmYes} onClick={handleDelete} disabled={deleting}>
              {deleting ? '…' : 'Yes, delete'}
            </button>
            <button className={styles.hoursConfirmCancel} onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  const date = formatDateDisplay(incident.incident_date)
  const loc = incident.location
  const desc = incident.incident_description
  // The state an affidavit-first incident is created in: nothing described yet.
  const undescribed = !date && !loc && !desc

  // case_number is nullable, so the sort must not call localeCompare on null (it
  // would throw during render and take the whole client file down).
  const cases = [...(initialIncident.cases ?? [])]
    .sort((a, b) => (a.case_number ?? '').localeCompare(b.case_number ?? ''))

  // A probation-violation incident (2026-08-19). It has no date, location or
  // description by construction and holds exactly ONE case, so the whole
  // incident chrome collapses: no date/location lines, no "+ add a case", no
  // "Awaiting details", and no "edit incident" — that button edits precisely the
  // three fields this branch hides, so leaving it would let the user type a
  // description that then renders nowhere. The × delete button is untouched.
  // The nested case line already reads "[case number] - PV" via the case-level
  // logic, and is the only content in the left cell.
  const isPvIncident = !!incident.is_pv
  // The PV detail block lives on the CASE, not the incident. A PV holds exactly
  // one case, but find() rather than [0] keeps this working if that ever changes.
  //
  // Three lines, each rendered only when it has content, so the block is 0–3
  // lines tall and never leaves an empty row behind:
  //   1. conviction date   2. crime   3. probation length · special info
  // Line 3 joins its two fields with " · " — the same separator bondReleaseText()
  // uses for bond + release status — and drops out entirely when neither is set.
  //
  // pv_sentence is NOT read here: it was replaced by these four columns on
  // 2026-08-20 and is deprecated (kept in the DB, never read or written — the
  // same pattern as clients.age and clients.bond_amount).
  const pvCase = cases.find(c => c.is_pv) ?? null
  const pvLine3 = [pvCase?.pv_probation_length, pvCase?.pv_special_info].filter(Boolean).join(' · ')
  const pvLines = [
    formatDateDisplay(pvCase?.pv_conviction_date) || null,
    pvCase?.pv_crime || null,
    pvLine3 || null,
  ].filter(Boolean)

  // One grid row per incident, always fully visible — there is no expand/collapse
  // state anymore. Left cell: date, location, then this incident's cases and its
  // own "add a case". Right cell: the description.
  return (
    <div className={styles.incidentRow}>
      {editing ? (
        /* Editing spans the full row rather than sitting in one cell: the three
           fields belong to different cells, so showing the old value of one while
           editing another would read as two competing sources of truth. */
        <div className={styles.incidentEditCell}>
          <div className={styles.incidentEditInputs} onBlur={onEditContainerBlur}>
            <textarea
              className={styles.incidentNameInput}
              value={editDesc}
              placeholder="Description"
              rows={3}
              autoFocus
              style={{ resize: 'none' }}
              onChange={e => setEditDesc(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <input
              className={styles.incidentNameInput}
              value={editLocation}
              placeholder="Location"
              onChange={e => setEditLocation(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {/* The date stays LAST on purpose: it was moved below the description
                on 2026-06-10 so the native mobile date picker can't cover the
                fields above it. Location was inserted between them, not before. */}
            <input
              type="date"
              className={`${styles.incidentNameInput} ${styles.incidentDateInput}`}
              value={editDate}
              onChange={e => setEditDate(e.target.value)}
              onKeyDown={onKeyDown}
              {...pickerHandlers()}
            />
          </div>
        </div>
      ) : (
        <>
          {/* .incidentLeftCellPv zeroes the first case item's 9px top margin.
              That margin exists to separate the first case from the location
              line above it — on a PV row there is nothing above it, so it read
              as unexplained empty space at the top of the cell. */}
          <div className={`${styles.incidentLeftCell}${isPvIncident ? ` ${styles.incidentLeftCellPv}` : ''}`}>
            {!isPvIncident && date && <div className={styles.incidentDateLine}>{date}</div>}
            {!isPvIncident && loc && <div className={styles.incidentLocLine}>{loc}</div>}

            {/* No same-incident bracket here, deliberately: every case in this
                cell belongs to this incident by construction, so the grouping is
                already unambiguous and a bracket would add nothing. The bracket
                belongs to the two FLAT lists — the client list and the header
                mini-list — where grouping is otherwise invisible. */}
            {cases.map(c => {
              // One line under the case number, e.g.
              // "$0 Bond · Held without bond | Affidavit". Every segment drops
              // out independently, so the line is a clean "$1,500 Bond |
              // Affidavit" in the common no-release-status case, and is not
              // rendered at all when nothing is set.
              const bond = bondReleaseText(c.bond_amount, c.release_status)
              const affidavit = !!c.warrant_url
              // Both the number and the line below it go to the same case.
              const open = () => onCaseTap(c.case_number || c.id)
              return (
                <div key={c.id} className={styles.incidentCaseItem}>
                  {/* Cases are addressed by case_number in the URL; one without
                      a number falls back to its id so it stays reachable
                      (CaseView resolves both). */}
                  <span
                    className={`${styles.incidentCaseNum} ${c.case_number ? '' : styles.caseNumberPending}`}
                    {...tapHandlers(open)}
                  >
                    {c.case_number || 'Case # pending'}
                    {/* charge_abbrev only, never the full charge, and frequently
                        null — every affidavit-first case starts without one. It
                        lives INSIDE the case-number span so it shares the same
                        click target and the same enlarged hit area; the muted
                        styling that makes it match the bond line is applied by
                        the nested class, which also has to reset the weight,
                        letter-spacing and italic it would otherwise inherit
                        from the number. The separating space sits inside the
                        conditional, so a null abbrev leaves no trailing space
                        and no placeholder. */}
                    {c.is_pv ? (
                      /* Same substitution as the two mini-lists. Deliberately
                         BARE text, not wrapped in .incidentCaseAbbrev: as of
                         2026-08-20 "PV" must render identically to the case
                         number, and sitting unwrapped inside that span inherits
                         its family, size, weight, colour and tracking exactly —
                         there is no second declaration to drift out of sync. A
                         PV never has a charge_abbrev, so the two are mutually
                         exclusive. */
                      <>{' '}- PV</>
                    ) : c.charge_abbrev && (
                      <span className={styles.incidentCaseAbbrev}>{' '}{c.charge_abbrev}</span>
                    )}
                  </span>
                  {(bond || affidavit) && (
                    /* Also navigates — a second, much larger target for the
                       same case. Styling is deliberately unchanged: it should
                       not read as a link, only behave as one. */
                    <div className={styles.incidentCaseMeta} {...tapHandlers(open)}>
                      {bond}
                      {bond && affidavit && ' | '}
                      {affidavit && <span className={styles.affidavitTag}>Affidavit</span>}
                    </div>
                  )}
                </div>
              )
            })}

            {!isPvIncident && !showAddCase && (
              <button className={styles.incidentAddCaseBtn} onClick={() => setShowAddCase(true)}>
                + add a case
              </button>
            )}
          </div>

          <div className={`${styles.incidentDescCell}${isPvIncident ? ` ${styles.incidentDescCellPv}` : ''}`}>
            <button
              className={styles.incidentDeleteBtn}
              onClick={() => setShowDeleteConfirm(true)}
            >×</button>
            {/* A PV incident shows its case's PV detail block here, or nothing at
                all — explicitly NOT the "Awaiting details" placeholder, which is
                what made the old under-an-incident PV flow read as a half-
                finished record. With no fields filled in the cell stays
                genuinely empty. The block is vertically centred by
                .incidentDescCellPv on the cell itself, so it stays centred at
                one, two or three lines. */}
            {isPvIncident ? (
              pvLines.map((line, i) => (
                <div key={i} className={styles.incidentDescText}>{line}</div>
              ))
            ) : (
              /* "edit incident" flows inline after the last word of the
                 description rather than starting its own line beneath it. */
              <div className={styles.incidentDescText}>
                {desc}
                {!desc && undescribed && <span className={styles.incidentAwaiting}>{AWAITING_DETAILS}</span>}
                {' '}
                <button className={styles.incidentEditBtn} onClick={startEdit}>
                  edit incident
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Full-width: the add-case form's own two-column bond/status row has no
          room in a 1/6-width cell. */}
      {showAddCase && (
        <div className={styles.incidentAddCaseCell}>
          <AddCaseForm
            incidentId={incident.id}
            onSaved={() => { setShowAddCase(false); onCaseAdded() }}
            onCancel={() => setShowAddCase(false)}
          />
        </div>
      )}
    </div>
  )
}

// ─── Personal Notes section ──────────────────────────────────────────────────

function PersonalNotesSection({ clientId, initialNote }) {
  const [note, setNote] = useState(initialNote ?? null)
  // A client who already has a note gets the section expanded on load — the note
  // is worth reading without a tap. An empty/absent note keeps the collapsed
  // default. Click-to-toggle behavior itself is unchanged. The parent holds this
  // render behind its own loading guard, so initialNote is already resolved here.
  const [open, setOpen] = useState(() => !!initialNote?.note?.trim())
  const [mode, setMode] = useState('idle') // 'idle' | 'add' | 'edit' | 'confirmDelete'
  const [draftText, setDraftText] = useState('')
  const [saving, setSaving] = useState(false)

  // When a note exists and the bar is clicked (not a button), toggle view/collapsed
  function handleBarClick() {
    if (mode !== 'idle') return
    if (note) setOpen(o => !o)
  }

  function startAdd(e) {
    e.stopPropagation()
    setDraftText('')
    setMode('add')
    setOpen(true)
  }

  function startEdit(e) {
    e.stopPropagation()
    setDraftText(note.note ?? '')
    setMode('edit')
  }

  function cancelEdit() {
    setMode(note ? 'idle' : 'idle')
    if (!note) setOpen(false)
  }

  async function saveNote() {
    const text = draftText.trim()
    if (!text) return
    setSaving(true)
    if (mode === 'add') {
      const newId = crypto.randomUUID()
      const record = { id: newId, client_id: clientId, note: text, updated_at: new Date().toISOString() }
      await db.personal_notes.put(record)
      await addToSyncQueue('personal_notes', 'INSERT', newId, record)
      setNote(record)
      setOpen(true)
    } else {
      const updated_at = new Date().toISOString()
      const changes = { note: text, updated_at }
      await db.personal_notes.update(note.id, changes)
      await addToSyncQueue('personal_notes', 'UPDATE', note.id, { id: note.id, client_id: clientId, note: text, updated_at })
      setNote(prev => ({ ...prev, note: text, updated_at }))
    }
    setSaving(false)
    setMode('idle')
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
  }

  async function confirmDelete() {
    setSaving(true)
    await db.personal_notes.delete(note.id)
    await addToSyncQueue('personal_notes', 'DELETE', note.id, { id: note.id })
    setNote(null)
    setOpen(false)
    setMode('idle')
    setSaving(false)
  }

  const isAddOrEdit = mode === 'add' || mode === 'edit'

  return (
    <div className={styles.personalNotesSection}>
      {/* ── Header bar ── */}
      <div
        className={styles.personalNotesBar}
        onClick={handleBarClick}
        style={{ cursor: note && !isAddOrEdit ? 'pointer' : 'default' }}
      >
        {isAddOrEdit ? (
          /* Inline editor inside the bar */
          <div className={styles.pnEditWrapper} onClick={e => e.stopPropagation()}>
            <textarea
              className={styles.pnTextarea}
              value={draftText}
              autoFocus
              rows={3}
              onChange={e => setDraftText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Enter a note…"
            />
            <div className={styles.pnEditActions}>
              <button className={styles.pnSaveBtn} onClick={saveNote} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button className={styles.pnCancelBtn} onClick={cancelEdit} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>
        ) : mode === 'confirmDelete' ? (
          <div className={styles.pnConfirmRow} onClick={e => e.stopPropagation()}>
            <span className={styles.pnConfirmText}>Delete this note?</span>
            <div className={styles.pnConfirmActions}>
              <button className={styles.hoursConfirmYes} onClick={confirmDelete} disabled={saving}>
                {saving ? '…' : 'Yes, delete'}
              </button>
              <button className={styles.hoursConfirmCancel} onClick={() => setMode('idle')}>
                Cancel
              </button>
            </div>
          </div>
        ) : open && note ? (
          /* View mode — note text + edit + delete */
          <div className={styles.pnViewRow}>
            <span className={styles.pnNoteText}>{note.note}</span>
            <div className={styles.pnViewActions} onClick={e => e.stopPropagation()}>
              <button className={styles.pnEditBtn} onClick={startEdit}>edit</button>
              <button className={styles.incidentDeleteBtn} onClick={e => { e.stopPropagation(); setMode('confirmDelete') }}>×</button>
            </div>
          </div>
        ) : (
          /* Default collapsed state */
          <>
            <span className={styles.sectionTitle}>Personal Notes</span>
            {!note && (
              <button className={styles.addBtn} onClick={startAdd}>+</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Hours section ───────────────────────────────────────────────────────────

const HOURS_OPTIONS = Array.from({ length: 25 }, (_, i) => ((i + 1) / 10).toFixed(1))

// Common descriptions offered as a dropdown; picking one fills the (still
// editable) description text field. Shared by AddHoursForm and EditHoursForm.
const DESCRIPTION_OPTIONS = [
  // Pinned to the TOP of the list by request (2026-08-19), ahead of every other
  // option — it is the one picked most often. Deliberately outside the
  // alphabetical run that follows; do not "restore" it to sort order. It
  // carries no entry in DEFAULT_HOURS_BY_DESCRIPTION, so picking it leaves the
  // Hours field alone.
  'Courtroom wait time',
  'Opened file',
  'Reviewed () affidavits 0. ; Reviewed criminal history 0. ; TOTAL:',
  'Jail visit with client',
  'Initial client meeting',
  'Met with ADA',
  'Met, negotiated with ADA',
  'Rescheduled Appearance',
  'Draft, send letter to client',
  'Draft, send email requesting client zoom visit',
  'Client zoom visit',
  'Met with client',
  'Research, investigate',
  'Read, review',
  'Draft, send email to ADA re: bond motion',
  'Draft, file bond reduction motion',
  'Prepared defense',
  'Prepared for trial',
  'Prepared for preliminary hearing',
  'Met with client; updated client re:',
  'Arrange BWC viewing appointment, obtain & sign form',
  'Reviewed file',
  'Guilty plea taken by judge',
  'Case dismissed',
  'Closed file',
]

// Descriptions that carry a conventional time value. Picking one of these from
// the dropdown pre-fills the Hours field; the field stays editable afterward,
// exactly as before. A description NOT listed here — including "Courtroom wait
// time" and anything typed by hand — leaves Hours untouched, so there is no
// forced default outside this map.
//
// Keys must match the DESCRIPTION_OPTIONS strings byte for byte: the lookup is a
// plain case-sensitive property hit, not a fuzzy match. Values are strings so
// they equal the HOURS_OPTIONS <option> values and the <select> stays controlled.
const DEFAULT_HOURS_BY_DESCRIPTION = {
  'Opened file': '0.5',
  'Closed file': '0.5',
  'Jail visit with client': '0.4',
  'Initial client meeting': '0.3',
  'Met with ADA': '0.1',
  'Met, negotiated with ADA': '0.1',
  'Rescheduled Appearance': '0.1',
  'Draft, send email requesting client zoom visit': '0.2',
  'Client zoom visit': '0.3',
  'Guilty plea taken by judge': '0.2',
  'Case dismissed': '0.1',
}

// Shared by AddHoursForm and EditHoursForm. Applies a dropdown pick as ONE state
// update, so description and hours can never land in separate renders.
function applyDescriptionPick(form, description) {
  const preset = DEFAULT_HOURS_BY_DESCRIPTION[description]
  return { ...form, description, ...(preset ? { hours: preset } : {}) }
}

// localStorage key holding the last entry_date the user saved, used to default
// the date field on the next new hours entry.
const LAST_HOURS_DATE_KEY = 'gsapp:lastHoursDate'

// Incidents render oldest-first (earliest incident_date at top). incident_date is
// TEXT, so compare the parsed numeric key — never new Date() or a string compare.
// Rows with a missing/unparseable date sort to the end instead of blowing up.
function compareIncidentsByDate(a, b) {
  const ka = dateKey(a.incident_date)
  const kb = dateKey(b.incident_date)
  const aMissing = ka === -Infinity
  const bMissing = kb === -Infinity
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1
  return ka - kb
}

function AddHoursForm({ clientId, computeSortOrder, onSaved, onCancel }) {
  const [form, setForm] = useState({
    entry_date: localStorage.getItem(LAST_HOURS_DATE_KEY) || todayString(),
    hours: '0.5',
    description: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    if (!form.entry_date.trim() || !form.description.trim()) {
      setError('Date and description are required.')
      return
    }
    setSaving(true)
    setError(null)
    const newId = crypto.randomUUID()
    const entryDate = form.entry_date.trim()
    const record = {
      id: newId,
      client_id: clientId,
      entry_date: entryDate,
      hours: Number(form.hours),
      description: form.description.trim(),
      // Slot into the current displayed order by date (see computeInsertSortOrder).
      sort_order: computeSortOrder(entryDate),
    }
    await db.hours.put(record)
    await addToSyncQueue('hours', 'INSERT', newId, record)
    localStorage.setItem(LAST_HOURS_DATE_KEY, record.entry_date)
    onSaved()
  }

  return (
    <div className={styles.inlineForm}>
      {/* Field order is date → description → hours (2026-08-19). Hours moved below
          description because picking a common description can now fill Hours in,
          so the field it drives has to come after it. Date and Hours no longer
          share a two-column row — that pairing is what the reorder breaks. */}
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Date</label>
        <input type="date" className={styles.formInput} value={toDateInput(form.entry_date)} onChange={e => set('entry_date', fromDateInput(e.target.value))} {...pickerHandlers()} />
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Description</label>
        <input className={styles.formInput} value={form.description} onChange={e => set('description', e.target.value)} placeholder="e.g. Court appearance" />
        <select
          className={styles.formSelect}
          style={{ marginTop: 6 }}
          value=""
          onChange={e => { if (e.target.value) setForm(f => applyDescriptionPick(f, e.target.value)) }}
        >
          <option value="">Pick a common description…</option>
          {DESCRIPTION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Hours</label>
        <select className={styles.formSelect} value={form.hours} onChange={e => set('hours', e.target.value)}>
          {HOURS_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
      </div>
      {error && <div className={styles.formError}>{error}</div>}
      <div className={styles.formActions}>
        <button className={styles.formSave} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className={styles.formCancel} onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  )
}

function EditHoursForm({ entry, onSaved, onCancel }) {
  const [form, setForm] = useState({
    entry_date: entry.entry_date,
    hours: String(entry.hours),
    description: entry.description,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    if (!form.entry_date.trim() || !form.description.trim()) {
      setError('Date and description are required.')
      return
    }
    setSaving(true)
    setError(null)
    const changes = {
      entry_date: form.entry_date.trim(),
      hours: Number(form.hours),
      description: form.description.trim(),
    }
    await db.hours.update(entry.id, changes)
    await addToSyncQueue('hours', 'UPDATE', entry.id, { id: entry.id, ...changes })
    localStorage.setItem(LAST_HOURS_DATE_KEY, changes.entry_date)
    onSaved()
  }

  return (
    <div className={styles.inlineForm}>
      {/* Field order is date → description → hours (2026-08-19). Hours moved below
          description because picking a common description can now fill Hours in,
          so the field it drives has to come after it. Date and Hours no longer
          share a two-column row — that pairing is what the reorder breaks. */}
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Date</label>
        <input type="date" className={styles.formInput} value={toDateInput(form.entry_date)} onChange={e => set('entry_date', fromDateInput(e.target.value))} {...pickerHandlers()} />
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Description</label>
        <input className={styles.formInput} value={form.description} onChange={e => set('description', e.target.value)} placeholder="e.g. Court appearance" />
        <select
          className={styles.formSelect}
          style={{ marginTop: 6 }}
          value=""
          onChange={e => { if (e.target.value) setForm(f => applyDescriptionPick(f, e.target.value)) }}
        >
          <option value="">Pick a common description…</option>
          {DESCRIPTION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Hours</label>
        <select className={styles.formSelect} value={form.hours} onChange={e => set('hours', e.target.value)}>
          {HOURS_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
      </div>
      {error && <div className={styles.formError}>{error}</div>}
      <div className={styles.formActions}>
        <button className={styles.formSave} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className={styles.formCancel} onClick={onCancel} disabled={saving}>Back</button>
      </div>
    </div>
  )
}

// One hours row wrapped as a @dnd-kit sortable item. The whole row moves during
// a drag, but only the dedicated ≡ handle activates dragging — so the × delete
// button, row-tap-to-edit, and text selection are never hijacked.
function SortableHoursRow({ entry, checked, onToggleCheck, editing, confirming, onEdit, onEditSaved, onEditCancel, onConfirm, onConfirmYes, onConfirmCancel }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.id })
  // Tap-to-edit is suppressed when the user is selecting text (so descriptions can
  // be highlighted/copied for ACAP) or click-dragging on desktop. The dnd grip
  // handle and its sensors are untouched. Child buttons stopPropagation their own
  // click, so keeping onClick here means they still bypass edit as before.
  const suppressRef = useRef(false)
  const startRef = useRef({ x: 0, y: 0 })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    ...(isDragging ? { position: 'relative', zIndex: 2 } : null),
  }

  if (editing) {
    return (
      <div ref={setNodeRef} style={style}>
        <EditHoursForm entry={entry} onSaved={onEditSaved} onCancel={onEditCancel} />
      </div>
    )
  }
  if (confirming) {
    return (
      <div ref={setNodeRef} style={style} className={styles.hoursConfirmRow}>
        <span className={styles.hoursConfirmText}>Delete this entry?</span>
        <div className={styles.hoursConfirmActions}>
          <button className={styles.hoursConfirmYes} onClick={onConfirmYes}>Yes, delete</button>
          <button className={styles.hoursConfirmCancel} onClick={onConfirmCancel}>Cancel</button>
        </div>
      </div>
    )
  }
  return (
    <div
      ref={setNodeRef}
      style={{ ...style, cursor: 'pointer' }}
      className={`${styles.hoursRow} ${checked ? styles.hoursRowChecked : ''}`}
      onPointerDown={e => { startRef.current = { x: e.clientX, y: e.clientY }; suppressRef.current = false }}
      onPointerUp={e => {
        const sel = window.getSelection ? window.getSelection().toString() : ''
        const moved = Math.abs(e.clientX - startRef.current.x) > 8 || Math.abs(e.clientY - startRef.current.y) > 8
        if (sel.trim() !== '' || moved) suppressRef.current = true
      }}
      onClick={() => { if (suppressRef.current) { suppressRef.current = false; return } onEdit() }}
    >
      <button
        ref={setActivatorNodeRef}
        className={styles.hoursDragHandle}
        style={{ touchAction: 'none' }}
        aria-label="Drag to reorder"
        onClick={e => e.stopPropagation()}
        {...attributes}
        {...listeners}
      >≡</button>
      <span>{formatDateDisplay(entry.entry_date)}</span>
      <span className={styles.hoursValue}>{entry.hours}</span>
      <span>{entry.description}</span>
      <button
        className={`${styles.hoursCheckBtn} ${checked ? styles.hoursCheckBtnOn : ''}`}
        onClick={e => { e.stopPropagation(); onToggleCheck() }}
        aria-label={checked ? 'Mark unreviewed' : 'Mark reviewed'}
      >{checked ? '✓' : ''}</button>
      <button
        className={styles.hoursDeleteBtn}
        onClick={e => { e.stopPropagation(); onConfirm() }}
      >×</button>
    </div>
  )
}

function HoursSection({ clientId, hours }) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)
  // Check-off is session-only: a Set of checked row ids held in local state, never
  // persisted. Resets naturally on reload or on navigating away and back.
  const [checkedIds, setCheckedIds] = useState(() => new Set())

  const list = hours ?? []
  const total = list.reduce((sum, e) => sum + Number(e.hours), 0)
  const anyChecked = checkedIds.size > 0

  // A new entry slots into the CURRENT displayed order (sort_order ASC) by date,
  // rather than jumping to the top. Scan top→bottom for the first row whose date
  // is the same as or older than the new entry's; insert immediately ABOVE it
  // (midpoint between it and the row above). No such row → new entry is the oldest
  // → bottom (max + 10). Belongs at the very top → min − 10. Only the new row gets
  // a sort_order; the existing list is never renumbered, so a manual drag order is
  // preserved. Dates compared via numeric dateKey (not new Date / string compare).
  function computeInsertSortOrder(newDateStr) {
    if (list.length === 0) return 0
    const newKey = dateKey(newDateStr)
    const idx = list.findIndex(row => dateKey(row.entry_date) <= newKey)
    if (idx === -1) {
      const maxOrder = Math.max(...list.map(e => e.sort_order ?? 0))
      return maxOrder + 10
    }
    const target = list[idx]
    const above = list[idx - 1]
    if (!above) return (target.sort_order ?? 0) - 10
    return ((above.sort_order ?? 0) + (target.sort_order ?? 0)) / 2
  }

  // Check-off toggle — purely visual (grays a reviewed row). Session-only local
  // state, no persistence. No effect on total, sort, or delete.
  function toggleCheck(id) {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clearAllChecks() {
    setCheckedIds(new Set())
  }

  // MouseSensor for desktop; TouchSensor with a short press-delay for iPhone so a
  // normal finger-scroll on the list still scrolls and only a deliberate hold on
  // the handle starts a drag.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  )

  // On drop, rewrite ONLY the moved row's sort_order to sit between its new
  // neighbors (top slot = minNeighbor − 10, bottom = maxNeighbor + 10). The rest
  // of the list keeps its existing values. Persist offline-first.
  async function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = list.findIndex(h => h.id === active.id)
    const newIndex = list.findIndex(h => h.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(list, oldIndex, newIndex)
    const pos = reordered.findIndex(h => h.id === active.id)
    const prev = reordered[pos - 1]
    const next = reordered[pos + 1]
    let newSort
    if (!prev) newSort = (next.sort_order ?? 0) - 10
    else if (!next) newSort = (prev.sort_order ?? 0) + 10
    else newSort = ((prev.sort_order ?? 0) + (next.sort_order ?? 0)) / 2
    await db.hours.update(active.id, { sort_order: newSort })
    await addToSyncQueue('hours', 'UPDATE', active.id, { id: active.id, sort_order: newSort })
  }

  function handleSaved() {
    setShowForm(false)
  }

  function handleEditSaved() {
    setEditingId(null)
  }

  async function confirmDelete(entry) {
    await db.hours.delete(entry.id)
    await addToSyncQueue('hours', 'DELETE', entry.id, { id: entry.id })
    setConfirmingId(null)
  }

  return (
    <div className={styles.section}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0f1820', padding: '5px 16px' }}>
        <span className={styles.sectionTitle}>Hours</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {anyChecked && (
            <button className={styles.hoursClearChecks} onClick={clearAllChecks}>clear checks</button>
          )}
          {!showForm && <button className={styles.addBtn} onClick={() => setShowForm(true)}>+</button>}
        </div>
      </div>
      {showForm && (
        <AddHoursForm
          clientId={clientId}
          computeSortOrder={computeInsertSortOrder}
          onSaved={handleSaved}
          onCancel={() => setShowForm(false)}
        />
      )}
      <div className={styles.hoursTable}>
        <div className={styles.hoursHead}>
          <span /><span>Date</span><span>Hours</span><span>Description</span>
        </div>
        {list.length === 0 && <div className={styles.hoursEmpty}>No entries yet</div>}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={list.map(e => e.id)} strategy={verticalListSortingStrategy}>
            {list.map(entry => (
              <SortableHoursRow
                key={entry.id ?? entry.entry_date}
                entry={entry}
                checked={checkedIds.has(entry.id)}
                onToggleCheck={() => toggleCheck(entry.id)}
                editing={editingId === entry.id}
                confirming={confirmingId === entry.id}
                onEdit={() => { if (entry.id) setEditingId(entry.id) }}
                onEditSaved={handleEditSaved}
                onEditCancel={() => setEditingId(null)}
                onConfirm={() => setConfirmingId(entry.id)}
                onConfirmYes={() => confirmDelete(entry)}
                onConfirmCancel={() => setConfirmingId(null)}
              />
            ))}
          </SortableContext>
        </DndContext>
        {list.length > 0 && (
          <div className={styles.hoursTotal}>
            <span /><span>Total</span>
            <span className={styles.hoursValue}>{total % 1 === 0 ? total : total.toFixed(1)}</span>
            <span />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Criminal History section ────────────────────────────────────────────────

function CriminalHistorySection({ clientId, initialUrl, onDeleted }) {
  const [url, setUrl] = useState(initialUrl ?? null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [historyDragOver, setHistoryDragOver] = useState(false)
  const [showCriminalHistoryText, setShowCriminalHistoryText] = useState(false)

  const liveClientRecord = useLiveQuery(() => db.clients.get(clientId), [clientId])
  const criminalHistoryText = liveClientRecord?.criminal_history_text ?? null

  async function uploadHistoryFile(file) {
    setUploading(true)
    setUploadError(null)
    const path = `criminal-history/${clientId}.pdf`
    const { error: uploadErr } = await supabase.storage
      .from('warrants')
      .upload(path, file, { contentType: 'application/pdf', upsert: true })
    if (uploadErr) { setUploadError(uploadErr.message); setUploading(false); return }
    const { data: urlData } = await supabase.storage.from('warrants').getPublicUrl(path)
    await db.clients.update(clientId, { criminal_history_url: urlData.publicUrl })
    await addToSyncQueue('clients', 'UPDATE', clientId, { id: clientId, criminal_history_url: urlData.publicUrl })
    setUrl(urlData.publicUrl)
    // Text extraction — offline-first and awaited, same as every other write in
    // the app. This was previously fired unawaited and written to Supabase first,
    // so navigating away or the PWA being killed lost the text with nothing
    // queued to retry. extractPdfText never throws (null = no text layer, or the
    // CDN worker was unreachable); a null result leaves the stored text alone
    // rather than overwriting good text with null.
    const text = await extractPdfText(file)
    if (text != null) {
      await db.clients.update(clientId, { criminal_history_text: text })
      await addToSyncQueue('clients', 'UPDATE', clientId, { id: clientId, criminal_history_text: text })
    } else {
      console.warn('[criminal_history_text] no text extracted; existing value left unchanged')
    }
    setUploading(false)
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadHistoryFile(file)
    e.target.value = ''
  }

  function handleHistoryDragOver(e) { e.preventDefault(); setHistoryDragOver(true) }
  function handleHistoryDragEnter(e) { e.preventDefault(); setHistoryDragOver(true) }
  function handleHistoryDragLeave() { setHistoryDragOver(false) }
  async function handleHistoryDrop(e) {
    e.preventDefault()
    setHistoryDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (file.type !== 'application/pdf') { setUploadError('Only PDF files are accepted.'); return }
    await uploadHistoryFile(file)
  }

  async function handleView() {
    const path = `criminal-history/${clientId}.pdf`
    const { data, error } = await supabase.storage.from('warrants').createSignedUrl(path, 3600)
    if (error) { alert('Could not open file: ' + error.message); return }
    window.open(data.signedUrl, '_blank')
  }

  async function handleDelete() {
    setDeleting(true)
    const path = `criminal-history/${clientId}.pdf`
    await supabase.storage.from('warrants').remove([path])
    await db.clients.update(clientId, { criminal_history_url: null })
    await addToSyncQueue('clients', 'UPDATE', clientId, { id: clientId, criminal_history_url: null })
    setUrl(null)
    setShowDeleteConfirm(false)
    setDeleting(false)
    onDeleted()
  }

  return (
    <>
      <div className={styles.section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0f1820', padding: '5px 16px' }}>
          <span className={styles.sectionTitle}>Criminal History</span>
        </div>
        {showDeleteConfirm ? (
          <div className={styles.hoursConfirmRow}>
            <span className={styles.hoursConfirmText}>Delete criminal history?</span>
            <div className={styles.hoursConfirmActions}>
              <button className={styles.hoursConfirmYes} onClick={handleDelete} disabled={deleting}>{deleting ? '…' : 'Yes, delete'}</button>
              <button className={styles.hoursConfirmCancel} onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className={styles.historyButtons}>
            {url ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button className={styles.historyViewBtn} onClick={handleView}>
                    View Criminal History
                  </button>
                  {criminalHistoryText && (
                    <button
                      className={`${styles.historyViewBtn} ${styles.viewTextBtn}`}
                      onClick={() => setShowCriminalHistoryText(true)}
                    >
                      View Text
                    </button>
                  )}
                </div>
                <button className={styles.hoursDeleteBtn} onClick={() => setShowDeleteConfirm(true)}>×</button>
              </>
            ) : (
              <label
                className={`${styles.historyUploadBtn} ${uploading ? styles.historyUploadDisabled : ''} ${historyDragOver ? styles.historyUploadBtnDragOver : ''}`}
                onDragOver={handleHistoryDragOver}
                onDragEnter={handleHistoryDragEnter}
                onDragLeave={handleHistoryDragLeave}
                onDrop={handleHistoryDrop}
              >
                {uploading ? 'Uploading…' : 'Upload Criminal History'}
                <input
                  type="file"
                  accept="application/pdf"
                  className={styles.fileInputHidden}
                  disabled={uploading}
                  onChange={handleUpload}
                />
              </label>
            )}
            {uploadError && <div className={styles.formError}>{uploadError}</div>}
          </div>
        )}
      </div>
      <TextViewerDrawer
        isOpen={showCriminalHistoryText}
        onClose={() => setShowCriminalHistoryText(false)}
        label="Criminal History Text"
        text={criminalHistoryText}
      />
    </>
  )
}

// ─── Courtroom Documents section ─────────────────────────────────────────────

function CourtroomDocsSection({ clientId }) {
  const docs = useLiveQuery(
    () => db.courtroom_documents.where('client_id').equals(clientId).sortBy('id'),
    [clientId]
  ) ?? []

  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formFile, setFormFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [viewTextDoc, setViewTextDoc] = useState(null)

  async function handleSave() {
    if (!formName.trim()) { setFormError('Document name is required.'); return }
    if (!formFile) { setFormError('Please select a PDF file.'); return }
    setSaving(true)
    setFormError(null)

    const safeName = formFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `courtroom-docs/${clientId}/${Date.now()}_${safeName}`

    const { error: uploadErr } = await supabase.storage
      .from('warrants')
      .upload(path, formFile, { contentType: 'application/pdf', upsert: true })

    if (uploadErr) { setFormError(uploadErr.message); setSaving(false); return }

    const newId = crypto.randomUUID()
    const record = { id: newId, client_id: clientId, name: formName.trim(), file_url: path }
    await db.courtroom_documents.put(record)
    await addToSyncQueue('courtroom_documents', 'INSERT', newId, record)

    // Text extraction — offline-first and awaited BEFORE the form closes, so the
    // text can't be lost to a navigation or the PWA being killed (see the note in
    // CriminalHistorySection). The document row is already persisted above, so it
    // survives even if extraction yields nothing.
    const text = await extractPdfText(formFile)
    if (text != null) {
      await db.courtroom_documents.update(newId, { extracted_text: text })
      await addToSyncQueue('courtroom_documents', 'UPDATE', newId, { id: newId, extracted_text: text })
    } else {
      console.warn('[extracted_text] no text extracted; existing value left unchanged')
    }

    setFormName('')
    setFormFile(null)
    setShowForm(false)
    setSaving(false)
  }

  async function handleView(doc) {
    const { data, error } = await supabase.storage.from('warrants').createSignedUrl(doc.file_url, 3600)
    if (error) { alert('Could not open file: ' + error.message); return }
    window.open(data.signedUrl, '_blank')
  }

  async function handleRename(doc) {
    if (!renameValue.trim()) return
    await db.courtroom_documents.update(doc.id, { name: renameValue.trim() })
    await addToSyncQueue('courtroom_documents', 'UPDATE', doc.id, { id: doc.id, name: renameValue.trim() })
    setRenamingId(null)
  }

  async function handleDelete(doc) {
    setDeleting(true)
    await supabase.storage.from('warrants').remove([doc.file_url])
    await db.courtroom_documents.delete(doc.id)
    await addToSyncQueue('courtroom_documents', 'DELETE', doc.id, { id: doc.id })
    setConfirmDeleteId(null)
    setDeleting(false)
  }

  const atMax = docs.length >= 5

  return (
    <>
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0f1820', padding: '5px 16px' }}>
        <span className={styles.sectionTitle}>Courtroom Documents</span>
        {!showForm && !atMax && (
          <button className={styles.addBtn} onClick={() => setShowForm(true)}>+</button>
        )}
      </div>

      {showForm && (
        <div className={styles.inlineForm}>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Document Name *</label>
            <input
              className={styles.formInput}
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="e.g. Motion to Suppress"
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>File (PDF) *</label>
            <input
              type="file"
              accept="application/pdf"
              className={styles.formInput}
              onChange={e => setFormFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {formError && <div className={styles.formError}>{formError}</div>}
          <div className={styles.formActions}>
            <button className={styles.formSave} onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className={styles.formCancel} onClick={() => { setShowForm(false); setFormName(''); setFormFile(null); setFormError(null) }} disabled={saving}>Back</button>
          </div>
        </div>
      )}

      <div className={styles.cdocList}>
        {docs.length === 0 && !showForm && (
          <div className={styles.cdocEmpty}>No courtroom documents uploaded.</div>
        )}
        {docs.map(doc => (
          <div key={doc.id} className={styles.cdocItem}>
            {/* Tile */}
            <button className={styles.cdocTile} onClick={() => handleView(doc)}>
              {doc.name}
            </button>
            {doc.extracted_text && (
              <button
                className={styles.cdocViewTextBtn}
                onClick={e => { e.stopPropagation(); setViewTextDoc(doc) }}
              >
                View Text
              </button>
            )}

            {/* Rename */}
            {renamingId === doc.id ? (
              <div className={styles.cdocRenameRow}>
                <input
                  className={styles.cdocRenameInput}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRename(doc); if (e.key === 'Escape') setRenamingId(null) }}
                  autoFocus
                />
                <button className={styles.cdocRenameAction} onClick={() => handleRename(doc)}>Save</button>
                <button className={styles.cdocRenameCancel} onClick={() => setRenamingId(null)}>Cancel</button>
              </div>
            ) : (
              /* Delete confirm or normal controls */
              confirmDeleteId === doc.id ? (
                <div className={styles.cdocConfirmRow}>
                  <span className={styles.cdocConfirmText}>Delete this document?</span>
                  <div className={styles.cdocConfirmActions}>
                    <button className={styles.hoursConfirmYes} onClick={() => handleDelete(doc)} disabled={deleting}>{deleting ? '…' : 'Yes, delete'}</button>
                    <button className={styles.hoursConfirmCancel} onClick={() => setConfirmDeleteId(null)} disabled={deleting}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className={styles.cdocControls}>
                  <button className={styles.cdocRenameBtn} onClick={() => { setRenamingId(doc.id); setRenameValue(doc.name) }}>rename</button>
                  <button className={styles.hoursDeleteBtn} onClick={() => setConfirmDeleteId(doc.id)}>×</button>
                </div>
              )
            )}
          </div>
        ))}
        {atMax && (
          <div className={styles.cdocMaxMsg}>Maximum 5 documents reached.</div>
        )}
      </div>
    </div>
    <TextViewerDrawer
      isOpen={!!viewTextDoc}
      onClose={() => setViewTextDoc(null)}
      label={viewTextDoc?.name ?? ''}
      text={viewTextDoc?.extracted_text ?? null}
    />
    </>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ClientFile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { client, incidents, nextEvent, hours, personalNote, loading, error, refetch } = useClientFile(id)

  const [showEventForm, setShowEventForm] = useState(false)
  const [showIncidentForm, setShowIncidentForm] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [closing, setClosing] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDeleteClient() {
    setDeleting(true)

    // Gather all related records before deleting
    const [hourRows, nextEventRows, personalNoteRows, incidentRows] = await Promise.all([
      db.hours.where('client_id').equals(id).toArray(),
      db.next_events.where('client_id').equals(id).toArray(),
      db.personal_notes.where('client_id').equals(id).toArray(),
      db.incidents.where('client_id').equals(id).toArray(),
    ])
    const incidentIds = incidentRows.map(r => r.id)
    const caseRows = (await Promise.all(
      incidentIds.map(iid => db.cases.where('incident_id').equals(iid).toArray())
    )).flat()

    // Delete from Dexie
    await Promise.all([
      db.hours.where('client_id').equals(id).delete(),
      db.next_events.where('client_id').equals(id).delete(),
      db.personal_notes.where('client_id').equals(id).delete(),
    ])
    await Promise.all(incidentIds.map(iid => db.cases.where('incident_id').equals(iid).delete()))
    await db.incidents.where('client_id').equals(id).delete()
    await db.clients.delete(id)

    // Queue DELETEs for Supabase sync
    await Promise.all([
      ...hourRows.map(r => addToSyncQueue('hours', 'DELETE', r.id, { id: r.id })),
      ...nextEventRows.map(r => addToSyncQueue('next_events', 'DELETE', r.id, { id: r.id })),
      ...personalNoteRows.map(r => addToSyncQueue('personal_notes', 'DELETE', r.id, { id: r.id })),
      ...caseRows.map(r => addToSyncQueue('cases', 'DELETE', r.id, { id: r.id })),
      ...incidentRows.map(r => addToSyncQueue('incidents', 'DELETE', r.id, { id: r.id })),
      addToSyncQueue('clients', 'DELETE', id, { id }),
    ])

    navigate('/')
  }

  const isClosed = client?.relieved_closed === true

  async function handleClose() {
    setClosing(true)
    const closedAt = new Date().toISOString()
    await db.clients.update(id, { relieved_closed: true, closed_at: closedAt })
    await addToSyncQueue('clients', 'UPDATE', id, { id, relieved_closed: true, closed_at: closedAt })
    setClosing(false)
    setShowCloseConfirm(false)
    refetch()
  }

  async function handleReopenCase() {
    setClosing(true)
    await db.clients.update(id, { relieved_closed: false, closed_at: null })
    await addToSyncQueue('clients', 'UPDATE', id, { id, relieved_closed: false, closed_at: null })
    setClosing(false)
    setShowCloseConfirm(false)
    refetch()
  }

  if (loading) {
    return (
      <div className={styles.screen}>
        <header className={styles.header}>
          <button className={styles.back} onClick={() => navigate(-1)}>‹ Back</button>
        </header>
        <div className={styles.stateMsg}>Loading…</div>
      </div>
    )
  }

  if (error || !client) {
    return (
      <div className={styles.screen}>
        <header className={styles.header}>
          <button className={styles.back} onClick={() => navigate(-1)}>‹ Back</button>
        </header>
        <div className={styles.stateMsg}>{error ?? 'Client not found.'}</div>
      </div>
    )
  }

  const nameCore = `${client.last_name}, ${client.first_name} (${client.gender})`

  // Sticky scroll header: name + gender + OCA, each parenthetical omitted cleanly
  // when missing (no empty "()" and no stray spaces). No "#" prefix on the OCA.
  const stickyName = [
    `${client.last_name}, ${client.first_name}`,
    client.gender ? `(${client.gender})` : '',
    client.oca ? `(${client.oca})` : '',
  ].filter(Boolean).join(' ')

  // Total Bond: hide the whole line when EVERY case has a null bond_amount.
  // A case with bond_amount = 0 counts as present (0 != null), so the line shows.
  // Sum only the non-null values.
  const bondCases = incidents.flatMap(inc => inc.cases ?? []).filter(c => c.bond_amount != null)
  const showTotalBond = bondCases.length > 0
  const totalBond = bondCases.reduce((sum, c) => sum + Number(c.bond_amount), 0)
  const sortedIncidents = [...incidents].sort(compareIncidentsByDate)

  // Header case mini-list: every case across every incident, ordered the same way
  // the client list orders them (numeric, ignoring the letter prefix) so the two
  // views read identically. case_number is nullable, hence the ?? '' guard.
  const headerCases = incidents
    .flatMap(inc => inc.cases ?? [])
    .sort((a, b) =>
      (parseInt((a.case_number ?? '').replace(/^\D+/, ''), 10) || 0) -
      (parseInt((b.case_number ?? '').replace(/^\D+/, ''), 10) || 0)
    )

  return (
    <div className={styles.screen}>

      {/* ── Sticky name bar ── */}
      <div className={styles.stickyNameBar}>{stickyName}</div>

      {/* ── Client header ── */}
      <div className={styles.clientHeader}>
        <header className={styles.header}>
          <button className={styles.back} onClick={() => navigate('/')}>‹ Back</button>
          <button className={styles.editBtn} onClick={() => navigate(`/client/${id}/edit`)}>Edit</button>
        </header>
        <div className={styles.nameRow}>
          <div className={styles.nameRowLeft}>
            <div style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 8 }}>
              <h1 className={styles.name}>{nameCore}</h1>
              <IndigentCircle clientId={id} status={client.indigent_status} />
            </div>
            {client.oca && (
              <div style={{ color: '#9faab8', fontSize: '0.85em', marginTop: 2 }}>{client.oca}</div>
            )}
            {showTotalBond && (
              <div className={styles.bondLine}>Total Bond: ${totalBond.toLocaleString()}</div>
            )}
          </div>

          {/* Case mini-list — grid column 2, centered in the ROW, not in the space
              left over between the name block and the badge (the two side tracks
              are both 1fr, so they stay equal and the middle sits on the row's
              midpoint). In normal flow, so the row still grows to fit any number
              of cases. Always rendered, even when empty, so the badge's explicit
              grid-column: 3 is never the thing holding the layout together alone.
              Unlike the client list this shows the FULL charge, not charge_abbrev.
              Non-interactive summary — the tappable copies live in the client list
              and under each incident — so the borrowed pointer cursor is overridden
              inline, the only way to beat a class from another CSS module without
              depending on bundle order. */}
          <div className={styles.headerCaseList}>
            {/* Same-incident bracket, identical rules to the client list and
                sharing its contiguity guard via bracketBlocks(): 2+ cases only,
                and only when all of an incident's cases land consecutively in
                this flat, number-sorted list. Sort order is untouched. */}
            {bracketBlocks(headerCases).map(block => {
              const rows = block.items.map(c => (
                <div key={c.id} className={rowStyles.caseTableRow}>
                  <span className={rowStyles.caseNum} style={{ cursor: 'default' }}>{c.case_number || '—'}</span>
                  {/* PV stands in for charge + classification here too — same
                      rule as the client list, so the two mini-lists still read
                      identically for the same case. */}
                  {c.is_pv ? (
                    <span className={rowStyles.casePv} style={{ cursor: 'default' }}>- PV</span>
                  ) : (
                    <>
                      {c.charge && <span className={rowStyles.caseCharge} style={{ cursor: 'default' }}>| {c.charge}</span>}
                      {c.classification && <>{' '}<span className={rowStyles.caseClassification}>({c.classification})</span></>}
                    </>
                  )}
                </div>
              ))
              return block.bracket
                ? <div key={block.items[0].id} className={styles.headerCaseGroup}>{rows}</div>
                : rows
            })}
          </div>

          <div className={styles.badgeStack}>
            {client.custody_status === 'in_custody' && <span className={`${styles.badge} ${isClosed ? styles.badgeGray : styles.badgeRed}`}>In Custody</span>}
            {client.custody_status === 'no_bond_held' && <span className={`${styles.badge} ${isClosed ? styles.badgeGray : styles.badgeRed}`}>No Bond/Held</span>}
            {client.custody_status === 'bonded_out' && <span className={`${styles.badge} ${isClosed ? styles.badgeGray : styles.badgeGreen}`}>Bonded Out</span>}
            {client.custody_status === 'pretrialed_out' && <span className={`${styles.badge} ${isClosed ? styles.badgeGray : styles.badgeGreen}`}>Pretrialed Out</span>}
            {client.custody_status === 'ror' && <span className={`${styles.badge} ${isClosed ? styles.badgeGray : styles.badgeGreen}`}>ROR&apos;d</span>}
            {client.custody_status === 'out' && <span className={`${styles.badge} ${isClosed ? styles.badgeGray : styles.badgeGreen}`}>Out</span>}
            {isClosed && <span className={styles.closedBadge}>CLOSED</span>}
          </div>
        </div>
      </div>

      {/* ── Next Event ── */}
      <div className={styles.nextEventWrapper}>
        {!showEventForm && (
          <NextEventBlock
            event={nextEvent}
            onEdit={() => setShowEventForm(true)}
          />
        )}
        {showEventForm && (
          <NextEventForm
            clientId={id}
            existing={nextEvent}
            onSaved={() => { setShowEventForm(false); refetch() }}
            onCancel={() => setShowEventForm(false)}
            onCleared={() => { setShowEventForm(false); refetch() }}
          />
        )}
      </div>

      {/* ── Personal Notes ── */}
      <PersonalNotesSection clientId={id} initialNote={personalNote} />

      {/* ── Incidents ── */}
      <div className={styles.incidentsWrapper}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0f1820', padding: '5px 16px' }}>
          <span className={styles.sectionTitle}>Incidents</span>
          {/* Same two-control header pattern the Hours section uses: a text
              control beside the square "+", which stays the primary affordance. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <AffidavitFirstUpload clientId={id} incidents={sortedIncidents} />
            {!showIncidentForm && (
              <button className={styles.addBtn} onClick={() => setShowIncidentForm(true)}>+</button>
            )}
          </div>
        </div>
        {showIncidentForm && (
          <AddIncidentForm
            clientId={id}
            onSaved={() => { setShowIncidentForm(false); refetch() }}
            onCancel={() => setShowIncidentForm(false)}
          />
        )}
        {sortedIncidents.map(incident => (
          <IncidentGroup
            key={incident.id}
            incident={incident}
            onCaseTap={num => navigate(`/case/${num}`)}
            onCaseAdded={refetch}
            onDeleted={refetch}
          />
        ))}
        {sortedIncidents.length === 0 && !showIncidentForm && (
          <div className={styles.noEventMsg}>No incidents yet</div>
        )}
      </div>

      {/* ── Hours ── */}
      <HoursSection clientId={id} hours={hours} />

      {/* ── Criminal History ── */}
      <CriminalHistorySection clientId={id} initialUrl={client.criminal_history_url} onDeleted={refetch} />

      {/* ── Courtroom Documents ── */}
      <CourtroomDocsSection clientId={id} />

      {/* ── Close / Reopen ── */}
      <div className={styles.closeCaseSection}>
        <div className={styles.closeCaseBtnRow}>
          {!showCloseConfirm && (
            <button className={styles.closeCaseBtn} onClick={() => setShowCloseConfirm(true)}>
              {isClosed ? 'Reopen Case' : 'Close Case'}
            </button>
          )}
          {showCloseConfirm && (
            <div className={styles.confirmBox}>
              <p className={styles.confirmText}>{isClosed ? 'Reopen this case?' : 'Mark this case as closed?'}</p>
              <div className={styles.confirmActions}>
                <button className={styles.confirmYes} onClick={isClosed ? handleReopenCase : handleClose} disabled={closing}>
                  {closing ? '…' : isClosed ? 'Yes, Reopen' : 'Yes, Close'}
                </button>
                <button className={styles.confirmNo} onClick={() => setShowCloseConfirm(false)} disabled={closing}>No</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Delete Client ── */}
      <div className={styles.deleteClientSection} style={{ marginTop: 32 }}>
        {!showDeleteConfirm ? (
          <button className={styles.deleteClientBtn} onClick={() => setShowDeleteConfirm(true)}>
            Delete Client
          </button>
        ) : (
          <div className={styles.deleteConfirmBox}>
            <p className={styles.confirmText}>Permanently delete this client and all their data?</p>
            <div className={styles.confirmActions}>
              <button className={styles.confirmDeleteYes} onClick={handleDeleteClient} disabled={deleting}>
                {deleting ? '…' : 'Yes, Delete'}
              </button>
              <button className={styles.confirmNo} onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
