import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useClients } from '../hooks/useClients'
import { useSyncStatus } from '../SyncContext'
import { normalizeIndigent } from '../indigentStatus'
import { shouldPersistScroll } from '../scrollRestore'
import { holdScrollAt } from '../scrollHold'
import ClientRow from '../components/ClientRow'
import OfflineStatus from '../components/OfflineStatus'
import DailyHoursDrawer from '../components/DailyHoursDrawer'
import styles from './ClientList.module.css'

const SORT_KEY = 'clientListSortMode'
const SCROLL_KEY = 'gsapp:clientListScroll'

// ─── Client-list scroll restoration ──────────────────────────────────────────
//
// Restores the list's scroll position on BOTH return paths: tapping a client and
// coming back, and a full page reload. sessionStorage rather than a ref or React
// state is what covers the reload — the component tree doesn't survive it.
//
// ⚠️ THE SCROLLING ELEMENT IS THE DOCUMENT, not a container. Nothing in the
// html → body → #root → .screen chain sets an overflow or a fixed height
// (.screen is min-height: 100vh with no overflow), so the page scrolls as a
// whole and window.scrollY is the value that means anything. The only
// overflow-y: auto elements in the app are the two drawers' internal bodies.
// Scrolling a container ref here would silently do nothing.
//
// Deliberately NOT a history-based solution: ClientFile's Back is
// navigate('/'), not navigate(-1), so it creates a new history entry rather
// than popping one — anything keyed on history state would miss the main path.
// <ScrollRestoration> is also unavailable: main.jsx uses BrowserRouter, not a
// data router.
//
// Scoped to the client list. No other page restores scroll.

// The single place a scroll position is written. Everything — the navigation
// handler, the throttle, the unmount flush, pagehide — goes through here, so
// there is exactly one line to audit when asking "what could have stored this?"
function persistScroll(y) {
  if (shouldPersistScroll(y)) sessionStorage.setItem(SCROLL_KEY, String(y))
}

function useClientListScrollRestoration(ready) {
  const restoredRef = useRef(false)

  // ── Save side ──────────────────────────────────────────────────────────────
  //
  // Throttled to at most one write per 150ms (leading edge skipped, trailing
  // edge written) so a flick doesn't write on every scroll event.
  //
  // ⚠️ `lastYRef` holds the last position observed WHILE MOUNTED, updated
  // synchronously on every scroll event. Both the throttle and the unmount flush
  // persist THAT, never a fresh `window.scrollY` read. This is the 2026-09-03
  // fix: the previous cleanup called save() which re-read window.scrollY during
  // teardown, by which point the route had changed and the document had
  // collapsed — so it stored 0 over the good value.
  const lastYRef = useRef(0)

  useEffect(() => {
    // history.scrollRestoration = 'manual' is set once at boot in main.jsx —
    // it belongs there rather than here, so it also covers a cold load straight
    // into a client file.
    lastYRef.current = window.scrollY

    let timer = null
    const onScroll = () => {
      // Recorded every event, unthrottled and storage-free: this is the value
      // the flush below trusts.
      lastYRef.current = window.scrollY
      if (timer) return
      timer = setTimeout(() => { timer = null; persistScroll(lastYRef.current) }, 150)
    }
    // pagehide fires while the document is still intact and still scrolled, so
    // reading live scrollY is correct HERE and only here. It is also the event
    // that fires reliably when iOS freezes or discards a PWA tab.
    const onPageHide = () => persistScroll(window.scrollY)

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', onPageHide)
      // Flush ONLY if a throttled write was still pending — otherwise the
      // latest position is already stored and there is nothing to do. Writing
      // unconditionally here is what caused the bug.
      if (timer) {
        clearTimeout(timer)
        persistScroll(lastYRef.current)
      }
    }
  }, [])

  // ── Restore side ───────────────────────────────────────────────────────────
  //
  // Gated on `ready` — useClients reads through useLiveQuery, so the first
  // render has zero rows and a document barely taller than the viewport;
  // scrolling then would clamp to ~0 and look like it did nothing. Guarded by a
  // ref so a later live update (a background sync landing) can never yank the
  // user back to a stale offset mid-browse. useLayoutEffect so the jump lands
  // before paint rather than as a visible flash.
  //
  // ⚠️ restoredRef is per-mount by construction, and ClientList genuinely
  // remounts on the navigate-away-and-back path (flat <Routes>, no layout route
  // or <Outlet>, so `/` → `/client/:id` swaps component types at the same tree
  // position). It therefore resets on Back, which is what makes the restore run
  // at all on that path.
  useLayoutEffect(() => {
    if (restoredRef.current || !ready) return
    restoredRef.current = true
    const target = Number(sessionStorage.getItem(SCROLL_KEY))
    if (!target) return

    // Drive and HOLD, rather than firing once. Two things this survives that a
    // single scrollTo did not: a document still growing as rows arrive from
    // Dexie (waited out against a wall-clock deadline, because on iOS an
    // IndexedDB read can outlast any sane frame budget), and mobile Safari
    // moving the scroll AFTER us during the route change (taken back for the
    // length of the settle window). Abandons instantly on real user input.
    return holdScrollAt(target)
  }, [ready])
}

