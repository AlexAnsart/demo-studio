---
name: film-demo
description: Records a polished, silent screen-capture demo video of any web app from a plain-English beat script — Playwright capture with a real cursor, human-speed typing, explicit zone-based zooms (focus/wide) with guaranteed containment, deterministic guardrails (cursor offscreen, zoom too long, inactivity), annotated frame inspection, post-record speed-ups, styled frame, and a verify/iterate loop. Use when the user asks to record, film, or generate a demo/tutorial/product video of a web app.
disable-model-invocation: true
---

# Film Demo

Silent, zoom-composited screen recording of a web app, driven by a short **beat
script** you write for the app you're demoing. No audio here — narration is a
separate step, see the `narrate` and `sync-narration` skills (or `produce-video`
to chain everything).

**Read first:** `reference.md` (camera math + pipeline internals).

**What this skill actually is:** this file is pure instructions; the real
machinery is a small code library at `scripts/*.mjs` in this same skill folder
(Playwright + ffmpeg, run via `node`). Reading this file *is* the invocation.
Never reimplement recording/zoom/speed-up logic ad hoc — call the library.

**Requirements:** Node 18+, `ffmpeg`/`ffprobe` on PATH, `npm i playwright &&
npx playwright install chromium` once in the target project.

## The camera model (most important concept)

**The camera only moves when the beat script says so.** Clicks and typing never
zoom by themselves. Two verbs, from `scripts/actions.mjs`:

- `await focus(page, timeline, target, 'label')` — ZOOM IN. `target` is a
  Playwright Locator **or a raw box** `{x, y, width, height}`. The crop is
  computed so the whole zone + padding is **guaranteed to fit** — you declare
  *what must be visible*, not coordinates. The cursor is automatically nudged
  inside the crop first.
- `await wide(page, timeline, 'label')` — ZOOM OUT to the full frame.

Rules of thumb (violating these is what makes bad demos):

1. **Few zooms.** 2-5 focus shots per video. Not every click deserves a zoom —
   only the moments where small UI must be readable (a text field, a result
   table, the final artifact).
2. **Always come back wide.** Every `focus` must be followed by a `wide` (or
   another `focus`) once its beat is over. The default state of the camera is
   wide.
3. **After a submit action, go wide immediately.** The viewer must see the
   result appear — never stay zoomed on the input after submitting.
4. **While focused, act only inside the zone.** Clicking outside the focused
   crop raises a record-time guardrail warning (`[film][guardrail]` in the
   console + an `alert` event that fails guardrails later). Call `wide()` or
   re-`focus()` first.
5. **Zones that grow need headroom.** A textarea that grows while typing needs
   its box expanded manually before `focus()` — measure the *final* size, not
   the empty-state size.
6. **A zoom should not outlive its beat.** Guardrails flag any zoomed shot held
   longer than 12s.

## Checklist

```
Film progress:
- [ ] 1. Write the beat script: ordered UI actions + the 2-5 moments that deserve a focus()
- [ ] 2. Create demos/<slug>/run.mjs importing scripts/*.mjs from this skill (or your vendored copy)
- [ ] 3. Record: node demos/<slug>/run.mjs  (your dev server must be running; watch for [film][guardrail] warnings)
- [ ] 4. Compose: node scripts/compose.mjs <renderDir>  — prints CAMERA PLAN + ALERTS automatically
- [ ] 5. Resolve every guardrail alert: fix run.mjs and re-record, or write down why it's acceptable
- [ ] 6. Inspect: node scripts/inspect.mjs <renderDir> [--alerts] — READ the annotated PNGs
- [ ] 7. Verify: node scripts/verify.mjs <renderDir> — duration, dead air, opening frames
- [ ] 8. Iterate until: zero unjustified alerts AND pass:true AND frames look right (new render number each time)
- [ ] 9. Deliver to the requested path
```

## The toolbox (`scripts/`)

