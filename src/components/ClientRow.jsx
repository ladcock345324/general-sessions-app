import styles from './ClientRow.module.css'

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
  const { lastName, firstName, gender, age, oca, custodyStatus, nextHearing, relievedClosed } = client

  const nameOca = oca ? `${lastName}, ${firstName} (${gender}, ${age}) #${oca}` : `${lastName}, ${firstName} (${gender}, ${age})`

  let nextLine = null
  if (nextHearing && nextHearing.date) {
    const d = new Date(nextHearing.date)
    const weekday = isNaN(d) ? '' : d.toLocaleDateString('en-US', { weekday: 'long' }) + ' '
    const t = nextHearing.time
    const validTime = t && /\d:\d{2}\s*(AM|PM)/i.test(t)
    const segments = [
      `${weekday}${nextHearing.date}`,
      ...(validTime ? [t] : []),
      ...(nextHearing.courtroom ? [`Courtroom ${nextHearing.courtroom}`] : []),
      ...(nextHearing.reason ? [nextHearing.reason] : []),
      ...(nextHearing.judge ? [nextHearing.judge] : []),
    ]
    nextLine = `Next: ${segments.join('  |  ')}`
  }

  return (
    <div className={`${styles.row} ${relieved ? styles.dimmed : ''}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className={styles.info}>
        <span className={styles.name}>{nameOca}</span>
        {nextLine
          ? <span className={styles.next}>{nextLine}</span>
          : <span className={styles.nextEmpty}>&nbsp;</span>
        }
      </div>
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
