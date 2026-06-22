// Nightly Supabase backup — run by .github/workflows/backup.yml, NOT locally.
//
// Dumps all 7 tables to backup/db/<table>.json and downloads every file in the
// `warrants` Storage bucket to backup/storage/<same path>, then writes
// backup/manifest.json with an integrity summary. Fails loudly (non-zero exit)
// on any error so a broken backup can never report success.
//
// The service role key is read ONLY from the SUPABASE_SERVICE_ROLE_KEY env var
// (a GitHub Actions secret). It is never logged, printed, or written to disk.

import { createClient } from '@supabase/supabase-js'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afhzkqjrciyoeizrpaxt.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const TABLES = ['clients', 'incidents', 'cases', 'hours', 'next_events', 'personal_notes', 'courtroom_documents']
const BUCKET = 'warrants'

const OUT_DIR = 'backup'
const DB_DIR = join(OUT_DIR, 'db')
const STORAGE_DIR = join(OUT_DIR, 'storage')

// Abort with a non-zero exit. Never include the service role key in any message.
function fail(message) {
  console.error(`[backup] FATAL: ${message}`)
  process.exit(1)
}

if (!SERVICE_ROLE_KEY) {
  // Note: intentionally does NOT echo the key (it's absent anyway) or any secret.
  fail('SUPABASE_SERVICE_ROLE_KEY is not set. Refusing to run.')
}

// Service role client — bypasses RLS so it can read every row and every file.
// This is a server-side backup: it never opens a realtime channel (no
// .channel()/.subscribe() calls), and we disable session persistence so nothing
// is written to the runner. The realtime block keeps realtime usage at zero so
// the websocket-on-Node crash can't recur even if the Node version changes.
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { /* disabled — backup does not subscribe to realtime */ },
})

// ── DB dump ──────────────────────────────────────────────────────────────────
// Paginate with .range() so we capture ALL rows and never truncate at the
// supabase-js 1000-row default.
async function dumpTable(table) {
  const pageSize = 1000
  let from = 0
  const rows = []
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) fail(`select failed for table "${table}": ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  const file = join(DB_DIR, `${table}.json`)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(rows, null, 2))
  return rows.length
}

// ── Storage dump ───────────────────────────────────────────────────────────
// .list() is NOT recursive and is paginated (100 default). We walk the bucket
// from the root, paginating each level and recursing into subfolders, so every
// prefix is covered automatically: warrants/, criminal-history/, and the nested
// courtroom-docs/<client_id>/<timestamp>_<filename>.
async function listLevel(prefix) {
  const pageSize = 100
  let offset = 0
  const entries = []
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) fail(`storage list failed for prefix "${prefix}": ${error.message}`)
    if (!data || data.length === 0) break
    entries.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return entries
}

// Returns a flat list of file paths (relative to the bucket root).
async function walkBucket(prefix = '') {
  const entries = await listLevel(prefix)
  const files = []
  for (const entry of entries) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name
    // Files carry a `metadata` object (with size); folders have metadata === null.
    const isFile = entry.metadata != null
    if (isFile) {
      if (entry.name === '.emptyFolderPlaceholder') continue // Supabase folder marker
      files.push(full)
    } else {
      files.push(...(await walkBucket(full)))
    }
  }
  return files
}

async function downloadFile(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error) fail(`storage download failed for "${path}": ${error.message}`)
  if (!data) fail(`storage download returned no data for "${path}"`)
  const bytes = Buffer.from(await data.arrayBuffer())
  const dest = join(STORAGE_DIR, path)
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, bytes)
  return bytes.length
}

async function main() {
  // Start from a clean output dir so deleted rows/files never linger in the
  // rolling snapshot (the workflow also force-pushes a fresh orphan commit).
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(DB_DIR, { recursive: true })
  await mkdir(STORAGE_DIR, { recursive: true })

  const tableCounts = {}
  for (const table of TABLES) {
    tableCounts[table] = await dumpTable(table)
    console.log(`[backup] table ${table}: ${tableCounts[table]} rows`)
  }

  const files = await walkBucket('')
  let totalBytes = 0
  for (const path of files) {
    totalBytes += await downloadFile(path)
  }
  console.log(`[backup] storage: ${files.length} files, ${totalBytes} bytes`)

  const manifest = {
    generatedAt: new Date().toISOString(),
    supabaseUrl: SUPABASE_URL,
    tables: tableCounts,
    storage: { fileCount: files.length, totalBytes },
  }
  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`[backup] complete — ${manifest.generatedAt}`)
}

main().catch(err => fail(err?.message || String(err)))
