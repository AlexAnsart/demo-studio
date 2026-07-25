#!/usr/bin/env node
/**
 * End-to-end smoke test for the recording engine — no real app, no auth, no
 * dev server. Exercises: screencast capture, event-driven cursor (move/press),
 * navigation cursor re-sync, focus/wide camera, appear/done tool-wait
 * compression, full compose (speedup → zoompan → styled frame), guardrails
 * and verify.
 *
 * Run after ANY change to these scripts: node test-engine.mjs
 * Exits 1 when a check fails. Output → .test/<NNN>/
 *
 * Review by reading:
 *   .test/<NNN>/capture-stats.json   → capturedFps ≥ 20, p90 interval ≤ 80ms
 *   .test/<NNN>/review/*.png         → cursor rendering + crop framing
 *   .test/<NNN>/final.mp4            → the assembled result
 */
import { mkdirSync, readFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'
import { createTimeline } from './timeline.mjs'
import { createFilmContext, prepareFilmPage, startFilmRecording, finishFilmRecording } from './record.mjs'
import { click, focus, wide, appear, done, open, settle, filmMove } from './actions.mjs'
import { composeFilm } from './compose.mjs'
import { verifyFilm } from './verify.mjs'
import { inspectFilm } from './inspect.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const pageHtml = (title, extra = '') => `<!doctype html><html><head><style>
  @keyframes spin { to { transform: rotate(360deg) } }
  body { margin:0; background:#f5f5f7; font-family:sans-serif }
  .btn { position:absolute; width:220px; height:56px; background:#fff; border:1px solid #ddd;
         display:flex; align-items:center; justify-content:center; font-size:16px; cursor:pointer }
  .spinner { position:absolute; left:920px; top:500px; width:44px; height:44px; border:4px solid #ccc;
             border-top-color:#111; border-radius:50%; animation:spin 0.8s linear infinite; display:none }
</style></head><body>
  <h1 style="position:absolute;left:80px;top:40px">${title}</h1>
  <!-- busy backdrop so the blank-frame heuristic (PNG size) behaves like a real app -->
  <div style="position:absolute;left:60px;top:120px;width:1800px;height:60px;font-size:13px;color:#555;line-height:1.5">
    ${'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor — '.repeat(9)}
  </div>
  <div style="position:absolute;left:60px;top:930px;width:1800px;height:120px;background:repeating-linear-gradient(90deg,#e2e2e6 0 24px,#f0f0f3 24px 48px)"></div>
  <div class="btn" id="a" style="left:200px;top:200px" onclick="this.style.background='#dff'">Button A</div>
  <div class="btn" id="b" style="left:1480px;top:820px" onclick="document.getElementById('spin').style.display='block';setTimeout(()=>{document.getElementById('spin').style.display='none';document.getElementById('result').style.display='flex'},6000)">Button B (runs tool)</div>
  <div class="spinner" id="spin"></div>
  <div class="btn" id="result" style="left:760px;top:460px;width:400px;height:120px;display:none;background:#111;color:#fff">RESULT PANEL</div>
  ${extra}
</body></html>`

function fail(msg) {
  console.error(`[test-engine] FAIL: ${msg}`)
  process.exitCode = 1
}

async function main() {
  const base = join(__dirname, '.test')
  mkdirSync(base, { recursive: true })
  const n = readdirSync(base).filter((d) => /^\d+$/.test(d)).map(Number).reduce((a, b) => Math.max(a, b), 0) + 1
  const renderDir = join(base, String(n).padStart(3, '0'))
  mkdirSync(renderDir, { recursive: true })
  console.log(`[test-engine] render → ${renderDir}`)

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })
  const context = await createFilmContext(browser, renderDir)
  const page = await context.newPage()
  await prepareFilmPage(page)
  const timeline = createTimeline()
  const recorder = await startFilmRecording(page, renderDir, timeline)

  const url1 = `data:text/html,${encodeURIComponent(pageHtml('Page one'))}`
  const url2 = `data:text/html,${encodeURIComponent(pageHtml('Page two (after nav)'))}`

  await page.goto(url1)
  await settle(page, { timeout: 5000 })
  open(timeline, 'page-one')

  // Beat 1: focused click near the top-left
  const btnA = page.locator('#a')
  await focus(page, timeline, btnA, 'button-a')
  await click(page, timeline, btnA, 'click-a', { expect: page.locator('#a') })
  await wide(page, timeline)

  // Beat 2: long diagonal move + tool wait (spinner → result) for the speed-up pass
  const btnB = page.locator('#b')
  await click(page, timeline, btnB, 'click-b')
  await appear(page, timeline, 'tool-run', await page.locator('#spin').boundingBox().catch(() => null))
  await page.locator('#result').waitFor({ state: 'visible', timeout: 12000 })
  await done(page, timeline, 'tool-run', await page.locator('#result').boundingBox())
  await focus(page, timeline, page.locator('#result'), 'result-panel')
  await page.waitForTimeout(2600)
  await wide(page, timeline)

  // Beat 3: navigation — the cursor must NOT teleport back to (960,540)
  const beforeNav = { ...timeline.state.cursorPos }
  await page.goto(url2)
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(600) // let the framenavigated re-sync land
  const domPos = await page.evaluate(() => window.__demoMouse)
  const drift = Math.hypot(domPos.x - beforeNav.x, domPos.y - beforeNav.y)
  console.log(`[test-engine] nav re-sync: before=(${Math.round(beforeNav.x)},${Math.round(beforeNav.y)}) after=(${Math.round(domPos.x)},${Math.round(domPos.y)}) drift=${Math.round(drift)}px`)
  if (drift > 5) fail(`cursor teleported across navigation (drift ${Math.round(drift)}px)`)

  await settle(page, { timeout: 5000 })
  await click(page, timeline, page.locator('#a'), 'click-a-page2')
  await filmMove(page, timeline, 960, 540)
  await page.waitForTimeout(2200)

  timeline.dump(join(renderDir, 'timeline.json'))
  const rec = await finishFilmRecording(context, page, renderDir, recorder)
  await browser.close().catch(() => {})
  if (!rec.ok) return fail('raw.mp4 was not produced')

  const stats = JSON.parse(readFileSync(join(renderDir, 'capture-stats.json'), 'utf8'))
  console.log(`[test-engine] capture: ${stats.frameCount} frames, ${stats.capturedFps} fps, intervals p50=${stats.frameIntervalMs.p50}ms p90=${stats.frameIntervalMs.p90}ms max=${stats.frameIntervalMs.max}ms`)
  if (stats.capturedFps < 18) fail(`captured fps too low (${stats.capturedFps}) — cursor will look choppy`)
  if (stats.frameIntervalMs.p90 > 110) fail(`frame interval p90 ${stats.frameIntervalMs.p90}ms — capture is irregular`)

  const result = composeFilm(renderDir)
  console.log(`[test-engine] composed ${result.finalPath} (${result.durationSec.toFixed(1)}s raw), ${result.shots.length} shots, ${result.guardrails.alerts.length} alerts`)
  for (const a of result.guardrails.alerts) {
    if (a.kind === 'cursor-offscreen') fail(`guardrail: ${a.message}`)
  }

  const report = verifyFilm(renderDir, { min: 5, max: 90 })
  if (!report.pass) {
    for (const i of report.issues) console.error(`[test-engine] verify: ${i}`)
    fail('verify did not pass')
  }
  inspectFilm(renderDir, null)
  console.log(process.exitCode ? '[test-engine] FAILED' : '[test-engine] OK')
}

main().catch((err) => {
  console.error('[test-engine] crashed:', err)
  process.exit(1)
})