const byLastName = (a, b) => a.last_name.localeCompare(b.last_name)

// Parse next_events.event_date ("M/D/YYYY") + event_time ("9:05 AM") into a
// comparable timestamp. A missing/unparseable time sorts as start of that day,
// so dateless events come before timed events on the same date. Returns null if
// there's no usable date.
function eventTimestamp(ev) {
  if (!ev || !ev.event_date) return null
  const dm = ev.event_date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!dm) return null
  const month = Number(dm[1]) - 1
  const day = Number(dm[2])
  const year = Number(dm[3])
  let hours = 0
  let minutes = 0
  const tm = (ev.event_time || '').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (tm) {
    hours = Number(tm[1]) % 12
    if (/PM/i.test(tm[3])) hours += 12
    minutes = Number(tm[2])
  }
  return new Date(year, month, day, hours, minutes).getTime()
}

function nextEventTimestamp(client) {
  return eventTimestamp(client.next_events && client.next_events[0])
}

// Active section: "name" → alphabetical; "event" → soonest next event first,
// clients with no next event grouped at the bottom, alphabetical among themselves.
function sortActive(clients, mode) {
  const arr = [...clients]
  if (mode !== 'event') return arr.sort(byLastName)
  return arr.sort((a, b) => {
    const ta = nextEventTimestamp(a)
    const tb = nextEventTimestamp(b)
    if (ta == null && tb == null) return byLastName(a, b)
    if (ta == null) return 1
    if (tb == null) return -1
    return ta - tb
  })
}

// Closed section: three colour tiers, then most-recently-modified first inside
// each tier. Replaced the old flat closed_at DESC ordering 2026-09-02.
//
//   Tier 1  red, orange, green   (top)
//   Tier 2  purple               — closed, no work left, awaiting final review
//   Tier 3  gold                 (bottom)
//
// A gold client can never appear above any other tier; a purple one can never
// appear above tier 1 but always sits above gold.
//
// ⚠️ The tier is keyed on normalizeIndigent(), the SAME function the circle uses
// to pick its colour — never on the raw stored string. That is what guarantees a
// client's tier can't disagree with the dot rendered next to their name: legacy
// 'yellow' resolves to orange (tier 1), and null/''/unrecognized resolves to red
// (tier 1) because that is what those render as. See src/indigentStatus.js.
//
// The "Sorting by:" toggle still does not reach this section — sortClosed takes
// no mode argument, exactly as before.
const INDIGENT_TIER = { red: 1, orange: 1, green: 1, purple: 2, gold: 3 }

function closedTier(client) {
  return INDIGENT_TIER[normalizeIndigent(client.indigent_status)]
}

// Full name order: last name, then first name for identical last names.
const byName = (a, b) =>
  a.last_name.localeCompare(b.last_name) ||
  (a.first_name ?? '').localeCompare(b.first_name ?? '')

// null when unset OR unparseable — an unparseable timestamp must land in the
// nulls rather than produce NaN comparisons, which would make the comparator
// inconsistent and the resulting order arbitrary.
function modifiedTimestamp(client) {
  if (!client.last_modified_at) return null
  const t = new Date(client.last_modified_at).getTime()
  return Number.isNaN(t) ? null : t
}

// The two values this section sorts on, for one client.
function sortKeyFor(client) {
  return { tier: closedTier(client), modified: modifiedTimestamp(client) }
}

