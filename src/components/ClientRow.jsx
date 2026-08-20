import { useNavigate } from 'react-router-dom'
import db from '../localDB'
import { addToSyncQueue } from '../syncManager'
import { bracketBlocks } from '../caseGrouping'
import styles from './ClientRow.module.css'

// Returns pointer event props that fire `handler` on tap but not on:
//   - drag (pointer moved > 5px)
//   - long press on touch (finger held >= 300ms — lets browser select text)
function tapHandlers(handler) {
  if (!handler) return {}
  const state = { x: 0, y: 0, t: 0, touch: false }
  return {
    onPointerDown: e => {
      state.x = e.clientX
      state.y = e.clientY
      state.touch = e.pointerType === 'touch'
      state.t = state.touch ? Date.now() : 0
    },
    onPointerUp: e => {
      if (Math.abs(e.clientX - state.x) >= 5 || Math.abs(e.clientY - state.y) >= 5) return
      if (state.touch && Date.now() - state.t >= 300) return
      handler()
    },
  }
}

// Display a stored date without leading zeros ("08/05/2026" → "8/5/2026").
// Anything that isn't a plain M/D/YYYY passes through untouched.
function formatDateDisplay(mdy) {
  const m = String(mdy ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return mdy ?? ''
  return `${Number(m[1])}/${Number(m[2])}/${m[3]}`
}

// An event is "overdue" once its date+time is more than three hours in the past.
// This is the client list's only stale-next-event signal and is deliberately
// scoped to this component — ClientFile's blue block and CaseView are unchanged.
//
// Purely derived at render: nothing is stored, so it clears itself the moment the
// next event is updated. It does NOT re-evaluate on a timer — a row flips to red
// on its next render (navigation, or any Dexie change via useLiveQuery), which is
// the accepted cost of having no stored flag.
//
// BOTH fields are required. A blank date or a blank time yields no meaningful
// cutoff, so those events are never marked overdue rather than being measured
// from an assumed midnight. Built from numeric Date(y, m, d, h, min) args, never
// new Date(string) — the same rule the rest of the app follows for these
// hand-entered "M/D/YYYY" strings.
const OVERDUE_GRACE_MS = 3 * 60 * 60 * 1000

function isOverdue(dateStr, timeStr) {
  const dm = String(dateStr ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const tm = String(timeStr ?? '').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!dm || !tm) return false
  let hours = Number(tm[1]) % 12
  if (/PM/i.test(tm[3])) hours += 12
  const when = new Date(Number(dm[3]), Number(dm[1]) - 1, Number(dm[2]), hours, Number(tm[2]))
  return Date.now() - when.getTime() > OVERDUE_GRACE_MS
}

const INDIGENT_CYCLE = { red: 'yellow', yellow: 'green', green: 'gold', gold: 'red' }
const INDIGENT_COLOR = { red: '#b85555', yellow: '#E8913A', green: '#3d9e6a', gold: '#FFD700' }

function IndigentCircle({ clientId, status }) {
  const current = INDIGENT_COLOR[status] ? status : 'red'
  function handleClick(e) {
    e.stopPropagation()
    const next = INDIGENT_CYCLE[current]
    db.clients.update(clientId, { indigent_status: next })
    addToSyncQueue('clients', 'UPDATE', clientId, { id: clientId, indigent_status: next })
  }
  return (
    <div
      className={styles.indigentCircle}
      onClick={handleClick}
      onPointerDown={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
    >
      <div style={{
        width: 14, height: 14, borderRadius: '50%',
        backgroundColor: INDIGENT_COLOR[current],
        pointerEvents: 'none',
      }} />
    </div>
  )
}

function CustodyBadge({ status, muted }) {
  const label =
    status === 'in_custody'     ? 'In Custody'     :
    status === 'no_bond_held'   ? 'No Bond/Held'   :
    status === 'bonded_out'     ? 'Bonded Out'     :
    status === 'pretrialed_out' ? 'Pretrialed Out' :
    status === 'ror'            ? "ROR'd"          :
    status === 'out'            ? 'Out'            : null
  if (!label) return null
  // In-custody statuses (in_custody, no_bond_held) → crimson; the rest → green.
  // The closed-section gray override wins over both.
  const colorClass = muted ? styles.badgeGray :
    (status === 'in_custody' || status === 'no_bond_held') ? styles.badgeRed : styles.badgeGreen
  return <span className={`${styles.badge} ${colorClass}`}>{label}</span>
}

function RelivedBadge() {
  return <span className={styles.closedBadge}>CLOSED</span>
}

export default function ClientRow({ client, relieved = false, onClick }) {
  const navigate = useNavigate()
  // bookingDate / bookingTime are deliberately NOT destructured here: the
  // in-custody preliminary-hearing countdown that consumed them was removed
  // 2026-08-10. The clients.booking_date and clients.booking_time COLUMNS are
  // retained, as are their New/Edit Client form fields — only the countdown is
  // gone. See PROGRESS.md.
  const { id, lastName, firstName, gender, oca, custodyStatus, nextHearing, relievedClosed, caseNumbers, indigentStatus } = client

  let nextSegments = null
  let nextOverdue = false
  if (nextHearing && nextHearing.date) {
    nextOverdue = isOverdue(nextHearing.date, nextHearing.time)
    const d = new Date(nextHearing.date)
    const weekday = isNaN(d) ? '' : d.toLocaleDateString('en-US', { weekday: 'long' }) + ', '
    const t = nextHearing.time
    const validTime = t && /\d:\d{2}\s*(AM|PM)/i.test(t)
    nextSegments = [
      `${weekday}${formatDateDisplay(nextHearing.date)}`,
      ...(validTime ? [t] : []),
      ...(nextHearing.courtroom ? [nextHearing.courtroom] : []),
      ...(nextHearing.reason ? [nextHearing.reason] : []),
    ]
  }

  return (
    <div className={styles.row} {...tapHandlers(onClick)} style={onClick ? { cursor: 'pointer', userSelect: 'text' } : undefined}>
      <div className={styles.info}>
        <div className={styles.nameLine}>
          <span className={styles.name}>
            {lastName}, {firstName} ({gender})
            {oca && <>{' '}<span className={styles.oca}>{oca}</span></>}
          </span>
          <IndigentCircle clientId={id} status={indigentStatus} />
        </div>
        {nextSegments
          ? (
            <span className={`${styles.next}${nextOverdue ? ` ${styles.nextOverdue}` : ''}`}>
              {nextSegments.map((seg, i) => (
                <span key={i}>{i > 0 && <span className={styles.pipe}>|</span>}{seg}</span>
              ))}
            </span>
          )
          : <span className={styles.nextEmpty}>&nbsp;</span>
        }
      </div>
      <div className={styles.caseLine}>
        {caseNumbers && caseNumbers.length > 0 && (
          <div className={styles.caseTable}>
            {bracketBlocks(caseNumbers).map(block => {
              const rows = block.items.map(c => {
                const start = { x: 0, y: 0 }
                const charge = c.charge_abbrev || c.charge || ''
                const pd = e => { e.stopPropagation(); start.x = e.clientX; start.y = e.clientY }
                // case_number is nullable and the tap target is the number span
                // alone, so an unnumbered case would have a zero-width hit area and
                // be unreachable from this list. A dash gives it something to tap,
                // and the id keeps the URL resolvable (CaseView resolves both).
                const pu = e => { e.stopPropagation(); if (Math.abs(e.clientX - start.x) < 5 && Math.abs(e.clientY - start.y) < 5) navigate(`/case/${c.case_number || c.id}`) }
                return (
                  <div key={c.id} className={styles.caseTableRow}>
                    <span className={styles.caseNum} onPointerDown={pd} onPointerUp={pu}>{c.case_number || '—'}</span>
                    {/* A probation violation has no charge, abbrev or
                        classification to show — "- PV" stands in for all three.
                        The case-number span above is untouched, so the tap
                        target and navigation are identical either way. */}
                    {c.is_pv ? (
                      /* .casePv, not .caseCharge: as of 2026-08-20 "PV" renders
                         in the case number's exact type (family, size, weight,
                         colour), not the muted charge style. It stays a SIBLING
                         span rather than moving inside .caseNum, because that
                         span is the tap target and is width-locked to the
                         56px number column. */
                      <span className={styles.casePv}>- PV</span>
                    ) : (
                      <>
                        {charge && <span className={styles.caseCharge}>| {charge}</span>}
                        {c.classification && <>{' '}<span className={styles.caseClassification}>({c.classification})</span></>}
                      </>
                    )}
                  </div>
                )
              })
              return block.bracket
                ? <div key={block.items[0].id} className={styles.caseGroup}>{rows}</div>
                : rows
            })}
          </div>
        )}
        <div className={styles.right}>
          <div className={styles.badgeArea}>
            {relieved ? (
              <div className={styles.badgeStack}>
                <CustodyBadge status={custodyStatus} muted />
                <RelivedBadge />
              </div>
            ) : (
              <div className={styles.badgeStack}>
                <CustodyBadge status={custodyStatus} muted={!!relievedClosed} />
                {relievedClosed && <span className={styles.closedBadge}>CLOSED</span>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
