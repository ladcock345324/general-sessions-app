import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
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
        age: data.age != null ? String(data.age) : '',
        oca: data.oca ?? '',
        custody_status: data.custody_status ?? 'in_custody',
        bond_amount: data.bond_amount != null ? String(data.bond_amount) : '',
        da_name: data.da_name ?? '',
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

    const { error: updateError } = await supabase
      .from('clients')
      .update({
        last_name: form.last_name.trim(),
        first_name: form.first_name.trim(),
        gender: form.gender,
        age: form.age ? Number(form.age) : null,
        oca: form.oca.trim() || null,
        custody_status: form.custody_status,
        bond_amount: form.bond_amount ? Number(form.bond_amount) : null,
        da_name: form.da_name.trim() || null,
      })
      .eq('id', id)

    if (updateError) {
      setError(updateError.message)
      setSaving(false)
      return
    }

    navigate(`/client/${id}`)
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

        <div className={styles.twoCol}>
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
            <label className={styles.label}>Age</label>
            <input
              className={styles.input}
              type="number"
              min="0"
              max="120"
              value={form.age}
              onChange={e => set('age', e.target.value)}
            />
          </div>
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
          </select>
        </div>

        <div className={styles.row}>
          <label className={styles.label}>Bond Amount</label>
          <div className={styles.prefixInput}>
            <span className={styles.prefix}>$</span>
            <input
              className={`${styles.input} ${styles.inputPrefixed}`}
              type="number"
              min="0"
              value={form.bond_amount}
              onChange={e => set('bond_amount', e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <div className={styles.row}>
          <label className={styles.label}>DA Name</label>
          <input
            className={styles.input}
            type="text"
            value={form.da_name}
            onChange={e => set('da_name', e.target.value)}
            placeholder="Optional"
          />
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
