import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useClientFile } from '../hooks/useClientFile'
import styles from './ClientFile.module.css'

// ─── Tap-safe click helper ───────────────────────────────────────────────────
// Returns onPointerDown/onPointerUp props that only fire `handler` when the
// pointer moved less than 5px — distinguishes a tap from a drag-to-select.
function tapHandlers(handler) {
  if (!handler) return {}
  const start = { x: 0, y: 0 }
  return {
    onPointerDown: e => { start.x = e.clientX; start.y = e.clientY },
    onPointerUp:   e => {
      if (Math.abs(e.clientX - start.x) < 5 && Math.abs(e.clientY - start.y) < 5) handler()
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
                (event.docket_type || '') + (event.subpoenas ? ` (${event.subpoenas})` : ''),
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

const EMPTY_EVENT = { docket_type: 'Jail Docket', reason: '', event_date: '', event_time: '9:00 AM', courtroom: '', judge: '', subpoenas: 'w/ subs' }

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

function NextEventForm({ clientId, existing, onSaved, onCancel }) {
  const existingJudge = existing?.judge ?? ''
  const judgeInList = JUDGES.includes(existingJudge)

  const [form, setForm] = useState(
    existing
      ? {
          docket_type: existing.docket_type,
          reason:      existing.reason ?? '',
          event_date:  existing.event_date,
          event_time:  existing.event_time,
          courtroom:   existing.courtroom,
          judge:       judgeInList ? existingJudge : 'Other',
          judgeOther:  judgeInList ? '' : existingJudge,
          subpoenas:   existing.subpoenas ?? '',
        }
      : { ...EMPTY_EVENT, judgeOther: '' }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    if (!form.event_date.trim()) {
      setError('Date is required.')
      return
    }
    setSaving(true)
    setError(null)

    const { judgeOther, ...rest } = form
    const payload = { ...rest, judge: form.judge === 'Other' ? judgeOther.trim() : form.judge }

    if (existing) {
      const { error: e } = await supabase
        .from('next_events')
        .update(payload)
        .eq('client_id', clientId)
      if (e) { setError(e.message); setSaving(false); return }
    } else {
      const { error: e } = await supabase
        .from('next_events')
        .insert({ client_id: clientId, ...payload })
      if (e) { setError(e.message); setSaving(false); return }
    }
    onSaved()
  }

  return (
    <div className={styles.inlineForm}>
      <div className={styles.formTwoCol}>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Docket Type</label>
          <select className={styles.formSelect} value={form.docket_type} onChange={e => set('docket_type', e.target.value)}>
            <option>Jail Docket</option>
            <option>Bond Docket</option>
            <option>Review Docket</option>
          </select>
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
        <label className={styles.formLabel}>Subpoenas</label>
        <select className={styles.formSelect} value={form.subpoenas} onChange={e => set('subpoenas', e.target.value)}>
          <option value="w/ subs">w/ subs</option>
          <option value="w/out subs">w/out subs</option>
          <option value="">—</option>
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
    const { error: e } = await supabase.from('incidents').insert({
      client_id: clientId,
      incident_description: form.incident_description.trim(),
      incident_date: form.incident_date.trim(),
    })
    if (e) { setError(e.message); setSaving(false); return }
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

// ─── Edit Incident form ───────────────────────────────────────────────────────

function EditIncidentForm({ incident, onSaved, onCancel }) {
  const [form, setForm] = useState({
    incident_description: incident.incident_description ?? '',
    incident_date: incident.incident_date ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    if (!form.incident_date.trim()) { setError('Date is required.'); return }
    setSaving(true)
    setError(null)
    const { error: e } = await supabase.from('incidents').update({
      incident_description: form.incident_description.trim() || null,
      incident_date: form.incident_date.trim(),
    }).eq('id', incident.id)
    if (e) { setError(e.message); setSaving(false); return }
    onSaved({ ...incident, ...form })
  }

  return (
    <div className={styles.inlineForm}>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Description</label>
        <input className={styles.formInput} value={form.incident_description} onChange={e => set('incident_description', e.target.value)} placeholder="e.g. Watch Theft Incident" />
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Date *</label>
        <input
          className={styles.formInput}
          value={form.incident_date}
          onChange={e => set('incident_date', formatDateInput(e.target.value))}
          placeholder="MM/DD/YYYY"
          inputMode="numeric"
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

const EMPTY_CASE = { case_number: '', charge: '', bond_amount: '' }

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
    const { error: ce } = await supabase.from('cases').insert({
      incident_id: incidentId,
      case_number: form.case_number.trim(),
      charge: form.charge.trim(),
      bond_amount: form.bond_amount ? Number(form.bond_amount) : null,
    })
    if (ce) { setError(ce.message); setSaving(false); return }
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
    const { error } = await supabase
      .from('incidents')
      .update({ incident_description: newDesc || null, incident_date: newDate })
      .eq('id', incident.id)
    if (!error) setIncident(prev => ({ ...prev, incident_description: newDesc || null, incident_date: newDate }))
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
    await supabase.from('cases').delete().eq('incident_id', incident.id)
    await supabase.from('incidents').delete().eq('id', incident.id)
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
              <input
                type="date"
                className={`${styles.incidentNameInput} ${styles.incidentDateInput}`}
                value={editDate}
                autoFocus
                onChange={e => setEditDate(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <textarea
                className={styles.incidentNameInput}
                value={editDesc}
                placeholder="Description"
                rows={3}
                style={{ resize: 'none' }}
                onChange={e => setEditDesc(e.target.value)}
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
          {(incident.cases ?? []).length === 0 && !showAddCase && (
            <div className={styles.noCasesMsg}>No cases yet</div>
          )}
          {(incident.cases ?? []).map(c => (
            <div key={c.id} className={styles.caseRow} {...tapHandlers(() => onCaseTap(c.case_number))} style={{ cursor: 'pointer', userSelect: 'text' }}>
              <div className={styles.caseInfo}>
                <span className={styles.caseNumber}>{c.case_number}</span>
                <span className={styles.caseCharge}>{c.charge}</span>
                <span className={styles.caseMeta}>
                  {c.warrant_url ? 'Warrant on File' : 'No Warrant'}<span className={styles.pipe}>|</span>{formatBond(c.bond_amount)} bond
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
    const { error: e } = await supabase.from('hours').insert({
      client_id: clientId,
      entry_date: form.entry_date.trim(),
      hours: Number(form.hours),
      description: form.description.trim(),
    })
    if (e) { setError(e.message); setSaving(false); return }
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
    const { error: e } = await supabase.from('hours').update({
      entry_date: form.entry_date.trim(),
      hours: Number(form.hours),
      description: form.description.trim(),
    }).eq('id', entry.id)
    if (e) { setError(e.message); setSaving(false); return }
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

function HoursSection({ clientId, hours: initialHours }) {
  const [hours, setHours] = useState(
    [...(initialHours ?? [])].sort((a, b) => new Date(b.entry_date) - new Date(a.entry_date))
  )
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)

  const total = hours.reduce((sum, e) => sum + Number(e.hours), 0)

  async function refreshHours() {
    const { data } = await supabase
      .from('hours')
      .select('*')
      .eq('client_id', clientId)
      .order('entry_date', { ascending: false })
    if (data) setHours(data)
  }

  async function handleSaved() {
    await refreshHours()
    setShowForm(false)
  }

  async function handleEditSaved() {
    await refreshHours()
    setEditingId(null)
  }

  async function confirmDelete(entry, i) {
    if (entry.id) await supabase.from('hours').delete().eq('id', entry.id)
    setHours(prev => prev.filter((_, idx) => idx !== i))
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
        {hours.length === 0 && <div className={styles.hoursEmpty}>No entries yet</div>}
        {hours.map((entry, i) => {
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
                  <button className={styles.hoursConfirmYes} onClick={() => confirmDelete(entry, i)}>Yes, delete</button>
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
        {hours.length > 0 && (
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

  async function uploadHistoryFile(file) {
    setUploading(true)
    setUploadError(null)
    const path = `criminal-history/${clientId}.pdf`
    const { error: uploadErr } = await supabase.storage
      .from('warrants')
      .upload(path, file, { contentType: 'application/pdf', upsert: true })
    if (uploadErr) { setUploadError(uploadErr.message); setUploading(false); return }
    const { data: urlData } = await supabase.storage.from('warrants').getPublicUrl(path)
    const { error: updateErr } = await supabase
      .from('clients')
      .update({ criminal_history_url: urlData.publicUrl })
      .eq('id', clientId)
    if (updateErr) { setUploadError(updateErr.message); setUploading(false); return }
    setUrl(urlData.publicUrl)
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
    await supabase.from('clients').update({ criminal_history_url: null }).eq('id', clientId)
    setUrl(null)
    setShowDeleteConfirm(false)
    setDeleting(false)
    onDeleted()
  }

  return (
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
              <button className={styles.historyViewBtn} onClick={handleView}>
                View Criminal History
              </button>
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
  )
}

// ─── Courtroom Documents section ─────────────────────────────────────────────

function CourtroomDocsSection({ clientId }) {
  const [docs, setDocs] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formFile, setFormFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchDocs()
  }, [clientId])

  async function fetchDocs() {
    const { data } = await supabase
      .from('courtroom_documents')
      .select('*')
      .eq('client_id', clientId)
      .order('id', { ascending: true })
    if (data) setDocs(data)
  }

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

    const { error: insertErr } = await supabase
      .from('courtroom_documents')
      .insert({ client_id: clientId, name: formName.trim(), file_url: path })

    if (insertErr) { setFormError(insertErr.message); setSaving(false); return }

    setFormName('')
    setFormFile(null)
    setShowForm(false)
    setSaving(false)
    fetchDocs()
  }

  async function handleView(doc) {
    const { data, error } = await supabase.storage.from('warrants').createSignedUrl(doc.file_url, 3600)
    if (error) { alert('Could not open file: ' + error.message); return }
    window.open(data.signedUrl, '_blank')
  }

  async function handleRename(doc) {
    if (!renameValue.trim()) return
    await supabase.from('courtroom_documents').update({ name: renameValue.trim() }).eq('id', doc.id)
    setRenamingId(null)
    fetchDocs()
  }

  async function handleDelete(doc) {
    setDeleting(true)
    await supabase.storage.from('warrants').remove([doc.file_url])
    await supabase.from('courtroom_documents').delete().eq('id', doc.id)
    setConfirmDeleteId(null)
    setDeleting(false)
    fetchDocs()
  }

  const atMax = docs.length >= 5

  return (
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
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ClientFile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { client, incidents, nextEvent, hours, loading, error, refetch } = useClientFile(id)

  const [showEventForm, setShowEventForm] = useState(false)
  const [showIncidentForm, setShowIncidentForm] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [showRelieveConfirm, setShowRelieveConfirm] = useState(false)
  const [closing, setClosing] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDeleteClient() {
    setDeleting(true)
    // Delete in dependency order
    await supabase.from('hours').delete().eq('client_id', id)
    await supabase.from('next_events').delete().eq('client_id', id)
    const { data: incidentRows } = await supabase
      .from('incidents').select('id').eq('client_id', id)
    if (incidentRows?.length) {
      const incidentIds = incidentRows.map(r => r.id)
      await supabase.from('cases').delete().in('incident_id', incidentIds)
      await supabase.from('incidents').delete().eq('client_id', id)
    }
    await supabase.from('clients').delete().eq('id', id)
    navigate('/')
  }

  const isRelieved = client?.relieved_as_counsel === true
  const isClosed   = client?.relieved_closed === true

  async function handleClose() {
    setClosing(true)
    await supabase.from('clients').update({ relieved_closed: true }).eq('id', id)
    setClosing(false)
    setShowCloseConfirm(false)
    refetch()
  }

  async function handleRelieve() {
    setClosing(true)
    await supabase.from('clients').update({ relieved_as_counsel: true }).eq('id', id)
    navigate('/')
  }

  async function handleReopen() {
    setClosing(true)
    await supabase.from('clients').update({ relieved_as_counsel: false, relieved_closed: false }).eq('id', id)
    navigate('/')
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

  const nameDisplay = client.oca
    ? `${client.last_name}, ${client.first_name} (${client.gender}, ${client.age}) #${client.oca}`
    : `${client.last_name}, ${client.first_name} (${client.gender}, ${client.age})`

  const bond = formatBond(client.bond_amount)
  const sortedIncidents = [...incidents].sort((a, b) => new Date(b.incident_date) - new Date(a.incident_date))

  return (
    <div className={styles.screen}>

      {/* ── Client header ── */}
      <div className={styles.clientHeader}>
        <header className={styles.header}>
          <button className={styles.back} onClick={() => navigate(-1)}>‹ Back</button>
          <button className={styles.editBtn} onClick={() => navigate(`/client/${id}/edit`)}>Edit</button>
        </header>
        <div className={styles.nameRow}>
          <h1 className={styles.name}>{nameDisplay}</h1>
          {client.custody_status === 'in_custody' && <span className={`${styles.badge} ${styles.badgeOrange}`}>In Custody</span>}
          {client.custody_status === 'bonded_out' && <span className={`${styles.badge} ${styles.badgeGreen}`}>Bonded Out</span>}
        </div>
        {(bond || client.da_name) && (
          <div className={styles.bondLine}>
            {[bond && `Bond: ${bond}`, client.da_name && `ADA: ${client.da_name}`].filter(Boolean).map((seg, i) => (
              <span key={i}>{i > 0 && <span className={styles.pipe}>|</span>}{seg}</span>
            ))}
          </div>
        )}
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
          />
        )}
      </div>

      {/* ── Incidents ── */}
      <div className={styles.incidentsWrapper}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0f1820', padding: '5px 16px' }}>
          <span className={styles.sectionTitle}>Incidents</span>
          {!showIncidentForm && (
            <button className={styles.incidentSectionAddBtn} onClick={() => setShowIncidentForm(true)}>+ add incident</button>
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

      {/* ── Close / Relieve / Reopen ── */}
      <div className={styles.closeCaseSection}>
        {isRelieved ? (
          /* ── Reopen ── */
          !showCloseConfirm ? (
            <button className={styles.reopenCaseBtn} onClick={() => setShowCloseConfirm(true)}>Reopen Case</button>
          ) : (
            <div className={styles.confirmBox}>
              <p className={styles.confirmText}>Reopen this case?</p>
              <div className={styles.confirmActions}>
                <button className={styles.confirmYes} onClick={handleReopen} disabled={closing}>{closing ? '…' : 'Yes, Reopen'}</button>
                <button className={styles.confirmNo} onClick={() => setShowCloseConfirm(false)} disabled={closing}>No</button>
              </div>
            </div>
          )
        ) : (
          /* ── Close Case + Relieved as Counsel ── */
          <div className={styles.closeCaseBtnRow}>
            {!showCloseConfirm && !showRelieveConfirm && (
              <>
                <button className={styles.closeCaseBtn} onClick={() => setShowCloseConfirm(true)}>
                  {isClosed ? 'Reopen Case' : 'Close Case'}
                </button>
                <button className={styles.relieveCaseBtn} onClick={() => setShowRelieveConfirm(true)}>Relieved as Counsel</button>
              </>
            )}
            {showCloseConfirm && (
              <div className={styles.confirmBox}>
                <p className={styles.confirmText}>{isClosed ? 'Reopen this case?' : 'Mark this case as closed?'}</p>
                <div className={styles.confirmActions}>
                  <button className={styles.confirmYes} onClick={isClosed ? () => { setClosing(true); supabase.from('clients').update({ relieved_closed: false }).eq('id', id).then(() => { setClosing(false); setShowCloseConfirm(false); refetch() }) } : handleClose} disabled={closing}>
                    {closing ? '…' : isClosed ? 'Yes, Reopen' : 'Yes, Close'}
                  </button>
                  <button className={styles.confirmNo} onClick={() => setShowCloseConfirm(false)} disabled={closing}>No</button>
                </div>
              </div>
            )}
            {showRelieveConfirm && (
              <div className={styles.confirmBox} style={{ borderColor: 'rgba(200, 80, 60, 0.35)' }}>
                <p className={styles.confirmText}>Mark as relieved as counsel and move to the Relieved section?</p>
                <div className={styles.confirmActions}>
                  <button className={styles.confirmYes} onClick={handleRelieve} disabled={closing}>{closing ? '…' : 'Yes, Relieve'}</button>
                  <button className={styles.confirmNo} onClick={() => setShowRelieveConfirm(false)} disabled={closing}>No</button>
                </div>
              </div>
            )}
          </div>
        )}
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
