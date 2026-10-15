// Criminal Court (CC) file helpers (2026-10-15).
//
// A CC file is a separate client row (clients.is_cc_file = true) made from a
// General Sessions (GS) file when charges leave GS for Criminal Court. The two
// are fully independent records — nothing here ever reads one to change the
// other. Shared by ClientRow (client list), ClientFile and CaseView so the
// "waiting" rule, the date math and the charge labels can't drift between views.
//
// All "M/D/YYYY" parsing here builds dates from numeric Date(y, m, d) args,
// never new Date(string), the same rule the rest of the app follows.

// ─── Slider colour ramp ─────────────────────────────────────────────────────
//
// ⚠️ THE KNOB. The waiting-panel slider's fill colour moves smoothly along these
// stops as it travels from 0% (the day the case left GS) to 100% (the ripe
// date). `at` is the position 0–1; colours are interpolated linearly in RGB
// between neighbouring stops. Edit the hexes (or add/remove stops) to retune.
export const CC_SLIDER_STOPS = [
  { at: 0.00, color: '#7a3b3b' }, // dead, muted red — just left General Sessions
  { at: 0.30, color: '#d9792b' }, // orange
  { at: 0.55, color: '#e8c63a' }, // yellow
  { at: 0.80, color: '#a8dc3c' }, // lime
  { at: 1.00, color: '#21f26b' }, // bright, brilliant green — ripe
]

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// pct is 0–100. Returns an "rgb(r, g, b)" string.
export function ccSliderColor(pct) {
  const t = Math.min(1, Math.max(0, (Number(pct) || 0) / 100))
  let lo = CC_SLIDER_STOPS[0]
  let hi = CC_SLIDER_STOPS[CC_SLIDER_STOPS.length - 1]
  for (let i = 0; i < CC_SLIDER_STOPS.length - 1; i++) {
    if (t >= CC_SLIDER_STOPS[i].at && t <= CC_SLIDER_STOPS[i + 1].at) {
      lo = CC_SLIDER_STOPS[i]
      hi = CC_SLIDER_STOPS[i + 1]
      break
    }
  }
  const span = hi.at - lo.at
  const f = span > 0 ? (t - lo.at) / span : 0
  const a = hexToRgb(lo.color)
  const b = hexToRgb(hi.color)
  const mix = a.map((v, i) => Math.round(v + (b[i] - v) * f))
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`
}

// ─── Date math ──────────────────────────────────────────────────────────────

const RIPE_LEAD_DAYS = 30

// "M/D/YYYY" → local-midnight Date, or null when blank/unparseable.
export function parseMdy(mdy) {
  const m = String(mdy ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]))
}

function toMdy(d) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

// Whole calendar days from a to b (b − a). Counted on UTC day numbers built from
// the local Y/M/D, so a DST change between the two dates can't shave a day off.
function calendarDaysBetween(a, b) {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((ub - ua) / 86400000)
}

// "M/D" with no year and no leading zeros — the compact client-list form.
export function formatMonthDay(mdy) {
  const d = parseMdy(mdy)
  return d ? `${d.getMonth() + 1}/${d.getDate()}` : ''
}

// ─── The "waiting" state ────────────────────────────────────────────────────
//
// A CC file is WAITING while ALL of these hold: it is a CC file, it has no CC
// case number yet, and the client has no next_events row. Derived at render and
// never stored — clear the CC number or the next event later and the panel
// simply comes back.
export function isCcWaiting(client, hasNextEvent) {
  return client?.is_cc_file === true && !String(client.cc_case_number ?? '').trim() && !hasNextEvent
}

/**
 * Everything the waiting panel and the client-list line display, or null when
 * the file is not waiting.
 *
 *   leftGs     "M/D/YYYY" | null   clients.left_gs_date
 *   daysSince  number | null       whole calendar days from leftGs to today
 *   estimate   "M/D/YYYY" | null   clients.cc_estimated_first_date
 *   ripe       "M/D/YYYY" | null   estimate − 30 days (when the CC case number
 *                                  is expected to show in the attorney portal)
 *   pct        number | null       slider position 0–100; null = no slider
 *
 * Slider: 0% at leftGs, 100% at the ripe date, linear by calendar day, clamped.
 * Past the ripe date it stays at 100%; a ripe date on or before leftGs is 100%.
 * No estimate → no ripe date and no slider. No leftGs → no slider either (there
 * is no 0% end to measure from).
 */
export function ccWaitingInfo(client, hasNextEvent, today = new Date()) {
  if (!isCcWaiting(client, hasNextEvent)) return null
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const left = parseMdy(client.left_gs_date)
  const est = parseMdy(client.cc_estimated_first_date)
  const ripeDate = est
    ? new Date(est.getFullYear(), est.getMonth(), est.getDate() - RIPE_LEAD_DAYS)
    : null

  let pct = null
  if (left && ripeDate) {
    const total = calendarDaysBetween(left, ripeDate)
    if (total <= 0) {
      pct = 100
    } else {
      const done = calendarDaysBetween(left, now)
      pct = Math.min(100, Math.max(0, (done / total) * 100))
    }
  }

  return {
    leftGs: left ? toMdy(left) : null,
    daysSince: left ? calendarDaysBetween(left, now) : null,
    estimate: est ? toMdy(est) : null,
    ripe: ripeDate ? toMdy(ripeDate) : null,
    pct,
  }
}

// ─── Charge labels and sorting for CC-file cases ────────────────────────────
//
// Criminal Court gives ONE number for the whole matter, and it identifies no
// specific charge — so inside a CC file the CHARGE is the main label, and the
// GS case number it came from (cases.gs_case_number) is a quiet reference.
// cases.case_number stays null on every CC-file case.

// Full charge first (header mini-list, CaseView, Incidents cell).
export function ccChargeLabel(c) {
  return c?.charge || c?.charge_abbrev || '(no charge entered)'
}

// Abbreviation first — the client list's existing convention for that column.
export function ccChargeShort(c) {
  return c?.charge_abbrev || c?.charge || '(no charge entered)'
}

// The number a case sorts on: gs_case_number inside a CC file, case_number
// everywhere else. Both are nullable, hence the '' fallback.
export function caseSortNumber(c, isCcFile) {
  return (isCcFile ? c?.gs_case_number : c?.case_number) ?? ''
}

// Numeric part of a case number with the letter prefix stripped — the key the
// client list and the header mini-list have always sorted on.
export function caseNumericKey(caseNumber) {
  return parseInt(String(caseNumber ?? '').replace(/^\D+/, ''), 10) || 0
}
