import { join } from 'path'
import { existsSync } from 'fs'
import { installFilmCursor, resyncFilmCursor } from './film-cursor.mjs'
import { startRecording, stopRecording } from './screencast.mjs'

/**
 * Recorded larger than the final 1920x1080 canvas so the zoom compositor has
 * headroom to crop in without visible blur. Override via `viewport` in
 * `createFilmContext` if your app needs a different capture size — keep
 * `compose()`'s `canvasW/canvasH` in sync if you do.
 */
export const FILM_VIEWPORT = { width: 1920, height: 1080 }

/**
 * NOTE: no `recordVideo` here — capture is done by screencast.mjs (CDP
 * screencast → CFR raw.mp4), started explicitly with
 * `startFilmRecording(page, renderDir, timeline)` once the page is prepared.
 */
export async function createFilmContext(browser, renderDir, { storageState, viewport = FILM_VIEWPORT } = {}) {
  return browser.newContext({
    viewport,
    locale: 'en-US',
    storageState,
  })
}

export async function prepareFilmPage(page, cursorOpts) {
  await installFilmCursor(page, cursorOpts)
  page.__filmCursorPos = { x: 960, y: 540 }
  // A navigation creates a fresh document whose cursor mounts at the default
  // center position — restore the last known position so the pointer never
  // visibly teleports after a reload / route change.
  page.on('framenavigated', async (frame) => {
    if (frame !== page.mainFrame()) return
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 })
      await resyncFilmCursor(page)
    } catch {
      /* page may be closing */
    }
  })
  page.setDefaultTimeout(20000)
}

/**
 * Starts the screencast capture. Call AFTER prepareFilmPage and AFTER creating
 * the timeline — it re-anchors the timeline epoch so video time == event time.
 */
export async function startFilmRecording(page, renderDir, timeline, opts) {
  return startRecording(page, renderDir, timeline, opts)
}

/**
 * Stops capture, assembles raw.mp4, then closes page + context.
 * Returns { rawPath, ok, frameCount, capturedFps }.
 */
export async function finishFilmRecording(context, page, renderDir, recorder) {
  let result = { rawPath: join(renderDir, 'raw.mp4'), ok: false, frameCount: 0, capturedFps: 0 }
  if (recorder) {
    try {
      result = await stopRecording(recorder, renderDir)
    } catch (err) {
      console.error(`[record] stopRecording failed: ${err.message}`)
    }
  }
  await page.close().catch(() => {})
  await context.close().catch(() => {})
  return result
}

/** The raw capture for a render — raw.mp4 (current) or raw.webm (legacy renders). */
export function rawVideoPath(renderDir) {
  const mp4 = join(renderDir, 'raw.mp4')
  if (existsSync(mp4)) return mp4
  return join(renderDir, 'raw.webm')
}
