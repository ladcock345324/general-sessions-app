import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useClients } from '../hooks/useClients'
import { useSyncStatus } from '../SyncContext'
import ClientRow from '../components/ClientRow'
import styles from './ClientList.module.css'

const byLastName = (a, b) => a.last_name.localeCompare(b.last_name)

// Strip leading non-digits and parse as integer for numeric sort
function caseNumericKey(caseNumber) {
  return parseInt((caseNumber ?? '').replace(/^\D+/, ''), 10) || 0
}

// Map Supabase row → shape ClientRow expects
function toRowProps(client) {
  const allCases = (client.incidents ?? []).flatMap(inc => inc.cases ?? [])
  const caseNumbers = [...allCases].sort((a, b) => caseNumericKey(a.case_number) - caseNumericKey(b.case_number))

  return {
    id: client.id,
    lastName: client.last_name,
    firstName: client.first_name,
    gender: client.gender,
    age: client.age,
    oca: client.oca,
    status: client.relieved_closed ? 'closed' : 'active',
    custodyStatus: client.custody_status,
    nextHearing: (client.next_events && client.next_events.length > 0)
      ? {
          date:        client.next_events[0].event_date,
          time:        client.next_events[0].event_time,
          docket_type: client.next_events[0].docket_type,
          courtroom:   client.next_events[0].courtroom,
        }
      : null,
    relievedClosed: client.relieved_closed ?? false,
    caseNumbers,
    indigentStatus: client.indigent_status ?? 'gray',
  }
}

function SyncStatusBar() {
  const { isOnline, isSyncing, lastSyncedAt } = useSyncStatus()

  let dot, text
  if (isSyncing) {
    dot  = styles.syncDotPulse
    text = 'Syncing…'
  } else if (!isOnline) {
    dot  = styles.syncDotYellow
    text = 'Offline — changes will sync when reconnected'
  } else {
    dot  = styles.syncDotGreen
    const time = lastSyncedAt
      ? new Date(lastSyncedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : null
    text = time ? `Synced ${time}` : 'Synced'
  }

  return (
    <div className={styles.syncBar}>
      <span className={`${styles.syncDot} ${dot}`} />
      <span>{text}</span>
    </div>
  )
}

export default function ClientList() {
  const navigate = useNavigate()
  const { clients, loading, error } = useClients()

  const active = clients.filter(c => !c.relieved_closed).sort(byLastName).map(toRowProps)
  const relieved = clients.filter(c => c.relieved_closed).sort(byLastName).map(toRowProps)

  return (
    <div className={styles.screen}>
      <div className={styles.topBar}>
        <button className={styles.signOutBtn} onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
      <SyncStatusBar />
      <header className={styles.header}>
        <h1 className={styles.title}>Clients</h1>
        <button className={styles.addClientBtn} onClick={() => navigate('/client/new')}>+</button>
      </header>

      {loading && (
        <div className={styles.stateMsg}>Loading…</div>
      )}

      {error && (
        <div className={styles.stateMsg}>Error: {error}</div>
      )}

      {!loading && !error && (
        <>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>Active</span>
              <span className={styles.sectionCount}>{active.length}</span>
            </div>
            <div className={styles.list}>
              {active.length === 0
                ? <div className={styles.emptyMsg}>No clients yet</div>
                : active.map(client => (
                    <ClientRow
                      key={client.id}
                      client={client}
                      onClick={() => navigate(`/client/${client.id}`)}
                    />
                  ))
              }
            </div>
          </section>

          {relieved.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Closed</span>
                <span className={styles.sectionCount}>{relieved.length}</span>
              </div>
              <div className={styles.list}>
                {relieved.map(client => (
                  <ClientRow
                    key={client.id}
                    client={client}
                    relieved
                    onClick={() => navigate(`/client/${client.id}`)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
