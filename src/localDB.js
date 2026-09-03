import Dexie from 'dexie'

const db = new Dexie('GeneralSessionsDB')

db.version(1).stores({
  clients:             'id, last_name, relieved_as_counsel',
})

db.version(2).stores({
  clients:             'id, last_name, relieved_as_counsel, indigent_status',
  incidents:           'id, client_id',
  cases:               'id, incident_id, case_number',
  next_events:         'id, client_id',
  hours:               'id, client_id',
  personal_notes:      'id, client_id',
  courtroom_documents: 'id, client_id',
  sync_queue:          '++id, table_name, operation, status, created_at',
})

// v3: index hours.sort_order so entries can be ordered/reordered by it.
db.version(3).stores({
  hours:               'id, client_id, sort_order',
})

// v4: drop the relieved_as_counsel index. The column was dropped from Supabase,
// so the index pointed at a field that no longer arrives in any fullSync payload.
//
// This bump is required precisely BECAUSE the field was indexed — a non-indexed
// column (clients.last_modified_at, cases.status, every pv_* column) can be added
// or removed with no bump at all, since Dexie stores whole objects and the store
// string lists indexed keys only. The v1/v2 declarations above are deliberately
// left as they were: they are the migration record for a device upgrading FROM
// those versions, and rewriting them in place would give a fresh install a
// different schema than an upgraded one.
db.version(4).stores({
  clients:             'id, last_name, indigent_status',
})

export default db
