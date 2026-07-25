/**
 * Smallest possible demo-studio run — records the fixture app in ./app with
 * the film-demo engine (imported directly from the skill folder since this
 * script lives inside the same repo checkout; a real project would import
 * from its vendored `demos/_engine/` copy instead — see demo-setup).
 *
 * Usage: node examples/hello-demo/run.mjs
 * Then:  node skills/film-demo/scripts/compose.mjs examples/hello-demo/renders/001 --out examples/hello-demo/output/demo.mp4
 */
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { mkdirSync, readdirSync } from 'fs'
import { chromium } from 'playwright'
import { createTimeline } from '../../skills/film-demo/scripts/timeline.mjs'
import { createFilmContext, prepareFilmPage, startFilmRecording, finishFilmRecording } from '../../skills/film-demo/scripts/record.mjs'
import { click, type, open, focus, wide, settle } from '../../skills/film-demo/scripts/actions.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rendersDir = join(__dirname, 'renders')
mkdirSync(rendersDir, { recursive: true })
const n = readdirSync(rendersDir).filter((d) => /^\d+$/.test(d)).map(Number).reduce((a, b) => Math.max(a, b), 0) + 1
const renderDir = join(rendersDir, String(n).padStart(3, '0'))
mkdirSync(renderDir, { recursive: true })
console.log(`[hello-demo] render -> ${renderDir}`)

const browser = await chromium.launch({ headless: true })
const context = await createFilmContext(browser, renderDir)
const page = await context.newPage()
await prepareFilmPage(page)
const timeline = createTimeline()
const recorder = await startFilmRecording(page, renderDir, timeline)

const appUrl = pathToFileURL(join(__dirname, 'app', 'index.html')).href
await page.goto(appUrl, { waitUntil: 'commit' })
await settle(page)
open(timeline, 'app-loaded')

const input = page.locator('#new-task-input')
await focus(page, timeline, input, 'composer')
await type(page, timeline, input, 'Ship the v1 release', 'task-text')
await click(page, timeline, page.locator('#add-btn'), 'add', { expect: page.locator('li', { hasText: 'Ship the v1 release' }) })
await wide(page, timeline, 'list-updated')

const newItem = page.locator('li', { hasText: 'Ship the v1 release' })
await focus(page, timeline, newItem, 'new-item')
await page.waitForTimeout(2800)
await wide(page, timeline, 'payoff')
await page.waitForTimeout(3800)

timeline.dump(join(renderDir, 'timeline.json'))
const { ok, capturedFps } = await finishFilmRecording(context, page, renderDir, recorder)
await browser.close()
if (!ok) {
  console.error('raw.mp4 not produced')
  process.exit(1)
}
console.log(`[hello-demo] recorded ${renderDir} at ${capturedFps}fps`)
