/**
 * Compiles a zoom plan (see zoomplan.mjs) into a single ffmpeg `zoompan` filter
 * string. Each shot holds its target (cx, cy, zoom) and eases in from the
 * previous shot's values over `transitionSec` using an ease-out cubic curve —
 * the same shape spring-physics auto-zoom tools use, without needing a spring
 * simulation: eased once per shot boundary is enough at this shot count.
 *
 * Math walkthrough: reference.md
 */

function fmt(n) {
  return Number(n.toFixed(4))
}

/**
 * Ease-out cubic — fast departure, slow settle (Screen Studio-like pan/zoom feel).
 * ffmpeg expr: 1-(1-p)^3
 */
function easeOutCubic(pVar) {
  return `(1-pow(1-${pVar},3))`
}

/** One piecewise `if(between(in_time,a,b), eased, ...)` chain per axis (zoom | cx | cy). */
function buildAxisExpr(shots, key, transitionSec) {
  let expr = `${fmt(shots[shots.length - 1][key])}`
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i]
    const cur = fmt(s[key])
    const hasPrev = i > 0
    // Prefer the shot's own transSec (derived from the cursor's real tDepart→tArrive window,
    // see zoomplan.mjs) so the camera and the cursor move in lockstep instead of two independent
    // guesses. Falls back to the global default for shots without that data (marks, wide shots).
    const trans = Math.max(0.12, Math.min(s.transSec ?? transitionSec, (s.tEnd - s.tStart) * 0.45))
    let valueExpr
    if (!hasPrev || trans <= 0.121) {
      valueExpr = `${cur}`
    } else {
      const prev = fmt(shots[i - 1][key])
      const p = `min(max((in_time-${fmt(s.tStart)})/${fmt(trans)},0),1)`
      const ease = easeOutCubic(p)
      valueExpr = `(${prev}+(${cur}-${prev})*${ease})`
    }
    expr = `if(between(in_time,${fmt(s.tStart)},${fmt(s.tEnd)}),${valueExpr},${expr})`
  }
  return expr
}

/**
 * @returns {string} a full `fps=...,zoompan=...` filter chain ready for `-vf`.
 */
export function toZoompanFilter(shots, { sourceW, sourceH, outW, outH, fps = 30, transitionSec = 0.72 } = {}) {
  const zExpr = buildAxisExpr(shots, 'zoom', transitionSec)
  const cxExpr = buildAxisExpr(shots, 'cx', transitionSec)
  const cyExpr = buildAxisExpr(shots, 'cy', transitionSec)
  const xExpr = `max(min(${cxExpr}-(iw/zoom/2),iw-iw/zoom),0)`
  const yExpr = `max(min(${cyExpr}-(ih/zoom/2),ih-ih/zoom),0)`
  return `fps=${fps},zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${outW}x${outH}:fps=${fps}`
}

/** True when the plan never actually zooms — caller can skip zoompan entirely. */
export function isTrivialPlan(shots) {
  return shots.every((s) => s.zoom <= 1.001)
}

/**
 * JS twin of the ffmpeg expression above — returns the exact crop rect the
 * final video shows at time `t`. Used by guardrails.mjs (cursor-in-crop checks)
 * and inspect.mjs (annotated frames). Keep in sync with buildAxisExpr.
 */
export function cameraAt(shots, t, { sourceW, sourceH, transitionSec = 0.72 } = {}) {
  if (!shots?.length) return null
  let i = shots.findIndex((s) => t >= s.tStart && t < s.tEnd)
  if (i < 0) i = t < shots[0].tStart ? 0 : shots.length - 1
  const s = shots[i]
  let zoom = s.zoom
  let cx = s.cx
  let cy = s.cy
  if (i > 0) {
    const trans = Math.max(0.12, Math.min(s.transSec ?? transitionSec, (s.tEnd - s.tStart) * 0.45))
    if (trans > 0.121) {
      const p = Math.min(Math.max((t - s.tStart) / trans, 0), 1)
      const e = 1 - Math.pow(1 - p, 3)
      const prev = shots[i - 1]
      zoom = prev.zoom + (s.zoom - prev.zoom) * e
      cx = prev.cx + (s.cx - prev.cx) * e
      cy = prev.cy + (s.cy - prev.cy) * e
    }
  }
  const w = sourceW / zoom
  const h = sourceH / zoom
  const x = Math.max(Math.min(cx - w / 2, sourceW - w), 0)
  const y = Math.max(Math.min(cy - h / 2, sourceH - h), 0)
  return { t, label: s.label, shotIndex: i, zoom, cx, cy, x, y, w, h }
}
