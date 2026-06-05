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

function CustodyBadge({ status }) {
  if (status === 'in_custody') {
    return <span className={`${styles.badge} ${styles.badgeOrange}`}>In Custody</span>
  }
  if (status === 'bonded_out') {
    return <span className={`${styles.badge} ${styles.badgeGreen}`}>Bonded Out</span>
  }
  return null
}

function RelivedBadge({ closed }) {
  return (
    <div className={styles.relievedBadge}>
      <span className={styles.relievedLabel}>Relieved as Counsel</span>
      {closed && <span className={styles.closedBadge}>CLOSED</span>}
    </div>
  )
}

export default function ClientRow({ client, relieved = false, onClick }) {
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
      {caseNumbers && caseNumbers.length > 0 && (
        <div className={styles.caseNumberStack}>
          {caseNumbers.map(c => (
            <span
              key={c.id}
              className={styles.caseNumberItem}
              {...tapHandlers(() => navigate(`/case/${c.case_number}`))}
            >
              {c.case_number}
            </span>
          ))}
        </div>
      )}
      <div className={styles.right}>
        {relieved ? (
          <RelivedBadge closed={relievedClosed} />
        ) : (
          <div className={styles.badgeStack}>
            <CustodyBadge status={custodyStatus} />
            {relievedClosed && <span className={styles.closedBadge}>CLOSED</span>}
          </div>
        )}
      </div>
    </div>
  )
}
