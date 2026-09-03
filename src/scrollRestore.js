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

// ~10 frames ≈ 160ms at 60fps. Long enough for rows to arrive and web fonts to
// settle after a remount, short enough to be invisible if it gives up.
export const MAX_RESTORE_FRAMES = 10

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
 * Decide what to do after one scrollTo attempt.
 *
 *   done     — landed within tolerance; stop.
 *   retry    — not there yet; try again on the next frame.
 *   give-up  — out of frames; keep whatever position we have.
 *
 * `reason` exists so the two failure modes stay distinguishable, both in tests
 * and if this ever needs debugging: a document that is still growing is a very
 * different problem from a scroll that is being refused.
 */
export function scrollRestoreStep({ target, currentY, maxScrollable, attempt, maxAttempts = MAX_RESTORE_FRAMES }) {
  if (Math.abs(currentY - target) <= SCROLL_TOLERANCE) {
    return { action: 'done', reason: 'landed' }
  }
  const reachable = isTargetReachable(target, maxScrollable)
  if (attempt >= maxAttempts) {
    // Out of frames. If the document is genuinely shorter than the target the
    // clamped position IS the right answer — the list really did get shorter
    // (rows deleted, a client reopened out of the section). Nothing is wrong.
    return { action: 'give-up', reason: reachable ? 'scroll-refused' : 'document-too-short' }
  }
  return {
    action: 'retry',
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
