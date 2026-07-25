/**
 * Automated quality gate for a film render — extracts stills + checks
 * duration/dead-air/blank-opening so the agent can confirm quality by reading
 * a handful of PNGs instead of watching the whole video. See "Quality gate"
 * in ../SKILL.md for how this fits the iteration loop.
 *
 * Usage: node verify.mjs <renderDir> [--min 12] [--max 130] [--dead-air 4]
 */
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { spawnSync } from 'child_process'
import { pathToFileURL } from 'url'
import { inactivityGaps } from './speedup.mjs'

function ffprobeDuration(path) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' })
  const n = parseFloat(r.stdout?.trim())
  return Number.isFinite(n) ? n : null
}

function extractFrame(videoPath, t, outPath) {
  const r = spawnSync('ffmpeg', ['-y', '-ss', String(Math.max(0, t)), '-i', videoPath, '-update', '1', '-frames:v', '1', outPath], { encoding: 'utf8' })
  return r.status === 0 && existsSync(outPath)
}

function isBlank(pngPath, minBytes = 45000) {
  return !existsSync(pngPath) || statSync(pngPath).size < minBytes
}

/** Gaps inside a loading-start/loading-end bracket are expected — don't flag them. */
function insideLoadingBracket(events, t) {
  let inBracket = false
  for (const e of events) {
    if (e.t > t) break
    if (e.type === 'loading-start') inBracket = true
    if (e.type === 'loading-end') inBracket = false
  }
  return inBracket
}

/**
 * A gap sitting inside an appear→done pair is a tool spinner the speed-up pass
 * already compressed to its target — expected, as long as it stays short.
 */
function insideToolWait(events, start, end, maxOkSec = 5) {
  if (end - start > maxOkSec) return false
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    if (e.type !== 'appear') continue
    const d = events.find((x, j) => j > i && x.type === 'done' && x.label === `${e.label}-done`)
    if (d && e.t <= start + 0.6 && d.t >= end - 0.6) return true
  }
  return false
}

export function verifyFilm(renderDir, options = {}) {
  // deadAir sits just above the speed-up pass's idleGapMin (3.5s) — anything it
  // flags is a gap the speed-up SHOULD have caught, i.e. a real bug.
  const { min = 12, max = 130, deadAir = 4.0, maxFrames = 14 } = options
  const issues = []
  const videoPath = join(renderDir, 'final.mp4')
  const timelinePath = join(renderDir, 'timeline.json')
  const zoomPlanPath = join(renderDir, 'zoom-plan.json')
  const reviewDir = join(renderDir, 'review')
  mkdirSync(reviewDir, { recursive: true })

  const frames = []
  let dur = null

  if (!existsSync(videoPath)) {
    issues.push(`Missing ${videoPath} — run compose.mjs first`)
  } else {
    dur = ffprobeDuration(videoPath)
    if (dur == null) issues.push('ffprobe could not read final.mp4 duration')
    else {
      if (dur < min) issues.push(`Too short: ${dur.toFixed(1)}s (min ${min}s) — script likely failed or skipped beats`)
      if (dur > max) issues.push(`Too long: ${dur.toFixed(1)}s (max ${max}s) — cut a beat, don't rush actions`)
    }
    for (const [i, t] of [0.4, 1.2, 2.4].entries()) {
      const out = join(reviewDir, `opening-${i + 1}.png`)
      if (extractFrame(videoPath, t, out)) {
        frames.push(out)
        if (isBlank(out)) issues.push(`Opening frame at ${t}s looks blank/loading — trim lead or pre-warm the app off-camera`)
      }
    }
  }

  let events = []
  if (existsSync(timelinePath)) {
    events = JSON.parse(readFileSync(timelinePath, 'utf8')).events ?? []
    if (events.length === 0) issues.push('timeline.json has no events — run.mjs must call timeline.shot()/mark() per beat')
    // Activity-based dead-air (same model as guardrails.mjs) — typing and cursor
    // travel windows (tDepart→t) count as activity, so long prompts don't false-flag.
    for (const [start, end] of inactivityGaps(events, deadAir)) {
      if (!insideLoadingBracket(events, start) && !insideToolWait(events, start, end)) {
        issues.push(`Dead air: ${(end - start).toFixed(1)}s with no activity at ${start.toFixed(1)}-${end.toFixed(1)}s — the speed-up pass should have compressed this; check loadingStart/appear/done brackets in run.mjs`)
      }
    }
    if (dur != null && events.length) {
      const tail = dur - events[events.length - 1].t
      if (tail > deadAir) issues.push(`Dead air at the end: ${tail.toFixed(1)}s after "${events[events.length - 1].label}" — trim or end on the result screen sooner`)
      // The payoff (last shown result) needs time to be READ — a video that
      // cuts < 2s after the last action ends before the viewer sees anything.
      const lastAction = [...events].reverse().find((e) => ['click', 'type', 'fill', 'appear', 'done'].includes(e.type))
      if (lastAction && dur - lastAction.t < 2.0) {
        issues.push(`Ends too soon: only ${(dur - lastAction.t).toFixed(1)}s after "${lastAction.label}" — hold the final result ≥ 3s (focus() it, pause, then stop)`)
      }
    }
  } else {
    issues.push('Missing timeline.json — cannot check pacing/dead-air')
  }

  if (existsSync(zoomPlanPath) && dur != null) {
    const shots = JSON.parse(readFileSync(zoomPlanPath, 'utf8'))
    const step = Math.max(1, Math.ceil(shots.length / maxFrames))
    for (let i = 0; i < shots.length; i += step) {
      const s = shots[i]
      const mid = Math.min(dur - 0.1, (s.tStart + s.tEnd) / 2)
      const out = join(reviewDir, `shot-${String(i + 1).padStart(2, '0')}-${(s.label ?? 'wide').replace(/[^a-z0-9]+/gi, '-').slice(0, 24)}.png`)
      if (extractFrame(videoPath, mid, out)) frames.push(out)
    }
  }

  const pass = issues.length === 0
  const report = {
    pass,
    renderDir,
    video: existsSync(videoPath) ? videoPath : null,
    durationSec: dur,
    issues,
    frames: [...new Set(frames)],
    agentInstructions: pass
      ? 'Read every review/*.png. For each shot-*.png confirm the crop frames the labeled element (not empty space, not cut off). Confirm opening-*.png is not blank. Only then copy final.mp4 to the requested output path.'
      : 'Fix run.mjs (dead air, wrong element) or zoom-plan options (padding/maxZoom), re-record with a new render number, re-compose, re-verify. Do not deliver until pass:true.',
  }
  writeFileSync(join(renderDir, 'review-report.json'), JSON.stringify(report, null, 2), 'utf8')
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const renderDir = args[0]
  if (!renderDir) {
    console.error('Usage: node verify.mjs <renderDir> [--min 12] [--max 130] [--dead-air 4]')
    process.exit(1)
  }
  const opt = (flag, def) => {
    const i = args.indexOf(flag)
    return i >= 0 ? Number(args[i + 1]) : def
  }
  const report = verifyFilm(renderDir, { min: opt('--min', 12), max: opt('--max', 130), deadAir: opt('--dead-air', 4.0) })
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.pass ? 0 : 1)
}
