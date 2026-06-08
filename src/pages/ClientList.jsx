import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useClients } from '../hooks/useClients'
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
    status: client.relieved_as_counsel ? 'relieved' : 'active',
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
  }
}

export default function ClientList() {
  const navigate = useNavigate()
  const { clients, loading, error } = useClients()
  const measureRef = useRef(null)
  const [tableWidth, setTableWidth] = useState(null)

  useEffect(() => {
    if (!clients.length || !measureRef.current) return
    const span = measureRef.current
    let maxW = 0
    for (const client of clients) {
      const allCases = (client.incidents ?? []).flatMap(inc => inc.cases ?? [])
      for (const c of allCases) {
        const charge = c.charge_abbrev || c.charge || ''
        span.textContent = `${c.case_number} | ${charge}`
        const w = span.getBoundingClientRect().width
        if (w > maxW) maxW = w
      }
    }
    if (maxW > 0) setTableWidth(Math.ceil(maxW) + 4)
  }, [clients])

  const active = clients.filter(c => !c.relieved_as_counsel).sort(byLastName).map(toRowProps)
  const relieved = clients.filter(c => c.relieved_as_counsel).sort(byLastName).map(toRowProps)

  return (
    <div className={styles.screen}>
      {/* Hidden span for measuring longest case row string */}
      <span ref={measureRef} style={{ visibility: 'hidden', position: 'absolute', whiteSpace: 'nowrap', fontSize: '10px', fontFamily: 'inherit', fontWeight: 700, pointerEvents: 'none' }} />
      <div className={styles.topBar}>
        <button className={styles.signOutBtn} onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
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
                      tableWidth={tableWidth}
                      onClick={() => navigate(`/client/${client.id}`)}
                    />
                  ))
              }
            </div>
          </section>

          {relieved.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Relieved as Counsel</span>
                <span className={styles.sectionCount}>{relieved.length}</span>
              </div>
              <div className={styles.list}>
                {relieved.map(client => (
                  <ClientRow
                    key={client.id}
                    client={client}
                    relieved
                    tableWidth={tableWidth}
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
