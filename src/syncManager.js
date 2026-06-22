import db from './localDB'

const DATA_TABLES = [
  'clients',
  'incidents',
  'cases',
  'next_events',
  'hours',
  'personal_notes',
  'courtroom_documents',
]

export async function fullSync(supabase) {
  if (!navigator.onLine) return

  await processSyncQueue(supabase)

  const results = await Promise.all(
    DATA_TABLES.map(table => supabase.from(table).select('*'))
  )

  await Promise.all(
    results.map(({ data, error }, i) => {
      const table = DATA_TABLES[i]
      // Skip this table on a failed/offline fetch — preserve the existing cache.
      // A successful empty array (data = [], error = null) still clears, which is
      // how cross-device deletions propagate.
      if (error || !Array.isArray(data)) return Promise.resolve()
      return db.transaction('rw', db[table], async () => {
        await db[table].clear()
        await db[table].bulkPut(data)
      })
    })
  )

  // Re-apply any pending local writes so they survive the clear+bulkPut
  const pending = await db.sync_queue.where('status').equals('pending').toArray()
  for (const entry of pending) {
    if (entry.operation === 'INSERT' || entry.operation === 'UPDATE') {
      await db[entry.table_name].put(entry.payload)
    } else if (entry.operation === 'DELETE') {
      await db[entry.table_name].delete(entry.record_id)
    }
  }

  localStorage.setItem('lastSyncedAt', new Date().toISOString())
}

export async function processSyncQueue(supabase) {
  if (!navigator.onLine) return

  const entries = await db.sync_queue
    .where('status').equals('pending')
    .sortBy('created_at')

  for (const entry of entries) {
    try {
      if (entry.operation === 'INSERT') {
        const { error } = await supabase.from(entry.table_name).upsert(entry.payload)
        if (error) throw error
      } else if (entry.operation === 'UPDATE') {
        const { error } = await supabase.from(entry.table_name).update(entry.payload).eq('id', entry.record_id)
        if (error) throw error
      } else if (entry.operation === 'DELETE') {
        const { error } = await supabase.from(entry.table_name).delete().eq('id', entry.record_id)
        if (error) throw error
      }
      await db.sync_queue.delete(entry.id)
    } catch (error) {
      console.error('[syncQueue] failed:', entry.table_name, entry.operation, error)
      const newCount = (entry.retry_count ?? 0) + 1
      await db.sync_queue.update(entry.id, {
        retry_count: newCount,
        status: newCount >= 3 ? 'failed' : 'pending',
      })
    }
  }
}

export async function addToSyncQueue(table_name, operation, record_id, payload) {
  await db.sync_queue.add({
    table_name,
    operation,
    record_id,
    payload,
    status: 'pending',
    created_at: new Date().toISOString(),
    retry_count: 0,
  })
}

export function startBackgroundSync(supabase) {
  const interval = setInterval(() => {
    if (navigator.onLine) processSyncQueue(supabase)
  }, 30_000)

  async function handleOnline() {
    await processSyncQueue(supabase)
    await fullSync(supabase)
  }

  window.addEventListener('online', handleOnline)

  return () => {
    clearInterval(interval)
    window.removeEventListener('online', handleOnline)
  }
}
