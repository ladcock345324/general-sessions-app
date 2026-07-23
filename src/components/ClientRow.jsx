import { useNavigate } from 'react-router-dom'
import db from '../localDB'
import { addToSyncQueue } from '../syncManager'
import { computePrelimCutoff, shortWeekday, formatMD, formatBookingTimeCompact } from '../prelimDeadline'
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
  const { id, lastName, firstName, gender, oca, custodyStatus, bookingDate, bookingTime, nextHearing, relievedClosed, caseNumbers, indigentStatus } = client

  // In-custody preliminary-hearing line: only when in custody (in_custody OR
  // no_bond_held — both are physically in custody) AND a booking date is set.
  // Cutoff = booking + 14 days (weekend rollover), computed at render.
  const showPrelim = (custodyStatus === 'in_custody' || custodyStatus === 'no_bond_held') && !!bookingDate
  const cutoffDate = showPrelim ? computePrelimCutoff(bookingDate) : ''

  let nextSegments = null
  if (nextHearing && nextHearing.date) {
    const d = new Date(nextHearing.date)
    const weekday = isNaN(d) ? '' : d.toLocaleDateString('en-US', { weekday: 'long' }) + ', '
    const t = nextHearing.time
    const validTime = t && /\d:\d{2}\s*(AM|PM)/i.test(t)
    nextSegments = [
      `${weekday}${nextHearing.date}`,
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
            <span className={styles.next}>
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
            {caseNumbers.map(c => {
              const start = { x: 0, y: 0 }
              const charge = c.charge_abbrev || c.charge || ''
              const pd = e => { e.stopPropagation(); start.x = e.clientX; start.y = e.clientY }
              const pu = e => { e.stopPropagation(); if (Math.abs(e.clientX - start.x) < 5 && Math.abs(e.clientY - start.y) < 5) navigate(`/case/${c.case_number}`) }
              return (
                <div key={c.id} className={styles.caseTableRow}>
                  <span className={styles.caseNum} onPointerDown={pd} onPointerUp={pu}>{c.case_number}</span>
                  <span className={styles.caseCharge}>| {charge}</span>
                  {c.classification && <>{' '}<span className={styles.caseClassification}>({c.classification})</span></>}
                </div>
              )
            })}
          </div>
        )}
        <div className={styles.right}>
          <div className={styles.badgeArea}>
            {showPrelim && (
              <div className={styles.prelimBlock}>
                <div className={styles.prelimRow1}>
                  {formatBookingTimeCompact(bookingTime)} {shortWeekday(bookingDate)} {formatMD(bookingDate)}
                </div>
                <div className={styles.prelimRow2}>
                  → {shortWeekday(cutoffDate)} {formatMD(cutoffDate)}
                </div>
              </div>
            )}
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
