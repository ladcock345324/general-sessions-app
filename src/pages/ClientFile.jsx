import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useClientFile } from '../hooks/useClientFile'
import styles from './ClientFile.module.css'

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatBond(amount) {
  if (amount == null) return null
  return '$' + Number(amount).toLocaleString()
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
            {event.docket_type}{event.subpoenas ? ` (${event.subpoenas})` : ''}{'  |  '}{(() => { const d = new Date(event.event_date); const day = isNaN(d) ? '' : d.toLocaleDateString('en-US', { weekday: 'long' }) + ' '; return day + event.event_date; })()}{'  |  '}{(() => { const m = event.event_time ? event.event_time.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i) : null; if (!m) return event.event_time; const h = m[1]; const min = m[2] || '00'; const ampm = m[3].toUpperCase(); return `${h}:${min} ${ampm}`; })()}
          </div>
          <div className={styles.nextEventMeta}>
            {event.courtroom ? `Courtroom ${event.courtroom}` : ''} | {event.judge}
          </div>
        </>
      ) : (
        <div className={styles.nextEventEmpty}>No upcoming event</div>
      )}
    </div>
  )
}

// ─── Next Event form ─────────────────────────────────────────────────────────

const EMPTY_EVENT = { docket_type: 'Jail Docket', reason: '', event_date: '', event_time: 'AM', courtroom: '', judge: '', subpoenas: 'w/ subs' }

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

