import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useLiveQuery } from 'dexie-react-hooks'
import { useClientFile } from '../hooks/useClientFile'
import { extractPdfText } from '../extractPdfText'
import db from '../localDB'
import { addToSyncQueue } from '../syncManager'
import styles from './ClientFile.module.css'
import TextViewerDrawer from '../components/TextViewerDrawer'

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

function formatBond(amount) {
  if (amount == null) return null
  return '$' + Number(amount).toLocaleString()
}

// Convert "M/D/YYYY" → "YYYY-MM-DD" for <input type="date">
function toDateInput(mdy) {
  if (!mdy) return ''
  const parts = mdy.split('/')
  if (parts.length !== 3) return ''
  const [m, d, y] = parts
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

// Convert "YYYY-MM-DD" → "M/D/YYYY" for storage and display
function fromDateInput(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}/${y}`
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
              const parts = [
                (event.docket_type || ''),
                day + event.event_date,
                ...(t && /\d:\d{2}\s*(AM|PM)/i.test(t) ? [t] : []),
              ]
              return parts.map((p, i) => (
                <span key={i}>{i > 0 && <span className={styles.pipe}>|</span>}{p}</span>
              ))
            })()}
          </div>
          <div className={styles.nextEventMeta}>
            {(() => {
              const segments = [
                ...(event.reason ? [event.reason] : []),
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

const DOCKET_PRESETS = ['Jail Docket', 'Bond Docket', 'Review Docket', 'Settlement Docket']

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

const EMPTY_EVENT = { docketPreset: 'Jail Docket', docketCustom: '', reason: '', event_date: '', event_time: '9:00 AM', courtroom: '', judge: '', ada_name: '' }

const COURTROOMS = ['', '3A', '3B', '3C', '4B', '4C', '4D', '5C', '5D']

const JUDGES = [
  '',
  'J. Bell',
  'R. Bell',
  'M. Blackburn',
  'S. Coleman',
  'A. Escobar',
  'R. Hayes (PRESIDING)',
  'J. Holt',
  'L. Jones',
  'M. Floyd',
  'G. Robinson',
  'A. Walker',
  'Other',
]

// Format raw digits → M/DD/YYYY or MM/DD/YYYY as user types.
// Month: single digit if first digit is 2-9; two digits if first digit is 1
//        and second digit is 0-2; otherwise single digit.
// Day:   single digit if first digit is 4-9; two digits otherwise.
function formatDateInput(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (!digits) return ''

  // ── Parse month ──────────────────────────────────────────────────────────
  let pos = 0
  let month = ''
  const m0 = digits[0]
  if (m0 >= '2' && m0 <= '9') {
    month = m0; pos = 1                          // single-digit month complete
  } else if (m0 === '1') {
    if (digits.length > 1) {
      const m1 = digits[1]
      if (m1 >= '0' && m1 <= '2') { month = m0 + m1; pos = 2 }   // 10/11/12
      else                         { month = m0;       pos = 1 }   // 1, next digit → day
    } else {
      return '1'                                 // still typing month
    }
  } else {
    // '0': always two-digit month
    if (digits.length > 1) { month = m0 + digits[1]; pos = 2 }
    else                    return m0
  }

  const rest = digits.slice(pos)
  if (!rest.length) return month + '/'

  // ── Parse day ────────────────────────────────────────────────────────────
  let day = ''
  let pos2 = 0
  const d0 = rest[0]
  if (d0 >= '4' && d0 <= '9') {
    day = d0; pos2 = 1                           // single-digit day complete
  } else if (d0 >= '1' && d0 <= '3') {
    if (rest.length > 1) { day = d0 + rest[1]; pos2 = 2 }
    else                  return month + '/' + d0
  } else {
    // '0': two-digit day
    if (rest.length > 1) { day = d0 + rest[1]; pos2 = 2 }
    else                  return month + '/' + d0
  }

  const year = rest.slice(pos2, pos2 + 4)
  if (!year.length) return month + '/' + day + '/'
  return month + '/' + day + '/' + year
}

// Convert "H:MM AM/PM" or "HH:MM AM/PM" → "HH:MM" for <input type="time">
function toTimeInput(ampm) {
  if (!ampm) return ''
  const m = ampm.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return ''
  let h = parseInt(m[1], 10)
  const min = m[2]
  const period = m[3].toUpperCase()
  if (period === 'AM' && h === 12) h = 0
  if (period === 'PM' && h !== 12) h += 12
  return `${String(h).padStart(2, '0')}:${min}`
}

// Convert "HH:MM" → "H:MM AM/PM" for storage and display
function fromTimeInput(hhmm) {
  if (!hhmm) return ''
  const [hStr, min] = hhmm.split(':')
  let h = parseInt(hStr, 10)
  const period = h >= 12 ? 'PM' : 'AM'
  if (h === 0) h = 12
  else if (h > 12) h -= 12
  return `${h}:${min} ${period}`
}

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
          ada_name:    existing.ada_name ?? '',
        }
      : { ...EMPTY_EVENT, judgeOther: '' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

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
    if (!form.event_date.trim()) {
      setError('Date is required.')
      return
    }
    setSaving(true)
    setError(null)

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
      <div className={styles.formTwoCol}>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Docket Type</label>
          <select className={styles.formSelect} value={form.docketPreset} onChange={e => set('docketPreset', e.target.value)}>
            <option value="">—</option>
            {DOCKET_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <input
            className={styles.formInput}
            style={{ marginTop: 6 }}
            value={form.docketCustom}
            onChange={e => set('docketCustom', e.target.value)}
            placeholder="Add'l text (optional)"
          />
        </div>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Reason</label>
          <select className={styles.formSelect} value={form.reason} onChange={e => set('reason', e.target.value)}>
            <option value="">—</option>
            <option>Trial</option>
            <option>Settlement</option>
          </select>
        </div>
      </div>
      <div className={styles.formTwoCol}>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Date</label>
          <input
            type="date"
            className={styles.formInput}
            value={toDateInput(form.event_date)}
            onChange={e => set('event_date', fromDateInput(e.target.value))}
          />
        </div>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Time</label>
          <input
            type="time"
            className={styles.formInput}
            value={toTimeInput(form.event_time)}
            onChange={e => set('event_time', fromTimeInput(e.target.value))}
          />
        </div>
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Courtroom</label>
        <select className={styles.formSelect} value={form.courtroom} onChange={e => set('courtroom', e.target.value)}>
          {COURTROOMS.map(c => <option key={c} value={c}>{c || '—'}</option>)}
        </select>
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
        <label className={styles.formLabel}>Assistant DA Name</label>
        <input
          className={styles.formInput}
          value={form.ada_name}
          onChange={e => set('ada_name', e.target.value)}
          placeholder="Optional"
        />
      </div>
      {error && <div className={styles.formError}>{error}</div>}
      <div className={styles.formActions}>
        <button className={styles.formSave} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className={styles.formCancel} onClick={onCancel} disabled={saving}>Cancel</button>
        {existing && <button className={styles.formClear} onClick={clear} disabled={saving}>Clear</button>}
      </div>
    </div>
  )
}

// ─── Add Incident form ────────────────────────────────────────────────────────

function AddIncidentForm({ clientId, onSaved, onCancel }) {
  const [form, setForm] = useState({ incident_description: '', incident_date: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    if (!form.incident_description.trim() || !form.incident_date.trim()) {
      setError('Description and date are required.')
      return
    }
    setSaving(true)
    setError(null)
    const newId = crypto.randomUUID()
    const record = {
      id: newId,
      client_id: clientId,
      incident_description: form.incident_description.trim(),
      incident_date: form.incident_date.trim(),
    }
    await db.incidents.put(record)
    await addToSyncQueue('incidents', 'INSERT', newId, record)
    onSaved()
  }

  return (
    <div className={styles.inlineForm}>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Description *</label>
        <input className={styles.formInput} value={form.incident_description} onChange={e => set('incident_description', e.target.value)} placeholder="e.g. Watch Theft Incident" />
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Date *</label>
        <input
          type="date"
          className={styles.formInput}
          value={toDateInput(form.incident_date)}
          onChange={e => set('incident_date', fromDateInput(e.target.value))}
        />
      </div>
      {error && <div className={styles.formError}>{error}</div>}
      <div className={styles.formActions}>
        <button className={styles.formSave} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className={styles.formCancel} onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  )
}

// ─── Add Case form (under a specific incident) ────────────────────────────────

// Charge classification, least-serious → most-serious. Blank = unset (stored null).
const CLASSIFICATIONS = ['', 'C MIS', 'B MIS', 'A MIS', 'E FEL', 'D FEL', 'C FEL', 'B FEL', 'A FEL', 'CAPITAL']

const EMPTY_CASE = { case_number: '', charge: '', charge_abbrev: '', classification: '', bond_amount: '' }

function AddCaseForm({ incidentId, onSaved, onCancel }) {
  const [form, setForm] = useState(EMPTY_CASE)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    if (!form.case_number.trim() || !form.charge.trim()) {
      setError('Case number and charge are required.')
      return
    }
    setSaving(true)
    setError(null)
    const newId = crypto.randomUUID()
    const record = {
      id: newId,
      incident_id: incidentId,
      case_number: form.case_number.trim(),
      charge: form.charge.trim(),
      charge_abbrev: form.charge_abbrev.trim() || null,
      classification: form.classification || null,
      bond_amount: form.bond_amount ? Number(form.bond_amount) : null,
    }
    await db.cases.put(record)
    await addToSyncQueue('cases', 'INSERT', newId, record)
    onSaved()
  }

  return (
    <div className={styles.inlineForm}>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Case Number *</label>
        <input className={styles.formInput} value={form.case_number} onChange={e => set('case_number', e.target.value)} placeholder="e.g. GS1041482" />
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Charge *</label>
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
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Bond Amount</label>
        <div className={styles.formPrefixInput}>
          <span className={styles.formPrefix}>$</span>
          <input className={`${styles.formInput} ${styles.formInputPrefixed}`} type="number" min="0" value={form.bond_amount} onChange={e => set('bond_amount', e.target.value)} placeholder="Optional" />
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

// ─── Incident group ──────────────────────────────────────────────────────────

function IncidentGroup({ clientId, incident: initialIncident, onCaseTap, onCaseAdded, onDeleted }) {
  const [incident, setIncident] = useState(initialIncident)
  const [open, setOpen] = useState(false)
  const [showAddCase, setShowAddCase] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editDesc, setEditDesc] = useState('')
  const [editDate, setEditDate] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const committingRef = useRef(false)

  function startEdit(e) {
    e.stopPropagation()
    setEditDesc(incident.incident_description ?? '')
    setEditDate(toDateInput(incident.incident_date ?? ''))
    setEditing(true)
  }

  async function commitEdit() {
    if (committingRef.current) return
    committingRef.current = true
    const newDesc = editDesc.trim()
    const newDate = fromDateInput(editDate)
    const unchanged = newDesc === (incident.incident_description ?? '') &&
                      newDate === (incident.incident_date ?? '')
    if (!newDate || unchanged) {
      setEditing(false)
      committingRef.current = false
      return
    }
    const changes = { incident_description: newDesc || null, incident_date: newDate }
    await db.incidents.update(incident.id, changes)
    await addToSyncQueue('incidents', 'UPDATE', incident.id, { id: incident.id, ...changes })
    setIncident(prev => ({ ...prev, incident_description: newDesc || null, incident_date: newDate }))
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

  return (
    <div className={styles.incidentGroup}>
      <div
        className={styles.incidentHeader}
        onClick={() => { if (!editing) { setOpen(o => !o); setShowAddCase(false) } }}
      >
        <div className={styles.incidentHeaderLeft}>
          {editing ? (
            <div className={styles.incidentEditInputs} onBlur={onEditContainerBlur} onClick={e => e.stopPropagation()}>
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
                type="date"
                className={`${styles.incidentNameInput} ${styles.incidentDateInput}`}
                value={editDate}
                onChange={e => setEditDate(e.target.value)}
                onKeyDown={onKeyDown}
              />
            </div>
          ) : (
            <div className={styles.incidentNameRow}>
              <span className={styles.incidentDatePart}>{incident.incident_date}</span>
              {incident.incident_description && (
                <span className={styles.incidentDescPart}>&nbsp;—&nbsp;{incident.incident_description}</span>
              )}
            </div>
          )}
          {open && !editing && (
            <button className={styles.incidentEditBtn} onClick={startEdit}>
              edit incident
            </button>
          )}
        </div>
        <button
          className={styles.incidentDeleteBtn}
          onClick={e => { e.stopPropagation(); setShowDeleteConfirm(true) }}
        >×</button>
      </div>

      {open && (
        <div className={styles.incidentBody}>
          {(initialIncident.cases ?? []).length === 0 && !showAddCase && (
            <div className={styles.noCasesMsg}>No cases yet</div>
          )}
          {[...(initialIncident.cases ?? [])].sort((a, b) => a.case_number.localeCompare(b.case_number)).map(c => (
            <div key={c.id} className={styles.caseRow} {...tapHandlers(() => onCaseTap(c.case_number))} style={{ cursor: 'pointer', userSelect: 'text' }}>
              <div className={styles.caseInfo}>
                <span className={styles.caseNumber}>{c.case_number}</span>
                <span className={styles.caseCharge}>{c.charge}{c.classification ? ` (${c.classification})` : ''}</span>
                <span className={styles.caseMeta}>
                  {c.warrant_url ? 'Affidavit on File' : 'No Affidavit'}<span className={styles.pipe}>|</span>{formatBond(c.bond_amount)} bond
                </span>
              </div>
              <span className={styles.caseChevron}>›</span>
            </div>
          ))}
          {showAddCase ? (
            <AddCaseForm
              incidentId={incident.id}
              onSaved={() => { setShowAddCase(false); onCaseAdded() }}
              onCancel={() => setShowAddCase(false)}
            />
          ) : (
            <button className={styles.addCaseInlineBtn} onClick={() => setShowAddCase(true)}>
              + add a case
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Personal Notes section ──────────────────────────────────────────────────

function PersonalNotesSection({ clientId, initialNote }) {
  const [note, setNote] = useState(initialNote ?? null)
  const [open, setOpen] = useState(false)
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

const HOURS_OPTIONS = ['0.1','0.2','0.3','0.4','0.5','0.6','0.7','0.8','0.9']

function todayString() {
  const d = new Date()
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

function AddHoursForm({ clientId, onSaved, onCancel }) {
  const [form, setForm] = useState({ entry_date: todayString(), hours: '0.5', description: '' })
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
    const record = {
      id: newId,
      client_id: clientId,
      entry_date: form.entry_date.trim(),
      hours: Number(form.hours),
      description: form.description.trim(),
    }
    await db.hours.put(record)
    await addToSyncQueue('hours', 'INSERT', newId, record)
    onSaved()
  }

  return (
    <div className={styles.inlineForm}>
      <div className={styles.formTwoCol}>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Date</label>
          <input type="date" className={styles.formInput} value={toDateInput(form.entry_date)} onChange={e => set('entry_date', fromDateInput(e.target.value))} />
        </div>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Hours</label>
          <select className={styles.formSelect} value={form.hours} onChange={e => set('hours', e.target.value)}>
            {HOURS_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Description</label>
        <input className={styles.formInput} value={form.description} onChange={e => set('description', e.target.value)} placeholder="e.g. Court appearance" />
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
    onSaved()
  }

  return (
    <div className={styles.inlineForm}>
      <div className={styles.formTwoCol}>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Date</label>
          <input type="date" className={styles.formInput} value={toDateInput(form.entry_date)} onChange={e => set('entry_date', fromDateInput(e.target.value))} />
        </div>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Hours</label>
          <select className={styles.formSelect} value={form.hours} onChange={e => set('hours', e.target.value)}>
            {HOURS_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Description</label>
        <input className={styles.formInput} value={form.description} onChange={e => set('description', e.target.value)} placeholder="e.g. Court appearance" />
      </div>
      {error && <div className={styles.formError}>{error}</div>}
      <div className={styles.formActions}>
        <button className={styles.formSave} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className={styles.formCancel} onClick={onCancel} disabled={saving}>Back</button>
      </div>
    </div>
  )
}

function HoursSection({ clientId, hours }) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)

  const total = (hours ?? []).reduce((sum, e) => sum + Number(e.hours), 0)

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
        {!showForm && <button className={styles.addBtn} onClick={() => setShowForm(true)}>+</button>}
      </div>
      {showForm && (
        <AddHoursForm
          clientId={clientId}
          onSaved={handleSaved}
          onCancel={() => setShowForm(false)}
        />
      )}
      <div className={styles.hoursTable}>
        <div className={styles.hoursHead}>
          <span>Date</span><span>Hours</span><span>Description</span>
        </div>
        {(hours ?? []).length === 0 && <div className={styles.hoursEmpty}>No entries yet</div>}
        {(hours ?? []).map((entry, i) => {
          if (editingId === entry.id) {
            return (
              <div key={entry.id ?? i}>
                <EditHoursForm
                  entry={entry}
                  onSaved={handleEditSaved}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            )
          }
          if (confirmingId === entry.id) {
            return (
              <div key={entry.id ?? i} className={styles.hoursConfirmRow}>
                <span className={styles.hoursConfirmText}>Delete this entry?</span>
                <div className={styles.hoursConfirmActions}>
                  <button className={styles.hoursConfirmYes} onClick={() => confirmDelete(entry)}>Yes, delete</button>
                  <button className={styles.hoursConfirmCancel} onClick={() => setConfirmingId(null)}>Cancel</button>
                </div>
              </div>
            )
          }
          return (
            <div
              key={entry.id ?? i}
              className={styles.hoursRow}
              onClick={() => { if (entry.id) setEditingId(entry.id) }}
              style={{ cursor: 'pointer' }}
            >
              <span>{entry.entry_date}</span>
              <span className={styles.hoursValue}>{entry.hours}</span>
              <span>{entry.description}</span>
              <button
                className={styles.hoursDeleteBtn}
                onClick={e => { e.stopPropagation(); setConfirmingId(entry.id) }}
              >×</button>
            </div>
          )
        })}
        {(hours ?? []).length > 0 && (
          <div className={styles.hoursTotal}>
            <span>Total</span>
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
    // Text extraction — .then() must be async so the await executes the query
    // (PostgrestFilterBuilder is lazy — unawaited calls are silently discarded).
    extractPdfText(file).then(async text => {
      const { error: textErr } = await supabase
        .from('clients')
        .update({ criminal_history_text: text ?? null })
        .eq('id', clientId)
      if (textErr) console.error('[criminal_history_text] PATCH failed:', textErr.message)
      else await db.clients.update(clientId, { criminal_history_text: text ?? null })
    }).catch(err => console.error('[criminal_history_text] extraction error:', err))
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

    const fileRef = formFile
    setFormName('')
    setFormFile(null)
    setShowForm(false)
    setSaving(false)

    // Text extraction — rule 7: keep direct Supabase write + update Dexie
    // .then() must be async so the await executes the query
    // (PostgrestFilterBuilder is lazy — unawaited calls are silently discarded).
    extractPdfText(fileRef).then(async text => {
      const { error: textErr } = await supabase
        .from('courtroom_documents')
        .update({ extracted_text: text ?? null })
        .eq('id', newId)
      if (textErr) console.error('[extracted_text] PATCH failed:', textErr.message)
      else await db.courtroom_documents.update(newId, { extracted_text: text ?? null })
    }).catch(err => console.error('[extracted_text] extraction error:', err))
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

  const totalBond = incidents.flatMap(inc => inc.cases ?? []).reduce((sum, c) => sum + (Number(c.bond_amount) || 0), 0)
  const sortedIncidents = [...incidents].sort((a, b) => new Date(b.incident_date) - new Date(a.incident_date))

  return (
    <div className={styles.screen}>

      {/* ── Sticky name bar ── */}
      <div className={styles.stickyNameBar}>{nameCore}</div>

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
            <div className={styles.bondLine}>
              {[`Total Bond: $${totalBond.toLocaleString()}`].filter(Boolean).map((seg, i) => (
                <span key={i}>{i > 0 && <span className={styles.pipe}>|</span>}{seg}</span>
              ))}
            </div>
          </div>
          <div className={styles.badgeStack}>
            {client.custody_status === 'in_custody' && <span className={`${styles.badge} ${isClosed ? styles.badgeGray : styles.badgeRed}`}>In Custody</span>}
            {client.custody_status === 'bonded_out' && <span className={`${styles.badge} ${isClosed ? styles.badgeGray : styles.badgeGreen}`}>Bonded Out</span>}
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
          {!showIncidentForm && (
            <button className={styles.addBtn} onClick={() => setShowIncidentForm(true)}>+</button>
          )}
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
            clientId={id}
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
