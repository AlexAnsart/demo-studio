---
name: produce-video
description: End-to-end production of a narrated, captioned demo video for any web app — chains narration generation (narrate), silent Playwright recording (film-demo, smart zooms + guardrails), and narration sync with burned captions (sync-narration) into one final .mp4. Use when the user asks to produce, make, or film a demo/product/tutorial video end to end, "with voice and subtitles", or "from A to Z".
---

# Produce a demo video, A → Z

One request in → one finished `.mp4` out (narrated + captioned if narration is
enabled, silent otherwise). This skill is the **orchestrator**: it owns the
chaining logic and the order of operations. The three stage skills own their
domain detail and remain the source of truth for it.

**MANDATORY — read all three stage skills before starting** (this file only
adds what happens *between* them; skipping them is how quality gets lost):

| Stage | Skill to read | Owns |
|-------|---------------|------|
| Voice | `narrate` | ElevenLabs voice/model defaults, script script-writing rules, credits |
| Silent video | `film-demo` (+ its `reference.md`) | Camera model (focus/wide), cursor, speed-ups, guardrails, inspect/verify loop |
| Sync + captions | `sync-narration` | Whisper alignment, segmentTargets, gaps, pre/post-roll, caption burn, ffmpeg gotchas |

If this is the **first** time this skill runs in a project, run `demo-setup`
first (or check that `demo.config.json` already exists at the project root) —
every stage below reads it for the base URL, output directory, narration
provider, and style preset. For scaffold patterns (login off-camera, beat plan,
compose caps), read `demo-setup/examples/` and `demo-setup/references/`.

## Pipeline

```
Request (what the app does, what to say, output path)
  │
  ├─ 0. SCRIPT     write demos/<slug>/script.md (beats + narration text)
  ├─ 1. VOICE      script → narration.mp3           (narrate)            — skip if narration.provider = "none"
  ├─ 2. ALIGN      mp3 → aligned.json                (whisper — sentence durations) — skip if no narration
  ├─ 3. RECORD     beats → <slug>-no-sound.mp4        (film-demo, holds sized from step 2)
  ├─ 4. SYNC       mp3 + no-sound → <slug>.mp4        (sync-narration, burned captions) — skip if no narration
  └─ 5. QA         frames + audio tail + output path → deliver
```

**Voice comes first, always** (when narration is enabled). Align the mp3
*before* recording so each sentence's exact duration sizes the on-screen
holds. After that, the video adapts to the voice, not the other way around.

**Silent mode:** if `demo.config.json` → `narration.provider` is `"none"`
(the default — no API key required), skip stages 1/2/4 entirely: `film-demo`
records straight to the final output, using its own idle-gap speed-up (no
narration-driven holds to protect).

Artifacts (in `demo.config.json` → `output.dir`, default `demos/<slug>/`):

```
demos/<slug>/script.md          the beat + narration script (source of truth for this run)
demos/<slug>/narration.mp3      narration (never retouched after ✓) — narrated mode only
demos/<slug>/no-sound.mp4       silent recording (keep for re-syncs) — narrated mode only
demos/<slug>/final.mp4          FINAL deliverable
```

## Checklist

```
Production progress:
- [ ] 0. Confirm demo.config.json exists (else run demo-setup); write demos/<slug>/script.md
- [ ] 1. Generate narration.mp3 (narrate, exact filename) + ffprobe check — skip if silent mode
- [ ] 2. Align mp3 (align-narration.py) → per-sentence durations table — skip if silent mode
- [ ] 3. Write beat plan: sentence ↔ beat ↔ min on-screen hold — skip if silent mode
- [ ] 4. Record silent video with film-demo (narration-aware config below if narrated)
- [ ] 5. film-demo gates: guardrails alerts resolved, inspect frames read, verify pass
- [ ] 6. Copy final.mp4 → no-sound.mp4 (narrated mode only)
- [ ] 7. Sync: contact sheet → targets → cues.txt → plan → validate → render — skip if silent mode
- [ ] 8. QA gates (below) on the final mp4
- [ ] 9. Deliver: absolute path + duration + justified alerts
```

## Stage 0 — Write the script

