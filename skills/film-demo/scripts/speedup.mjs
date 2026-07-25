/**
 * Post-record speed-ups — plan ALL compressions first from the activity
 * model, then apply them in ONE ffmpeg pass (a single re-encode instead of one
 * per segment), then remap every timestamp (events + cursor trace) through the
 * same time map so timeline.json stays frame-accurate against raw.mp4.
 *
 * What gets compressed:
 * 1. Lead — everything before the first event anchor is dropped.
 * 2. loading-start → first appear/click  → capped at `preToolWaitMax` (default 4s)
 * 3. appear → done pairs (tool spinners) → capped at `toolWaitMax` (default 8s)
 * 4. Any remaining INACTIVE gap (no cursor motion, no typing, no click — derived
 *    from tDepart/t activity windows) longer than `idleGapMin` → `idleGapMax`.
 *    This is the pass that kills "nothing happens for 10s" moments regardless
 *    of which event types surround them.
 */
import { join } from 'path'
import { existsSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { spawnSync } from 'child_process'
import { rawVideoPath } from './record.mjs'

function runFfmpeg(args) {
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 15 * 60 * 1000 })
  if (r.status !== 0) throw new Error(r.stderr?.slice(-800) ?? 'ffmpeg failed')
}

function ffprobeDuration(path) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' })
  const n = parseFloat(r.stdout?.trim())
  return Number.isFinite(n) ? n : null
}

/** Merged [start, end] intervals during which something visibly happens. */
export function activityIntervals(events) {
  const iv = []
  for (const e of events ?? []) {
    if (e.tDepart != null && e.t > e.tDepart) iv.push([e.tDepart, e.t])
    else if (e.type === 'scroll') iv.push([Math.max(0, e.t - 2.2), e.t])
    else iv.push([Math.max(0, e.t - 0.2), e.t + 0.2])
  }
  iv.sort((a, b) => a[0] - b[0])
  const merged = []
  for (const [s, e] of iv) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1] + 0.05) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  return merged
}

/** Gaps between activity intervals, within [0, lastEventT]. */
export function inactivityGaps(events, minGap = 3.5) {
  const act = activityIntervals(events)
  if (!act.length) return []
  const gaps = []
  for (let i = 1; i < act.length; i++) {
    const start = act[i - 1][1]
    const end = act[i][0]
    if (end - start >= minGap) gaps.push([start, end])
  }
  return gaps
}

function overlaps(seg, list) {
  return list.some((s) => seg.start < s.end && seg.end > s.start)
}

/**
 * @returns {Array<{start,end,target,kind}>} sorted, non-overlapping segments in
 * ORIGINAL raw.mp4 time. target=0 means "drop entirely" (lead).
 */
export function planSpeedups(events, config = {}, durationSec = null) {
  const {
    // Loading states must FLASH in the final video, not linger: 4s of visibly
    // compressed spinner is the ceiling before viewers reach for the seek bar.
    toolWaitMax = 4,
    preToolWaitMax = 2.5,
    idleGapMax = 1.8,
    idleGapMin = 3.5,
    leadPad = 0.3,
    tailHold = 2.6, // seconds of the closing shot kept after the last event
  } = config
  const segments = []
  const anchor = (e) => e.tDepart ?? e.t

  // 1. lead: drop [0, firstAnchor - leadPad] — even short leads flash an
  // unloaded/blank paint, so the threshold is aggressive.
  const firstT = events.length ? Math.min(...events.map(anchor)) : 0
  if (firstT - leadPad > 0.3) segments.push({ start: 0, end: firstT - leadPad, target: 0, kind: 'lead' })

  // 1b. tail: drop everything beyond tailHold after the last event (page close, static end)
  if (durationSec != null && events.length) {
    const lastT = Math.max(...events.map((e) => e.t))
    if (durationSec - lastT > tailHold + 0.6) {
      segments.push({ start: lastT + tailHold, end: durationSec - 0.3, target: 0, kind: 'tail' })
    }
  }

  // 2. loading-start → first appear/click (streaming latency before first tool)
  for (let i = 0; i < events.length; i++) {
    if (events[i].type !== 'loading-start') continue
    const first = events.find((e, j) => j > i && (e.type === 'appear' || e.type === 'click'))
    if (!first) continue
    const seg = { start: events[i].t, end: first.tArrive ?? first.t, target: preToolWaitMax, kind: `pre-tool:${events[i].label}` }
    if (seg.end - seg.start > preToolWaitMax + 0.5 && !overlaps(seg, segments)) segments.push(seg)
  }

  // 3. appear → done pairs (tool spinners)
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    if (e.type !== 'appear') continue
    const doneEv = events.find((d, j) => j > i && d.type === 'done' && d.label === `${e.label}-done`)
    if (!doneEv) continue
    const seg = { start: e.t, end: doneEv.tArrive ?? doneEv.t, target: toolWaitMax, kind: `tool:${e.label}` }
    if (seg.end - seg.start > toolWaitMax + 0.5 && !overlaps(seg, segments)) segments.push(seg)
  }

  // 4. generic inactivity (activity-model complement)
  for (const [start, end] of inactivityGaps(events, idleGapMin)) {
    const seg = { start: start + 0.3, end: end - 0.2, target: idleGapMax, kind: 'idle' }
    if (seg.end - seg.start > idleGapMax + 0.5 && !overlaps(seg, segments)) segments.push(seg)
  }

  segments.sort((a, b) => a.start - b.start)
  return segments
}

