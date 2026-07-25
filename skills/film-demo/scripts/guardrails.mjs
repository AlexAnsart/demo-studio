/**
 * Deterministic guardrails for a composed film. Reads renderDir/timeline.json
 * (events + cursor trace) and renderDir/zoom-plan.json, replays the EXACT
 * camera math the final video used (cameraAt), and reports:
 *
 *   A. CAMERA PLAN — one line per shot: when, how long, zoom, where. This is
 *      how the agent knows "how long does each zoom last and where is it".
 *   B. ALERTS — violations the agent must fix or explicitly justify:
 *      - cursor-offscreen : the cursor is outside the visible crop
 *      - zoom-too-long    : a zoomed shot holds > maxZoomHoldSec
 *      - inactivity       : > inactivitySec with no cursor motion / typing / click
 *      - zone-clipped     : a focus zone not fully contained in its crop
 *      - record-alert     : warnings raised at record time (click outside zone…)
 *
 * Usage: node guardrails.mjs <renderDir>
 * Exit code 1 when alerts exist — the agent decides to fix or to justify.
 */
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { pathToFileURL } from 'url'
import { cameraAt } from './zoompan-expr.mjs'
import { inactivityGaps } from './speedup.mjs'
import { FILM_VIEWPORT } from './record.mjs'

/** Piecewise-linear cursor position at time t (holds last known position). */
export function cursorAt(trace, t) {
  if (!trace?.length) return null
  if (t <= trace[0].t) return { x: trace[0].x, y: trace[0].y }
  for (let i = 1; i < trace.length; i++) {
    if (trace[i].t >= t) {
      const a = trace[i - 1]
      const b = trace[i]
      const span = b.t - a.t
      if (span <= 0) return { x: b.x, y: b.y }
      const p = (t - a.t) / span
      return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p }
    }
  }
  const last = trace[trace.length - 1]
  return { x: last.x, y: last.y }
}

