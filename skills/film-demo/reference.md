# film-demo — zoom & compositing reference

Deep-dive for `scripts/{zoomplan,zoompan-expr,speedup,guardrails,inspect,render,compose,verify}.mjs`.
Read `SKILL.md` first; come back here when tuning the camera feel or debugging the ffmpeg graph.

## Why zones, not pixels

Commercial tools (Screen Studio, Cap, Recordly) analyze cursor position and (sometimes) frame
differencing to decide where and when to zoom. We don't need to — the beat script *declares* what
must be visible: `focus(locator | box)` / `wide()`. Playwright returns exact `boundingBox()`es in
the same coordinate space as the recording (see § resolution), so "make this region visible" is
pure arithmetic, not vision. `zoomplan.mjs` turns the ordered list of `focus`/`wide` events into
**shots**: contiguous time ranges, each with a crop center `(cx, cy)` and a zoom factor.

## Shot construction (`zoomplan.mjs`)

1. **Only `focus` and `wide` events create shots.** Clicks, typing, scrolls, appears, loading
   brackets never move the camera — they feed the cursor trace, activity model and guardrails only.
   This is the design decision that kills "zoom flicker on every click".
2. `cropForZone(box)` computes the crop:
   `zoom = clamp(min(sourceW / (box.w·(1+2·padding)), sourceH / (box.h·(1+2·padding))), minZoom, maxZoom)`
   with `padding: 0.22`, then clamps the center to keep the crop inside the frame. Because zoom is
   derived from the box size, **the zone always fits in the crop by construction** — this function is
   shared with `actions.mjs`, which uses the same crop for record-time containment warnings, and with
   guardrails' `zone-clipped` check (which should therefore never fire unless someone breaks this).
   A zone bigger than the frame at `minZoom` simply yields zoom=1 (wide) — declaring "this must be
   visible" on a huge element is valid and just means no zoom.
3. Camera events within `minShotSec` (0.8s) merge — the later one wins.
4. **Shot timing anchors on `tDepart`.** `focus()` stamps `tDepart`/`tArrive` around its own cursor
   nudge; the pan starts when the cursor starts moving. `transSec = clamp(tArrive - tDepart, 0.4, 1.2)`
   rides along per shot so camera and cursor arrive together.
5. **Travel-distance safety cap** (`travelMargin: 0.3`): consecutive shot centers far apart get their
   zooms capped so the crop stays wide enough for the cursor to remain visible during the pan. With
   explicit zones + cursor nudging this rarely fires; it's a last-resort floor.
6. Center clamping can pull `cx` away from a zone's literal center near viewport edges (docked
   panel) — expected; containment still holds because the crop is at least as big as zone+padding.

## Easing → ffmpeg expression (`zoompan-expr.mjs`)

Each shot's target value (for `zoom`, `cx`, `cy` independently) eases in from the *previous* shot's
value over that shot's own `transSec` (falls back to the global `transitionSec` default, 0.72s, when
the shot has none) using an ease-out cubic curve:

```
p     = clamp((in_time - shot.tStart) / transSec, 0, 1)
ease  = 1 - (1 - p)^3
value = prevValue + (curValue - prevValue) * ease
```

At `p=0` this is `prevValue`, at `p=1` (and beyond, since `p` is clamped) it's `curValue` — so one
formula covers both the transition *and* the hold, no separate branch needed. This is compiled into
one big `if(between(in_time, tStart, tEnd), <formula>, <rest>)` chain per axis, three chains total
(`z`, `x`, `y`), fed to ffmpeg's `zoompan` filter:

```
fps=30,zoompan=z='<zExpr>':x='max(min(<cxExpr>-(iw/zoom/2),iw-iw/zoom),0)':y='...':d=1:s=WxH:fps=30
```

Key facts about `zoompan` that make this work (confirmed against ffmpeg 8.x, see
`ffmpeg -h filter=zoompan` / ffmpeg.org docs):
- `in_time` is the input frame's timestamp in seconds — matches `timeline.json`'s `t` directly, no
  frame-counting math needed.
