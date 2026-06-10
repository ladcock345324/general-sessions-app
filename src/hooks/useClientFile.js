import { useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import db from '../localDB'

export function useClientFile(clientId) {
  const data = useLiveQuery(async () => {
    if (!clientId) return null

    const [client, nextEvent, allIncidents, allHours, personalNote] = await Promise.all([
      db.clients.get(clientId),
      db.next_events.where('client_id').equals(clientId).first(),
      db.incidents.where('client_id').equals(clientId).toArray(),
      db.hours.where('client_id').equals(clientId).toArray(),
      db.personal_notes.where('client_id').equals(clientId).first(),
    ])

    if (!client) return null

    allIncidents.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    const incidentIds = allIncidents.map(i => i.id)
    const allCases = incidentIds.length
      ? await db.cases.where('incident_id').anyOf(incidentIds).toArray()
      : []

    const casesByIncidentId = new Map()
    for (const c of allCases) {
      const list = casesByIncidentId.get(c.incident_id) ?? []
      list.push(c)
      casesByIncidentId.set(c.incident_id, list)
    }

    const incidents = allIncidents.map(incident => ({
      ...incident,
      cases: casesByIncidentId.get(incident.id) ?? [],
    }))

    allHours.sort((a, b) => (a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : 0))

    return { client, incidents, nextEvent: nextEvent ?? null, hours: allHours, personalNote: personalNote ?? null }
  }, [clientId])

  const refetch = useCallback(() => {}, [])

  return {
    client: data?.client ?? null,
    incidents: data?.incidents ?? [],
    nextEvent: data?.nextEvent ?? null,
    hours: data?.hours ?? [],
    personalNote: data?.personalNote ?? null,
    loading: data === undefined,
    error: null,
    refetch,
  }
}