| Tool | Run | What it gives you |
|------|-----|-------------------|
| `compose.mjs <renderDir> [--out p] [--preset name] [--no-frame] [--no-speedup] [--speedup k=v,…]` | after every record | speed-ups → zoom → styled frame → **prints the camera plan (each shot: start, end, hold, zoom, label) and all guardrail alerts** |
| `guardrails.mjs <renderDir>` | anytime after compose | re-prints camera plan + alerts; exit 1 if alerts. Kinds: `cursor-offscreen`, `zoom-too-long` (>12s), `inactivity` (>5s no cursor/typing/click), `zone-clipped`, `zoom-pump` (blink-short wide between two zooms / redundant re-focus), `record-alert` |
| `inspect.mjs <renderDir> [--times 3,10.5] [--alerts]` | to SEE the video | annotated frames from the raw capture: white box = exact crop the final video shows at that instant, gray box = focus zone, filled square = cursor; plus `review/inspect.json` with crop/cursor coordinates and cursor-to-edge distances per frame |
| `verify.mjs <renderDir>` | before delivering | duration bounds, activity-based dead-air, blank-opening check, ends-too-soon check, per-shot stills from `final.mp4` |
| `test-engine.mjs` | after ANY change to `scripts/` | full pipeline e2e on a synthetic page (no app needed): capture fps/regularity, cursor across a navigation, camera, speed-ups, guardrails, verify |

**Capture health:** every record writes `capture-stats.json` (frame count,
achieved fps, frame interval p50/p90). `capturedFps` should sit near 30 with
p90 ≤ ~80ms — a low/irregular capture is what reads as a stuttering cursor and
choppy loading animations, and means something is starving the recorder
(heavy machine load, giant page). Fix that before blaming the beat script.

**How to use alerts:** every alert is deterministic and timestamped. For each
one, either fix the cause in `run.mjs` and re-record, or explicitly justify it
(e.g. "8s inactivity = spinner, capped by design — acceptable"). Never
silently ignore an alert. `inspect.mjs --alerts` gives you a frame at every
alert instant so you can see exactly what the viewer would see.

## Quality bar (non-negotiable)

A finished video should feel like a **Screen Studio / Arcade**-grade tutorial:

| Dimension | Target | How |
|-----------|--------|-----|
| **Capture** | ~30fps constant-frame-rate, no jitter | CDP screencast recorder (`screencast.mjs`) — check `capture-stats.json` every record |
| **Cursor** | Real arrow pointer, ~1.6x scale, drop shadow, follows real input events | Automatic via `film-cursor.mjs` in `prepareFilmPage`; survives navigations (auto re-sync — never teleports to center) |
| **Click feedback** | ONE press effect (squash on mousedown, release on mouseup) | Built-in — tied to the real click events, so it can never read as a double-click. **No ring/halo** |
| **Cursor stays in frame** | Never outside the visible crop | Enforced by design (focus nudges cursor in; guardrails verify every frame vs the cursor trace) |
| **Zooms** | 2-5 explicit `focus` shots, zone fully contained, back to `wide` after each; no zoom pumping | Camera model above + `zoom-pump` guardrail |
| **Typing** | Human speed, visible keystrokes | Always `type()` — never `.fill()` or paste |
| **Clicks** | Hover pause → press → expected result visible | `click()` with `expect:` locator wherever the click has a knowable outcome; ~650ms settle after |
| **Dead air** | No gap > ~4s with nothing moving | Activity-based speed-up compresses ALL inactive gaps (not just tool waits) |
| **Tool/API waits** | Spinner visible ≤4s per tool | `appear`/`done` pairs; auto-compressed |
| **Duration** | 15s-2min | Speed-ups + trim; split the script if still too long |
| **Opening** | First frame = target screen, fully loaded (no spinner) | Log in / seed data off-camera; `await settle(page)` before the first beat; lead auto-dropped |
| **Ending** | Final result readable ≥3s before the video stops | `focus()` the payoff, `pause(2500+)`, then stop; verify flags endings <2s |
| **State hygiene** | No leftover toasts/errors from previous runs | Reset app state before recording starts |

## Pacing budgets (after speed-up)

