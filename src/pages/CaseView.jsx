import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from '../supabaseClient'
import { extractPdfText } from '../extractPdfText'
import db from '../localDB'
import { addToSyncQueue } from '../syncManager'
import styles from './CaseView.module.css'
import TextViewerDrawer from '../components/TextViewerDrawer'

function formatBond(amount) {
  if (amount == null) return null
  return '$' + Number(amount).toLocaleString()
}

// ─── Edit form ───────────────────────────────────────────────────────────────

function EditCaseForm({ caseData, onSaved, onCancel }) {
  const [form, setForm] = useState({
    case_number:   caseData.case_number   ?? '',
    charge:        caseData.charge        ?? '',
    charge_abbrev: caseData.charge_abbrev ?? '',
    bond_amount:   caseData.bond_amount != null ? String(caseData.bond_amount) : '',
  })
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

    const changes = {
      case_number:   form.case_number.trim(),
      charge:        form.charge.trim(),
      charge_abbrev: form.charge_abbrev.trim() || null,
      bond_amount:   form.bond_amount ? Number(form.bond_amount) : null,
    }
    await db.cases.update(caseData.id, changes)
    await addToSyncQueue('cases', 'UPDATE', caseData.id, { id: caseData.id, ...changes })
    onSaved(form.case_number.trim())
  }

  return (
    <div className={styles.editForm}>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Case Number *</label>
        <input className={styles.formInput} value={form.case_number} onChange={e => set('case_number', e.target.value)} />
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Charge *</label>
        <input className={styles.formInput} value={form.charge} onChange={e => set('charge', e.target.value)} />
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Abbrev. (for client list)</label>
        <input className={styles.formInput} value={form.charge_abbrev} onChange={e => set('charge_abbrev', e.target.value)} placeholder="Optional" />
      </div>
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

  const [caseData, setCaseData] = useState(null)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)

  const liveCaseNotes = useLiveQuery(
    () => db.cases.where('case_number').equals(caseNumber).first().then(c => c?.notes ?? ''),
    [caseNumber]
  )
  useEffect(() => {
    if (liveCaseNotes !== undefined) setNotes(liveCaseNotes)
  }, [liveCaseNotes])

  const liveWarrantText = useLiveQuery(
    () => db.cases.where('case_number').equals(caseNumber).first().then(c => c?.warrant_text ?? null),
    [caseNumber]
  )

  const [error, setError] = useState(null)
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
    const path = `warrants/${caseData.case_number}.pdf`
    const { error: uploadErr } = await supabase.storage
      .from('warrants')
      .upload(path, file, { contentType: 'application/pdf', upsert: true })
    if (uploadErr) { setUploadError(uploadErr.message); setUploading(false); return }
    const { data: urlData } = supabase.storage.from('warrants').getPublicUrl(path)
    await db.cases.update(caseData.id, { warrant_url: urlData.publicUrl })
    await addToSyncQueue('cases', 'UPDATE', caseData.id, { id: caseData.id, warrant_url: urlData.publicUrl })
    setCaseData(prev => ({ ...prev, warrant_url: urlData.publicUrl }))
    // Text extraction — rule 7: keep direct Supabase write + update Dexie.
    // .then() must be async so the await actually executes the Supabase query
    // (PostgrestFilterBuilder is lazy — unawaited calls are silently discarded).
    extractPdfText(file).then(async text => {
      console.log('[warrant_text] extracted length:', text?.length ?? 0)
      const { error: textErr } = await supabase
        .from('cases')
        .update({ warrant_text: text ?? null })
        .eq('id', caseData.id)
      if (textErr) console.error('[warrant_text] PATCH failed:', textErr.message)
      else {
        console.log('[warrant_text] PATCH succeeded')
        await db.cases.update(caseData.id, { warrant_text: text ?? null })
      }
    }).catch(err => console.error('[warrant_text] extraction error:', err))
    setUploading(false)
  }

  async function handleWarrantUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadWarrantFile(file)
    e.target.value = ''
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

  useEffect(() => {
    async function fetchCase() {
      setLoading(true)
      const { data, error } = await supabase
        .from('cases')
        .select('*, incidents(client_id, clients(first_name, last_name))')
        .eq('case_number', caseNumber)
        .maybeSingle()

      if (error) {
        setError(error.message)
      } else {
        setCaseData(data)
      }
      setLoading(false)
    }
    fetchCase()
  }, [caseNumber])

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

  if (error || !caseData) {
    return (
      <div className={styles.screen}>
        <header className={styles.header}>
          <button className={styles.back} onClick={() => navigate(-1)}>‹ Back</button>
        </header>
        <div className={styles.placeholder}>{error ?? `Case ${caseNumber} not found.`}</div>
      </div>
    )
  }

  const warrantStatus = caseData.warrant_url ? 'Warrant on File' : 'No Warrant'

  function handleSaved(newCaseNumber) {
    setEditing(false)
    if (newCaseNumber !== caseNumber) {
      navigate(`/case/${newCaseNumber}`, { replace: true })
    } else {
      db.cases.where('case_number').equals(newCaseNumber).first()
        .then(dexieData => { if (dexieData) setCaseData(prev => ({ ...prev, ...dexieData })) })
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.caseHeader}>
        <header className={styles.header}>
          <button className={styles.back} onClick={() => navigate(-1)}>‹ Back</button>
          {(() => {
            const client = caseData.incidents?.clients
            if (!client) return null
            return (
              <div className={styles.clientName}>
                {client.last_name}, {client.first_name}
              </div>
            )
          })()}
          {!editing && (
            <button className={styles.editBtn} onClick={() => setEditing(true)}>Edit</button>
          )}
        </header>
        <div className={styles.caseNumberLabel}>{caseData.case_number}</div>
        <div className={styles.charge}>{caseData.charge}</div>
        <div className={styles.meta}>
          {warrantStatus}<span className={styles.pipe}>|</span>{formatBond(caseData.bond_amount)} bond
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
              <button
                className={styles.warrantBtn}
                onClick={async () => {
                  const path = `warrants/${caseData.case_number}.pdf`
                  const { data, error } = await supabase.storage
                    .from('warrants')
                    .createSignedUrl(path, 3600)
                  if (error) { alert('Could not open warrant: ' + error.message); return }
                  window.open(data.signedUrl, '_blank')
                }}
              >
                View Warrant
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
              {uploading ? 'Uploading…' : caseData.warrant_url ? 'Replace Warrant' : 'Upload Warrant'}
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
        label="Warrant Text"
        text={liveWarrantText ?? null}
      />
    </div>
  )
}