/** t (original) → t (after all compressions). */
export function makeTimeMap(segments) {
  return (t) => {
    if (t == null) return t
    let out = t
    for (const seg of segments) {
      const len = seg.end - seg.start
      const newLen = seg.target
      if (t >= seg.end) out -= len - newLen
      else if (t > seg.start) out -= (t - seg.start) * (1 - newLen / len)
    }
    return Math.max(0, Math.round(out * 1000) / 1000)
  }
}

/** One ffmpeg pass: split raw.mp4 into parts, retime compressed ones, concat. */
export function applySegmentsToVideo(renderDir, segments, log = () => {}) {
  if (!segments.length) return false
  const raw = rawVideoPath(renderDir)
  const out = join(renderDir, 'raw.sped.tmp.mp4')

  const parts = []
  let cursor = 0
  for (const seg of segments) {
    if (seg.start - cursor > 0.05) parts.push({ start: cursor, end: seg.start, factor: 1 })
    if (seg.target > 0.01) parts.push({ start: seg.start, end: seg.end, factor: (seg.end - seg.start) / seg.target })
    // target 0 → part dropped entirely
    cursor = seg.end
  }
  parts.push({ start: cursor, end: null, factor: 1 })

  const lines = [`[0:v]split=${parts.length}${parts.map((_, i) => `[s${i}]`).join('')}`]
  parts.forEach((p, i) => {
    const trim = p.end == null ? `trim=start=${p.start}` : `trim=${p.start}:${p.end}`
    const setpts = p.factor === 1 ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${p.factor.toFixed(4)}`
    lines.push(`[s${i}]${trim},${setpts}[c${i}]`)
  })
  lines.push(`${parts.map((_, i) => `[c${i}]`).join('')}concat=n=${parts.length}:v=1:a=0[out]`)

  runFfmpeg([
    '-y', '-i', raw,
    '-filter_complex', lines.join(';'),
    '-map', '[out]',
    '-r', '30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-an',
    out,
  ])
  if (!existsSync(out)) throw new Error('speedup output missing')
  unlinkSync(raw)
  renameSync(out, raw)
  for (const s of segments) {
    log(`${s.kind}: ${s.start.toFixed(1)}-${s.end.toFixed(1)}s (${(s.end - s.start).toFixed(1)}s → ${s.target}s)`)
  }
  return true
}

/**
 * Entry point used by compose.mjs. Takes and returns `{ events, cursor }`
 * (both remapped), updates raw.mp4 and timeline.json in place.
 */
export function postprocessRecording(renderDir, data, config = {}, log = () => {}) {
  const events = data.events ?? []
  const cursorTrace = data.cursor ?? []
  const rawDuration = ffprobeDuration(rawVideoPath(renderDir))
  const segments = planSpeedups(events, config.speedup ?? config, rawDuration)
  let outEvents = events
  let outCursor = cursorTrace
  if (segments.length) {
    try {
      applySegmentsToVideo(renderDir, segments, log)
      const map = makeTimeMap(segments)
      outEvents = events.map((e) => ({
        ...e,
        t: map(e.t),
        ...(e.tDepart != null ? { tDepart: map(e.tDepart) } : {}),
        ...(e.tArrive != null ? { tArrive: map(e.tArrive) } : {}),
      }))
      outCursor = cursorTrace.map((c) => ({ ...c, t: map(c.t) }))
    } catch (err) {
      log(`WARN: speedup failed, keeping original video: ${err.message}`)
    }
  } else {
    log('nothing to compress')
  }
  writeFileSync(join(renderDir, 'timeline.json'), JSON.stringify({ events: outEvents, cursor: outCursor }, null, 2), 'utf8')
  return { events: outEvents, cursor: outCursor }
}
