import { useNavigate } from 'react-router-dom'
import db from '../localDB'
import { addToSyncQueue } from '../syncManager'
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

const INDIGENT_CYCLE = { gray: 'red', red: 'green', green: 'gray' }
const INDIGENT_COLOR = { gray: '#6b7a99', red: '#b85555', green: '#3d9e6a' }

function IndigentCircle({ clientId, status }) {
  const current = status ?? 'gray'
  function handleClick(e) {
    e.stopPropagation()
    const next = INDIGENT_CYCLE[current] ?? 'gray'
    db.clients.update(clientId, { indigent_status: next })
    addToSyncQueue('clients', 'UPDATE', clientId, { id: clientId, indigent_status: next })
  }
  return (
    <div
      onClick={handleClick}
      onPointerDown={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}
      style={{
        width: 28, height: 28, display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
      }}
    >
      <div style={{
        width: 14, height: 14, borderRadius: '50%',
        backgroundColor: INDIGENT_COLOR[current] ?? INDIGENT_COLOR.gray,
        pointerEvents: 'none',
      }} />
    </div>
  )
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

export default function ClientRow({ client, relieved = false, onClick }) {
  const navigate = useNavigate()
  const { id, lastName, firstName, gender, age, oca, custodyStatus, nextHearing, relievedClosed, caseNumbers, indigentStatus } = client

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
        <div className={styles.nameLine}>
          <span className={styles.name}>{nameOca}</span>
          <IndigentCircle clientId={id} status={indigentStatus} />
        </div>
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
                </div>
              )
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
