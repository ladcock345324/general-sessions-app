import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toDateInput, fromDateInput, pickerHandlers } from '../dateUtils'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from '../supabaseClient'
import { extractPdfText } from '../extractPdfText'
import db from '../localDB'
import { addToSyncQueue } from '../syncManager'
import { touchClient } from '../touchClient'
import styles from './CaseView.module.css'
import TextViewerDrawer from '../components/TextViewerDrawer'
import { useScrollToTopOnMount } from '../scrollHold'

// Charge classification, most-serious → least-serious. Blank = unset (stored
// null) and stays first — it's the placeholder, not a severity level.
// Kept byte-identical to the copy in ClientFile.jsx.
const CLASSIFICATIONS = ['', 'CAPITAL', 'A FEL', 'B FEL', 'C FEL', 'D FEL', 'E FEL', 'A MIS', 'B MIS', 'C MIS', 'MIS']

// Case-level release condition. release_status is independent of the client-level
// custody_status (a case's condition vs. where the client physically is).
const RELEASE_LABELS = { held_without_bond: 'Held without bond', pretrial_released: 'Pretrial Released', ror: "ROR'd" }

// Per-case bond/status line — decides independently. bond set (incl. 0) → "$X bond";
// release_status set → its label; both → "$X bond · Label"; both null → "".
function bondStatusText(bondAmount, releaseStatus) {
  const segs = []
  if (bondAmount != null) segs.push(`$${Number(bondAmount).toLocaleString()} bond`)
  if (releaseStatus && RELEASE_LABELS[releaseStatus]) segs.push(RELEASE_LABELS[releaseStatus])
  return segs.join(' · ')
}

// ─── Edit form ───────────────────────────────────────────────────────────────