Write `demos/<slug>/script.md` with two parallel tracks, beat order = narration
order:

```markdown
# <Video title>

## Say (skip this section entirely for silent mode)
1. "Here's how it works."
2. "Type your task, hit add, and watch it appear instantly."
3. "That's it — no page reload, no setup."

## Show
1. Open the app, wait for it to settle.
2. Focus the task input.
3. Type "Ship the v1 release".
4. Click Add — expect the new item in the list.
5. Wide — let the viewer see the list update.
6. Focus the new list item, hold ~2s (the payoff).
7. Wide, hold 2.5s, stop.
```

Keep total narration to ~150 words/minute of planned video length (a 60s video
≈ 150 words). If the user gave you the app's flow but no narration text and
narration is enabled, draft the Say lines yourself from what the Show beats
actually do — never invent behavior the app doesn't have.

## Stage 1 — Voice (narrated mode only)

Follow `narrate` exactly. Use the **current Say text** from `script.md`:

```bash
python <narrate-skill-dir>/scripts/generate_narration.py \
  --out demos/<slug>/narration.mp3 \
  --text-file /tmp/say.txt
```

Gate: `ffprobe` duration > 0 and plausible (~150 words/min). Narration costs
API credits — if the mp3 already exists and Say hasn't changed, reuse it; any
Say edit → regenerate.

## Stage 2 — Align (before recording, not after)

```bash
pip install -r <sync-narration-skill-dir>/scripts/requirements.txt   # once
python <sync-narration-skill-dir>/scripts/align-narration.py \
  demos/<slug>/narration.mp3 \
  --script-file /tmp/say.txt --out /tmp/aligned.json
```

From `sentences[]`, build the **beat plan** and put it as a comment block at
the top of `run.mjs`:

```
// BEAT PLAN (from aligned.json)
// #  sentence (first words…)      dur    beat                     min hold
// 1  "Here's how it works…"       2.1s   app loads                3s
// 2  "Type your task…"            4.8s   type + add                6s
```

**Min hold = sentence duration + ~1.2s.** The sync stage can stretch silence
*between* sentences, but it can never make a beat that left the screen too
early stay longer — an undersized hold forces narration to spill over the
next beat.

## Stage 3 — Record silent (film-demo, narration-aware when applicable)

Follow the whole `film-demo` workflow (beat script, camera plan, guardrails,
inspect, verify). Differences **specific to narrated videos**:

1. **Zero on-screen text.** No overlays or caption cards in `run.mjs` —
   captions are burned at sync time from the Say text.
2. **Holds are narration-driven.** After each beat's action settles,
   `pause()` until the beat's min hold (beat plan above) is met. These
   pauses are *deliberate*, so:
3. **Disable the generic idle compression** — it would eat exactly those
   holds:

```bash
node <film-demo-skill-dir>/scripts/compose.mjs <renderDir> --speedup idleGapMin=9999,toolWaitMax=2.5,preToolWaitMax=2,tailHold=4
```

   Keep lead/tail trims. **Do not** log an early `open()` event before the
   first beat — lead trim anchors on the first timeline event; an early
   `open()` blocks trimming dead startup time and forces a huge head-pad at
   sync. **Preload the app off-camera** (`page.goto` + `settle`) *before*
   `startFilmRecording`; the first filmed event must be the first beat.
4. **Guardrail justifications shift:** `inactivity` and `zoom-too-long`
   alerts during a planned narration hold are expected — justify them
   against the beat plan (name the sentence). `cursor-offscreen` and
   `record-alert` (error text, click outside zone) are never justifiable,
   same as always.
5. **Camera ↔ narration:** when a clause describes one element, `focus()` on
   it for that hold, then `wide()`. The pointer must be **settled** on the
   element for the clause's whole window — sync (stage 4) cannot fix a
   cursor that was still traveling.
6. **Opening + payoff:** `await settle(page)` before the first beat (fully
   loaded, no spinner, no leftover state from a previous take). End on the
   RESULT: `focus()` the changed element, hold ≥ 4s, then stop.
7. **Fail fast, restart from zero.** Use `expect:` on every click with a
   knowable outcome. Any error, repeated click, or unexpected state = kill
   the take, fix, fresh render.
