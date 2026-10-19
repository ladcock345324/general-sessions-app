// Judges and their divisions (2026-10-19).
//
// ⚠️ next_events.judge stores ONLY the plain name ("J. Bell"), exactly as it
// always has. The division is added at DISPLAY time from JUDGE_DIVISION, so
// the stored data never changes and a division can be corrected here without a
// migration. A free-text "Other" judge, or any name not in the map, displays
// as-is with no division.
//
// One map covers both courts — the General Sessions and Criminal Court names
// don't overlap.

// General Sessions divisions (from the court's website).
// Criminal Court divisions, for the Next Event form on a CC file.
export const JUDGE_DIVISION = {
  // General Sessions
  'G. Robinson': 'I',
  'M. Blackburn': 'II',
  'A. Escobar': 'III',
  'A. Walker': 'IV',
  'R. Hayes': 'V',
  'J. Bell': 'VI',
  'M. Floyd': 'VII',
  'R. Bell': 'VIII',
  'L. Jones': 'IX',
  'S. Coleman': 'X',
  'A. Holt': 'XI',
  // Criminal Court
  'S. Dozier': 'I',
  'A. Dalton': 'II',
  'D. Deaner': 'III',
  'J. Smith': 'IV',
  'K. Babb': 'V',
  'C. Chappell': 'VI',
}

// Legacy stored strings → the plain name they mean. "R. Hayes (PRESIDING)" was
// the dropdown entry until 2026-10-19; rows saved with it still hold it.
const JUDGE_ALIAS = {
  'R. Hayes (PRESIDING)': 'R. Hayes',
}

// The plain name a stored value stands for (aliases resolved, otherwise as-is).
export function canonicalJudge(name) {
  return JUDGE_ALIAS[name] ?? name
}

// "J. Bell" → "J. Bell (VI)"; "R. Hayes (PRESIDING)" → "R. Hayes (V)";
// anything unrecognised (an "Other" free-text judge) → unchanged.
export function judgeLabel(name) {
  if (!name) return name ?? ''
  const plain = canonicalJudge(name)
  const div = JUDGE_DIVISION[plain]
  return div ? `${plain} (${div})` : name
}

// General Sessions dropdown — the existing order, unchanged except that
// "R. Hayes (PRESIDING)" is now plain "R. Hayes". Blank first, "Other" last.
export const GS_JUDGES = [
  '',
  'J. Bell',
  'R. Bell',
  'M. Blackburn',
  'S. Coleman',
  'A. Escobar',
  'R. Hayes',
  'A. Holt',
  'L. Jones',
  'M. Floyd',
  'G. Robinson',
  'A. Walker',
  'Other',
]

// Criminal Court dropdown (CC files ONLY), in division order.
export const CC_JUDGES = [
  '',
  'S. Dozier',
  'A. Dalton',
  'D. Deaner',
  'J. Smith',
  'K. Babb',
  'C. Chappell',
  'Other',
]
