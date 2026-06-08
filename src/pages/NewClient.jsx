import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import styles from './NewClient.module.css'

const EMPTY = {
  last_name: '',
  first_name: '',
  gender: 'M',
  age: '',
  oca: '',
  custody_status: 'in_custody',
  bond_amount: '',
  da_name: '',
}

export default function NewClient() {
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

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

    const { error: insertError } = await supabase.from('clients').insert({
      last_name: form.last_name.trim(),
      first_name: form.first_name.trim(),
      gender: form.gender,
      age: form.age ? Number(form.age) : null,
      oca: form.oca.trim() || null,
      custody_status: form.custody_status,
      bond_amount: form.bond_amount ? Number(form.bond_amount) : null,
      da_name: form.da_name.trim() || null,
      relieved_as_counsel: false,
      relieved_closed: false,
      criminal_history: null,
    })

    if (insertError) {
      setError(insertError.message)
      setSaving(false)
      return
    }

    navigate('/')
  }

  return (
    <div className={styles.screen}>
      <div className={styles.pageHeader}>
        <button className={styles.back} onClick={() => navigate(-1)}>‹ Back</button>
        <span className={styles.pageTitle}>New Client</span>
      </div>

      <div className={styles.form}>
        <div className={styles.row}>
          <label className={styles.label}>Last Name *</label>
          <input
            className={styles.input}
            type="text"
            value={form.last_name}
            onChange={e => set('last_name', e.target.value)}
            placeholder="e.g. Woods-James"
            autoFocus
          />
        </div>

        <div className={styles.row}>
          <label className={styles.label}>First Name *</label>
          <input
            className={styles.input}
            type="text"
            value={form.first_name}
            onChange={e => set('first_name', e.target.value)}
            placeholder="e.g. Kimberly"
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
              placeholder="—"
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
            <option value="out">Out</option>
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
          <label className={styles.label}>Assistant DA Name</label>
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
          {saving ? 'Saving…' : 'Save Client'}
        </button>
      </div>
    </div>
  )
}