| Beat type | Raw record | After speed-up |
|-----------|------------|----------------|
| Nav click → content visible | 2-4s | 2-4s |
| Typing a realistic input (~200 chars) | 6-10s | 6-10s (reads as deliberate — keep) |
| Tool/API spinner | 10-60s raw | **≤4s each** |
| Any other inactive gap | whatever | **≤1.8s** (auto) |
| Focused shot hold | — | 3-8s, hard alert at 12s |
| Result hold (final screen) | **≥3s** | ≥3s (verify flags <2s) |
| **Total video** | — | **30-110s** (aim 45-90s) |

## 1. Write the beat script (plain English, before touching code)

Before writing `run.mjs`, write down the ordered beats in plain English —
this is your source of truth for the camera plan:

```
1. Open the app at /  → wait for it to settle
2. Focus the "new task" input
3. Type "Ship the v1 release"
4. Click "Add"  → expect the new item in the list
5. Wide — let the viewer see the list update
6. Focus the new list item for 2s (the payoff)
7. Wide, hold 2.5s, stop
```

Decide the 2-5 focus moments explicitly. Everything else stays wide.

## 2. Demo folder

```
demos/<slug>/
├── script.md   # the beat list above, pasted verbatim
└── run.mjs     # Playwright beat script
```

If this is the first demo in the project, either import the engine directly
from this skill's `scripts/` folder (path depends on where your agent
installed skills, e.g. `.cursor/skills/film-demo/scripts/`), or — recommended
for a project that will film more than one demo — vendor a copy once into
`demos/_engine/` so every `run.mjs` uses a stable relative import. The
`demo-setup` skill does this for you automatically.

## 3. Write run.mjs

```javascript
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, readdirSync } from 'fs'
import { chromium } from 'playwright'
import { createTimeline } from '../_engine/timeline.mjs'
import { createFilmContext, prepareFilmPage, startFilmRecording, finishFilmRecording } from '../_engine/record.mjs'
import { click, type, open, focus, wide, settle } from '../_engine/actions.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rendersDir = join(__dirname, 'renders')
mkdirSync(rendersDir, { recursive: true })
const n = readdirSync(rendersDir).filter((d) => /^\d+$/.test(d)).map(Number).reduce((a, b) => Math.max(a, b), 0) + 1
const renderDir = join(rendersDir, String(n).padStart(3, '0'))
mkdirSync(renderDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
// Log in / seed data OFF-CAMERA here if the app needs it (separate page/context,
// never recorded) — then pass storageState into createFilmContext.
const context = await createFilmContext(browser, renderDir)
const page = await context.newPage()
await prepareFilmPage(page) // installs the cursor — do not skip
const timeline = createTimeline()
const recorder = await startFilmRecording(page, renderDir, timeline) // anchors video t=0

await page.goto('http://localhost:5173/', { waitUntil: 'commit' })
await settle(page)                                    // no spinner in the opening frame
open(timeline, 'app-loaded')

// Camera stays wide by default; zoom only where it matters:
const input = page.locator('#new-task-input')
await focus(page, timeline, input, 'composer')
await type(page, timeline, input, 'Ship the v1 release', 'task-text')
await click(page, timeline, page.locator('#add-btn'), 'add', { expect: page.locator('text=Ship the v1 release') })
await wide(page, timeline, 'list-updated')             // ALWAYS after a submit action

const newItem = page.locator('li', { hasText: 'Ship the v1 release' })
await focus(page, timeline, newItem, 'new-item')
await page.waitForTimeout(2000)
await wide(page, timeline, 'payoff')
await page.waitForTimeout(2500)

timeline.dump(join(renderDir, 'timeline.json'))
const { ok, capturedFps } = await finishFilmRecording(context, page, renderDir, recorder)
await browser.close()
if (!ok) { console.error('raw.mp4 not produced'); process.exit(1) }
console.log(renderDir, `${capturedFps}fps`)
```

**Rules:**
- **`type()` not paste/fill** for any text the viewer reads.
- **`appear()` + `done()`** for every async tool/API call the user waits on
  (they also nudge the cursor — keep them).
- Log in, seed data, cleanup → **off-camera** (separate context, no video).
- **`settle(page)` before the first beat** and after any on-camera navigation.
- **`expect:` on every click with a knowable outcome.** A click that visibly
  does nothing (dead button, failed first click) is a broken take — the script
  must throw, not push on.