// Snapshot every closed client's sort inputs, keyed by id. Taken once per mount
// — see useFrozenClosedOrder.
function snapshotClosedOrder(clients) {
  return new Map(clients.map(c => [c.id, sortKeyFor(c)]))
}

/**
 * Freeze the Closed section's ORDER for as long as this view is mounted
 * (2026-09-03).
 *
 * Tapping a client's indigent circle stamps last_modified_at and can change the
 * colour tier, and this list re-sorts live — so the row the user just tapped
 * leapt out from under their finger. The dot must respond instantly; the row
 * must not move.
 *
 * ⚠️ Mount-scoped, deliberately, and that granularity is load-bearing: the row
 * takes its correct new position the next time the list is LOADED, which covers
 * both a page refresh and returning from a client file. ClientList genuinely
 * remounts on that second path — `<Routes>` is flat, with no layout route or
 * <Outlet>, so `/` → `/client/:id` swaps component types at the same tree
 * position and React unmounts this subtree. (The scroll bug fixed the same day
 * is the behavioural proof: its symptom came from this component's effect
 * CLEANUP running on that navigation.)
 *
 * Only the ORDER is frozen. Every row still renders from live data, so the dot
 * recolours on tap exactly as before.
 */
function useFrozenClosedOrder(closedClients, resolved) {
  const [frozen, setFrozen] = useState(null)
  // React's "adjust state while rendering" pattern — the same one CaseView's
  // PvField uses to re-seed its draft, and for the same lint reason. The three
  // alternatives were each worse:
  //   • a useRef written during render trips `react-hooks/refs` (2 errors);
  //   • a useEffect trips `react-hooks/set-state-in-effect`, AND would set the
  //     value without scheduling a render, so the first sort would use live
  //     values with nothing to correct it;
  //   • a useMemo keyed only on `resolved` raises an exhaustive-deps warning.
  // Setting state during render re-renders immediately, before commit, so the
  // very first painted order is already the frozen one.
  //
  // Gated on `resolved` — useLiveQuery returns undefined on first render, and
  // snapshotting an empty list then would freeze an empty Map that never fills.
  // The `frozen === null` guard is what stops this looping.
  if (resolved && frozen === null) {
    setFrozen(snapshotClosedOrder(closedClients))
  }
  return frozen
}

// Closed section, sorted against a frozen snapshot when one exists.
//
// A client in the snapshot keeps the position it had when this view mounted. A
// client NOT in it — newly closed, or newly arrived from a sync — falls back to
// its live values and sorts into place normally, rather than being dropped or
// pinned to an end. A client that leaves the section simply falls out; the
// stale snapshot entry is never consulted again and needs no cleanup.
function sortClosed(clients, frozen) {
  const keyFor = c => frozen?.get(c.id) ?? sortKeyFor(c)
  return [...clients].sort((a, b) => {
    const ka = keyFor(a)
    const kb = keyFor(b)
    if (ka.tier !== kb.tier) return ka.tier - kb.tier

    // Within a tier: most recently modified first, un-stamped clients at the
    // bottom of that tier and alphabetical among themselves.
    const ma = ka.modified
    const mb = kb.modified
    if (ma == null && mb == null) return byName(a, b)
    if (ma == null) return 1
    if (mb == null) return -1
    if (ma !== mb) return mb - ma
    return byName(a, b)
  })
}

// Strip leading non-digits and parse as integer for numeric sort
function caseNumericKey(caseNumber) {
  return parseInt((caseNumber ?? '').replace(/^\D+/, ''), 10) || 0
}

// Map Supabase row → shape ClientRow expects
function toRowProps(client) {
  const allCases = (client.incidents ?? []).flatMap(inc => inc.cases ?? [])
  const caseNumbers = [...allCases].sort((a, b) => caseNumericKey(a.case_number) - caseNumericKey(b.case_number))

  return {
    id: client.id,
    lastName: client.last_name,
    firstName: client.first_name,
    gender: client.gender,
    oca: client.oca,
    status: client.relieved_closed ? 'closed' : 'active',
    custodyStatus: client.custody_status,
    // booking_date / booking_time are no longer threaded to ClientRow: the
    // prelim-hearing countdown that used them was removed 2026-08-10. The
    // columns and their New/Edit Client form fields are retained.
    nextHearing: (client.next_events && client.next_events.length > 0)
      ? {
          date:      client.next_events[0].event_date,
          time:      client.next_events[0].event_time,
          courtroom: client.next_events[0].courtroom,
          reason:    client.next_events[0].reason,
        }
      : null,
    relievedClosed: client.relieved_closed ?? false,
    caseNumbers,
    indigentStatus: client.indigent_status ?? 'red',
  }
}

