// Judges, their full names and their divisions (2026-10-19).
//
// ⚠️ next_events.judge stores ONLY the short name ("J. Bell"), exactly as it
// always has, and the dropdown option VALUES are those short names. Everything
// the user SEES — dropdown labels and the Next Event display — goes through
// judgeLabel(), which turns the short name into the judge's full name plus
// division, e.g. "J. Bell" → "Jodie Bell (VI)". So the stored data never changes
// and a name or division can be corrected here without a migration. A free-text
// "Other" judge, or any name not in the map, displays exactly as typed.
//
// One map covers both courts — the General Sessions and Criminal Court short
// names don't overlap.
export const JUDGES = {
  // General Sessions (divisions from the court's website)
  'G. Robinson': { full: 'Gale Robinson', division: 'I' },
  'M. Blackburn': { full: 'Melissa Blackburn', division: 'II' },
  'A. Escobar': { full: 'Ana Escobar', division: 'III' },
  'A. Walker': { full: 'Allegra Walker', division: 'IV' },
  'R. Hayes': { full: 'Robin Hayes', division: 'V' },
  'J. Bell': { full: 'Jodie Bell', division: 'VI' },
  'M. Floyd': { full: 'Marcus Floyd', division: 'VII' },
  'R. Bell': { full: 'Rachel Bell', division: 'VIII' },
  'L. Jones': { full: 'Lynda Jones', division: 'IX' },
  'S. Coleman': { full: 'Sam Coleman', division: 'X' },
  'A. Holt': { full: 'Aaron Holt', division: 'XI' },
  // Criminal Court
  'S. Dozier': { full: 'Steve Dozier', division: 'I' },
  'A. Dalton': { full: 'Angelita Dalton', division: 'II' },
  'D. Deaner': { full: 'Dawn Deaner', division: 'III' },
  'J. Smith': { full: 'Jennifer Smith', division: 'IV' },
  'K. Babb': { full: 'Khadija Babb', division: 'V' },
  'C. Chappell': { full: 'Cynthia Chappell', division: 'VI' },
}

// Legacy stored strings → the short name they mean. "R. Hayes (PRESIDING)" was
// the dropdown entry until 2026-10-19; rows saved with it still hold it.
const JUDGE_ALIAS = {
  'R. Hayes (PRESIDING)': 'R. Hayes',
}

// The short name a stored value stands for (aliases resolved, otherwise as-is).
export function canonicalJudge(name) {
  return JUDGE_ALIAS[name] ?? name
}

// "J. Bell" → "Jodie Bell (VI)"; "R. Hayes (PRESIDING)" → "Robin Hayes (V)";
// anything unrecognised (an "Other" free-text judge) → unchanged.
export function judgeLabel(name) {
  if (!name) return name ?? ''
  const judge = JUDGES[canonicalJudge(name)]
  return judge ? `${judge.full} (${judge.division})` : name
}

// General Sessions dropdown, in DIVISION order I → XI (2026-10-19). Blank
// first, "Other" last. Values are the stored short names.
export const GS_JUDGES = [
  '',
  'G. Robinson',
  'M. Blackburn',
  'A. Escobar',
  'A. Walker',
  'R. Hayes',
  'J. Bell',
  'M. Floyd',
  'R. Bell',
  'L. Jones',
  'S. Coleman',
  'A. Holt',
  'Other',
]

// Criminal Court dropdown (CC files ONLY), in division order I → VI.
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
