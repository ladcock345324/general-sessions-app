import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from '../supabaseClient'
import { extractPdfText } from '../extractPdfText'
import db from '../localDB'
import { addToSyncQueue } from '../syncManager'
import styles from './CaseView.module.css'
import TextViewerDrawer from '../components/TextViewerDrawer'

// Charge classification, least-serious → most-serious. Blank = unset (stored null).
const CLASSIFICATIONS = ['', 'MIS', 'C MIS', 'B MIS', 'A MIS', 'E FEL', 'D FEL', 'C FEL', 'B FEL', 'A FEL', 'CAPITAL']

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

function EditCaseForm({ caseData, onSaved, onCancel }) {
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

// ─── Main page ───────────────────────────────────────────────────────────────

export default function CaseView() {
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

  const warrantStatus = caseData.warrant_url ? 'Affidavit on File' : 'No Affidavit'

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
          {!editing && (
            <button className={styles.editBtn} onClick={() => setEditing(true)}>Edit</button>
          )}
        </header>
        {/* Both nullable — a lone dash keeps the header from collapsing to an
            empty strip when the case has no number yet. */}
        <div className={styles.caseNumberLabel}>{caseData.case_number || '—'}</div>
        {caseData.charge && <div className={styles.charge}>{caseData.charge}</div>}
        <div className={styles.meta}>
          {warrantStatus}
          {bondStatusText(caseData.bond_amount, caseData.release_status) && (
            <><span className={styles.pipe}>|</span>{bondStatusText(caseData.bond_amount, caseData.release_status)}</>
          )}
        </div>
      </div>

      {editing ? (
        <EditCaseForm
          caseData={caseData}
          onSaved={handleSaved}
          onCancel={() => setEditing(false)}
        />
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
                  setNotesSaving(false)
                  setNotesSaved(true)
                }}
              >
                {notesSaving ? 'Saving…' : 'Save Notes'}
              </button>
              {notesSaved && <span className={styles.notesSavedMsg}>Saved</span>}
            </div>
          </div>

          {caseData.disposition && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Disposition</div>
              <div className={styles.dispositionText}>{caseData.disposition}</div>
            </div>
          )}
        </>
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
