import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useClients } from '../hooks/useClients'
import { useSyncStatus } from '../SyncContext'
import ClientRow from '../components/ClientRow'
import OfflineStatus from '../components/OfflineStatus'
import styles from './ClientList.module.css'

const SORT_KEY = 'clientListSortMode'

const byLastName = (a, b) => a.last_name.localeCompare(b.last_name)

// Parse next_events.event_date ("M/D/YYYY") + event_time ("9:05 AM") into a
// comparable timestamp. A missing/unparseable time sorts as start of that day,
// so dateless events come before timed events on the same date. Returns null if
// there's no usable date.
function eventTimestamp(ev) {
  if (!ev || !ev.event_date) return null
  const dm = ev.event_date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!dm) return null
  const month = Number(dm[1]) - 1
  const day = Number(dm[2])
  const year = Number(dm[3])
  let hours = 0
  let minutes = 0
  const tm = (ev.event_time || '').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (tm) {
    hours = Number(tm[1]) % 12
    if (/PM/i.test(tm[3])) hours += 12
    minutes = Number(tm[2])
  }
  return new Date(year, month, day, hours, minutes).getTime()
}

function nextEventTimestamp(client) {
  return eventTimestamp(client.next_events && client.next_events[0])
}

// Active section: "name" → alphabetical; "event" → soonest next event first,
// clients with no next event grouped at the bottom, alphabetical among themselves.
function sortActive(clients, mode) {
  const arr = [...clients]
  if (mode !== 'event') return arr.sort(byLastName)
  return arr.sort((a, b) => {
    const ta = nextEventTimestamp(a)
    const tb = nextEventTimestamp(b)
    if (ta == null && tb == null) return byLastName(a, b)
    if (ta == null) return 1
    if (tb == null) return -1
    return ta - tb
  })
}

// Closed section: always by closed_at DESC (most recently closed first); null
// closed_at sorts to the bottom. Toggle does not affect this section.
function sortClosed(clients) {
  return [...clients].sort((a, b) => {
    const ca = a.closed_at ? new Date(a.closed_at).getTime() : null
    const cb = b.closed_at ? new Date(b.closed_at).getTime() : null
    if (ca == null && cb == null) return 0
    if (ca == null) return 1
    if (cb == null) return -1
    return cb - ca
  })
}

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
    indigentStatus: client.indigent_status ?? 'red',
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

  const [sortMode, setSortMode] = useState(() =>
    localStorage.getItem(SORT_KEY) === 'event' ? 'event' : 'name'
  )

  function toggleSort() {
    setSortMode(prev => {
      const next = prev === 'name' ? 'event' : 'name'
      localStorage.setItem(SORT_KEY, next)
      return next
    })
  }

  const active = sortActive(clients.filter(c => !c.relieved_closed), sortMode).map(toRowProps)
  const relieved = sortClosed(clients.filter(c => c.relieved_closed)).map(toRowProps)

  return (
    <div className={styles.screen}>
      <div className={styles.topBar}>
        <button className={styles.signOutBtn} onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
      <SyncStatusBar />
      <OfflineStatus />
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
          <div className={styles.sortToggleRow}>
            <button className={styles.sortToggle} onClick={toggleSort}>
              Sorting by: {sortMode === 'event' ? 'Next Event' : 'Name'}
            </button>
          </div>

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
