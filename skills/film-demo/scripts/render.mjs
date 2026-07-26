import { spawnSync } from 'child_process'
import { dirname } from 'path'
import { existsSync } from 'fs'
import { toZoompanFilter, isTrivialPlan } from './zoompan-expr.mjs'
import { buildChromeAssets, buildWallpaperBg, buildRoundedShadow } from './chrome.mjs'

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
 * Stage 2 — pads the zoomed clip into a styled canvas. Two paths:
 *
 * - **Plain** (no `wallpaper`/`radius`/`titlebarHeight`): solid background,
 *   soft drop shadow, square 1px border — the original, unchanged ffmpeg-only
 *   graph. Every existing preset (`studio-dark`, `clean-light`, `none`) stays
 *   byte-identical.
 * - **Chrome** (any of those three set): adds a wallpaper background (cover
 *   crop + optional blur/dim), rounded window corners, and an optional
 *   macOS-style title bar with traffic-light dots. The extra PNG assets are
 *   pre-rendered once with `sharp` (`chrome.mjs`) then composited by ffmpeg —
 *   see `docs/CONFIG.md` for the full `frame.*` option list.
 *
 * `background`/`borderColor`/`shadowOpacity` are shared by both paths.
 */
export async function applyStyledFrame(zoomedPath, outPath, options = {}) {
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
    wallpaper = null,
    wallpaperDim = 0.35,
    wallpaperBlur = 0,
    radius = 0,
    titlebarHeight = 0,
    titlebarColor = 'rgba(22,22,27,0.94)',
    trafficLights = true,
    trafficLightColors = ['#ff5f57', '#febc2e', '#28c840'],
  } = options
  if (!durationSec) throw new Error('applyStyledFrame requires durationSec (ffprobe the zoomed clip first)')
  const srcDur = Math.ceil(durationSec) + 1
  const contentW = canvasW - 2 * padX
  const contentH = canvasH - 2 * padY
  const shadowW = contentW + 2 * shadowPad
  const shadowH = contentH + 2 * shadowPad
  const shadowX = padX - shadowPad
  const shadowY = padY - shadowPad + shadowDrop

  const useChrome = !!wallpaper || radius > 0 || titlebarHeight > 0
  if (!useChrome) {
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

  // --- Chrome path ---
  const renderDir = dirname(zoomedPath)
  const effTitlebarHeight = titlebarHeight > 0 ? Math.min(titlebarHeight, padY) : 0
  if (titlebarHeight > 0 && effTitlebarHeight < titlebarHeight) {
    console.warn(`[render] titlebarHeight (${titlebarHeight}) > padY (${padY}) — clamped to ${effTitlebarHeight}. Increase frame.padY to show the full title bar.`)
  }
  const windowY = padY - effTitlebarHeight

  const { maskPath, chromePath, windowW, windowH } = await buildChromeAssets(renderDir, {
    contentW,
    contentH,
    radius,
    titlebarHeight: effTitlebarHeight,
    titlebarColor,
    trafficLights,
    trafficLightColors,
    borderColor,
    borderWidth: 1,
  })

  let shadowAsset = null
  if (shadowOpacity > 0) {
    shadowAsset = await buildRoundedShadow(renderDir, {
      windowW,
      windowH,
      radius,
      shadowOpacity,
      shadowPad,
      shadowDrop,
    })
  }

  let bgPath = null
  if (wallpaper) {
    if (!existsSync(wallpaper)) throw new Error(`applyStyledFrame: wallpaper file not found: ${wallpaper}`)
    bgPath = await buildWallpaperBg(renderDir, { wallpaperFile: wallpaper, canvasW, canvasH, dim: wallpaperDim, blurPx: wallpaperBlur })
  }

  const inputs = ['-y', '-i', zoomedPath, '-loop', '1', '-t', String(srcDur), '-i', maskPath, '-loop', '1', '-t', String(srcDur), '-i', chromePath]
  let nextInputIdx = 3
  if (bgPath) {
    inputs.push('-loop', '1', '-t', String(srcDur), '-i', bgPath)
    nextInputIdx++
  }
  const bgInputIdx = bgPath ? 3 : null
  let shadowInputIdx = null
  if (shadowAsset) {
    inputs.push('-loop', '1', '-t', String(srcDur), '-i', shadowAsset.shadowPath)
    shadowInputIdx = nextInputIdx
    nextInputIdx++
  }

  const chains = []
  if (bgPath) {
    chains.push(`[${bgInputIdx}:v]scale=${canvasW}:${canvasH}:flags=lanczos[bg]`)
  } else {
    chains.push(`color=c=${background}:s=${canvasW}x${canvasH}:r=${fps}:d=${srcDur}[bg]`)
  }
  let stage = '[bg]'
  if (shadowAsset) {
    const sx = padX - shadowAsset.shadowPad
    const sy = windowY - shadowAsset.shadowPad
    chains.push(`${stage}[${shadowInputIdx}:v]overlay=x=${sx}:y=${sy}[bgshadow]`)
    stage = '[bgshadow]'
  }
  const bgLabel = stage
  chains.push(
    `[0:v]scale=${contentW}:${contentH}:flags=lanczos[contentv]`,
    `[1:v]format=gray[maskgray]`,
    `[contentv][maskgray]alphamerge,format=yuva420p[contentrgba]`,
    `${bgLabel}[contentrgba]overlay=x=${padX}:y=${padY}:shortest=1[bgcontent]`,
    `[2:v]format=rgba[chromergba]`,
    `[bgcontent][chromergba]overlay=x=${padX}:y=${windowY}[out]`,
  )

  runFfmpeg(
    [
      ...inputs,
      '-filter_complex', chains.join(';'),
      '-map', '[out]',
      '-r', String(fps),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-shortest',
      outPath,
    ],
    'applyStyledFrame(chrome)',
  )
  return outPath
}
