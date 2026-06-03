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
      {closed && <span className={styles.closedLabel}>CLOSED</span>}
    </div>
  )
}

export default function ClientRow({ client, relieved = false, onClick }) {
  const { lastName, firstName, gender, age, oca, custodyStatus, nextHearing, relievedClosed } = client

  const nameOca = oca ? `${lastName}, ${firstName} (${gender}, ${age}) #${oca}` : `${lastName}, ${firstName} (${gender}, ${age})`

  const nextLine = nextHearing
    ? `Next: ${nextHearing.day}, ${nextHearing.date} at ${nextHearing.time}`
    : null

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
        {relieved
          ? <RelivedBadge closed={relievedClosed} />
          : <CustodyBadge status={custodyStatus} />
        }
      </div>
    </div>
  )
}
