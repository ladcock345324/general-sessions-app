import { useLayoutEffect } from 'react'
import { scrollHoldStep, maxScrollableY, SCROLL_TOLERANCE } from './scrollRestore'

// ─── Single-hold invariant ───────────────────────────────────────────────────
//
// ⚠️ AT MOST ONE HOLD IS EVER LIVE, app-wide, and a newer hold PRE-EMPTS an
// older one immediately rather than the two interleaving.
//
// Without this, a hold that outlived its page could fight the next one: leave a
// client file inside the 1s settle window and `holdScrollAt(0)` would still be
// re-applying scroll 0 while the client list mounted underneath it and started
// restoring. Whoever landed last would win.
//
// React's own effect cleanup already covers the common ordering (a deleted
// subtree's cleanups run before the incoming route's layout effects), so this is
// belt and braces — but a hold loop that outlives its page is wrong on its own
// terms, and this makes "only one" structural rather than dependent on commit
// ordering staying the way it is today.
let activeFinish = null

/** True while a hold is driving the scroll position programmatically. */
export function isScrollHoldActive() {
  return activeFinish !== null
}

/**
 * Drive the window to `target` and hold it there until it settles or the user
 * takes over. Returns a cleanup function — always call it.
 *
 * The imperative half of the scroll work: `scrollRestore.js` decides, this
 * moves. Split that way so the decisions stay testable without a browser.
 *
 * Used for BOTH directions of travel, because they are the same problem with a
 * different target:
 *   • returning to the client list → target = the saved position
 *   • entering a detail page       → target = 0
 *
 * ⚠️ Why holding is necessary at all, rather than one scrollTo: mobile Safari
 * applies its own scroll handling across these SPA route changes and can act
 * AFTER our restore. Whoever lands last wins, which is why the failure was
 * intermittent for identical actions. `history.scrollRestoration = 'manual'`
 * does not prevent it.
 */
export function holdScrollAt(target) {
  // A newer hold wins outright. Done before anything else so the old loop is
  // torn down before this one touches the scroll position.
  if (activeFinish) activeFinish()

  const startMs = performance.now()
  let landedMs = null
  let raf = 0
  let interrupted = false
  let finished = false

  // Genuine user input outranks everything — this must never fight the user for
  // the viewport. Deliberately NOT the 'scroll' event: our own scrollTo fires
  // that, so it would abort us instantly.
  const interrupt = () => { interrupted = true }
  const passive = { passive: true }

  function finish() {
    if (finished) return
    finished = true
    if (activeFinish === finish) activeFinish = null
    cancelAnimationFrame(raf)
    window.removeEventListener('touchstart', interrupt, passive)
    window.removeEventListener('wheel', interrupt, passive)
    window.removeEventListener('keydown', interrupt)
  }

  const tick = () => {
    // `finished` is checked as well as cancelling the rAF: cancellation alone
    // relies on no frame already being in flight, and this loop must not be one
    // refactor away from re-applying scroll after its page is gone.
    if (finished) return
    const now = performance.now()
    const { action, reason } = scrollHoldStep({
      target,
      currentY: window.scrollY,
      maxScrollable: maxScrollableY(document.documentElement.scrollHeight, window.innerHeight),
      elapsedMs: now - startMs,
      msSinceLanded: landedMs == null ? null : now - landedMs,
      userInterrupted: interrupted,
    })

    if (action === 'stop') { finish(); return }
    if (action === 'apply') window.scrollTo(0, target)
    // Returned exactly once, on the frame the position first arrives.
    if (reason === 'landed') landedMs = now

    raf = requestAnimationFrame(tick)
  }

  activeFinish = finish
  window.addEventListener('touchstart', interrupt, passive)
  window.addEventListener('wheel', interrupt, passive)
  window.addEventListener('keydown', interrupt)

  // First attempt synchronously, so that when this is called from a layout
  // effect the position is already right before the browser paints.
  window.scrollTo(0, target)
  if (Math.abs(window.scrollY - target) <= SCROLL_TOLERANCE) landedMs = performance.now()
  raf = requestAnimationFrame(tick)

  return finish
}

/**
 * Reset a detail page to the top when it is entered, and hold it there.
 *
 * ⚠️ This exists because NOTHING was resetting the scroll on forward
 * navigation. Desktop browsers do it for you, which is why this was invisible
 * there; mobile Safari carries the previous page's scroll position into the new
 * route, and a client file is shorter than a scrolled client list, so the
 * carried position clamps to the end — landing the user at the BOTTOM of the
 * file they just opened.
 *
 * ⚠️ Deliberately NOT applied app-wide, and never to the client list. Forward
 * navigation into a detail page resets; returning to the list restores. A
 * blanket reset would destroy the restore.
 *
 * The returned cleanup is what stops this hold when the page unmounts — leaving
 * a client file inside the settle window must not leave a hold-at-zero running
 * over the list that replaces it.
 */
export function useScrollToTopOnMount() {
  useLayoutEffect(() => holdScrollAt(0), [])
}
