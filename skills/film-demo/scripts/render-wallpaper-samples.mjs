#!/usr/bin/env node
/**
 * Renders a short macos-dark chrome sample for every *.png in assets/wallpapers/.
 * Usage: node render-wallpaper-samples.mjs [renderDir] [--sec 10]
 *
 * Output: examples/hello-demo/wallpaper-samples/<name>.mp4
 */
import { spawnSync } from 'child_process'
import { mkdirSync, readdirSync } from 'fs'
import { dirname, join, basename } from 'path'
import { fileURLToPath } from 'url'
import { applyStyledFrame } from './render.mjs'
import { loadPreset, resolveWallpaper } from './presets.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WALLPAPERS_DIR = join(__dirname, '..', 'assets', 'wallpapers')
const repoRoot = join(__dirname, '..', '..', '..')
const outDir = join(repoRoot, 'examples', 'hello-demo', 'wallpaper-samples')

const args = process.argv.slice(2)
const secIdx = args.indexOf('--sec')
const onlyIdx = args.indexOf('--only')
const sampleSec = secIdx >= 0 ? Number(args[secIdx + 1]) : 10
const onlySet = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',').map((s) => s.trim())) : null
const renderDir = args.find((a, i) => !a.startsWith('--') && a !== String(sampleSec) && (onlyIdx < 0 || i !== onlyIdx + 1)) ?? join(repoRoot, 'examples', 'hello-demo', 'renders', '006')

function ffprobeDuration(path) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' })
  return parseFloat(r.stdout?.trim())
}

const zoomedPath = join(renderDir, 'preview-zoomed.mp4')
const rawPath = join(renderDir, 'raw.mp4')
if (!ffprobeDuration(zoomedPath) && !ffprobeDuration(rawPath)) {
  console.error(`Missing preview-zoomed.mp4 or raw.mp4 in ${renderDir} — run hello-demo first`)
  process.exit(1)
}

const duration = Math.min(ffprobeDuration(zoomedPath) || ffprobeDuration(rawPath), sampleSec)
const preset = loadPreset('macos-dark')
const canvasW = 1920, canvasH = 1080, padX = 96, padY = 96, fps = 30

mkdirSync(outDir, { recursive: true })

const wallpapers = readdirSync(WALLPAPERS_DIR)
  .filter((f) => f.endsWith('.png'))
  .map((f) => basename(f, '.png'))
  .filter((n) => !onlySet || onlySet.has(n))
  .sort()

console.log(`Rendering ${wallpapers.length} wallpaper samples (${duration}s each) → ${outDir}\n`)

const results = []
for (const name of wallpapers) {
  const outPath = join(outDir, `${name}.mp4`)
  process.stdout.write(`${name}… `)
  try {
    const wp = resolveWallpaper(name)
    await applyStyledFrame(zoomedPath, outPath, {
      canvasW, canvasH, padX, padY, fps,
      background: preset.background,
      borderColor: preset.borderColor,
      shadowOpacity: preset.shadowOpacity,
      wallpaper: wp,
      wallpaperDim: preset.wallpaperDim,
      wallpaperBlur: preset.wallpaperBlur,
      radius: preset.radius ?? 0,
      titlebarHeight: preset.titlebarHeight ?? 0,
      titlebarColor: preset.titlebarColor,
      trafficLights: preset.trafficLights ?? true,
      trafficLightColors: preset.trafficLightColors,
      durationSec: duration,
    })
    console.log('ok')
    results.push({ name, ok: true, path: outPath })
  } catch (err) {
    console.log(`FAIL — ${err.message}`)
    results.push({ name, ok: false, error: err.message })
  }
}

const ok = results.filter((r) => r.ok).length
console.log(`\nDone: ${ok}/${wallpapers.length} samples in ${outDir}`)
if (ok < wallpapers.length) process.exit(1)
