/**
 * Generates abstract mesh-gradient wallpapers (PNG) for use as `frame.wallpaper`
 * backgrounds — see `presets.mjs` and `chrome.mjs`. Fully synthetic (SVG blurred
 * radial blobs rasterized with sharp), so every bundled wallpaper in
 * `../assets/wallpapers/` is safe to redistribute in this MIT repo: no stock
 * photos, no attribution, no network fetch at render time, crisp at any size.
 *
 * Bring your own wallpaper instead: `frame.wallpaper` accepts any image path.
 *
 * Usage: node generate-wallpaper.mjs --out my.png --colors "#1a1033,#7c3aed,#ec4899" [--bg "#05030a"] [--w 1920] [--h 1080]
 */
import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { pathToFileURL } from 'url'
import sharp from 'sharp'

/** Deterministic pseudo-random in [0,1) from a seed + index (no RNG state, so
 * the same call always produces the same wallpaper). */
function hashUnit(seed, i) {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** A handful of off-center, varied-size blurred blobs on a dark base, plus a
 * vignette for depth — the "macOS mesh wallpaper" look. Positions/sizes vary
 * deterministically per `seed` so the bundled set (different seeds) looks
 * distinct instead of a single washed-out glow. */
function meshGradientSvg(w, h, { bg, colors, seed = 0 }) {
  const blobs = colors.map((color, i) => {
    const rx = 0.18 + hashUnit(seed, i * 2) * 0.64 // 0.18–0.82 of width
    const ry = 0.15 + hashUnit(seed, i * 2 + 1) * 0.7 // 0.15–0.85 of height
    const cx = rx * w
    const cy = ry * h
    const r = Math.max(w, h) * (0.32 + hashUnit(seed, i * 3 + 5) * 0.16)
    const opacity = 0.42 + hashUnit(seed, i * 5 + 9) * 0.16
    return `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(0)}" fill="${color}" opacity="${opacity.toFixed(2)}"/>`
  })
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <filter id="soften" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="${Math.max(w, h) * 0.07}" />
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="${bg}" />
  <g filter="url(#soften)">${blobs.join('')}</g>
</svg>`
}

/** Flowing layered wave ribbons — Recordly / Screen Studio style. Full-canvas
 * colour base (no edge vignette) so cover-crop never shows black bands. */
function waveRibbonSvg(w, h, { bg, colors, seed = 0, layers = 6 }) {
  const paths = []
  for (let i = 0; i < layers; i++) {
    const color = colors[i % colors.length]
    const yBase = h * (0.15 + hashUnit(seed, i) * 0.7)
    const amp = h * (0.06 + hashUnit(seed, i + 10) * 0.14)
    const freq = 0.8 + hashUnit(seed, i + 20) * 2.2
    const phase = hashUnit(seed, i + 30) * Math.PI * 2
    const opacity = 0.3 + hashUnit(seed, i + 40) * 0.35
    let d = `M 0 ${(yBase - amp).toFixed(1)}`
    const steps = 16
    for (let s = 1; s <= steps; s++) {
      const x = (w / steps) * s
      const t = (s / steps) * Math.PI * 2 * freq + phase
      const y = yBase + Math.sin(t) * amp + Math.sin(t * 0.5 + i) * amp * 0.35
      const cpx = x - w / steps / 2
      const cpy = y
      d += ` Q ${cpx.toFixed(1)} ${cpy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`
    }
    d += ` L ${w} ${h} L 0 ${h} Z`
    paths.push(`<path d="${d}" fill="${color}" opacity="${opacity.toFixed(2)}"/>`)
  }
  const c0 = colors[0]
  const c1 = colors[Math.min(1, colors.length - 1)]
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="base" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c0}" stop-opacity="0.55"/>
      <stop offset="50%" stop-color="${c1}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${bg}"/>
    </linearGradient>
    <filter id="blur" x="-15%" y="-15%" width="130%" height="130%">
      <feGaussianBlur stdDeviation="${Math.max(w, h) * 0.022}" />
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="${bg}"/>
  <rect width="${w}" height="${h}" fill="url(#base)"/>
  <g filter="url(#blur)">${paths.join('')}</g>
</svg>`
}

/** Independent per-pixel grayscale noise at a low, constant alpha — breaks up
 * the 8-bit banding (Mach bands) that soft radial gradients otherwise show,
 * especially in low-contrast palettes. SVG `feTurbulence` is unreliable across
 * SVG rasterizers, so this is done directly as a raw pixel buffer instead. */
function noiseLayerBuffer(w, h, alpha = 10) {
  const buf = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const v = Math.floor(Math.random() * 256)
    const o = i * 4
    buf[o] = v
    buf[o + 1] = v
    buf[o + 2] = v
    buf[o + 3] = alpha
  }
  return buf
}

export async function generateMeshWallpaper(outPath, { bg = '#05030a', colors, seed = 0, width = 1920, height = 1080 } = {}) {
  if (!colors?.length) throw new Error('generateMeshWallpaper requires colors: [hex, ...]')
  const svg = meshGradientSvg(width, height, { bg, colors, seed })
  return rasterizeWallpaper(outPath, svg, width, height)
}

export async function generateWaveWallpaper(outPath, { bg = '#05030a', colors, seed = 0, width = 1920, height = 1080, layers = 5 } = {}) {
  if (!colors?.length) throw new Error('generateWaveWallpaper requires colors: [hex, ...]')
  const svg = waveRibbonSvg(width, height, { bg, colors, seed, layers })
  return rasterizeWallpaper(outPath, svg, width, height)
}

async function rasterizeWallpaper(outPath, svg, width, height) {
  const base = sharp(Buffer.from(svg))
  const noise = noiseLayerBuffer(width, height, 8)
  mkdirSync(dirname(outPath), { recursive: true })
  await base
    .composite([{ input: noise, raw: { width, height, channels: 4 }, blend: 'over' }])
    .png({ compressionLevel: 9 })
    .toFile(outPath)
  return outPath
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const opt = (flag, fallback) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : fallback
  }
  const out = opt('--out')
  const colors = opt('--colors', '').split(',').filter(Boolean)
  if (!out || !colors.length) {
    console.error('Usage: node generate-wallpaper.mjs --out my.png --colors "#hex,#hex,..." [--bg #hex] [--w 1920] [--h 1080] [--seed 0]')
    process.exit(1)
  }
  await generateMeshWallpaper(out, {
    bg: opt('--bg', '#05030a'),
    colors,
    seed: Number(opt('--seed', '0')),
    width: Number(opt('--w', '1920')),
    height: Number(opt('--h', '1080')),
  })
  console.log(out)
}