// clientId comes from the page's own live query, which already walks
// case → incident → client for the header name — no extra lookup needed.
function EditCaseForm({ caseData, clientId, onSaved, onCancel }) {
  const [form, setForm] = useState({
    case_number:    caseData.case_number    ?? '',
    charge:         caseData.charge         ?? '',
    charge_abbrev:  caseData.charge_abbrev  ?? '',
    classification: caseData.classification ?? '',
    bond_amount:    caseData.bond_amount != null ? String(caseData.bond_amount) : '',
    release_status: caseData.release_status ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    // case_number and charge became nullable 2026-07-28 — neither is required,
    // and a blank field saves as null rather than ''.
    setSaving(true)
    setError(null)

    // Bond: empty string → null (NOT 0). An explicit "0" stays 0 and displays
    // "$0 bond". This is the root of the ticket — never coerce blank to 0.
    const bondRaw = form.bond_amount.trim()
    const changes = {
      case_number:    form.case_number.trim() || null,
      charge:         form.charge.trim() || null,
      charge_abbrev:  form.charge_abbrev.trim() || null,
      classification: form.classification || null,
      bond_amount:    bondRaw === '' ? null : Number(bondRaw),
      release_status: form.release_status || null,
    }
    await db.cases.update(caseData.id, changes)
    await addToSyncQueue('cases', 'UPDATE', caseData.id, { id: caseData.id, ...changes })
    await touchClient(clientId)
    // The URL is keyed on case_number; with none, fall back to the id so the
    // page we navigate to still resolves.
    onSaved(changes.case_number || caseData.id)
  }

  return (
    <div className={styles.editForm}>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Case Number</label>
        <input className={styles.formInput} value={form.case_number} onChange={e => set('case_number', e.target.value)} />
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Charge</label>
        <input className={styles.formInput} value={form.charge} onChange={e => set('charge', e.target.value)} />
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
            <input
              className={`${styles.formInput} ${styles.formInputPrefixed}`}
              type="number" min="0"
              value={form.bond_amount}
              onChange={e => set('bond_amount', e.target.value)}
              placeholder="Optional"
            />
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

// ─── PV field (always editable) ──────────────────────────────────────────────

// One probation-violation detail field, editable in place: no edit mode, no Save
// button, no extra click. Commits on blur and on Enter; Escape restores the last
// saved value — the same convention the inline "edit incident" fields in
// ClientFile already use.
//
// The date variant commits on CHANGE rather than blur. Picking a date is a
// discrete action, not typing, and a native mobile date picker does not reliably
// produce a blur to hang the save on. It therefore does NOT also commit on blur:
// doing both would enqueue a second, identical UPDATE for every pick.
//
// PV cases only. Nothing here is reachable from a normal case.
function PvField({ label, value, placeholder, type, onCommit }) {
  const [draft, setDraft] = useState(value ?? '')
  const [saved, setSaved] = useState(false)
  const inFlight = useRef(false)
  const skipBlur = useRef(false)

  // Re-seed the draft when the STORED value changes underneath (our own write
  // landing, or a background sync). This is React's documented "adjust state
  // while rendering" pattern rather than a useEffect: setState inside an effect
  // body causes a cascading second render, and the repo's lint rule rejects it.
  // The guard makes it converge in one pass — and because typing changes only
  // `draft`, never `value`, it cannot clobber an edit in progress.
  const [seededFrom, setSeededFrom] = useState(value ?? '')
  if ((value ?? '') !== seededFrom) {
    setSeededFrom(value ?? '')
    setDraft(value ?? '')
  }

  // Clears the transient "Saved" tick. Keyed on `saved` so each commit restarts
  // the timer, and cleaned up so it can't fire after unmount.
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 2000)
    return () => clearTimeout(t)
  }, [saved])

  async function commit(next) {
    if (inFlight.current) return
    // Blank saves as null, never '' — the same rule every other write follows.
    const normalized = (next ?? '').trim() || null
    if (normalized === (value ?? null)) return
    inFlight.current = true
    await onCommit(normalized)
    inFlight.current = false
    setSaved(true)
  }

  return (
    <div className={styles.pvField}>
      <div className={styles.pvFieldHead}>
        <span className={styles.sectionLabel}>{label}</span>
        {saved && <span className={styles.notesSavedMsg}>Saved</span>}
      </div>
      {type === 'date' ? (
        <input
          type="date"
          className={styles.pvInput}
          value={toDateInput(draft)}
          onChange={e => {
            const mdy = fromDateInput(e.target.value)
            setDraft(mdy)
            commit(mdy)
          }}
          {...pickerHandlers()}
        />
      ) : (
        <input
          className={styles.pvInput}
          value={draft}
          placeholder={placeholder}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            if (skipBlur.current) { skipBlur.current = false; return }
            commit(draft)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
            if (e.key === 'Escape') {
              setDraft(value ?? '')
              skipBlur.current = true
              e.currentTarget.blur()
            }
          }}
        />
      )}
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function CaseView() {
  // Same hole as ClientFile — reached by scrolling a client file and tapping a
  // case, so it carries that page's offset on mobile Safari. See scrollHold.js.
  useScrollToTopOnMount()

  const { caseNumber } = useParams()
  const navigate = useNavigate()

  const [notes, setNotes] = useState('')

  const liveData = useLiveQuery(async () => {
    // Cases are addressed by case_number, but that column is nullable as of
    // 2026-07-28. A case with no number is linked by its id instead, so fall
    // back to a primary-key lookup when the number match finds nothing.
    const caseRecord = (await db.cases.where('case_number').equals(caseNumber).first())
      ?? (await db.cases.get(caseNumber))
    if (!caseRecord) return null
    const incident = await db.incidents.get(caseRecord.incident_id)
    const client = incident ? await db.clients.get(incident.client_id) : null
    return { caseRecord, client }
  }, [caseNumber])

  const caseData = liveData?.caseRecord ?? null
  const clientName = liveData?.client ?? null
  const loading = liveData === undefined
  const liveWarrantText = caseData?.warrant_text ?? null

  useEffect(() => {
    if (liveData !== undefined) setNotes(liveData?.caseRecord?.notes ?? '')
  }, [liveData])

  const [editing, setEditing] = useState(false)
  const [notesSaving, setNotesSaving] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showWarrantText, setShowWarrantText] = useState(false)

  async function handleDeleteCase() {
    setDeleting(true)
    const incidentId = caseData.incident_id

    const incident = await db.incidents.get(incidentId)
    const clientId = incident?.client_id

    await db.cases.delete(caseData.id)
    await addToSyncQueue('cases', 'DELETE', caseData.id, { id: caseData.id })
    // clientId is resolved above, before the delete, so it survives the row going away.
    await touchClient(clientId)

    const remaining = await db.cases.where('incident_id').equals(incidentId).count()
    if (!remaining) {
      await db.incidents.delete(incidentId)
      await addToSyncQueue('incidents', 'DELETE', incidentId, { id: incidentId })
    }

    navigate(clientId ? `/client/${clientId}` : '/')
  }
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [warrantDragOver, setWarrantDragOver] = useState(false)

  async function uploadWarrantFile(file) {
    setUploading(true)
    setUploadError(null)
    // Falls back to the id so a case with no number can't write "null.pdf" and
    // collide with every other unnumbered case.
    const path = `warrants/${caseData.case_number || caseData.id}.pdf`
    const { error: uploadErr } = await supabase.storage
      .from('warrants')
      .upload(path, file, { contentType: 'application/pdf', upsert: true })
    if (uploadErr) { setUploadError(uploadErr.message); setUploading(false); return }
    await db.cases.update(caseData.id, { warrant_url: path })
    await addToSyncQueue('cases', 'UPDATE', caseData.id, { id: caseData.id, warrant_url: path })
    // Text extraction — offline-first and awaited, same as every other write in
    // the app. This was previously fired unawaited and written straight to
    // Supabase first, so a navigation, an offline moment, or iOS killing the PWA
    // lost the extracted text entirely with nothing queued to retry — the cause
    // of the affidavits on file with a NULL warrant_text. extractPdfText never
    // throws (null = scanned PDF with no text layer, or the CDN worker was
    // unreachable); a null result leaves the stored text alone rather than
    // overwriting good text with null.
    const text = await extractPdfText(file)
    if (text != null) {
      await db.cases.update(caseData.id, { warrant_text: text })
      await addToSyncQueue('cases', 'UPDATE', caseData.id, { id: caseData.id, warrant_text: text })
    } else {
      console.warn('[warrant_text] no text extracted; existing value left unchanged')
    }
    await touchClient(clientName?.id)
    setUploading(false)
  }

  async function handleWarrantUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadWarrantFile(file)
    e.target.value = ''
  }

  async function handleViewWarrant() {
    const path = caseData.warrant_url
    const { data, error } = await supabase.storage.from('warrants').createSignedUrl(path, 3600)
    if (error) { alert('Could not open affidavit: ' + error.message); return }
    window.open(data.signedUrl, '_blank')
  }

  function handleWarrantDragOver(e) { e.preventDefault(); setWarrantDragOver(true) }
  function handleWarrantDragEnter(e) { e.preventDefault(); setWarrantDragOver(true) }
  function handleWarrantDragLeave() { setWarrantDragOver(false) }
  async function handleWarrantDrop(e) {
    e.preventDefault()
    setWarrantDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (file.type !== 'application/pdf') { setUploadError('Only PDF files are accepted.'); return }
    await uploadWarrantFile(file)
  }

  if (loading) {
    return (
      <div className={styles.screen}>
        <header className={styles.header}>
          <button className={styles.back} onClick={() => navigate(-1)}>‹ Back</button>
        </header>
        <div className={styles.placeholder}>Loading…</div>
      </div>
    )
  }

  if (!caseData) {
    return (
      <div className={styles.screen}>
        <header className={styles.header}>
          <button className={styles.back} onClick={() => navigate(-1)}>‹ Back</button>
        </header>
        <div className={styles.placeholder}>{`Case ${caseNumber} not found.`}</div>
      </div>
    )
  }

  // Matches the incidents case line in ClientFile: the word "Affidavit" in green
  // when one is on file, and nothing at all when there isn't. The two older
  // on-file/absent status strings this replaced are gone from the app entirely.
  // Because this segment can now be absent, the bond segment's separator has to
  // be conditional on BOTH sides, or the line would open with a stray "|".
  const hasAffidavit = !!caseData.warrant_url
  const bondText = bondStatusText(caseData.bond_amount, caseData.release_status)

  // A probation violation is not a charged offense, so most of this page does
  // not apply to it (2026-08-20): no affidavit controls, no bond/affidavit meta
  // line, no Notes (pv_special_info covers that), and no Edit button — that form
  // edits case number, charge, classification, bond and status, none of which a
  // PV has. In their place the four pv_* fields render always-editable below.
  //
  // Deliberately KEPT: the "PV" label in the charge slot, the client-name header,
  // Back, Delete Case, and Disposition (still useful for recording a PV outcome).
  // Every branch below is gated on this flag — a normal case is untouched.
  const isPv = !!caseData.is_pv

  // One column per call, so a field only ever writes its own value.
  async function savePvField(column, value) {
    await db.cases.update(caseData.id, { [column]: value })
    await addToSyncQueue('cases', 'UPDATE', caseData.id, { id: caseData.id, [column]: value })
    await touchClient(clientName?.id)
  }

  function handleSaved(newCaseNumber) {
    setEditing(false)
    if (newCaseNumber !== caseNumber) {
      navigate(`/case/${newCaseNumber}`, { replace: true })
    }
    // same case_number: useLiveQuery re-renders automatically after db.cases.update
  }

  return (
    <div className={styles.screen}>
      <div className={styles.caseHeader}>
        <header className={styles.header}>
          <button className={styles.back} onClick={() => navigate(-1)}>‹ Back</button>
          {clientName && (
            <div className={styles.clientName}>
              {clientName.last_name}, {clientName.first_name}
            </div>
          )}
          {!editing && !isPv && (
            <button className={styles.editBtn} onClick={() => setEditing(true)}>Edit</button>
          )}
        </header>
        {/* Both nullable — a lone dash keeps the header from collapsing to an
            empty strip when the case has no number yet. */}
        <div className={styles.caseNumberLabel}>{caseData.case_number || '—'}</div>
        {/* PV replaces the charge line, matching the "[case number] - PV" the
            client list and both mini-lists show. The leading "[case number] -"
            is dropped HERE ONLY: the number is already the large label directly
            above, so repeating it would print it twice in four lines. Same PV
            token, same slot, no stutter. */}
        {isPv
          ? <div className={styles.charge}>PV</div>
          : caseData.charge && <div className={styles.charge}>{caseData.charge}</div>}
        {!isPv && (
          <div className={styles.meta}>
            {hasAffidavit && <span className={styles.affidavitTag}>Affidavit</span>}
            {hasAffidavit && bondText && <span className={styles.pipe}>|</span>}
            {bondText}
          </div>
        )}
      </div>

      {editing ? (
        <EditCaseForm
          caseData={caseData}
          clientId={clientName?.id}
          onSaved={handleSaved}
          onCancel={() => setEditing(false)}
        />
      ) : isPv ? (
        /* The four PV detail fields, always editable in place — no edit mode and
           no Save button (see PvField). They replace the affidavit row, the
           Notes section and the Edit form, none of which apply to a PV. Each
           field writes only its own column. */
        <div className={styles.section}>
          <PvField
            label="Conviction Date"
            type="date"
            value={caseData.pv_conviction_date}
            onCommit={v => savePvField('pv_conviction_date', v)}
          />
          <PvField
            label="Crime"
            placeholder="e.g. DUI (MIS)"
            value={caseData.pv_crime}
            onCommit={v => savePvField('pv_crime', v)}
          />
          <PvField
            label="Probation Length"
            placeholder="e.g. 11 months 29 days"
            value={caseData.pv_probation_length}
            onCommit={v => savePvField('pv_probation_length', v)}
          />
          <PvField
            label="Special Info"
            placeholder="Optional — probation conditions / notes"
            value={caseData.pv_special_info}
            onCommit={v => savePvField('pv_special_info', v)}
          />
        </div>
      ) : (
        <>
          <div className={styles.warrantRow}>
            {caseData.warrant_url && (
              <button className={styles.warrantBtn} onClick={handleViewWarrant}>
                View Affidavit
              </button>
            )}
            {liveWarrantText && (
              <button
                className={`${styles.warrantBtn} ${styles.viewTextBtn}`}
                onClick={() => setShowWarrantText(true)}
              >
                View Text
              </button>
            )}
            <label
              className={`${styles.warrantBtn} ${styles.uploadBtn} ${uploading ? styles.uploadBtnDisabled : ''} ${warrantDragOver ? styles.uploadBtnDragOver : ''}`}
              onDragOver={handleWarrantDragOver}
              onDragEnter={handleWarrantDragEnter}
              onDragLeave={handleWarrantDragLeave}
              onDrop={handleWarrantDrop}
            >
              {uploading ? 'Uploading…' : caseData.warrant_url ? 'Replace Affidavit' : 'Upload Affidavit'}
              <input
                type="file"
                accept="application/pdf"
                className={styles.fileInput}
                disabled={uploading}
                onChange={handleWarrantUpload}
              />
            </label>
            {uploadError && <div className={styles.uploadError}>{uploadError}</div>}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionLabel}>Notes</div>
            <textarea
              className={styles.notesInput}
              value={notes}
              onChange={e => { setNotes(e.target.value); setNotesSaved(false) }}
              placeholder="Add notes about this case…"
              rows={5}
            />
            <div className={styles.notesActions}>
              <button
                className={styles.notesSaveBtn}
                disabled={notesSaving}
                onClick={async () => {
                  setNotesSaving(true)
                  await db.cases.update(caseData.id, { notes })
                  await addToSyncQueue('cases', 'UPDATE', caseData.id, { id: caseData.id, notes })
                  await touchClient(clientName?.id)
                  setNotesSaving(false)
                  setNotesSaved(true)
                }}
              >
                {notesSaving ? 'Saving…' : 'Save Notes'}
              </button>
              {notesSaved && <span className={styles.notesSavedMsg}>Saved</span>}
            </div>
          </div>
        </>
      )}

      {/* Shown for PV and normal cases alike — a disposition is just as useful
          for recording how a violation resolved. Deliberately left in place. */}
      {!editing && caseData.disposition && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Disposition</div>
          <div className={styles.dispositionText}>{caseData.disposition}</div>
        </div>
      )}

      {/* ── Delete Case ── */}
      {!editing && (
        <div className={styles.deleteCaseSection}>
          {!showDeleteConfirm ? (
            <button className={styles.deleteCaseBtn} onClick={() => setShowDeleteConfirm(true)}>
              Delete Case
            </button>
          ) : (
            <div className={styles.deleteConfirmBox}>
              <p className={styles.deleteConfirmText}>Delete this case? This cannot be undone.</p>
              <div className={styles.deleteConfirmActions}>
                <button className={styles.confirmDeleteYes} onClick={handleDeleteCase} disabled={deleting}>
                  {deleting ? '…' : 'Yes, Delete'}
                </button>
                <button className={styles.confirmDeleteNo} onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <TextViewerDrawer
        isOpen={showWarrantText}
        onClose={() => setShowWarrantText(false)}
        label="Affidavit Text"
        text={liveWarrantText ?? null}
      />
    </div>
  )
}
