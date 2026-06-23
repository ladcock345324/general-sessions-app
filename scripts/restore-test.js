// One-time RESTORE TEST — restores the latest backup (from the `backups`
// branch) into a THROWAWAY test Supabase project to prove the backup is real
// and complete. This NEVER touches the production project: it only reads
// TEST_* credentials and hard-asserts the test project ref before any write.
//
// Run: node scripts/restore-test.js   (after pasting the key into .env.restore-test)

import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep, posix } from 'node:path'

const TEST_PROJECT_REF = 'vngnhoyxusdyopxplnjd' // throwaway test project
const ENV_FILE = '.env.restore-test'
const BUCKET = 'warrants'
const BACKUP_DIR = 'backup'
const DB_DIR = join(BACKUP_DIR, 'db')
const STORAGE_DIR = join(BACKUP_DIR, 'storage')

// FK-safe insert order: parents before children.
const TABLE_ORDER = ['clients', 'incidents', 'cases', 'hours', 'next_events', 'personal_notes', 'courtroom_documents']

function fail(message) {
  console.error(`[restore-test] FATAL: ${message}`)
  process.exit(1)
}

// ── Load + guard credentials ─────────────────────────────────────────────────
function loadEnv(file) {
  let txt
  try {
    txt = readFileSync(file, 'utf8')
  } catch {
    fail(`${file} not found. Create it and paste the test service_role key first.`)
  }
  const env = {}
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

const env = loadEnv(ENV_FILE)
const TEST_URL = env.TEST_SUPABASE_URL
const TEST_KEY = env.TEST_SUPABASE_SERVICE_ROLE_KEY

if (!TEST_URL || !TEST_KEY) fail(`${ENV_FILE} must set TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_ROLE_KEY.`)
if (TEST_KEY === 'PASTE_KEY_HERE') fail(`The service_role key is still the placeholder — paste the real key into ${ENV_FILE} first.`)
// SAFETY GUARD: refuse to run unless the URL is the throwaway test project.
if (!TEST_URL.includes(TEST_PROJECT_REF)) {
  fail(`TEST_SUPABASE_URL does not contain the test project ref "${TEST_PROJECT_REF}". Refusing to run to avoid writing to the wrong project.`)
}

const supabase = createClient(TEST_URL, TEST_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { /* disabled — restore does not subscribe to realtime */ },
})

// ── Materialize the backup from origin/backups (without switching branches) ──
function materializeBackup() {
  try {
    execFileSync('git', ['fetch', 'origin', 'backups'], { stdio: 'inherit' })
    execFileSync('git', ['checkout', 'origin/backups', '--', BACKUP_DIR], { stdio: 'inherit' })
  } catch (e) {
    fail(`could not materialize ${BACKUP_DIR}/ from origin/backups: ${e?.message || e}`)
  }
}

// Unstage the checked-out backup so nothing is left staged (files stay on disk,
// gitignored). Best-effort — never fails the test.
function cleanupIndex() {
  try {
    execFileSync('git', ['reset', '-q', '--', BACKUP_DIR], { stdio: 'ignore' })
  } catch { /* ignore */ }
}

// ── Restore database ─────────────────────────────────────────────────────────
async function restoreTable(table) {
  const file = join(DB_DIR, `${table}.json`)
  let rows
  try {
    rows = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    fail(`could not read ${file}: ${e?.message || e}`)
  }
  if (!Array.isArray(rows)) fail(`${file} is not a JSON array`)
  if (rows.length === 0) {
    console.log(`[db] ${table}: 0 rows (empty — skipped)`)
    return 0
  }
  // Insert with explicit ids (present in each row) so FKs line up. Batched.
  const batchSize = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error } = await supabase.from(table).insert(batch)
    if (error) fail(`insert into "${table}" failed: ${error.message}`)
    inserted += batch.length
  }
  console.log(`[db] ${table}: ${inserted} rows inserted`)
  return inserted
}

// ── Restore storage ──────────────────────────────────────────────────────────
function walkFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }
  return out
}

