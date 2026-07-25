/**
 * CDP screencast recorder — replaces Playwright's `recordVideo`.
 *
 * Why: Playwright's built-in recorder muxes a VFR WebM whose frame timestamps
 * carry transport jitter, which reads as stuttering cursor motion and choppy
 * loading animations in the final render. Here we capture the raw compositor
 * frames ourselves via `Page.startScreencast`, keep each frame's EXACT
 * compositor timestamp, and assemble a clean constant-frame-rate MP4 with
 * ffmpeg's concat demuxer (per-frame durations from the real timestamps).
 *
 * Timeline alignment: `startRecording` re-anchors the timeline epoch at the
 * moment capture begins, so video time == timeline event time by construction
 * (frames received before the anchor are clamped to t=0).
 */
import { join, resolve } from 'path'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { spawnSync } from 'child_process'

export async function startRecording(page, renderDir, timeline, { quality = 82, width = 1920, height = 1080 } = {}) {
  const framesDir = join(renderDir, 'frames')
  mkdirSync(framesDir, { recursive: true })

  const state = {
    framesDir,
    frames: [], // { tsMs, file } in arrival order
    writes: [],
    index: 0,
    cdp: null,
    timeline,
    stopped: false,
  }

  state.cdp = await page.context().newCDPSession(page)
  state.cdp.on('Page.screencastFrame', (ev) => {
    const file = `f${String(state.index++).padStart(6, '0')}.jpg`
    state.frames.push({ tsMs: ev.metadata.timestamp * 1000, file })
    // Ack immediately — waiting on disk I/O throttled capture to ~10fps when
    // Node was busy stepping mouse.move() in a tight loop.
    state.cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {})
    state.writes.push(
      writeFile(join(framesDir, file), Buffer.from(ev.data, 'base64')).catch(() => {}),
    )
  })

  await state.cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality,
    maxWidth: width,
    maxHeight: height,
    everyNthFrame: 1,
  })
  // Anchor: from here on, timeline.now() and frame PTS share the same zero.
  timeline.setEpoch(Date.now())
  return state
}

/**
 * Stops capture and assembles `raw.mp4` (CFR, `fps`) in renderDir.
 * Returns { rawPath, ok, frameCount, capturedFps }.
 */
export async function stopRecording(state, renderDir, { fps = 30, keepFrames = false } = {}) {
  if (state.stopped) throw new Error('recorder already stopped')
  state.stopped = true
  const stopMs = Date.now()
  await state.cdp.send('Page.stopScreencast').catch(() => {})
  await state.cdp.detach().catch(() => {})
  await Promise.all(state.writes)

  const epochMs = state.timeline.epochMs
  // Relative times, clamped at 0; keep only the last pre-anchor frame (it is
  // the image on screen when the timeline started).
  let frames = state.frames
    .map((f) => ({ t: Math.max(0, (f.tsMs - epochMs) / 1000), file: f.file }))
    .sort((a, b) => a.t - b.t)
  const lastZero = frames.reduce((acc, f, i) => (f.t === 0 ? i : acc), -1)
  if (lastZero > 0) frames = frames.slice(lastZero)

  const rawPath = join(renderDir, 'raw.mp4')
  if (frames.length < 2) {
    return { rawPath, ok: false, frameCount: frames.length, capturedFps: 0 }
  }

  const durationSec = (stopMs - epochMs) / 1000
  const lines = ['ffconcat version 1.0']
  for (let i = 0; i < frames.length; i++) {
    const next = i + 1 < frames.length ? frames[i + 1].t : Math.max(durationSec, frames[i].t + 1 / fps)
    lines.push(`file '${frames[i].file}'`)
    lines.push(`duration ${Math.max(0.001, next - frames[i].t).toFixed(4)}`)
  }
  // concat demuxer quirk: repeat the last file so its duration is honored
  lines.push(`file '${frames[frames.length - 1].file}'`)
  const listPath = join(state.framesDir, 'list.txt')
  writeFileSync(listPath, lines.join('\n'), 'utf8')

  const r = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-f', 'concat', '-safe', '0',
      '-i', resolve(listPath),
      '-vf', `fps=${fps}`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p',
      '-an',
      rawPath,
    ],
    { cwd: state.framesDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 },
  )
  const ok = r.status === 0 && existsSync(rawPath)
  if (!ok) console.error(`[screencast] assembly failed:\n${r.stderr?.slice(-1500)}`)

  const spanSec = frames[frames.length - 1].t - frames[0].t
  const capturedFps = spanSec > 0 ? (frames.length - 1) / spanSec : 0
  const intervals = frames.slice(1).map((f, i) => f.t - frames[i].t).sort((a, b) => a - b)
  const pct = (p) => (intervals.length ? Math.round(intervals[Math.min(intervals.length - 1, Math.floor(p * intervals.length))] * 1000) : null)
  writeFileSync(
    join(renderDir, 'capture-stats.json'),
    JSON.stringify(
      {
        frameCount: frames.length,
        durationSec: Math.round(durationSec * 100) / 100,
        capturedFps: Math.round(capturedFps * 10) / 10,
        outputFps: fps,
        frameIntervalMs: { p50: pct(0.5), p90: pct(0.9), max: pct(1) },
      },
      null,
      2,
    ),
    'utf8',
  )
  if (ok && !keepFrames) rmSync(state.framesDir, { recursive: true, force: true })
  else if (keepFrames) {
    writeFileSync(join(state.framesDir, 'frames-meta.json'), JSON.stringify(frames, null, 2), 'utf8')
  }
  return { rawPath, ok, frameCount: frames.length, capturedFps }
}