- **Fail fast, restart from zero.** Any error toast, unexpected dialog, retry,
  or leftover state during recording = kill the take, fix the cause, start a
  fresh render. Never deliver a take that contains a visible error or a click
  that had to be repeated.
- Never call `timeline.shot()` directly — the wrappers record the cursor trace
  and the depart/arrive windows that the camera, speed-ups and guardrails all
  depend on.
- Do not hand-roll ffmpeg in `run.mjs` — `compose.mjs` does speed-ups
  automatically.

## 4-7. Record → Compose → Guardrails → Inspect → Verify

```bash
node demos/<slug>/run.mjs                          # watch for [film][guardrail] warnings
node <skill-dir>/scripts/compose.mjs demos/<slug>/renders/00N
#   → prints CAMERA PLAN + ALERTS. Zero alerts, or justify each one.
node <skill-dir>/scripts/inspect.mjs demos/<slug>/renders/00N            # overview frames
node <skill-dir>/scripts/inspect.mjs demos/<slug>/renders/00N --alerts   # frame per alert
node <skill-dir>/scripts/verify.mjs demos/<slug>/renders/00N
```

Read the inspect PNGs with your image tool. For each: is the white crop box
framing the right content? Is the cursor square inside it, comfortably away
from the edges? Does the gray zone box match what the beat intended? Any
rendering glitch (blank area, overlapping UI, half-loaded state)? Then read a
few `review/shot-*.png` from verify (these come from the FINAL video) to
confirm the actual output looks clean.

Per-video speed-up tuning (CLI `--speedup k=v,k=v` or
`composeFilm({ speedupConfig: {...} })`): `toolWaitMax` (4), `preToolWaitMax`
(2.5), `idleGapMax` (1.8), `idleGapMin` (3.5).

## 8. Iterate

| Problem | Fix |
|---------|-----|
| `cursor-offscreen` alert | A click/scroll happened outside the focused zone, or a `focus` box was stale. Re-order beats: `wide()` before acting elsewhere. Check the inspect frame at that instant |
| `zoom-too-long` alert | Insert `wide()` earlier in run.mjs, or split the focus into two shorter ones |
| `inactivity` alert | If it's a capped spinner (≤4s), justify and move on. Otherwise a wait in run.mjs isn't bracketed by `loadingStart`/`appear`/`done` — fix and re-record |
| `zoom-pump` alert | Merge the two zooms into ONE `focus()` on the union box of both zones, or drop the redundant re-focus |
| `record-alert` (click outside zone / error text visible) | Add `wide()`/`focus()` before that click; error text = broken take, fix the cause and re-record from zero |
| Zoom frames the wrong thing / empty space | The zone box was captured before a scroll or layout change — pass a Locator to `focus()` (it re-reads the box fresh) or re-measure after the layout settles |
| Video still too long | Lower `toolWaitMax`/`preToolWaitMax`; check the camera plan for shots that exist only because of a wait; split the script |
| Instant text paste | Replace with `type()`, re-record |
| Cursor stutters / choppy animations | Read `capture-stats.json` — low fps or high p90 means the capture starved; reduce machine load, re-record. Validate the pipeline itself with `test-engine.mjs` |
| Ugly cursor / cursor teleports | Ensure `prepareFilmPage` is used (it installs the cursor AND the navigation re-sync); run `test-engine.mjs` |
| Pan feels harsh | Raise `transitionSec` in compose options (default 0.72) |

## 9. Deliver

Copy to the requested output path, report final duration + camera plan + any
justified alerts.

## Hard rules

- Silent (no audio/captions) — narration is a separate skill.
- Record 1920x1080 by default (`FILM_VIEWPORT` in `record.mjs`); output
  1920x1080 styled frame. Override both together if your app needs another
  aspect ratio.
- 15s-2min final duration.
- Zero unjustified guardrail alerts at delivery.
- A take containing a visible error, a repeated click, or leftover state from
  a previous run is **never** delivered — fix the cause and re-record from
  zero.
- If the app itself misbehaves (feature broken, flaky endpoint) and you work
  around it, **tell the user explicitly in the final message** — never
  silently ship around a product bug.
