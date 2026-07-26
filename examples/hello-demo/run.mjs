/**
 * hello-demo — four focus shots, minimal static pauses, macos-dark (photo-coast-aerial).
 */
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { mkdirSync, readdirSync } from 'fs'
import { chromium } from 'playwright'
import { createTimeline } from '../../skills/film-demo/scripts/timeline.mjs'
import { createFilmContext, prepareFilmPage, startFilmRecording, finishFilmRecording } from '../../skills/film-demo/scripts/record.mjs'
import { click, type, open, focus, wide, settle } from '../../skills/film-demo/scripts/actions.mjs'
import { pause } from '../../skills/film-demo/scripts/motion.mjs'

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

await click(page, timeline, page.locator('#priority-btn'), 'priority-high', {
  expect: page.locator('#priority-btn .label', { hasText: 'High' }),
})

const newItem = page.locator('li', { hasText: 'Ship the v1 release' })
await click(page, timeline, page.locator('#add-btn'), 'add', { expect: newItem })
await wide(page, timeline, 'list-updated')

await focus(page, timeline, newItem, 'new-item')
await click(page, timeline, newItem.locator('.check'), 'mark-done')
await wide(page, timeline, 'task-completed')

await click(page, timeline, page.locator('.tab[data-filter="active"]'), 'filter-active', {
  expect: page.locator('.tab.active', { hasText: 'Active' }),
})
await focus(page, timeline, page.locator('#list'), 'filtered-list')
await wide(page, timeline, 'wide-before-delete')

const remainingItem = page.locator('li', { hasText: 'Set up the project' })
await click(page, timeline, remainingItem.locator('.delete'), 'delete')
await remainingItem.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})

await click(page, timeline, page.locator('.tab[data-filter="all"]'), 'filter-all', {
  expect: page.locator('.tab.active', { hasText: 'All' }),
})
await focus(page, timeline, page.locator('#list'), 'payoff')
await pause(2500)
await wide(page, timeline, 'outro')

timeline.dump(join(renderDir, 'timeline.json'))
const { ok, capturedFps } = await finishFilmRecording(context, page, renderDir, recorder)
await browser.close()
if (!ok) {
  console.error('raw.mp4 not produced')
  process.exit(1)
}
console.log(`[hello-demo] recorded ${renderDir} at ${capturedFps}fps`)
