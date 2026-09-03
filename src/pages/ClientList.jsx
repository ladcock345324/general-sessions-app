import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useClients } from '../hooks/useClients'
import { useSyncStatus } from '../SyncContext'
import { normalizeIndigent } from '../indigentStatus'
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
function useClientListScrollRestoration(ready) {
  const restoredRef = useRef(false)

  // Save side. Throttled to at most one write per 150ms (leading edge skipped,
  // trailing edge written) so a flick doesn't write on every scroll event. The
  // cleanup writes one final time: the throttle would otherwise drop the last
  // few pixels before the user taps into a client, which is exactly the position
  // being restored.
  useEffect(() => {
    // Stop the browser's own restoration from fighting ours. Left as 'manual'
    // rather than reset to 'auto' on unmount — resetting it would hand the
    // client-list history entry back to the browser, which is the thing we are
    // overriding. No other page in the app restores scroll, so nothing else
    // depends on the default.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

    let timer = null
    const save = () => sessionStorage.setItem(SCROLL_KEY, String(window.scrollY))
    const onScroll = () => {
      if (timer) return
      timer = setTimeout(() => { timer = null; save() }, 150)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    // pagehide, not beforeunload: it is the one that fires reliably when iOS
    // Safari freezes or discards a PWA tab.
    window.addEventListener('pagehide', save)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', save)
      save()
    }
  }, [])

  // Restore side. Gated on `ready` — useClients reads through useLiveQuery, so
  // the first render has zero rows and a document barely taller than the
  // viewport; scrolling then would clamp to ~0 and look like it did nothing.
  // Guarded by a ref so a later live update (a background sync landing) can
  // never yank the user back to a stale offset mid-browse. useLayoutEffect so
  // the jump lands before paint rather than as a visible flash.
  useLayoutEffect(() => {
    if (restoredRef.current || !ready) return
    restoredRef.current = true
    const saved = Number(sessionStorage.getItem(SCROLL_KEY))
    if (!saved) return
    window.scrollTo(0, saved)
    // One rAF re-apply, for the cold-reload case only: row heights can still
    // settle after this effect (web fonts resolving, the safe-area inset
    // applying), and a document that is briefly too short clamps the scroll
    // short of the target. Re-applying inside the same frame is invisible.
    requestAnimationFrame(() => window.scrollTo(0, saved))
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

function sortClosed(clients) {
  return [...clients].sort((a, b) => {
    const ta = closedTier(a)
    const tb = closedTier(b)
    if (ta !== tb) return ta - tb

    // Within a tier: most recently modified first, un-stamped clients at the
    // bottom of that tier and alphabetical among themselves.
    const ma = modifiedTimestamp(a)
    const mb = modifiedTimestamp(b)
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

  function toggleSort() {
    setSortMode(prev => {
      const next = prev === 'name' ? 'event' : 'name'
      localStorage.setItem(SORT_KEY, next)
      return next
    })
  }

  const active = sortActive(clients.filter(c => !c.relieved_closed), sortMode).map(toRowProps)
  const relieved = sortClosed(clients.filter(c => c.relieved_closed)).map(toRowProps)

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
                      onClick={() => navigate(`/client/${client.id}`)}
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
                    onClick={() => navigate(`/client/${client.id}`)}
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
