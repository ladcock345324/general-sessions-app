import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'

export function useClientFile(clientId) {
  const [client, setClient] = useState(null)
  const [incidents, setIncidents] = useState([])
  const [nextEvent, setNextEvent] = useState(null)
  const [hours, setHours] = useState([])
  const [personalNote, setPersonalNote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!clientId) return

    async function fetchAll() {
      setLoading(true)
      setError(null)

      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single()

      if (clientError) {
        setError(clientError.message)
        setLoading(false)
        return
      }
      setClient(clientData)

      const { data: eventData } = await supabase
        .from('next_events')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle()
      setNextEvent(eventData ?? null)

      const { data: incidentData } = await supabase
        .from('incidents')
        .select(`
          id,
          incident_date,
          incident_description,
          cases (
            id,
            case_number,
            charge,
            warrant_url,
            bond_amount,
            disposition,
            notes,
            status
          )
        `)
        .eq('client_id', clientId)
        .order('id', { ascending: true })
      setIncidents(incidentData ?? [])

      const { data: hoursData } = await supabase
        .from('hours')
        .select('*')
        .eq('client_id', clientId)
        .order('entry_date', { ascending: false })
      setHours(hoursData ?? [])

      const { data: noteData } = await supabase
        .from('personal_notes')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle()
      setPersonalNote(noteData ?? null)

      setLoading(false)
    }

    fetchAll()
  }, [clientId, tick])

  return { client, incidents, nextEvent, hours, personalNote, loading, error, refetch }
}