// Object key = path relative to backup/storage, with forward slashes.
function objectKey(fullPath) {
  return relative(STORAGE_DIR, fullPath).split(sep).join(posix.sep)
}

async function ensureBucket() {
  const { data: existing, error: listErr } = await supabase.storage.listBuckets()
  if (listErr) fail(`could not list buckets: ${listErr.message}`)
  if (existing.some(b => b.name === BUCKET)) {
    console.log(`[storage] bucket "${BUCKET}" already exists`)
    return
  }
  const { error } = await supabase.storage.createBucket(BUCKET, { public: false })
  if (error) fail(`could not create bucket "${BUCKET}": ${error.message}`)
  console.log(`[storage] bucket "${BUCKET}" created (private)`)
}

async function restoreStorage() {
  const files = walkFiles(STORAGE_DIR)
  let uploaded = 0
  for (const full of files) {
    const key = objectKey(full)
    const bytes = readFileSync(full)
    const contentType = key.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'
    const { error } = await supabase.storage.from(BUCKET).upload(key, bytes, { upsert: true, contentType })
    if (error) fail(`upload "${key}" failed: ${error.message}`)
    uploaded++
  }
  console.log(`[storage] ${uploaded} files uploaded`)
  return { uploaded, files }
}

// ── Round-trip verify ────────────────────────────────────────────────────────
async function roundTripVerify(files) {
  // Prefer a warrants/*.pdf; fall back to the first .pdf available.
  const pick = files.find(f => objectKey(f).startsWith('warrants/') && f.toLowerCase().endsWith('.pdf'))
    || files.find(f => f.toLowerCase().endsWith('.pdf'))
  if (!pick) {
    console.log('[verify] no PDF available to round-trip — skipped')
    return null
  }
  const key = objectKey(pick)
  const originalBytes = readFileSync(pick)
  const { data, error } = await supabase.storage.from(BUCKET).download(key)
  if (error) fail(`round-trip download of "${key}" failed: ${error.message}`)
  const downloaded = Buffer.from(await data.arrayBuffer())
  const hasPdfHeader = downloaded.subarray(0, 4).toString('latin1') === '%PDF'
  const sizeMatches = downloaded.length === originalBytes.length
  return { key, originalSize: originalBytes.length, downloadedSize: downloaded.length, hasPdfHeader, sizeMatches }
}

async function main() {
  console.log(`[restore-test] target: ${TEST_URL}`)
  materializeBackup()

  const dbCounts = {}
  for (const table of TABLE_ORDER) {
    dbCounts[table] = await restoreTable(table)
  }

  await ensureBucket()
  const { uploaded, files } = await restoreStorage()
  const verify = await roundTripVerify(files)

  cleanupIndex()

  console.log('\n=========== RESTORE TEST SUMMARY ===========')
  console.log('Database rows inserted:')
  for (const table of TABLE_ORDER) console.log(`  ${table.padEnd(20)} ${dbCounts[table]}`)
  console.log(`Storage files uploaded:  ${uploaded}`)
  if (verify) {
    console.log('Round-trip check:')
    console.log(`  file:            ${verify.key}`)
    console.log(`  original size:   ${verify.originalSize} bytes`)
    console.log(`  downloaded size: ${verify.downloadedSize} bytes`)
    console.log(`  %PDF header:     ${verify.hasPdfHeader ? 'present ✓' : 'MISSING ✗'}`)
    console.log(`  size matches:    ${verify.sizeMatches ? 'yes ✓' : 'NO ✗'}`)
    console.log(`  RESULT:          ${verify.hasPdfHeader && verify.sizeMatches ? 'PASS ✓' : 'FAIL ✗'}`)
  } else {
    console.log('Round-trip check:        skipped (no PDF)')
  }
  console.log('============================================')

  if (verify && !(verify.hasPdfHeader && verify.sizeMatches)) {
    fail('round-trip verification did not pass')
  }
}

main().catch(err => fail(err?.message || String(err)))
