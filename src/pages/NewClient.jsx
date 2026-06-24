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
  booking_hour: '',
  booking_period: '',
  oca: '',
  custody_status: 'in_custody',
}

const HOURS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']

// Mirror Next Event's date conversions (see ClientFile.jsx).
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
// hour + AM/PM dropdowns → "h:00 AM/PM" (same format as next_events.event_time),
// or null when either is blank.
function combineTime(hour, period) {
  if (!hour || !period) return null
  return `${Number(hour)}:00 ${period}`
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
      booking_time: combineTime(form.booking_hour, form.booking_period),
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
          <label className={styles.label}>First Name *</label>
          <input
            className={styles.input}
            type="text"
            value={form.first_name}
            onChange={e => set('first_name', e.target.value)}
            placeholder="e.g. Kimberly"
            autoFocus
          />
        </div>

        <div className={styles.row}>
          <label className={styles.label}>Last Name *</label>
          <input
            className={styles.input}
            type="text"
            value={form.last_name}
            onChange={e => set('last_name', e.target.value)}
            placeholder="e.g. Woods-James"
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
          <div className={styles.bookingGrid}>
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
              <label className={styles.label}>Hour</label>
              <select
                className={styles.select}
                value={form.booking_hour}
                onChange={e => set('booking_hour', e.target.value)}
              >
                <option value="">—</option>
                {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div className={styles.row}>
              <label className={styles.label}>AM/PM</label>
              <select
                className={styles.select}
                value={form.booking_period}
                onChange={e => set('booking_period', e.target.value)}
              >
                <option value="">—</option>
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
          </div>
          {(form.booking_date || form.booking_hour || form.booking_period) && (
            <button
              type="button"
              className={styles.bookingClear}
              onClick={() => setForm(prev => ({ ...prev, booking_date: '', booking_hour: '', booking_period: '' }))}
            >
              Clear
            </button>
          )}
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
