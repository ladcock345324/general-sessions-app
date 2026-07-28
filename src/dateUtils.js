// Shared "M/D/YYYY" date helpers. Originally defined inline in ClientFile.jsx;
// extracted here once a second file (DailyHoursDrawer) needed the same logic.

// Convert "M/D/YYYY" → "YYYY-MM-DD" for <input type="date">
export function toDateInput(mdy) {
  if (!mdy) return ''
  const parts = mdy.split('/')
  if (parts.length !== 3) return ''
  const [m, d, y] = parts
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

// Convert "YYYY-MM-DD" → "M/D/YYYY" for storage and display
export function fromDateInput(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}/${y}`
}

// Display a stored date without leading zeros ("08/05/2026" → "8/5/2026").
// Write paths already normalize via fromDateInput, so this is the display-side
// guarantee for any value that arrived by another route. Anything that isn't a
// plain M/D/YYYY passes through untouched rather than being blanked.
export function formatDateDisplay(mdy) {
  const m = String(mdy ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return mdy ?? ''
  return `${Number(m[1])}/${Number(m[2])}/${m[3]}`
}

// Makes a whole <input type="date"> open the native picker, not just its little
// calendar icon. showPicker() is unavailable on older browsers and throws when
// the call isn't user-activated, so both are guarded — the field degrades to a
// normal date input rather than breaking.
export function pickerHandlers() {
  const open = e => {
    const el = e.currentTarget
    if (typeof el.showPicker !== 'function') return
    try { el.showPicker() } catch { /* unsupported or not user-activated */ }
  }
  return { onClick: open, onFocus: open }
}

export function todayString() {
  const d = new Date()
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

// Parse "M/D/YYYY" → a numeric key (year*10000 + month*100 + day) for reliable
// date comparison. NOT new Date() and NOT string compare — both are unreliable
// for these hand-entered "M/D/YYYY" strings. Unparseable → -Infinity (oldest).
export function dateKey(mdy) {
  const m = (mdy ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return -Infinity
  return Number(m[3]) * 10000 + Number(m[1]) * 100 + Number(m[2])
}

// Shift an "M/D/YYYY" date by `deltaDays` (may be negative) → "M/D/YYYY".
// Built from numeric Date(year, month, day) args, never new Date(string), so
// setDate() handles month/year rollover correctly without a locale-parsing risk.
export function shiftDate(mdy, deltaDays) {
  const m = (mdy ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return mdy ?? ''
  const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]))
  d.setDate(d.getDate() + deltaDays)
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}
