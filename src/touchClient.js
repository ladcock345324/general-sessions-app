import db from './localDB'
import { addToSyncQueue } from './syncManager'

/**
 * Stamp clients.last_modified_at = now for one client.
 *
 * This is the ONLY thing that writes that column. It drives the within-tier
 * ordering of the Closed section (most recently modified first), so the column
 * is only as good as the completeness of its call sites — the full list lives in
 * the 2026-09-02 PROGRESS.md entry, and adding a new client-data write path
 * means adding a call here too.
 *
 * Offline-first like every other write in the app: Dexie first, then one
 * sync-queue UPDATE. Not indexed in Dexie (the clients store is
 * 'id, last_name, indigent_status'), so it needed no version bump — it rides the
 * existing select('*') fullSync and the standard UPDATE payload.
 *
 * ⚠️ NEVER CALL THIS FROM THE SYNC LAYER. fullSync and processSyncQueue replay
 * SERVER state into Dexie; stamping there would mark every client as freshly
 * modified on every sync and destroy the ordering entirely. That is structurally
 * enforced rather than merely documented: syncManager.js does not import this
 * module, and must not start.
 *
 * ⚠️ Only actual DATA CHANGES count. Opening a client file, scrolling it,
 * expanding a section, navigating away, and the session-only hours check-off
 * toggle (which persists nothing at all) must all leave the timestamp alone.
 *
 * Deliberately not awaited-and-checked at most call sites: it is a metadata
 * stamp, and a failure to write it must never block or roll back the real edit
 * it accompanies. A missing id is a no-op rather than a throw.
 */
export async function touchClient(clientId) {
  if (!clientId) return
  const last_modified_at = new Date().toISOString()
  await db.clients.update(clientId, { last_modified_at })
  await addToSyncQueue('clients', 'UPDATE', clientId, { id: clientId, last_modified_at })
}
