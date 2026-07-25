import { writeFileSync } from 'fs'

/**
 * Structured event log for one recording — the "screenplay" the zoom compositor,
 * the guardrails, and the verifier read instead of looking at pixels.
 *
 * - `cursor`: a per-step trace of the scripted cursor position ({t, x, y}),
 *   appended by actions.mjs on every movement step. This is what lets
 *   guardrails.mjs check "is the cursor inside the visible crop?" at any time.
 * - `state.zone`: the currently focused zone (set by focus()/wide()), used by
 *   actions.mjs to warn at record time when a click targets something outside it.
 */
export function createTimeline() {
  let startedAt = Date.now()
  const events = []
  const cursor = []
  const state = {
    cursorPos: { x: 960, y: 540 }, // must match film-cursor.mjs initial position
    zone: null, // { x, y, w, h, crop: {x,y,w,h,zoom}, label } | null (= wide)
  }

  function elapsed() {
    return Math.round(((Date.now() - startedAt) / 1000) * 1000) / 1000
  }

  return {
    /** Current elapsed seconds — lets actions.mjs stamp precise depart/arrive instants. */
    now: elapsed,
    state,
    /**
     * Re-anchors t=0 — called by screencast.mjs when capture starts so event
     * timestamps and video frame timestamps share the exact same zero.
     */
    setEpoch(ms) {
      startedAt = ms
    },
    get epochMs() {
      return startedAt
    },
    /**
     * Logs a zoom/guardrail-relevant action. `box` = the element's boundingBox() (or null).
     * `extra` may carry `{ tDepart, tArrive }` — the exact window during which the
     * cursor was traveling — used both for camera/cursor sync and activity detection.
     */
    shot(type, label, box, extra) {
      events.push({
        t: elapsed(),
        type,
        label,
        box: box
          ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width ?? box.w), h: Math.round(box.height ?? box.h) }
          : null,
        ...extra,
      })
    },
    /** Logs a non-zoom event (scroll, nav, loading bracket, alert). */
    mark(type, label, extra) {
      events.push({ t: elapsed(), type, label, box: null, ...extra })
    },
    /** Called by actions.mjs on every cursor movement step. */
    trackCursor(x, y) {
      state.cursorPos = { x, y }
      cursor.push({ t: elapsed(), x: Math.round(x), y: Math.round(y) })
    },
    /**
     * Analytical cursor path for a eased move — logged up front so guardrails
     * still have dense samples even though the on-screen motion is rAF-driven.
     */
    trackCursorPath(fromX, fromY, toX, toY, durSec, sampleHz = 30) {
      const t0 = elapsed()
      const steps = Math.max(2, Math.ceil(durSec * sampleHz))
      for (let i = 0; i <= steps; i++) {
        const p = i / steps
        const eased = 1 - (1 - p) ** 3
        cursor.push({
          t: Math.round((t0 + durSec * p) * 1000) / 1000,
          x: Math.round(fromX + (toX - fromX) * eased),
          y: Math.round(fromY + (toY - fromY) * eased),
        })
      }
      state.cursorPos = { x: toX, y: toY }
    },
    events,
    cursor,
    dump(path) {
      writeFileSync(path, JSON.stringify({ events, cursor }, null, 2), 'utf8')
      return events
    },
  }
}
