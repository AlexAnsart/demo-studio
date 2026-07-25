/**
 * Zone-based zoom planning. The beat script (run.mjs) declares WHICH REGION of
 * the page must be visible — `focus(zone)` / `wide()` from actions.mjs — and this
 * module turns those declarations into a contiguous list of camera shots.
 *
 * Contract (this is the whole point of the zone model):
 * - A `focus` shot's crop ALWAYS fully contains the declared zone box + padding.
 *   The zoom factor is derived from the box size, so containment is guaranteed
 *   by construction — never by luck.
 * - Clicks/typing do NOT create zoom shots. They only feed guardrails,
 *   speed-ups and cursor tracking. The camera moves only when the script says so.
 *
 * See reference.md for the math.
 */

export const ZOOM_PLAN_DEFAULTS = {
  padding: 0.22, // fraction of zone size added as breathing room on each side
  minZoom: 1.0,
  maxZoom: 1.7, // content softens beyond this at 1920x1080 source — see reference.md
  idleZoom: 1.0,
  leadSec: 0.15, // fallback anchor shift for events without tDepart
  minShotSec: 0.8, // focus/wide events closer than this merge (later wins)
  minTransSec: 0.4, // clamps for the tArrive-tDepart-derived transition duration
  maxTransSec: 1.2,
  // Last-resort safety: a shot's crop half-width must be >= travelMargin * distance
  // to the next shot's center, so the cursor never exits frame during a big pan.
  travelMargin: 0.3,
}

/**
 * Deterministic crop for one zone box — the single source of truth used by BOTH
 * the plan builder and actions.mjs's record-time containment warnings.
 * @param {{x,y,w,h}} box zone in source pixels
 * @returns {{zoom,cx,cy,x,y,w,h}} crop rect fully containing box+padding
 */
export function cropForZone(box, sourceW, sourceH, options = {}) {
  const opts = { ...ZOOM_PLAN_DEFAULTS, ...options }
  let zoom = opts.idleZoom
  if (box && box.w > 0 && box.h > 0) {
    const w = box.w * (1 + 2 * opts.padding)
    const h = box.h * (1 + 2 * opts.padding)
    zoom = Math.min(sourceW / w, sourceH / h)
    zoom = Math.min(Math.max(zoom, opts.minZoom), opts.maxZoom)
  }
  const halfW = sourceW / zoom / 2
  const halfH = sourceH / zoom / 2
  let cx = box ? box.x + box.w / 2 : sourceW / 2
  let cy = box ? box.y + box.h / 2 : sourceH / 2
  cx = Math.min(Math.max(cx, halfW), sourceW - halfW)
  cy = Math.min(Math.max(cy, halfH), sourceH - halfH)
  return { zoom, cx, cy, x: cx - halfW, y: cy - halfH, w: 2 * halfW, h: 2 * halfH }
}

/**
 * @param {Array<{t,type,label,box,tDepart?,tArrive?}>} events timeline events
 * @param {number} durationSec total raw video duration
 * @returns {Array<{tStart,tEnd,cx,cy,zoom,label,transSec?,zone?}>}
 */
export function buildZoomPlan(events, durationSec, sourceW, sourceH, options = {}) {
  const opts = { ...ZOOM_PLAN_DEFAULTS, ...options }
  const cams = (events ?? []).filter((e) => e.type === 'focus' || e.type === 'wide')

  // Merge camera moves that are too close together — the later one wins.
  const kept = []
  for (const e of cams) {
    const prev = kept[kept.length - 1]
    if (prev && e.t - prev.t < opts.minShotSec) kept[kept.length - 1] = e
    else kept.push(e)
  }

  const anchorOf = (e) => e.tDepart ?? e.t - opts.leadSec

  const shots = []
  const firstT = kept.length ? Math.max(0, anchorOf(kept[0])) : 0
  if (kept.length === 0 || firstT > 0.05) {
    shots.push({ tStart: 0, cx: sourceW / 2, cy: sourceH / 2, zoom: opts.idleZoom, label: 'wide' })
  }
  for (const e of kept) {
    const crop =
      e.type === 'wide' || !e.box
        ? { zoom: opts.idleZoom, cx: sourceW / 2, cy: sourceH / 2 }
        : cropForZone(e.box, sourceW, sourceH, opts)
    const prevStart = shots.length ? shots[shots.length - 1].tStart : 0
    const tStart = Math.max(prevStart + 0.05, anchorOf(e))
    const transSec =
      e.tDepart != null && e.tArrive != null
        ? Math.max(opts.minTransSec, Math.min(opts.maxTransSec, e.tArrive - e.tDepart))
        : undefined
    shots.push({ tStart, cx: crop.cx, cy: crop.cy, zoom: crop.zoom, label: e.label, transSec, zone: e.box ?? null })
  }

  // Cursor-safety cap for big jumps between consecutive shot centers.
  for (let i = 0; i < shots.length - 1; i++) {
    const a = shots[i]
    const b = shots[i + 1]
    const dist = Math.hypot(b.cx - a.cx, b.cy - a.cy)
    if (dist < 1) continue
    const safeZoom = Math.min(sourceW, sourceH) / (2 * opts.travelMargin * dist)
    a.zoom = Math.max(opts.minZoom, Math.min(a.zoom, safeZoom))
    b.zoom = Math.max(opts.minZoom, Math.min(b.zoom, safeZoom))
  }

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    s.tEnd = i + 1 < shots.length ? shots[i + 1].tStart : durationSec
    const halfW = sourceW / s.zoom / 2
    const halfH = sourceH / s.zoom / 2
    s.cx = Math.min(Math.max(s.cx, halfW), sourceW - halfW)
    s.cy = Math.min(Math.max(s.cy, halfH), sourceH - halfH)
  }
  return shots
}
