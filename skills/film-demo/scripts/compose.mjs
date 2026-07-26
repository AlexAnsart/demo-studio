import { join, resolve, dirname } from 'path'
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'fs'
import { spawnSync } from 'child_process'
import { pathToFileURL } from 'url'
import { buildZoomPlan } from './zoomplan.mjs'
import { renderZoomed, applyStyledFrame } from './render.mjs'
import { FILM_VIEWPORT, rawVideoPath } from './record.mjs'
import { postprocessRecording } from './speedup.mjs'
import { runGuardrails, formatReport } from './guardrails.mjs'
import { loadPreset, resolveWallpaper } from './presets.mjs'
import { assertCaptureStats } from './capture-gate.mjs'

function ffprobeDuration(path) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' })
  const n = parseFloat(r.stdout?.trim())
  if (!Number.isFinite(n)) throw new Error(`ffprobe could not read duration of ${path}`)
  return n
}

/**
 * Composes `raw.mp4` + `timeline.json` (both in `renderDir`) into `final.mp4`,
 * and copies it to `out` if given. Writes `zoom-plan.json` alongside for
 * verify.mjs and for the agent to sanity-check before/after rendering.
 */
export async function composeFilm(renderDir, options = {}) {
  const preset = loadPreset(options.preset ?? 'macos-dark')
  const {
    out,
    canvasW = 1920,
    canvasH = 1080,
    padX = 96,
    padY = 96,
    fps = 30,
    styledFrame = true,
    background = preset.background,
    borderColor = preset.borderColor,
    shadowOpacity = preset.shadowOpacity,
    wallpaper = preset.wallpaper ?? null,
    wallpaperDim = preset.wallpaperDim ?? 0.35,
    wallpaperBlur = preset.wallpaperBlur ?? 0,
    radius = preset.radius ?? 0,
    titlebarHeight = preset.titlebarHeight ?? 0,
    titlebarColor = preset.titlebarColor,
    trafficLights = preset.trafficLights ?? true,
    trafficLightColors = preset.trafficLightColors,
    skipSpeedup = false,
    speedupConfig,
    ...zoomOpts
  } = options

  assertCaptureStats(renderDir)

  const rawPath = rawVideoPath(renderDir)
  const timelinePath = join(renderDir, 'timeline.json')
  if (!existsSync(rawPath)) throw new Error(`Missing ${rawPath} — did the record step finish and assemble the capture?`)
  if (!existsSync(timelinePath)) throw new Error(`Missing ${timelinePath} — did run.mjs call timeline.dump()?`)

  let data = JSON.parse(readFileSync(timelinePath, 'utf8'))
  if (!skipSpeedup) {
    data = postprocessRecording(renderDir, data, speedupConfig ?? {}, (msg) => console.log(`[speedup] ${msg}`))
  }
  const events = data.events
  const duration = ffprobeDuration(rawPath)
  const { width: sourceW, height: sourceH } = FILM_VIEWPORT

  const shots = buildZoomPlan(events, duration, sourceW, sourceH, zoomOpts)
  writeFileSync(join(renderDir, 'zoom-plan.json'), JSON.stringify(shots, null, 2), 'utf8')

  const contentW = styledFrame ? canvasW - 2 * padX : canvasW
  const contentH = styledFrame ? canvasH - 2 * padY : canvasH

  const zoomedPath = join(renderDir, 'zoomed.mp4')
  renderZoomed(rawPath, shots, zoomedPath, { sourceW, sourceH, outW: contentW, outH: contentH, fps })

  const finalPath = join(renderDir, 'final.mp4')
  if (styledFrame) {
    await applyStyledFrame(zoomedPath, finalPath, {
      canvasW, canvasH, padX, padY, fps, background, borderColor, shadowOpacity,
      wallpaper: resolveWallpaper(wallpaper), wallpaperDim, wallpaperBlur,
      radius, titlebarHeight, titlebarColor, trafficLights, trafficLightColors,
      durationSec: duration,
    })
  } else {
    copyFileSync(zoomedPath, finalPath)
  }

  // Guardrails run automatically so every compose ends with the camera plan +
  // alert list in front of the agent (also saved to guardrails-report.json).
  const guardrails = runGuardrails(renderDir)
  console.log('\n' + formatReport(guardrails) + '\n')

  let outPath = null
  if (out) {
    outPath = resolve(out)
    mkdirSync(dirname(outPath), { recursive: true })
    copyFileSync(finalPath, outPath)
  }

  return { finalPath, outPath, shots, durationSec: duration, guardrails }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const renderDir = args[0]
  const outIdx = args.indexOf('--out')
  const out = outIdx >= 0 ? args[outIdx + 1] : undefined
  const noFrame = args.includes('--no-frame')
  const skipSpeedup = args.includes('--no-speedup')
  const presetIdx = args.indexOf('--preset')
  const preset = presetIdx >= 0 ? args[presetIdx + 1] : 'macos-dark'
  // --speedup key=value[,key=value…] e.g. --speedup idleGapMin=9999,toolWaitMax=6
  // (narrated videos disable idle compression to protect narration holds)
  const speedupIdx = args.indexOf('--speedup')
  let speedupConfig
  if (speedupIdx >= 0) {
    speedupConfig = Object.fromEntries(
      args[speedupIdx + 1].split(',').map((pair) => {
        const [k, v] = pair.split('=')
        return [k, Number(v)]
      }),
    )
  }
  // Chrome overrides — usually set via --preset (macos-dark/macos-light/rounded-dark)
  // instead, but exposed individually for one-off tweaks. See docs/CONFIG.md.
  const opt = (flag) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const wallpaper = opt('--wallpaper')
  const radiusArg = opt('--radius')
  const radius = radiusArg !== undefined ? Number(radiusArg) : undefined
  const titlebar = args.includes('--titlebar') ? true : args.includes('--no-titlebar') ? false : undefined
  const titlebarHeightArg = opt('--titlebar-height')
  const titlebarColor = opt('--titlebar-color')
  const trafficLights = args.includes('--traffic-lights') ? true : args.includes('--no-traffic-lights') ? false : undefined
  const trafficLightColorsArg = opt('--traffic-light-colors') // e.g. "#ff5f57,#febc2e,#28c840"
  const wallpaperDimArg = opt('--wallpaper-dim')
  const wallpaperBlurArg = opt('--wallpaper-blur')

  if (!renderDir) {
    console.error(
      'Usage: node compose.mjs <renderDir> [--out <path>] [--preset name] [--no-frame] [--no-speedup] [--speedup k=v,…]\n' +
        '                        [--wallpaper name|path] [--wallpaper-dim 0-1] [--wallpaper-blur px]\n' +
        '                        [--radius px] [--titlebar|--no-titlebar] [--titlebar-height px] [--titlebar-color css]\n' +
        '                        [--traffic-lights|--no-traffic-lights] [--traffic-light-colors "#hex,#hex,#hex"]',
    )
    process.exit(1)
  }
  const result = await composeFilm(renderDir, {
    out, preset, styledFrame: !noFrame, skipSpeedup, speedupConfig,
    ...(wallpaper !== undefined ? { wallpaper } : {}),
    ...(radius !== undefined ? { radius } : {}),
    ...(titlebarHeightArg !== undefined ? { titlebarHeight: Number(titlebarHeightArg) } : titlebar === true ? { titlebarHeight: 40 } : titlebar === false ? { titlebarHeight: 0 } : {}),
    ...(titlebarColor !== undefined ? { titlebarColor } : {}),
    ...(trafficLights !== undefined ? { trafficLights } : {}),
    ...(trafficLightColorsArg !== undefined ? { trafficLightColors: trafficLightColorsArg.split(',') } : {}),
    ...(wallpaperDimArg !== undefined ? { wallpaperDim: Number(wallpaperDimArg) } : {}),
    ...(wallpaperBlurArg !== undefined ? { wallpaperBlur: Number(wallpaperBlurArg) } : {}),
  })
  console.log(JSON.stringify({ final: result.finalPath, out: result.outPath, shots: result.shots.length, durationSec: result.durationSec, alerts: result.guardrails.alerts.length }, null, 2))
}
