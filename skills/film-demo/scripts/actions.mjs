import { sleep, pause, smoothScroll } from './motion.mjs'
import { cropForZone } from './zoomplan.mjs'
import { FILM_VIEWPORT } from './record.mjs'
import { animateFilmCursor } from './film-cursor.mjs'

/**
 * Film actions — every beat logs timeline events for the zoom compositor,
 * the speed-up pass and the guardrails.
 *
 * CAMERA MODEL (zone-based):
 * - The camera moves ONLY on `focus(zone)` / `wide()`. Clicks and typing never
 *   zoom by themselves; they only log events used for cursor tracking,
 *   activity detection (speed-ups) and guardrails.
 * - `focus()` takes a Locator (or a raw box): the crop is computed so the whole
 *   zone fits with padding — containment is guaranteed by construction.
 * - Clicking a target outside the current focus zone's crop raises a record-time
 *   warning (and an `alert` event) — call `wide()` or re-`focus()` first.
 *
 * Every cursor movement step is traced into timeline.cursor, so guardrails.mjs
 * can verify "cursor inside the visible crop" for every frame of the final video.
 */

async function freshBox(locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {})
  await pause(150)
  return locator.boundingBox().catch(() => null)
}

function normBox(box) {
  if (!box) return null
  return { x: box.x, y: box.y, w: box.width ?? box.w, h: box.height ?? box.h }
}

/**
 * Smooth eased cursor move, traced into the timeline for guardrails.
 * Ease-out cubic — the SAME curve the camera uses (zoompan-expr.mjs).
 *
 * Motion runs inside the page at compositor rate (requestAnimationFrame in
 * film-cursor.mjs) rather than stepping Playwright's mouse.move() from Node
 * (each round-trip is ~30-80ms, i.e. ~10-15 effective Hz and choppy video).
 * Playwright's mouse jumps to the destination once, after the animation, so
 * hover/click targets stay correct.
 */
export async function filmMove(page, timeline, x, y) {
  const from = timeline.state.cursorPos
  const dist = Math.hypot(x - from.x, y - from.y)
  if (dist < 2) {
    timeline.trackCursor(x, y)
    page.__filmCursorPos = { x, y }
    return
  }
  const durMs = Math.max(280, Math.min(780, 240 + dist * 0.4))
  const durSec = durMs / 1000
  timeline.trackCursorPath(from.x, from.y, x, y, durSec)
  await animateFilmCursor(page, from.x, from.y, x, y, durMs)
  await page.mouse.move(x, y).catch(() => {})
  page.__filmCursorPos = { x, y }
}

function pointInCrop(crop, x, y) {
  return x >= crop.x && x <= crop.x + crop.w && y >= crop.y && y <= crop.y + crop.h
}

/** Record-time guardrail: warn when an action target sits outside the focused crop. */
function warnIfOutsideZone(timeline, box, label) {
  const zone = timeline.state.zone
  if (!zone || !box) return
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  if (!pointInCrop(zone.crop, cx, cy)) {
    const msg = `"${label}" target (${Math.round(cx)},${Math.round(cy)}) is outside focus zone "${zone.label}" — wide() or focus() first`
    console.warn(`[film][guardrail] ${msg}`)
    timeline.mark('alert', msg)
  }
}

/**
 * ZOOM IN: declare the region that must be fully visible from now on.
 * `target` = Playwright Locator or raw box {x,y,width,height}. Nudges the cursor
 * into the crop first so it can never be stranded outside the zoomed frame.
 */
export async function focus(page, timeline, target, label, opts) {
  const box = normBox(typeof target?.boundingBox === 'function' ? await freshBox(target) : target)
  if (!box || box.w <= 0 || box.h <= 0) {
    timeline.mark('alert', `focus "${label}" got no box — staying wide`)
    return
  }
  const crop = cropForZone(box, FILM_VIEWPORT.width, FILM_VIEWPORT.height, opts)
  const p = timeline.state.cursorPos
  const tDepart = timeline.now()
  if (!pointInCrop(crop, p.x, p.y)) {
    await filmMove(page, timeline, box.x + box.w / 2, box.y + box.h / 2)
  }
  const tArrive = timeline.now()
  timeline.state.zone = { ...box, crop, label }
  timeline.shot('focus', label, box, { tDepart, tArrive })
  await pause(250)
}

/**
 * ZOOM OUT to the full frame. Call it after every focused beat that has ended.
 * First pulls the cursor back to the center of the current crop — a natural
 * "step back" gesture that also guarantees the cursor stays inside every
 * intermediate crop of the zoom-out transition (the crop only grows around
 * that center, so the cursor can never fall off an edge mid-pan).
 */
export async function wide(page, timeline, label = 'wide') {
  const zone = timeline.state.zone
  const tDepart = timeline.now()
  if (zone) {
    await filmMove(page, timeline, zone.crop.x + zone.crop.w / 2, zone.crop.y + zone.crop.h / 2)
  }
  const tArrive = timeline.now()
  timeline.state.zone = null
  timeline.shot('wide', label, null, { tDepart, tArrive })
  await pause(250)
}

/**
 * Quick scan for visible error UI after an action — raises a timeline alert
 * (surfaced by guardrails) so a broken take is caught instead of shipped.
 */
