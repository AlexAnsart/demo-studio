/**
 * Reference run.mjs — adapt paths, selectors, and beats to your app.
 * demo-setup copies this to demos/<slug>/run.mjs and trims what you don't need.
 *
 * Narrated compose (after record):
 *   node demos/_engine/compose.mjs <renderDir> --speedup idleGapMin=9999,toolWaitMax=2.5,preToolWaitMax=2,tailHold=4
 *
 * BEAT PLAN (fill after align-narration.py for narrated videos)
 * #  sentence                         dur    beat                 min hold
 * 1  "Here's the task board…"         2.4s   wide establish       3.5s
 * 2  "Type what you need…"            5.1s   type + add           6.5s
 * 3  "No reload — the list…"          3.8s   focus payoff         5.0s
 */
import { readFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'
import { loadConfig } from '../../_engine/config.mjs'
import { createTimeline } from '../../_engine/timeline.mjs'
import { createFilmContext, prepareFilmPage, startFilmRecording, finishFilmRecording } from '../../_engine/record.mjs'
import { click, type, focus, wide, appear, done, settle } from '../../_engine/actions.mjs'
import { pause } from '../../_engine/motion.mjs'
import { nextRenderDir, initRunLog, logRun } from '../_lib/paths.mjs'
import { buildDemoSession, waitForAppReady } from '../_lib/auth.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const config = loadConfig(process.cwd())

async function holdMin(sec, label, renderDir) {
  await pause(Math.max(0, Math.round(sec * 1000)))
  logRun(`Hold "${label}" ${sec}s`, renderDir)
}

async function main() {
  const baseUrl = process.env.DEMO_BASE_URL ?? config.app.baseUrl
  const { dir: renderDir } = nextRenderDir(__dirname)
  initRunLog(renderDir)
  logRun(`Base URL: ${baseUrl}`, renderDir)
  logRun(`Render → ${renderDir}`, renderDir)

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })

  let storageState
  if (config.auth?.loginRequired) {
    logRun('Warmup login off-camera', renderDir)
    storageState = await buildDemoSession(browser, { baseUrl })
  }

  const context = await createFilmContext(browser, renderDir, { storageState })
  const page = await context.newPage()
  await prepareFilmPage(page, config.cursor)

  // --- Preload off-camera BEFORE recording (first filmed event = first Show beat) ---
  await page.goto(baseUrl, { waitUntil: 'commit' })
  await waitForAppReady(page)
  await settle(page)

  const timeline = createTimeline()
  const recorder = await startFilmRecording(page, renderDir, timeline)

  // Beat 1: establish
  await wide(page, timeline, 'establish')
  await holdMin(3.5, 'sentence-1', renderDir)

  // Beat 2: type + submit (adjust selectors)
  const input = page.locator('#task-input') // TODO: your selector
  await focus(page, timeline, input, 'composer')
  await type(page, timeline, input, 'Ship the v1 release', 'task-text')
  await click(page, timeline, page.locator('#add-btn'), 'add', {
    expect: page.locator('li', { hasText: 'Ship the v1 release' }),
  })
  await wide(page, timeline, 'list-updated')

  // Optional tool wait bracket (spinner → result)
  // await appear(page, timeline, 'save-run', null)
  // await page.locator('.result').waitFor({ state: 'visible', timeout: 30000 })
  // await done(page, timeline, 'save-run', await page.locator('.result').boundingBox())
  // await wide(page, timeline, 'tool-done')

  // Beat 3: payoff
  const newRow = page.locator('li', { hasText: 'Ship the v1 release' })
  await focus(page, timeline, newRow, 'payoff')
  await holdMin(5.0, 'sentence-3', renderDir)
  await wide(page, timeline, 'final-wide')
  await pause(2500)

  timeline.dump(join(renderDir, 'timeline.json'))
  const rec = await finishFilmRecording(context, page, renderDir, recorder)
  await browser.close()

  if (!rec.ok) {
    console.error('raw.mp4 not produced')
    process.exit(1)
  }
  console.log(`Recorded ${renderDir} (${rec.capturedFps} fps)`)
  const frame = config.frame ?? {}
  const chromeFlags = []
  if (frame.wallpaper) chromeFlags.push(`--wallpaper ${frame.wallpaper}`)
  if (frame.radius) chromeFlags.push(`--radius ${frame.radius}`)
  if (frame.titlebarHeight) chromeFlags.push(`--titlebar-height ${frame.titlebarHeight}`)
  if (frame.trafficLights === false) chromeFlags.push('--no-traffic-lights')
  console.log(`Compose: node demos/_engine/compose.mjs ${renderDir.replace(/\\/g, '/')} --preset ${frame.preset ?? 'studio-dark'}${chromeFlags.length ? ' ' + chromeFlags.join(' ') : ''}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