8. **Duration sanity:** silent video ≥ padded-audio estimate (sum of sentence
   durations + planned inter-sentence gaps) and ≤ 2min.

For **silent mode** (no narration), skip 2/3/4 above — just follow `film-demo`
as-is; its own speed-up defaults already keep pacing tight.

Copy the accepted render's `final.mp4` to `no-sound.mp4` (narrated mode only).

## Stage 4 — Sync + captions (narrated mode only)

Follow `sync-narration` end to end. Chaining shortcuts already earned:

- `aligned.json` from stage 2 is reused as-is.
- `segmentTargets`: read them off the recording's **timeline.json** (after
  compose its timestamps are remapped to final-video time, so each beat's
  settle moment is exact) plus the camera plan compose prints — still
  generate the contact sheet to confirm frames match. If the plan builder
  reports **merged sentences** (no usable silence between them), pass one
  target per merged block.
- `cues.txt`: split the Say text into caption cues at clause breaks — **≤ 60
  chars preferred, 80 hard max**.
- Keep defaults (`--tail-pad 1.0`; pre/post-roll and min-silence are
  word-safe and silence-aware out of the box).
- `--validate-only` first, always; then render **to the requested output
  path**.
- **`leadGap` / `--head-pad` = composed timestamp of the first spoken beat**,
  not the raw pre-recording offset. Values **> 5s always mean wrong sync**
  (spot-check fails): trim dead opening footage in Stage 3, or extend Say so
  narration covers long waits.
- **Spot-check is mandatory:** `node <sync-narration-skill-dir>/scripts/spot-check.mjs plan.json`
  and read EVERY frame.

## Stage 5 — QA gates (all must pass before delivering)

- [ ] Final duration 15s-2min; ends on the result screen (payoff readable ≥ 3s), not mid-action
- [ ] Narrated mode: `spot-check.mjs` run on the final render and EVERY frame read
- [ ] Scrub last 1s of audio: final word decays naturally (post-roll not clipped) — narrated mode
- [ ] Narrated mode: `plan.json` `leadGap` ≤ 5s; opening frames show motion before first spoken word
- [ ] `verify.mjs` passes on the silent/final master
- [ ] No tight `focus()` zoom held through a loading state or unscripted UI
- [ ] No narration while the cursor travels — narrated mode
- [ ] `capture-stats.json` healthy — **`compose.mjs` / `verify.mjs` / sync hard-fail if fps < 25 or p90 > 80ms**; else re-record
- [ ] Final file sits at the exact requested output path
- [ ] Silent master + `.mp3` kept alongside — narrated mode

## What to redo when something is wrong

| Symptom | Redo |
|---------|------|
| Wrong words / wrong voice | Stage 1 (only if Say changed or generation was wrong) → then 2, 4 |
| Beat leaves screen before its clause ends | Stage 3 (raise that hold) → 4. Voice is fixed — never speed it up |
| Caption early/late, clipped onset/tail | Stage 4 only (targets, pre/post-roll) — no re-record needed |
| Cursor moving during a clause | Stage 3 (move the action before the hold) → 4 |
| Video too long | Stage 3 (cut a beat — never rush actions, never trim a mapped payoff) |
| Nothing happens / mute audio first 10-20s | Stage 3 (preload off-camera; first event = first beat) → Stage 4 (`--head-pad` = composed queue time, **≤ 5s**) |
| Draft Say too short for the video | Expand Say (stage 0), regenerate voice → align → record/sync |

## Deliverable message (required)

```markdown
## Video ready

**Final:** `<absolute path to final.mp4>`
- Duration: <X>s
- Mode: <narrated (N sentences, voice) | silent>
- Silent master: `<no-sound.mp4>` (narrated mode) · render `<NNN>` · capture <fps>fps
- Guardrail alerts justified: <list or "none">
- Anomalies: <list or "none">
```

**Anomalies are mandatory to report.** Anything that did not behave as
expected — a feature that errored and needed a retry/workaround, a beat
dropped because the UI never reached the scripted state, a flaky endpoint, a
take restarted — goes in the final message, even when the delivered video
looks fine. Never let the user discover a bug by watching the video.