- `zoom` inside the `x`/`y` expressions refers to the *current frame's* just-evaluated `z` result —
  this is the documented idiom (`x='iw/2-(iw/zoom/2)'` in ffmpeg's own examples), so `x`/`y` don't need
  their own copy of the zoom formula.
- A leading `fps=30` filter is required before `zoompan` with `d=1` — without normalizing the input to
  a constant frame rate first, zoompan's per-input-frame duration bookkeeping doesn't line up with the
  recording's actual (variable) frame rate.
- Long nested `if(between(...))` chains are the standard, documented way to do multi-keyframe zoompan
  (see ffmpeg.org's own "zoom in only for the first second" example) — not a hack.

Ease-out cubic (fast departure, slow settle) reads closer to a Screen Studio pan feel than a
raised-cosine or linear curve. If pans still feel harsh on review, the shot almost certainly has an
unusually short `tArrive - tDepart` (fast click) — check the timeline before raising the global
`transitionSec` default, since most shots now use their own `transSec`.

## Post-record speed-up (`speedup.mjs`, single encode)

Applied automatically by `compose.mjs` before zoom (skip with `--no-speedup`). Plans ALL
compressions first, applies them in **one** ffmpeg `split/trim/setpts/concat` pass (one re-encode
total instead of one per segment), then remaps every timestamp — events **and** the cursor trace —
through the same `makeTimeMap(segments)` so `timeline.json` stays frame-accurate.

Planned segments, in priority order (later passes skip anything overlapping an earlier one):
1. **Lead** — everything before the first event anchor minus 0.3s pad is dropped entirely.
2. **Pre-tool wait** — `loading-start` → first `appear`/`click` compressed to ≤2.5s.
3. **Tool spinner** — each `appear` → matching `done` (`label-done`) compressed to ≤4s.
4. **Generic inactivity** — the activity model (`activityIntervals`) unions every
   `[tDepart, t]` window (cursor travel + typing + clicks) plus scroll windows; any gap in the
   complement > `idleGapMin` (3.5s) is compressed to `idleGapMax` (1.8s), **regardless of the
   surrounding event types**. This is the pass that kills residual dead air.

Label convention for tools/API calls (both `async`, take `page` first — they nudge the cursor to the box):
```javascript
await appear(page, timeline, 'load-report', box)
await done(page, timeline, 'load-report', box)  // logs as load-report-done
```

## Guardrails (`guardrails.mjs`) — the deterministic reviewer

Runs automatically at the end of every `compose`; rerun anytime with
`node scripts/guardrails.mjs <renderDir>`. It replays the exact camera math the final video
used — `cameraAt(shots, t)` in `zoompan-expr.mjs` is the JS twin of the compiled ffmpeg expression
(same easing, same clamping; keep them in sync) — against the recorded cursor trace, and reports:

- **CAMERA PLAN**: per shot — index, start, end, hold seconds, zoom, center, zone. This is the
  authoritative answer to "how long does each zoom last and where is it".
- **`cursor-offscreen`**: samples cursor-vs-crop at 10fps over the whole video; flags any span
  ≥0.2s where the cursor sits outside the visible crop (4px tolerance).
- **`zoom-too-long`**: a shot with zoom > 1.05 held > 12s.
- **`inactivity`**: > 5s with no cursor motion / typing / click in the *final* timeline (a capped
  4s tool spinner is fine — verify skips those automatically).
- **`zone-clipped`**: focus zone not fully inside its crop (should never fire — by construction).
- **`zoom-pump`**: a wide shot shorter than 2s sandwiched between two zooms, or a re-focus nearly
  identical to the previous shot — merge into ONE `focus()` on the union of both zones.
- **`record-alert`**: warnings raised during recording (a click outside the focused zone, or
  visible error text detected after a click — the latter always means re-record).

Exit code 1 when any alert exists. Alerts are ignorable *by explicit decision only* — the skill
requires each one fixed or justified in the delivery report.

## Frame inspection (`inspect.mjs`) — letting the agent "see" the video

`node scripts/inspect.mjs <renderDir> [--times 3,10.5] [--alerts]`

Extracts frames from **the raw capture** (pre-zoom, full 1920×1080) and draws on each: the crop
rect the final video shows at that instant (white, 4px), the active focus zone (gray, 2px), the
scripted cursor position (filled 16px square). `review/inspect.json` carries exact numbers per
frame: crop rect, cursor position, in/out-of-crop flag, cursor distance to each crop edge, zone
box. Default sampling = settle point + midpoint of every shot; `--alerts` samples at every
guardrail alert. Drawing on the raw frame (not the final) is deliberate: you can see both what the
viewer sees (inside the white box) *and* what sits just outside it — exactly what you need to
judge a bad crop.

## Capture (`screencast.mjs`) — why not Playwright `recordVideo`

Playwright's built-in recorder muxes a VFR WebM whose frame timestamps carry transport jitter —
that reads as a stuttering cursor and choppy loading animations. This engine captures compositor
frames itself via CDP `Page.startScreencast` (JPEG q82, `everyNthFrame: 1`), keeps each frame's
exact compositor timestamp, and assembles a clean CFR 30fps `raw.mp4` with ffmpeg's concat demuxer
(per-frame durations from the real timestamps). `startFilmRecording(page, renderDir, timeline)`
also re-anchors the timeline epoch at capture start, so **video time == timeline event time by
construction**.

Every record writes `capture-stats.json` — frame count, achieved fps, and frame-interval
p50/p90/max. Healthy: ~30fps, p90 ≤ 80ms. A long `max` is normal (static screens paint nothing; the
assembler holds the frame). Low fps *during motion* means the machine is starving the recorder.
Validate any `scripts/` change with `node scripts/test-engine.mjs`.

## Cursor trace

`actions.mjs`'s `filmMove()` logs an analytical eased path into `timeline.cursor` (~30
samples/sec) and animates the on-screen pointer via `requestAnimationFrame` inside the page
(compositor rate — typically 60 Hz). Playwright's mouse jumps to the destination once, after
the animation, so hover/click targets stay correct. `cursorAt()` in guardrails linearly
interpolates between samples. Never move the Playwright mouse directly in a beat script —
you'd bypass the trace and blind the guardrails.

## Film cursor (`film-cursor.mjs`)

SVG arrow pointer (lucide `mouse-pointer-2` path) at 1.6x scale by default (`cursor.scale` in
`demo.config.json`), thin white outline + drop shadow so it reads on both light and dark UI.

**rAF travel:** long moves run through `__filmCursorAnimate` at compositor refresh rate. Stepping
`page.mouse.move()` from Node instead would be ~30-80ms per CDP round-trip (~10-15 effective Hz,
choppy video). Press feedback still follows real input: `mousedown` squashes to ~0.8x, `mouseup`
springs back — one press per real click.

**Navigations:** a new document remounts the cursor at the default center. `prepareFilmPage()`
installs a `framenavigated` hook that re-syncs the pointer to the last known position
(`resyncFilmCursor`), so the cursor never visibly teleports after a reload or route change.

`filmMove()` is the only sanctioned way to travel. Clicks are a real `mouse.down` → 90ms →
`mouse.up` at the settled position (never `locator.click()`, which re-computes the point and
can visibly teleport the real mouse away from the drawn pointer).

`test-engine.mjs` is a full e2e smoke test on a synthetic page (no real app) — run it after any
change to `scripts/`.

## Resolution and zoom headroom

The recording (`FILM_VIEWPORT`, 1920x1080 by default) **is** the coordinate space `boundingBox()`
returns boxes in — the screencast captures the viewport 1:1, so no scale factor to track between
"where Playwright says the button is" and "where it is in the raw video." Zoom is capped at
`maxZoom: 1.7` by default because we're zooming into a 1920x1080 source without recording at a
higher physical resolution — a 2x+ zoom would visibly soften/pixelate. If a sharper deep-zoom is
needed later, record at a larger viewport (e.g. 2560x1440) and raise `maxZoom` — everything
downstream is resolution-agnostic (it computes in source pixels, not fixed constants).

## Styled frame (`render.mjs` → `applyStyledFrame`, presets in `presets.mjs`)

Single `filter_complex` graph, four layers, source video is `[0:v]`:

```
color=...:d=<clip+1>[bg]                                    # canvas background
color=black:...,format=yuva420p,colorchannelmixer=aa=0.55,
  boxblur=24:1[shadow]                                       # soft rect, alpha-blurred
[bg][shadow]overlay=...[bg2]                                 # shadow, offset down+right
[0:v]scale=contentW:contentH:flags=lanczos[content]
[bg2][content]overlay=x=padX:y=padY[bg3]                     # the actual window
[bg3]drawbox=...:color=<borderColor>:t=1[out]                # 1px border
```

**Perf trap already hit and fixed:** the `color=` lavfi sources need a duration (`d=`) — do **not**
default it to something large (e.g. `d=600`) "because `-shortest` will cut it anyway." `boxblur` runs
on every generated frame *before* `-shortest` truncates the output, so a 600s source blurs 18,000
frames to produce a 6s clip — this can hang ffmpeg for minutes. `compose.mjs` always passes the
real clip duration (`durationSec`, ffprobed) into `applyStyledFrame`; `render.mjs` throws if it's
missing specifically so this doesn't regress silently.

`format=yuva420p` is what gives the shadow a real alpha channel for `overlay` to blend — a plain
`color=black@0.6` string-alpha, chained through `boxblur`, isn't guaranteed to survive as blendable
alpha in every ffmpeg build. If the shadow ever renders as a hard black box instead of a soft one,
check that chain first; the escape hatch is `shadowOpacity: 0` (border-only, still reads as "framed").

Ship three presets out of the box (`presets.mjs`): `studio-dark` (near-black, subtle shadow),
`clean-light` (off-white, faint shadow), `none` (no background/shadow, border only). Add your own
by editing `PRESETS` in `presets.mjs`, or pass `background`/`borderColor`/`shadowOpacity` directly
to `composeFilm()`.

## Cross-platform notes

- CLI entry-point detection (`if (import.meta.url === ...)`) must use
  `pathToFileURL(process.argv[1]).href`, not string-concatenating `file://${process.argv[1]}` —
  `argv[1]` is backslash-separated on Windows, `import.meta.url` never is. Every script here that's
  meant to run standalone follows this pattern; copy it if you add another one.
- All ffmpeg calls go through `spawnSync('ffmpeg', args)` with an **args array**, never a shell
  string — the generated filter strings contain unescaped single quotes and commas that are only
  valid because ffmpeg's own filtergraph parser sees them, not the shell. See the
  `sync-narration` skill's `SKILL.md` for the same gotcha in the captioning pipeline.
- `spawnSync` calls carry generous timeouts so a runaway filter graph fails loudly instead of
  hanging a render indefinitely.
