import Dexie from 'dexie'

const db = new Dexie('GeneralSessionsDB')

db.version(1).stores({
  clients:             'id, last_name, relieved_as_counsel',
  incidents:           'id, client_id',
  cases:               'id, incident_id, case_number',
  next_events:         'id, client_id',
  hours:               'id, client_id',
  personal_notes:      'id, client_id',
  courtroom_documents: 'id, client_id',
  sync_queue:          '++id, table_name, operation, status, created_at',
})

export default db
