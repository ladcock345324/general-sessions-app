import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://afhzkqjrciyoeizrpaxt.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmaHprcWpyY2l5b2VpenJwYXh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTk1MTcsImV4cCI6MjA5NTk5NTUxN30.TY7bdmAthoQAts_BEfvNMgZirEUmLKjxLCkUP8vkABI'
)

async function seed() {
  console.log('Seeding Kimberly Woods-James…\n')

  // ── 1. Client ─────────────────────────────────────────────────────────────
  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .insert({
      last_name: 'Woods-James',
      first_name: 'Kimberly',
      gender: 'F',
      age: 56,
      oca: '140804',
      custody_status: 'in_custody',
      bond_amount: 5000,
      relieved_as_counsel: false,
      relieved_closed: false,
      criminal_history: null,
    })
    .select()
    .single()

  if (clientErr) { console.error('Client insert failed:', clientErr.message); process.exit(1) }
  const clientId = client.id
  console.log(`✓ Client inserted (id: ${clientId})`)

  // ── 2. Next Event ─────────────────────────────────────────────────────────
  const { error: eventErr } = await supabase
    .from('next_events')
    .insert({
      client_id: clientId,
      docket_type: 'Jail Docket',
      event_date: '6/7/2026',
      event_time: '9:05 AM',
      courtroom: 'Courtroom 4B',
      judge: 'A. Walker',
      subpoenas: 'w/ subs',
    })

  if (eventErr) { console.error('Next event insert failed:', eventErr.message); process.exit(1) }
  console.log('✓ Next event inserted')

  // ── 3. Incident 1: July 2024 ──────────────────────────────────────────────
  const { data: inc1, error: inc1Err } = await supabase
    .from('incidents')
    .insert({ client_id: clientId, incident_date: 'July 2024' })
    .select()
    .single()

  if (inc1Err) { console.error('Incident 1 insert failed:', inc1Err.message); process.exit(1) }
  console.log(`✓ Incident 1 inserted (id: ${inc1.id})`)

  const { error: c1Err } = await supabase
    .from('cases')
    .insert([
      {
        incident_id: inc1.id,
        case_number: 'GS1041481',
        charge: 'Domestic Assault',
        warrant_status: 'No standalone warrant — see GS1041482',
        bond_amount: 1000,
        da_name: null,
      },
      {
        incident_id: inc1.id,
        case_number: 'GS1041482',
        charge: 'Vandalism',
        warrant_status: 'Warrant covers both charges',
        bond_amount: 1000,
        da_name: 'Ms. Districa Attana',
      },
    ])

  if (c1Err) { console.error('Cases 1 insert failed:', c1Err.message); process.exit(1) }
  console.log('✓ Cases for Incident 1 inserted (GS1041481, GS1041482)')

  // ── 4. Incident 2: December 2025 ──────────────────────────────────────────
  const { data: inc2, error: inc2Err } = await supabase
    .from('incidents')
    .insert({ client_id: clientId, incident_date: 'December 2025' })
    .select()
    .single()

  if (inc2Err) { console.error('Incident 2 insert failed:', inc2Err.message); process.exit(1) }
  console.log(`✓ Incident 2 inserted (id: ${inc2.id})`)

  const { error: c2Err } = await supabase
    .from('cases')
    .insert([
      {
        incident_id: inc2.id,
        case_number: 'GS1107926',
        charge: 'Theft ≤$1,000',
        warrant_status: 'Warrant on file',
        bond_amount: 1500,
        da_name: null,
      },
      {
        incident_id: inc2.id,
        case_number: 'GS1107927',
        charge: 'Vandalism ≤$1,000',
        warrant_status: 'Warrant on file',
        bond_amount: 1000,
        da_name: null,
      },
    ])

  if (c2Err) { console.error('Cases 2 insert failed:', c2Err.message); process.exit(1) }
  console.log('✓ Cases for Incident 2 inserted (GS1107926, GS1107927)')

  // ── 5. Hours ──────────────────────────────────────────────────────────────
  const { error: hoursErr } = await supabase
    .from('hours')
    .insert({
      client_id: clientId,
      entry_date: '6/1/2026',
      hours: 0.3,
      description: 'Initial client meeting',
    })

  if (hoursErr) { console.error('Hours insert failed:', hoursErr.message); process.exit(1) }
  console.log('✓ Hours inserted')

  console.log('\nSeed complete ✓')
}

seed()
