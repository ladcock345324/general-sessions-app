import { useLiveQuery } from 'dexie-react-hooks'
import db from '../localDB'

export function useClients() {
  const clients = useLiveQuery(async () => {
    const [allClients, allNextEvents, allIncidents, allCases] = await Promise.all([
      db.clients.orderBy('last_name').toArray(),
      db.next_events.toArray(),
      db.incidents.toArray(),
      db.cases.toArray(),
    ])

    const nextEventsByClientId = new Map()
    for (const ne of allNextEvents) {
      const list = nextEventsByClientId.get(ne.client_id) ?? []
      list.push(ne)
      nextEventsByClientId.set(ne.client_id, list)
    }

    const casesByIncidentId = new Map()
    for (const c of allCases) {
      const list = casesByIncidentId.get(c.incident_id) ?? []
      list.push(c)
      casesByIncidentId.set(c.incident_id, list)
    }

    const incidentsByClientId = new Map()
    for (const inc of allIncidents) {
      const list = incidentsByClientId.get(inc.client_id) ?? []
      list.push({ ...inc, cases: casesByIncidentId.get(inc.id) ?? [] })
      incidentsByClientId.set(inc.client_id, list)
    }

    return allClients.map(client => ({
      ...client,
      next_events: nextEventsByClientId.get(client.id) ?? [],
      incidents: incidentsByClientId.get(client.id) ?? [],
    }))
  }, [])

  return {
    clients: clients ?? [],
    loading: clients === undefined,
    error: null,
  }
}
