/**
 * Scroll-restoration decision logic for the client list.
 *
 * Extracted into its own module for one reason: it is the part that can be
 * tested without a browser. The effect that drives it can't be, so everything
 * that makes a DECISION lives here and the effect stays a thin shell around it.
 * (It also can't be exported from ClientList.jsx — a non-component export from
 * a page file trips react-refresh/only-export-components.)
 */

// Browsers report fractional scroll offsets on zoomed/hi-DPI displays, and a
// restored position can land a hair off. Two pixels is under one line of text.
export const SCROLL_TOLERANCE = 2

// ⚠️ WALL CLOCK, not a frame count. This replaced a 10-frame budget on
// 2026-09-03: ~166ms at 60fps is easily gone before IndexedDB has returned a
// single row on iOS, and the restore would then measure a one-viewport
// document, clamp to 0 and give up. That alone could produce an intermittent
// failure with no Safari involvement at all. Frames are not a unit of data
// arriving.
export const REACH_DEADLINE_MS = 1500

// After landing, keep watching for this long and take the position back if
// something moves it. Mobile Safari applies its own scroll handling across SPA
// route changes and can act AFTER our restore — whoever lands last wins, which
// is what made the failure intermittent. Abandoned instantly on real user input.
export const SETTLE_MS = 1000

/**
 * The maximum scrollY a document can actually reach. A restore target beyond
 * this is silently CLAMPED by the browser — which is what "it jumped to the
 * top" looks like when the rows haven't rendered yet and the document is one
 * viewport tall.
 */
export function maxScrollableY(scrollHeight, innerHeight) {
  return Math.max(0, scrollHeight - innerHeight)
}

export function isTargetReachable(target, maxScrollable) {
  return maxScrollable >= target
}

/**
 * One frame of "drive the window to `target`, then HOLD it there".
 *
 *   apply — scroll to the target now, and keep going.
 *   watch — already there; don't touch it, but keep watching.
 *   stop  — we are done, or the user took over. Detach everything.
 *
 * Two phases in one machine:
 *
 *   REACH  — from the start until the position first lands, bounded by
 *            `reachDeadlineMs`. This is where a document that is still growing
 *            gets waited out.
 *   SETTLE — from the first landing for `settleMs`. The position is watched and
 *            RE-APPLIED if anything moves it. This is what beats mobile Safari's
 *            own scroll handling, which can fire after our restore has already
 *            run and would otherwise silently win.
 *
 * ⚠️ `userInterrupted` outranks everything. A real touch, wheel or key means the
 * user is scrolling, and this must never fight them for the viewport.
 *
 * `reason` is returned so the outcomes stay distinguishable — a document that
 * never grew is a completely different problem from a scroll that was overridden.
 */
export function scrollHoldStep({
  target, currentY, maxScrollable,
  elapsedMs, msSinceLanded, userInterrupted,
  reachDeadlineMs = REACH_DEADLINE_MS,
  settleMs = SETTLE_MS,
}) {
  if (userInterrupted) return { action: 'stop', reason: 'user-scrolled' }

  const landed = Math.abs(currentY - target) <= SCROLL_TOLERANCE
  const reachable = isTargetReachable(target, maxScrollable)

  if (landed) {
    // 'landed' is returned exactly once — on the frame the position first
    // arrives — so the caller can start the settle clock off it.
    if (msSinceLanded == null) return { action: 'watch', reason: 'landed' }
    if (msSinceLanded >= settleMs) return { action: 'stop', reason: 'settled' }
    return { action: 'watch', reason: 'holding' }
  }

  // Not at the target, but we HAD been: something moved us after we got there.
  // Take it back, for as long as the settle window is open.
  if (msSinceLanded != null) {
    if (msSinceLanded >= settleMs) return { action: 'stop', reason: 'settled' }
    return { action: 'apply', reason: 'drifted' }
  }

  // Still in the reach phase.
  if (elapsedMs >= reachDeadlineMs) {
    // If the document is genuinely shorter than the target, the clamped
    // position IS the right answer — the list really did get shorter.
    return { action: 'stop', reason: reachable ? 'scroll-refused' : 'document-too-short' }
  }
  return {
    action: 'apply',
    // Not reachable yet is the common case on a remount: rows are still
    // arriving from Dexie, so the document hasn't grown to its full height.
    reason: reachable ? 'scroll-did-not-take' : 'document-still-growing',
  }
}

/**
 * Whether a candidate scroll position is worth persisting.
 *
 * ⚠️ This is the guard for the bug fixed on 2026-09-03. The old cleanup called
 * a plain `save()` on unmount, which read `window.scrollY` at a moment when the
 * route had already changed and the document had collapsed to a short page —
 * so it faithfully stored 0 and destroyed the good value that had been saved
 * moments earlier. Refresh was unaffected (no unmount, `pagehide` fires while
 * the document is still intact), which is exactly why refresh worked and Back
 * did not.
 *
 * A 0 from a genuine user scroll to the top is legitimate and IS stored. What
 * must never be stored is a 0 that is merely an artifact of teardown, so the
 * unmount path passes the last position observed while mounted rather than
 * re-reading a collapsed scrollY.
 */
export function shouldPersistScroll(candidateY) {
  return Number.isFinite(candidateY) && candidateY >= 0
}