// Format raw digits → H:MM AM/PM as user types
function formatTimeInput(raw) {
  // Preserve AM/PM suffix if already present
  const upper = raw.toUpperCase()
  const isPM = upper.includes('P')
  const suffix = isPM ? ' PM' : ' AM'
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (digits.length === 0) return suffix.trim()
  if (digits.length <= 2) return digits + suffix
  const h = digits.slice(0, digits.length - 2)
  const m = digits.slice(-2)
  return h + ':' + m + suffix
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

  function handleDateChange(e) {
    const formatted = formatDateInput(e.target.value)
    set('event_date', formatted)
  }

  function handleTimeChange(e) {
    const formatted = formatTimeInput(e.target.value)
    set('event_time', formatted)
  }

  async function save() {
    if (!form.event_date.trim() || !form.event_time.trim()) {
      setError('Date and time are required.')
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
            className={styles.formInput}
            value={form.event_date}
            onChange={handleDateChange}
            placeholder="MM/DD/YYYY"
            inputMode="numeric"
          />
        </div>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Time</label>
          <input
            className={styles.formInput}
            value={form.event_time}
            onChange={handleTimeChange}
            placeholder="9:00 AM"
            inputMode="numeric"
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

function IncidentGroup({ clientId, incident: initialIncident, onCaseTap, onCaseAdded }) {
  const storageKey = `incident-open-${clientId}-${initialIncident.id}`
  const [incident, setIncident] = useState(initialIncident)
  const [open, setOpen] = useState(() => sessionStorage.getItem(storageKey) === '1')
  const [showAddCase, setShowAddCase] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editDesc, setEditDesc] = useState('')
  const [editDate, setEditDate] = useState('')
  const committingRef = useRef(false)

  const displayName = incident.incident_description
    ? `${incident.incident_description} (${incident.incident_date})`
    : incident.incident_date

  function startEdit(e) {
    e.stopPropagation()
    setEditDesc(incident.incident_description ?? '')
    setEditDate(incident.incident_date ?? '')
    setEditing(true)
  }

  async function commitEdit() {
    if (committingRef.current) return
    committingRef.current = true
    const newDesc = editDesc.trim()
    const newDate = editDate.trim()
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
      committingRef.current = true  // block the blur that follows
      setEditing(false)
    }
  }

  // Commit only when focus leaves both inputs entirely
  function onEditContainerBlur(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) commitEdit()
  }

  return (
    <div className={styles.incidentGroup}>
      <div
        className={styles.incidentHeader}
        onClick={() => { if (!editing) { setOpen(o => { const next = !o; sessionStorage.setItem(storageKey, next ? '1' : '0'); return next }); setShowAddCase(false) } }}
      >
        <div className={styles.incidentHeaderLeft}>
          {editing ? (
            <div className={styles.incidentEditInputs} onBlur={onEditContainerBlur} onClick={e => e.stopPropagation()}>
              <input
                className={styles.incidentNameInput}
                value={editDesc}
                autoFocus
                placeholder="Description"
                onChange={e => setEditDesc(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <input
                className={`${styles.incidentNameInput} ${styles.incidentDateInput}`}
                value={editDate}
                placeholder="Date"
                onChange={e => setEditDate(e.target.value)}
                onKeyDown={onKeyDown}
              />
            </div>
          ) : (
            <span className={styles.incidentName}>{displayName}</span>
          )}
          {open && !editing && (
            <button className={styles.incidentEditBtn} onClick={startEdit}>
              edit incident
            </button>
          )}
        </div>
        <span className={`${styles.incidentChevron} ${open ? styles.incidentChevronOpen : ''}`}>›</span>
      </div>

      {open && (
        <div className={styles.incidentBody}>
          {(incident.cases ?? []).length === 0 && !showAddCase && (
            <div className={styles.noCasesMsg}>No cases yet</div>
          )}
          {(incident.cases ?? []).map(c => (
            <div key={c.id} className={styles.caseRow} onClick={() => onCaseTap(c.case_number)}>
              <div className={styles.caseInfo}>
                <span className={styles.caseNumber}>{c.case_number}</span>
                <span className={styles.caseCharge}>{c.charge}</span>
                <span className={styles.caseMeta}>
                  {c.warrant_url ? 'Warrant on File' : 'No Warrant'} | {formatBond(c.bond_amount)} bond
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
          <input className={styles.formInput} value={form.entry_date} onChange={e => set('entry_date', e.target.value)} placeholder="6/2/2026" />
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
          <input className={styles.formInput} value={form.entry_date} onChange={e => set('entry_date', e.target.value)} placeholder="6/2/2026" />
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

function CriminalHistorySection({ clientId, initialUrl }) {
  const [url, setUrl] = useState(initialUrl ?? null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
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
    e.target.value = ''
  }

  async function handleView() {
    const path = `criminal-history/${clientId}.pdf`
    const { data, error } = await supabase.storage.from('warrants').createSignedUrl(path, 3600)
    if (error) { alert('Could not open file: ' + error.message); return }
    window.open(data.signedUrl, '_blank')
  }

  return (
    <div className={styles.section}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0f1820', padding: '5px 16px' }}>
        <span className={styles.sectionTitle}>Criminal History</span>
      </div>
      <div className={styles.historyButtons}>
        {url && (
          <button className={styles.historyViewBtn} onClick={handleView}>
            View Criminal History
          </button>
        )}
        <label className={`${styles.historyUploadBtn} ${uploading ? styles.historyUploadDisabled : ''}`}>
          {uploading ? 'Uploading…' : url ? 'Replace Criminal History' : 'Upload Criminal History'}
          <input
            type="file"
            accept="application/pdf"
            className={styles.fileInputHidden}
            disabled={uploading}
            onChange={handleUpload}
          />
        </label>
        {uploadError && <div className={styles.formError}>{uploadError}</div>}
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

  async function handleClose() {
    setClosing(true)
    await supabase.from('clients').update({ relieved_as_counsel: true, relieved_closed: true }).eq('id', id)
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
            {[bond && `Bond: ${bond}`, client.da_name && `DA: ${client.da_name}`].filter(Boolean).join(' | ')}
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
          />
        ))}
        {sortedIncidents.length === 0 && !showIncidentForm && (
          <div className={styles.noEventMsg}>No incidents yet</div>
        )}
      </div>

      {/* ── Hours ── */}
      <HoursSection clientId={id} hours={hours} />

      {/* ── Criminal History ── */}
      <CriminalHistorySection clientId={id} initialUrl={client.criminal_history_url} />

      {/* ── Delete Client ── */}
      <div className={styles.deleteClientSection}>
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

      {/* ── Close / Reopen ── */}
      <div className={styles.closeCaseSection}>
        {!showCloseConfirm ? (
          isRelieved
            ? <button className={styles.reopenCaseBtn} onClick={() => setShowCloseConfirm(true)}>Reopen Case</button>
            : <button className={styles.closeCaseBtn} onClick={() => setShowCloseConfirm(true)}>Close Case</button>
        ) : (
          <div className={styles.confirmBox}>
            <p className={styles.confirmText}>{isRelieved ? 'Reopen this case?' : 'Mark this case as closed?'}</p>
            <div className={styles.confirmActions}>
              <button className={styles.confirmYes} onClick={isRelieved ? handleReopen : handleClose} disabled={closing}>
                {closing ? '…' : isRelieved ? 'Yes, Reopen' : 'Yes, Close'}
              </button>
              <button className={styles.confirmNo} onClick={() => setShowCloseConfirm(false)} disabled={closing}>No</button>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
