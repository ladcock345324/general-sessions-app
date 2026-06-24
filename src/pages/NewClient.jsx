import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import db from '../localDB'
import { addToSyncQueue } from '../syncManager'
import styles from './NewClient.module.css'

const EMPTY = {
  last_name: '',
  first_name: '',
  gender: 'M',
  booking_date: '',
  booking_time: '',
  oca: '',
  custody_status: 'in_custody',
}

// Mirror Next Event's date/time conversions (see ClientFile.jsx).
// "M/D/YYYY" ↔ "YYYY-MM-DD" for <input type="date">
function toDateInput(mdy) {
  if (!mdy) return ''
  const parts = mdy.split('/')
  if (parts.length !== 3) return ''
  const [m, d, y] = parts
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}
function fromDateInput(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}/${y}`
}
// "h:MM AM/PM" ↔ "HH:MM" for <input type="time">
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
function fromTimeInput(hhmm) {
  if (!hhmm) return ''
  const [hStr, min] = hhmm.split(':')
  let h = parseInt(hStr, 10)
  const period = h >= 12 ? 'PM' : 'AM'
  if (h === 0) h = 12
  else if (h > 12) h -= 12
  return `${h}:${min} ${period}`
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

    const id = crypto.randomUUID()
    const record = {
      id,
      last_name: form.last_name.trim(),
      first_name: form.first_name.trim(),
      gender: form.gender,
      booking_date: form.booking_date.trim() || null,
      booking_time: form.booking_time.trim() || null,
      oca: form.oca.trim() || null,
      custody_status: form.custody_status,
      relieved_as_counsel: false,
      relieved_closed: false,
    }

    await db.clients.put(record)
    await addToSyncQueue('clients', 'INSERT', id, record)
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
          <label className={styles.label}>Booked/Initial Appearance</label>
          <div className={styles.twoCol}>
            <div className={styles.row}>
              <label className={styles.label}>Date</label>
              <input
                className={styles.input}
                type="date"
                value={toDateInput(form.booking_date)}
                onChange={e => set('booking_date', fromDateInput(e.target.value))}
              />
            </div>
            <div className={styles.row}>
              <label className={styles.label}>Time</label>
              <input
                className={styles.input}
                type="time"
                step="3600"
                value={toTimeInput(form.booking_time)}
                onChange={e => set('booking_time', fromTimeInput(e.target.value))}
              />
            </div>
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