async function guardErrorUI(page, timeline, label) {
  const found = await page
    .locator('text=/\\b(error|failed|something went wrong)\\b/i')
    .first()
    .isVisible({ timeout: 60 })
    .catch(() => false)
  if (found) {
    const msg = `error text visible on screen after "${label}" — the take is broken, re-record`
    console.warn(`[film][guardrail] ${msg}`)
    timeline.mark('alert', msg)
  }
}

/**
 * Full click sequence with explicit depart/arrive timestamps. Does NOT zoom.
 * The press is a real mousedown → 90ms → mouseup, so the pointer's press
 * animation (film-cursor.mjs) fires exactly once, with the actual click.
 */
async function filmClick(page, timeline, locator, label, { hoverMs = 420, afterMs = 650 } = {}) {
  const box = normBox(await freshBox(locator))
  if (!box) throw new Error(`Element not visible for click: ${label}`)
  warnIfOutsideZone(timeline, box, label)
  const x = box.x + box.w / 2
  const y = box.y + box.h / 2
  const tDepart = timeline.now()
  await filmMove(page, timeline, x, y)
  await pause(hoverMs)
  await page.mouse.down()
  await sleep(90)
  await page.mouse.up()
  const tArrive = timeline.now()
  await pause(afterMs)
  return { box, tDepart, tArrive }
}

/**
 * Options:
 * - `expect`: Locator that MUST become visible after the click (fail-fast —
 *   a click that visibly did nothing means a broken take, not a longer wait).
 * - `expectTimeout`: ms for the expectation (default 8000).
 */
export async function click(page, timeline, locator, label, opts = {}) {
  const { box, tDepart, tArrive } = await filmClick(page, timeline, locator, label, opts)
  timeline.shot('click', label, box, { tDepart, tArrive })
  if (opts.expect) {
    await opts.expect.waitFor({ state: 'visible', timeout: opts.expectTimeout ?? 8000 }).catch(() => {
      throw new Error(`click "${label}": expected element did not appear — restart the take`)
    })
  }
  await guardErrorUI(page, timeline, label)
}

/** Human-speed typing — never `.fill()` or clipboard paste for visible prompts. */
export async function type(page, timeline, locator, text, label, { delay = 38, hoverMs = 280, afterMs = 400 } = {}) {
  const { box, tDepart, tArrive } = await filmClick(page, timeline, locator, label, { hoverMs, afterMs: 180 })
  await locator.pressSequentially(text, { delay })
  await pause(afterMs)
  // t (logged now) = end of typing; [tDepart, t] is the full activity window.
  timeline.shot('type', label, box, { tDepart, tArrive })
}

/** Short fields only (name, email) — still typed, slightly faster. */
export async function fill(page, timeline, locator, text, label, { delay = 55, ...opts } = {}) {
  const { box, tDepart, tArrive } = await filmClick(page, timeline, locator, label, { hoverMs: 250, afterMs: 120, ...opts })
  await locator.pressSequentially(text, { delay })
  timeline.shot('fill', label, box, { tDepart, tArrive })
}

export async function scroll(page, timeline, deltaY, label, opts) {
  const tDepart = timeline.now()
  await smoothScroll(page, deltaY, { steps: 18, stepMs: 70, ...opts })
  timeline.mark('scroll', label, { tDepart })
}

export function open(timeline, label) {
  timeline.mark('open', label)
}

export function loadingStart(timeline, label) {
  timeline.mark('loading-start', label)
}

export function loadingEnd(timeline, label) {
  timeline.mark('loading-end', label)
}

/**
 * Something appeared on screen without a click (tool card, panel, result).
 * Nudges the cursor toward it (presenter gesture + keeps the cursor in any
 * focused crop). Pair with `done()` so the speed-up pass can compress the wait.
 */
export async function appear(page, timeline, label, box) {
  const b = normBox(box)
  const tDepart = timeline.now()
  if (b) await filmMove(page, timeline, b.x + b.w / 2, b.y + b.h / 2)
  const tArrive = timeline.now()
  timeline.shot('appear', label, b, { tDepart, tArrive })
}

export async function done(page, timeline, label, box) {
  const b = normBox(box)
  const tDepart = timeline.now()
  if (b) await filmMove(page, timeline, b.x + b.w / 2, b.y + b.h / 2)
  const tArrive = timeline.now()
  timeline.shot('done', `${label}-done`, b, { tDepart, tArrive })
}

/**
 * Waits until the page is visually at rest: network idle AND no spinner /
 * loading indicator visible. Call before the FIRST beat (the video must open
 * on a fully loaded screen — the lead trim drops everything before the first
 * event) and after any navigation that precedes a beat.
 */
export async function settle(page, { timeout = 20000 } = {}) {
  const deadline = Date.now() + timeout
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {})
  const busy = page.locator('.animate-spin, [aria-busy="true"], text=/^(Loading|Authenticating|Fetching)/i').first()
  while (Date.now() < deadline) {
    const visible = await busy.isVisible({ timeout: 60 }).catch(() => false)
    if (!visible) break
    await sleep(250)
  }
  await pause(300)
}