function SyncStatusBar() {
  const { isOnline, isSyncing, lastSyncedAt } = useSyncStatus()

  let dot, text
  if (isSyncing) {
    dot  = styles.syncDotPulse
    text = 'Syncing…'
  } else if (!isOnline) {
    dot  = styles.syncDotYellow
    text = 'Offline — changes will sync when reconnected'
  } else {
    dot  = styles.syncDotGreen
    const time = lastSyncedAt
      ? new Date(lastSyncedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : null
    text = time ? `Synced ${time}` : 'Synced'
  }

  return (
    <div className={styles.syncBar}>
      <span className={`${styles.syncDot} ${dot}`} />
      <span>{text}</span>
    </div>
  )
}

export default function ClientList() {
  const navigate = useNavigate()
  const { clients, loading, error } = useClients()

  const [sortMode, setSortMode] = useState(() =>
    localStorage.getItem(SORT_KEY) === 'event' ? 'event' : 'name'
  )
  const [showHours, setShowHours] = useState(false)

  // Restore only once the rows actually exist — see the hook's own note.
  useClientListScrollRestoration(clients.length > 0)

  // ⚠️ Capture the scroll position SYNCHRONOUSLY, at the moment of leaving,
  // before navigate() runs. This value is correct by construction: the list is
  // still mounted, the document is still full height, and nothing throttled can
  // race it. Everything else (the 150ms throttle, the unmount flush) is a
  // backstop for positions the user never navigated away from.
  function openClient(clientId) {
    persistScroll(window.scrollY)
    navigate(`/client/${clientId}`)
  }

  function toggleSort() {
    setSortMode(prev => {
      const next = prev === 'name' ? 'event' : 'name'
      localStorage.setItem(SORT_KEY, next)
      return next
    })
  }

  const closedClients = clients.filter(c => c.relieved_closed)
  // Frozen for the life of this mount. `!loading` is the "the query has actually
  // resolved" signal — useClients reports loading while useLiveQuery is still
  // undefined, so this can't snapshot an empty list that never fills.
  const frozenClosedOrder = useFrozenClosedOrder(closedClients, !loading)

  const active = sortActive(clients.filter(c => !c.relieved_closed), sortMode).map(toRowProps)
  const relieved = sortClosed(closedClients, frozenClosedOrder).map(toRowProps)

  return (
    <div className={styles.screen}>
      <div className={styles.topBar}>
        <button className={styles.signOutBtn} onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
      <SyncStatusBar />
      <OfflineStatus />
      <header className={styles.header}>
        <h1 className={styles.title}>Clients</h1>
        <button className={styles.addClientBtn} onClick={() => navigate('/client/new')}>+</button>
      </header>

      {loading && (
        <div className={styles.stateMsg}>Loading…</div>
      )}

      {error && (
        <div className={styles.stateMsg}>Error: {error}</div>
      )}

      {!loading && !error && (
        <>
          <div className={styles.sortToggleRow}>
            <button className={styles.sortToggle} onClick={toggleSort}>
              Sorting by: {sortMode === 'event' ? 'Next Event' : 'Name'}
            </button>
            <button className={styles.sortToggle} onClick={() => setShowHours(true)}>
              Hours
            </button>
          </div>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>Active</span>
              <span className={styles.sectionCount}>{active.length}</span>
            </div>
            <div className={styles.list}>
              {active.length === 0
                ? <div className={styles.emptyMsg}>No clients yet</div>
                : active.map(client => (
                    <ClientRow
                      key={client.id}
                      client={client}
                      onClick={() => openClient(client.id)}
                    />
                  ))
              }
            </div>
          </section>

          {relieved.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Closed</span>
                <span className={styles.sectionCount}>{relieved.length}</span>
              </div>
              <div className={styles.list}>
                {relieved.map(client => (
                  <ClientRow
                    key={client.id}
                    client={client}
                    relieved
                    onClick={() => openClient(client.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <DailyHoursDrawer isOpen={showHours} onClose={() => setShowHours(false)} />
    </div>
  )
}
