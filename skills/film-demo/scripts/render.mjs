import { spawnSync } from 'child_process'
import { toZoompanFilter, isTrivialPlan } from './zoompan-expr.mjs'

function runFfmpeg(args, label) {
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64, timeout: 20 * 60 * 1000 })
  if (r.signal) throw new Error(`${label} timed out or was killed (signal ${r.signal}) — check for runaway lavfi duration`)
  if (r.status !== 0) {
    throw new Error(`${label} failed (ffmpeg exit ${r.status}):\n${r.stderr?.slice(-3000) ?? '(no stderr)'}`)
  }
  return r
}

/** Stage 1 — crops/zooms the raw recording into `outW`x`outH`, no framing. */
export function renderZoomed(rawPath, shots, outPath, { sourceW, sourceH, outW, outH, fps = 30 } = {}) {
  const vf = isTrivialPlan(shots)
    ? `scale=${outW}:${outH}:flags=lanczos`
    : toZoompanFilter(shots, { sourceW, sourceH, outW, outH, fps })
  runFfmpeg(
    ['-y', '-i', rawPath, '-vf', vf, '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', outPath],
    'renderZoomed',
  )
  return outPath
}

/**
 * Stage 2 — pads the zoomed clip into a styled canvas: background, soft drop
 * shadow, thin border. See `presets/*.json` at the repo root for ready-made
 * looks (studio-dark, clean-light, none) — pass their fields straight through
 * as `background` / `borderColor` / `shadowOpacity`. Set `shadowOpacity: 0` to
 * disable the shadow if it renders oddly on your ffmpeg build.
 */
export function applyStyledFrame(zoomedPath, outPath, options = {}) {
  const {
    canvasW = 1920,
    canvasH = 1080,
    padX = 96,
    padY = 96,
    background = '0x0A0A0A',
    borderColor = 'white@0.35',
    shadowOpacity = 0.55,
    shadowPad = 20,
    shadowDrop = 14,
    fps = 30,
    durationSec, // required — bounds the lavfi background/shadow sources, see reference.md perf note
  } = options
  if (!durationSec) throw new Error('applyStyledFrame requires durationSec (ffprobe the zoomed clip first)')
  const srcDur = Math.ceil(durationSec) + 1
  const contentW = canvasW - 2 * padX
  const contentH = canvasH - 2 * padY
  const shadowW = contentW + 2 * shadowPad
  const shadowH = contentH + 2 * shadowPad
  const shadowX = padX - shadowPad
  const shadowY = padY - shadowPad + shadowDrop

  const chains = [`color=c=${background}:s=${canvasW}x${canvasH}:r=${fps}:d=${srcDur}[bg]`]
  if (shadowOpacity > 0) {
    chains.push(
      `color=c=black:s=${shadowW}x${shadowH}:r=${fps}:d=${srcDur},format=yuva420p,colorchannelmixer=aa=${shadowOpacity},boxblur=24:1[shadow]`,
      `[bg][shadow]overlay=x=${shadowX}:y=${shadowY}[bg2]`,
    )
  }
  const bgLabel = shadowOpacity > 0 ? '[bg2]' : '[bg]'
  chains.push(
    `[0:v]scale=${contentW}:${contentH}:flags=lanczos[content]`,
    // shortest=1: the generated background outlives the clip by design (srcDur is
    // rounded up) — end the graph with the content, or the final video gains a
    // frozen 1-2s tail. Output `-shortest` does NOT cover filter_complex graphs.
    `${bgLabel}[content]overlay=x=${padX}:y=${padY}:shortest=1[bg3]`,
    `[bg3]drawbox=x=${padX}:y=${padY}:w=${contentW}:h=${contentH}:color=${borderColor}:t=1[out]`,
  )

  runFfmpeg(
    [
      '-y', '-i', zoomedPath,
      '-filter_complex', chains.join(';'),
      '-map', '[out]',
      '-r', String(fps),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-shortest',
      outPath,
    ],
    'applyStyledFrame',
  )
  return outPath
}
