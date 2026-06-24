// Preliminary-hearing deadline math for in-custody defendants.
//
// TN Rule of Crim. Pro. 5 requires the preliminary hearing within 14 days of the
// initial appearance before the magistrate. In Davidson County the commissioner
// review happens at booking, so the client's booking date stands in for that
// initial appearance. Cutoff = booking date + 14 calendar days, then rolled
// forward off a weekend (Sat → Mon, Sun → Mon). Weekends only — Rule 45 holiday
// rollover is intentionally NOT applied. The cutoff is computed at render time
// and never stored.
//
// All parsing splits "M/D/YYYY" into numeric parts and builds the date with
// new Date(year, month-1, day) — never new Date(string) — so local time is used
// and UTC parsing can't shift the weekday/date by a day.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Parse "M/D/YYYY" → { y, m, d } numbers, or null if malformed.
function parseMDY(dateStr) {
  if (!dateStr) return null
  const parts = String(dateStr).split('/')
  if (parts.length !== 3) return null
  const m = Number(parts[0])
  const d = Number(parts[1])
  const y = Number(parts[2])
  if (!m || !d || !y) return null
  return { y, m, d }
}

function formatDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`
}

// "M/D/YYYY" → "M/D/YYYY": booking date + 14 days, rolled off the weekend.
export function computePrelimCutoff(bookingDateStr) {
  const p = parseMDY(bookingDateStr)
  if (!p) return ''
  // new Date(y, m-1, d+14) handles month/year overflow automatically.
  const cutoff = new Date(p.y, p.m - 1, p.d + 14)
  const day = cutoff.getDay()
  if (day === 6) cutoff.setDate(cutoff.getDate() + 2)      // Saturday → Monday
  else if (day === 0) cutoff.setDate(cutoff.getDate() + 1) // Sunday → Monday
  return formatDate(cutoff)
}

// "M/D/YYYY" → "Sun".."Sat"
export function shortWeekday(dateStr) {
  const p = parseMDY(dateStr)
  if (!p) return ''
  return WEEKDAYS[new Date(p.y, p.m - 1, p.d).getDay()]
}

// "M/D/YYYY" → "M/D" (strip year)
export function formatMD(dateStr) {
  const p = parseMDY(dateStr)
  if (!p) return ''
  return `${p.m}/${p.d}`
}

// Stored booking time ("h:MM AM/PM", same format as Next Event's event_time)
// → compact "h" + AM/PM with no minutes and no space. "2:00 PM" → "2PM".
export function formatBookingTimeCompact(timeStr) {
  if (!timeStr) return ''
  const m = String(timeStr).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return ''
  return `${Number(m[1])}${m[3].toUpperCase()}`
}
