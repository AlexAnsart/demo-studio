/**
 * Rich "window chrome" assets for the styled frame — wallpaper background,
 * rounded window corners, macOS-style title bar + traffic-light dots. Used by
 * `render.mjs` (`applyStyledFrame`) only when a preset/config actually asks
 * for one of these (see `presets.mjs` and docs/CONFIG.md `frame.*` fields) —
 * the plain solid-background + square-border path in `render.mjs` never
 * touches this file, so existing presets render byte-identical to before.
 *
 * All assets are pre-rendered once per compose with `sharp` (SVG → PNG, plus
 * a raw pixel buffer for the wallpaper dim layer), then composited onto the
 * video by `render.mjs`'s ffmpeg filter graph — sharp never touches video.
 */
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import sharp from 'sharp'

/** SVG path for a rectangle with an independent corner radius per corner
 * (0 = square). Used for both the content mask and the chrome overlay so a
 * title bar's rounded top / square bottom lines up pixel-for-pixel with the
 * content area's square top / rounded bottom right below it. */
export function roundedRectPath(w, h, { tl = 0, tr = 0, br = 0, bl = 0 } = {}) {
  const clamp = (r) => Math.max(0, Math.min(r, w / 2, h / 2))
  tl = clamp(tl)
  tr = clamp(tr)
  br = clamp(br)
  bl = clamp(bl)
  return [
    `M ${tl} 0`,
    `H ${w - tr}`,
    tr ? `A ${tr} ${tr} 0 0 1 ${w} ${tr}` : '',
    `V ${h - br}`,
    br ? `A ${br} ${br} 0 0 1 ${w - br} ${h}` : '',
    `H ${bl}`,
    bl ? `A ${bl} ${bl} 0 0 1 0 ${h - bl}` : '',
    `V ${tl}`,
    tl ? `A ${tl} ${tl} 0 0 1 ${tl} 0` : '',
    'Z',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Builds `.chrome-mask.png` (content rounding, contentW x contentH) and
 * `.chrome-overlay.png` (title bar + dots + border, windowW x windowH) into
 * `renderDir`. The title bar occupies the bottom `titlebarHeight` px of the
 * top padding — it does not shrink the content area, so callers don't need
 * to change `contentW`/`contentH` math elsewhere.
 */
export async function buildChromeAssets(renderDir, opts) {
  const {
    contentW,
    contentH,
    radius = 0,
    titlebarHeight = 0,
    titlebarColor = 'rgba(22,22,27,0.94)',
    trafficLights = true,
    trafficLightColors = ['#ff5f57', '#febc2e', '#28c840'],
    borderColor = 'rgba(255,255,255,0.16)',
    borderWidth = 1,
  } = opts

  const hasTitlebar = titlebarHeight > 0
  const windowW = contentW
  const windowH = contentH + titlebarHeight

  const maskPathD = roundedRectPath(contentW, contentH, {
    tl: hasTitlebar ? 0 : radius,
    tr: hasTitlebar ? 0 : radius,
    bl: radius,
    br: radius,
  })
  const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${contentW}" height="${contentH}"><path d="${maskPathD}" fill="#fff"/></svg>`

  const dotsSvg = trafficLights
    ? trafficLightColors.map((c, i) => `<circle cx="${24 + i * 22}" cy="${titlebarHeight / 2}" r="6.5" fill="${c}"/>`).join('')
    : ''
  const titlebarSvg = hasTitlebar
    ? `<path d="${roundedRectPath(windowW, titlebarHeight, { tl: radius, tr: radius })}" fill="${titlebarColor}"/>${dotsSvg}`
    : ''
  const borderSvg =
    borderWidth > 0
      ? `<path d="${roundedRectPath(windowW, windowH, { tl: radius, tr: radius, bl: radius, br: radius })}" fill="none" stroke="${borderColor}" stroke-width="${borderWidth}"/>`
      : ''
  const chromeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${windowW}" height="${windowH}">${titlebarSvg}${borderSvg}</svg>`

  mkdirSync(renderDir, { recursive: true })
  const maskPath = join(renderDir, '.chrome-mask.png')
  const chromePath = join(renderDir, '.chrome-overlay.png')
  await sharp(Buffer.from(maskSvg)).png().toFile(maskPath)
  await sharp(Buffer.from(chromeSvg)).png().toFile(chromePath)

  return { maskPath, chromePath, windowW, windowH }
}

/**
 * Soft drop shadow matching the window's rounded shape — avoids the square
 * lavfi shadow bleeding past rounded corners (the dark "wings" artifact).
 */
export async function buildRoundedShadow(renderDir, {
  windowW,
  windowH,
  radius = 0,
  shadowOpacity = 0.55,
  shadowPad = 24,
  shadowDrop = 16,
}) {
  const pad = shadowPad
  const drop = shadowDrop
  const canvasW = windowW + 2 * pad
  const canvasH = windowH + 2 * pad + drop
  const pathD = roundedRectPath(windowW, windowH, { tl: radius, tr: radius, bl: radius, br: radius })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">
    <path d="${pathD}" fill="rgba(0,0,0,${shadowOpacity})" transform="translate(${pad}, ${pad + drop})"/>
  </svg>`
  const outPath = join(renderDir, '.chrome-shadow.png')
  await sharp(Buffer.from(svg)).blur(22).png().toFile(outPath)
  return { shadowPath: outPath, shadowW: canvasW, shadowH: canvasH, shadowPad: pad, shadowDrop: drop }
}

/**
 * Builds `.chrome-bg.png` (canvasW x canvasH) from a wallpaper image: cover-fit
 * crop, optional blur, optional dark dim layer (keeps window chrome legible
 * against a busy wallpaper).
 */
export async function buildWallpaperBg(renderDir, { wallpaperFile, canvasW, canvasH, dim = 0.35, blurPx = 0 }) {
  // Cover-fit at 108% then centre-crop — guarantees edge-to-edge fill with no black bands.
  const ow = Math.ceil(canvasW * 1.08)
  const oh = Math.ceil(canvasH * 1.08)
  let img = sharp(wallpaperFile).resize(ow, oh, { fit: 'cover', position: 'centre' })
  if (blurPx > 0) img = img.blur(blurPx)
  let buf = await img
    .extract({
      left: Math.max(0, Math.floor((ow - canvasW) / 2)),
      top: Math.max(0, Math.floor((oh - canvasH) / 2)),
      width: canvasW,
      height: canvasH,
    })
    .png()
    .toBuffer()
  if (dim > 0) {
    const dimLayer = await sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: dim } } })
      .png()
      .toBuffer()
    buf = await sharp(buf).composite([{ input: dimLayer }]).png().toBuffer()
  }
  const outPath = join(renderDir, '.chrome-bg.png')
  writeFileSync(outPath, buf)
  return outPath
}
