/**
 * Indigent-status circle: the cycle, the colours, and the one normalizer that
 * decides what a stored value actually MEANS.
 *
 * Shared by all three consumers — ClientRow (client list), ClientFile (header)
 * and ClientList (the Closed-section tier sort). This app duplicates most small
 * helpers by convention, and these constants WERE duplicated byte-for-byte in
 * ClientRow.jsx and ClientFile.jsx until 2026-09-02. They were pulled into one
 * module for the same reason caseGrouping.js was: the Closed section now sorts
 * clients into tiers BY COLOUR, so a second (or third) copy that drifted would
 * put a client in a tier that disagrees with the dot rendered next to their
 * name. One source of truth is what makes "tier never disagrees with the dot"
 * a structural guarantee rather than a convention.
 *
 * The IndigentCircle COMPONENT is still written out in each of the two views —
 * they differ (one uses a CSS class for the hit area, one inline styles) and
 * that difference is deliberate. Only the data is shared.
 */

// The five states, in cycle order: red → orange → green → purple → gold → red.
export const INDIGENT_CYCLE = {
  red:    'orange',
  orange: 'green',
  green:  'purple',
  purple: 'gold',
  gold:   'red',
}

// purple (#9B59B6) means: case closed, no work left, final review or ACAP upload
// pending. That meaning drives the Closed-section tier sort and nothing else.
// The hex is the knob if it doesn't read as distinct from red/orange/green/gold
// against the #1E2A3A row background.
export const INDIGENT_COLOR = {
  red:    '#b85555',
  orange: '#E8913A',
  green:  '#3d9e6a',
  purple: '#9B59B6',
  gold:   '#FFD700',
}

// ⚠️ LEGACY ALIAS — load-bearing, and deliberately permanent.
//
// The orange circle (#E8913A) was stored as 'yellow' until 2026-09-02. The name
// was confusing, so 'orange' became canonical and nothing writes 'yellow' any
// more — but the live database still held 'yellow' rows when this shipped, and
// they are renamed separately afterwards.
//
// Without this map a stored 'yellow' would fall through to the off-cycle → red
// normalizer below: the client's dot would silently change colour, and (since
// tier assignment mirrors the dot) they would jump tiers in the Closed section.
// A stored 'yellow' therefore renders orange and advances to green, exactly as
// 'orange' does.
//
// KEEP THIS AFTER THE RENAME. It costs one object lookup and protects any row
// that escapes the rename — a device that was offline during it, a restore from
// an older backup snapshot, a row hand-edited in the dashboard.
export const INDIGENT_ALIAS = { yellow: 'orange' }

/**
 * Resolve a stored indigent_status to the value the app actually uses — for the
 * colour it renders AND for the tier it sorts into. Those two must never be
 * derived separately.
 *
 * Legacy aliases resolve to their canonical name; anything unrecognized (null,
 * '', an old 'gray', junk) normalizes to 'red'. Display-only: this never writes.
 * A client sitting on an unrecognized value therefore shows red and advances to
 * INDIGENT_CYCLE.red — the SECOND entry in the cycle — on their first tap,
 * which is the long-standing behaviour and is unchanged.
 */
export function normalizeIndigent(status) {
  const canonical = INDIGENT_ALIAS[status] ?? status
  return INDIGENT_COLOR[canonical] ? canonical : 'red'
}
