import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'

export function useClients() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchClients() {
      setLoading(true)
      const { data, error } = await supabase
        .from('clients')
        .select('*, next_events(event_date, event_time, docket_type, courtroom, reason, judge), incidents(cases(id, case_number, charge, charge_abbrev))')
        .order('last_name', { ascending: true })

      if (error) {
        setError(error.message)
      } else {
        setClients(data ?? [])
      }
      setLoading(false)
    }

    fetchClients()
  }, [])

  return { clients, loading, error }
}