export function runGuardrails(renderDir, options = {}) {
  const {
    sampleFps = 10,
    cursorMargin = 4, // px tolerance at crop edges
    minOffscreenSpan = 0.2,
    maxZoomHoldSec = 12,
    inactivitySec = 5,
  } = options
  const { width: W, height: H } = FILM_VIEWPORT

  const { events, cursor } = JSON.parse(readFileSync(join(renderDir, 'timeline.json'), 'utf8'))
  const shots = JSON.parse(readFileSync(join(renderDir, 'zoom-plan.json'), 'utf8'))
  const duration = shots.length ? shots[shots.length - 1].tEnd : 0

  const plan = shots.map((s, i) => ({
    index: i,
    label: s.label,
    tStart: Math.round(s.tStart * 10) / 10,
    tEnd: Math.round(s.tEnd * 10) / 10,
    holdSec: Math.round((s.tEnd - s.tStart) * 10) / 10,
    zoom: Math.round(s.zoom * 100) / 100,
    center: `${Math.round(s.cx)},${Math.round(s.cy)}`,
    zone: s.zone ? `${s.zone.x},${s.zone.y} ${s.zone.w}x${s.zone.h}` : null,
  }))

  const alerts = []

  // B1. cursor inside the visible crop, sampled over the whole video
  let spanStart = null
  for (let t = 0; t <= duration; t += 1 / sampleFps) {
    const cam = cameraAt(shots, t, { sourceW: W, sourceH: H })
    const cur = cursorAt(cursor, t)
    if (!cam || !cur) continue
    const inside =
      cur.x >= cam.x - cursorMargin &&
      cur.x <= cam.x + cam.w + cursorMargin &&
      cur.y >= cam.y - cursorMargin &&
      cur.y <= cam.y + cam.h + cursorMargin
    if (!inside && spanStart == null) spanStart = t
    if (inside && spanStart != null) {
      if (t - spanStart >= minOffscreenSpan) {
        alerts.push({
          kind: 'cursor-offscreen',
          tStart: Math.round(spanStart * 10) / 10,
          tEnd: Math.round(t * 10) / 10,
          message: `cursor outside visible crop ${spanStart.toFixed(1)}-${t.toFixed(1)}s (shot "${cameraAt(shots, spanStart, { sourceW: W, sourceH: H })?.label}")`,
        })
      }
      spanStart = null
    }
  }
  if (spanStart != null && duration - spanStart >= minOffscreenSpan) {
    alerts.push({
      kind: 'cursor-offscreen',
      tStart: Math.round(spanStart * 10) / 10,
      tEnd: Math.round(duration * 10) / 10,
      message: `cursor outside visible crop ${spanStart.toFixed(1)}s → end`,
    })
  }

  // B2. zoomed shot holding too long
  for (const s of shots) {
    const hold = s.tEnd - s.tStart
    if (s.zoom > 1.05 && hold > maxZoomHoldSec) {
      alerts.push({
        kind: 'zoom-too-long',
        tStart: Math.round(s.tStart * 10) / 10,
        tEnd: Math.round(s.tEnd * 10) / 10,
        message: `shot "${s.label}" holds zoom ${s.zoom.toFixed(2)} for ${hold.toFixed(1)}s (> ${maxZoomHoldSec}s) — add wide() earlier`,
      })
    }
  }

  // B3. inactivity in the FINAL timeline (post speed-up)
  for (const [start, end] of inactivityGaps(events, inactivitySec)) {
    const spinner = events.some((e) => e.type === 'appear' && e.t <= start + 0.5 && events.some((d) => d.type === 'done' && d.label === `${e.label}-done` && d.t >= end - 0.5))
    alerts.push({
      kind: 'inactivity',
      tStart: Math.round(start * 10) / 10,
      tEnd: Math.round(end * 10) / 10,
      message: `${(end - start).toFixed(1)}s with no cursor motion / typing / click at ${start.toFixed(1)}-${end.toFixed(1)}s${spinner ? ' (tool spinner — may be acceptable)' : ''}`,
    })
  }

  // B4. focus zone fully contained in its crop (should never fire — by construction)
  for (const s of shots) {
    if (!s.zone) continue
    const w = W / s.zoom
    const h = H / s.zoom
    const x = Math.max(Math.min(s.cx - w / 2, W - w), 0)
    const y = Math.max(Math.min(s.cy - h / 2, H - h), 0)
    if (s.zone.x < x - 1 || s.zone.y < y - 1 || s.zone.x + s.zone.w > x + w + 1 || s.zone.y + s.zone.h > y + h + 1) {
      alerts.push({
        kind: 'zone-clipped',
        tStart: Math.round(s.tStart * 10) / 10,
        message: `focus zone of "${s.label}" is not fully inside its crop — zoomplan bug or zone larger than frame`,
      })
    }
  }

  // B5. record-time alerts propagated
  for (const e of events) {
    if (e.type === 'alert') {
      alerts.push({ kind: 'record-alert', tStart: Math.round(e.t * 10) / 10, message: e.label })
    }
  }

  // B6. zoom pumping — a blink-short wide (or direct re-focus) sandwiched
  // between two zoomed shots reads as the camera "pumping". One longer focus
  // covering the union of both zones is almost always better.
  for (let i = 1; i < shots.length - 1; i++) {
    const prev = shots[i - 1]
    const s = shots[i]
    const next = shots[i + 1]
    if (s.zoom <= 1.05 && prev.zoom > 1.05 && next.zoom > 1.05 && s.tEnd - s.tStart < 2.0) {
      alerts.push({
        kind: 'zoom-pump',
        tStart: Math.round(s.tStart * 10) / 10,
        tEnd: Math.round(s.tEnd * 10) / 10,
        message: `wide "${s.label}" lasts only ${(s.tEnd - s.tStart).toFixed(1)}s between two zooms ("${prev.label}" → "${next.label}") — use ONE focus() on the union of both zones instead`,
      })
    }
  }
  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1]
    const b = shots[i]
    if (a.zoom > 1.05 && b.zoom > 1.05 && Math.abs(a.zoom - b.zoom) < 0.12 && Math.hypot(b.cx - a.cx, b.cy - a.cy) < 90) {
      alerts.push({
        kind: 'zoom-pump',
        tStart: Math.round(b.tStart * 10) / 10,
        message: `focus "${b.label}" is nearly identical to previous "${a.label}" — drop the re-focus, hold the first shot`,
      })
    }
  }

  alerts.sort((a, b) => a.tStart - b.tStart)
  const report = { durationSec: Math.round(duration * 10) / 10, plan, alerts }
  writeFileSync(join(renderDir, 'guardrails-report.json'), JSON.stringify(report, null, 2), 'utf8')
  return report
}

export function formatReport(report) {
  const lines = []
  lines.push(`duration: ${report.durationSec}s`)
  lines.push('')
  lines.push('CAMERA PLAN')
  lines.push('idx  start   end     hold   zoom  label')
  for (const p of report.plan) {
    lines.push(
      `${String(p.index).padStart(3)}  ${String(p.tStart).padStart(6)}  ${String(p.tEnd).padStart(6)}  ${String(p.holdSec).padStart(5)}  ${String(p.zoom).padStart(4)}  ${p.label}${p.zone ? `  [zone ${p.zone}]` : ''}`,
    )
  }
  lines.push('')
  if (!report.alerts.length) {
    lines.push('ALERTS: none')
  } else {
    lines.push(`ALERTS (${report.alerts.length}) — fix each one or justify it explicitly:`)
    for (const a of report.alerts) lines.push(`- [${a.kind}] ${a.message}`)
  }
  return lines.join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const renderDir = process.argv[2]
  if (!renderDir || !existsSync(join(renderDir, 'zoom-plan.json'))) {
    console.error('Usage: node guardrails.mjs <renderDir>   (run compose first — needs zoom-plan.json)')
    process.exit(2)
  }
  const report = runGuardrails(renderDir)
  console.log(formatReport(report))
  process.exit(report.alerts.length ? 1 : 0)
}
