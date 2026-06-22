import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import db from '../localDB'
import { addToSyncQueue } from '../syncManager'
import styles from './NewClient.module.css'

export default function EditClient() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .single()

      if (error || !data) {
        setError(error?.message ?? 'Client not found.')
        return
      }

      setForm({
        last_name: data.last_name ?? '',
        first_name: data.first_name ?? '',
        gender: data.gender ?? 'M',
        oca: data.oca ?? '',
        custody_status: data.custody_status ?? 'in_custody',
      })
    }
    load()
  }, [id])

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSave() {
    if (!form.last_name.trim() || !form.first_name.trim()) {
      setError('Last name and first name are required.')
      return
    }

    setSaving(true)
    setError(null)

    const changes = {
      last_name: form.last_name.trim(),
      first_name: form.first_name.trim(),
      gender: form.gender,
      oca: form.oca.trim() || null,
      custody_status: form.custody_status,
    }

    await db.clients.update(id, changes)
    await addToSyncQueue('clients', 'UPDATE', id, { id, ...changes })
    navigate(`/client/${id}`, { replace: true })
  }

  if (!form) {
    return (
      <div className={styles.screen}>
        <div className={styles.pageHeader}>
          <button className={styles.back} onClick={() => navigate(-1)}>‹ Back</button>
          <span className={styles.pageTitle}>Edit Client</span>
        </div>
        <div style={{ padding: '24px 16px', color: '#6b7a99', fontSize: 14 }}>
          {error ?? 'Loading…'}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.screen}>
      <div className={styles.pageHeader}>
        <button className={styles.back} onClick={() => navigate(-1)}>Cancel</button>
        <span className={styles.pageTitle}>Edit Client</span>
      </div>

      <div className={styles.form}>
        <div className={styles.row}>
          <label className={styles.label}>Last Name *</label>
          <input
            className={styles.input}
            type="text"
            value={form.last_name}
            onChange={e => set('last_name', e.target.value)}
          />
        </div>

        <div className={styles.row}>
          <label className={styles.label}>First Name *</label>
          <input
            className={styles.input}
            type="text"
            value={form.first_name}
            onChange={e => set('first_name', e.target.value)}
          />
        </div>

        <div className={styles.row}>
          <label className={styles.label}>Gender</label>
          <select
            className={styles.select}
            value={form.gender}
            onChange={e => set('gender', e.target.value)}
          >
            <option value="M">M</option>
            <option value="F">F</option>
          </select>
        </div>

        <div className={styles.row}>
          <label className={styles.label}>OCA #</label>
          <input
            className={styles.input}
            type="text"
            value={form.oca}
            onChange={e => set('oca', e.target.value)}
            placeholder="Optional"
          />
        </div>

        <div className={styles.row}>
          <label className={styles.label}>Custody Status</label>
          <select
            className={styles.select}
            value={form.custody_status}
            onChange={e => set('custody_status', e.target.value)}
          >
            <option value="in_custody">In Custody</option>
            <option value="bonded_out">Bonded Out</option>
            <option value="out">Out</option>
          </select>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <button
          className={styles.saveBtn}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
