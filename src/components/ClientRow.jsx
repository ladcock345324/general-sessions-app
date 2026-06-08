import { useNavigate } from 'react-router-dom'
import styles from './ClientRow.module.css'

// Returns onPointerDown/onPointerUp props that only fire `handler` when the
// pointer moved less than 5px — distinguishes a tap from a drag-to-select.
function tapHandlers(handler) {
  if (!handler) return {}
  const start = { x: 0, y: 0 }
  return {
    onPointerDown: e => { start.x = e.clientX; start.y = e.clientY },
    onPointerUp:   e => {
      if (Math.abs(e.clientX - start.x) < 5 && Math.abs(e.clientY - start.y) < 5) handler()
    },
  }
}

function CustodyBadge({ status, muted }) {
  const label =
    status === 'in_custody' ? 'In Custody' :
    status === 'bonded_out' ? 'Bonded Out' :
    status === 'out'        ? 'Out'         : null
  if (!label) return null
  const colorClass = muted ? styles.badgeGray :
    status === 'in_custody' ? styles.badgeRed : styles.badgeGreen
  return <span className={`${styles.badge} ${colorClass}`}>{label}</span>
}

function RelivedBadge({ closed }) {
  return (
    <div className={styles.relievedBadge}>
      <span className={styles.relievedLabel}>Relieved as Counsel</span>
      {closed && <span className={styles.closedBadge}>CLOSED</span>}
    </div>
  )
}

export default function ClientRow({ client, relieved = false, tableWidth, onClick }) {
  const navigate = useNavigate()
  const { lastName, firstName, gender, age, oca, custodyStatus, nextHearing, relievedClosed, caseNumbers } = client

  const nameOca = oca ? `${lastName}, ${firstName} (${gender}, ${age}) #${oca}` : `${lastName}, ${firstName} (${gender}, ${age})`

  let nextSegments = null
  if (nextHearing && nextHearing.date) {
    const d = new Date(nextHearing.date)
    const weekday = isNaN(d) ? '' : d.toLocaleDateString('en-US', { weekday: 'long' }) + ', '
    const t = nextHearing.time
    const validTime = t && /\d:\d{2}\s*(AM|PM)/i.test(t)
    nextSegments = [
      `${weekday}${nextHearing.date}`,
      ...(validTime ? [t] : []),
      ...(nextHearing.docket_type ? [nextHearing.docket_type] : []),
      ...(nextHearing.courtroom ? [`Courtroom ${nextHearing.courtroom}`] : []),
    ]
  }

  return (
    <div className={`${styles.row} ${relieved ? styles.dimmed : ''}`} {...tapHandlers(onClick)} style={onClick ? { cursor: 'pointer', userSelect: 'text' } : undefined}>
      <div className={styles.info}>
        <span className={styles.name}>{nameOca}</span>
        {nextSegments
          ? (
            <span className={styles.next}>
              <span style={{ textDecoration: 'underline' }}>Next:</span>{' '}
              {nextSegments.map((seg, i) => (
                <span key={i}>{i > 0 && <span className={styles.pipe}>|</span>}{seg}</span>
              ))}
            </span>
          )
          : <span className={styles.nextEmpty}>&nbsp;</span>
        }
      </div>
      <div className={styles.rowRight}>
        {caseNumbers && caseNumbers.length > 0 && (
          <div className={styles.caseTable}>
            {longestCaseNumber && (
              <>
                <span className={styles.caseSizer} aria-hidden="true">{longestCaseNumber}</span>
                <span className={styles.caseSizer} aria-hidden="true" />
              </>
            )}
            {caseNumbers.flatMap(c => {
              const start = { x: 0, y: 0 }
              const charge = c.charge_abbrev || c.charge || ''
              const pd = e => { e.stopPropagation(); start.x = e.clientX; start.y = e.clientY }
              const pu = e => { e.stopPropagation(); if (Math.abs(e.clientX - start.x) < 5 && Math.abs(e.clientY - start.y) < 5) navigate(`/case/${c.case_number}`) }
              return [
                <span key={`n-${c.id}`} className={styles.caseNum} onPointerDown={pd} onPointerUp={pu}>{c.case_number}</span>,
                <span key={`ch-${c.id}`} className={styles.caseCharge} onPointerDown={pd} onPointerUp={pu}>| {charge}</span>,
              ]
            })}
          </div>
        )}
        <div className={styles.right}>
          {relieved ? (
            <RelivedBadge closed={relievedClosed} />
          ) : (
            <div className={styles.badgeStack}>
              <CustodyBadge status={custodyStatus} muted={!!relievedClosed} />
              {relievedClosed && <span className={styles.closedBadge}>CLOSED</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
