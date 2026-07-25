---
name: sync-narration
description: Syncs a separately-recorded narration track onto a silent screen recording — pads audio with calculated pauses to match on-screen pacing (no voice during cursor movement), then burns styled captions. Use when the user provides a silent screen-recorded video plus a narration .mp3 and asks to sync/combine/caption them.
---

# Sync narration onto a silent screen recording

Input: silent screen recording (from `film-demo`) + a narration `.mp3` (from
`narrate`, or any TTS/recorded voice). Output: final `.mp4` with paced
narration + burned-in captions.

**Never ship** with (a) captions out of sync with audio, (b) long video
stretches with no narration at the start or end — that reads as broken/empty,
(c) clipped TTS onsets **or** release tails (last syllable cut off — use
`--seg-postroll`, see below), or (d) narration playing while the cursor is
still moving — voice should land only after the pointer has settled on the
target element.

---

## Quick start (copy-paste per video)

```bash
# 0 — once
pip install -r scripts/requirements.txt

# 1 — align audio to script (local Whisper, no API key)
python scripts/align-narration.py \
  demos/<slug>/narration.mp3 \
  --script-file script.txt \
  --out /tmp/aligned.json

# 2 — contact sheet → pick segmentTargets (when each sentence should start on screen)
ffmpeg -y -i demos/<slug>/no-sound.mp4 -vf "fps=1/2,scale=384:-1,tile=5x6" -update 1 -frames:v 1 /tmp/contact.png

# 3 — write cues.txt (one caption line per readable cue, exact script wording, ≤ 60 chars)
# 4 — build plan (defaults: seg-preroll 0.12, seg-postroll 0.20, min-silence 0.22, max-cue-chars 80)
node scripts/build-plan-from-align.js \
  --align /tmp/aligned.json --out /tmp/plan.json \
  --video /tmp/work.mp4 \
  --audio demos/<slug>/narration.mp3 \
  --output demos/<slug>/final.mp4 \
  --targets 0,2,8,… \
  --cues-file cues.txt \
  --tail-pad 1.0

# 5 — work video (default: full no-sound.mp4, no trim)
ffmpeg -y -i demos/<slug>/no-sound.mp4 -c:v copy -an /tmp/work.mp4
# Only trim if you verified dead footage — see "Video trim (conservative)" below

# 6 — validate + render
node scripts/sync-narration.mjs /tmp/plan.json --validate-only
node scripts/sync-narration.mjs /tmp/plan.json

# 7 — spot-check narration ↔ picture on the FINAL render (mandatory)
node scripts/spot-check.mjs /tmp/plan.json
# → read EVERY PNG in spot-check/: at each sentence start the screen must already
#   show what the sentence talks about; during long gaps something must be happening.
```

---

## How the three layers fit together

| Layer | Tool | What it controls |
|-------|------|------------------|
| **When each word is spoken** | `align-narration.py` (faster-whisper) | Word + sentence timestamps in the raw `.mp3` |
| **When each sentence lands on screen** | `segmentTargets` in `build-plan-from-align.js` | Inserted gaps *between* sentences |
| **When each caption appears** | Caption `start`/`end` from word alignment | Burned subs locked to audio |
| **Audio attack (no clipped onset)** | `--seg-preroll` (default **0.12 s**, silence-aware) | `atrim` starts slightly *before* Whisper word onset |
| **Audio release (no clipped ending)** | `--seg-postroll` (default **0.20 s**, silence-aware) | `atrim` extends after last word; final segment runs to mp3 end |
| **No cut inside a word** | orphan-word absorption + `--min-silence` (default **0.22 s**) | boundary words are absorbed into the earlier sentence; sentences without usable silence between them are **merged into one segment** (one target for the block) |

**Gaps** stretch narration to match UI pacing. **Video length** defaults to the full silent
recording — the padded audio track is often shorter than the screen capture, and the tail of the
video carries visual payoffs after the last spoken word.

---

## 1. faster-whisper alignment (no API key)

Install: `pip install -r scripts/requirements.txt`

Default model is `base` (~150 MB, one-time download) — its word boundaries are noticeably
tighter than `tiny`; clipped onsets (first letter of a word missing) usually trace back to
running `tiny`. Only drop to `--model tiny` when iterating fast on something non-final.

```bash
python scripts/align-narration.py narration.mp3 \
  --script-file script.txt \
  --out aligned.json
```

Output:
- `words[]` — `{ word, start, end }` for every token
- `sentences[]` — sentence blocks matched to the script

**Use this for:**
- Audio `segments` boundaries (one per sentence — never split at comma pauses)
- Caption cue `start`/`end` (via `build-plan-from-align.js` + `cues.txt`)

**Do not** use `silencedetect` alone for caption timing — comma pauses inside a sentence are
not sentence boundaries.

### Word-safe segment boundaries (fixes clipped attack/release AND mid-word cuts)

Whisper word timestamps lag the audible envelope on both sides (~50–350 ms), and its sentence
bounds sometimes leave a split word's tail token stranded between two sentences — an inserted gap
there cuts the word in half in the output. `build-plan-from-align.js` handles all of this
deterministically:

1. **Orphan-word absorption** — any word that ends before the next sentence starts is absorbed
   into the earlier sentence. A sentence's audio runs until the next one begins; nothing is left
   in no-man's land.
2. **Tight-boundary merge** (`--min-silence`, default **0.22 s**) — when the silence between two
   sentences is smaller than this, cutting there would clip the TTS release/attack, so the two
   sentences are **merged into one audio segment**. The script prints which sentences merged;
   pass **one** `--targets` value for the merged block.
3. **Silence-aware padding** — `--seg-preroll` (default **0.12**) and `--seg-postroll` (default
   **0.20**) extend each cut into the surrounding silence, but never more than **half** of it
   (the neighbouring sentence keeps its share) and the final segment always runs to the full
   `.mp3` duration.

The padded bounds are **baked into `plan.segments`** (`segmentPreRoll`/`segmentPostRoll` are 0
in the emitted plan) — `sync-narration.mjs` uses them as-is.

- **Listen-check before ship:** scrub the last 1 s of audio in the rendered file — the final word
  should decay naturally, not stop mid-syllable.

---

## 2. Contact sheet → segmentTargets

```bash
ffmpeg -y -i no-sound.mp4 -vf "fps=1/2,scale=384:-1,tile=5x6" -update 1 -frames:v 1 contact.png
```

Read the grid (cell `i` ≈ `i×2` s). For each sentence in `aligned.json`, pick the output time
when that topic is **visible** — pass as comma list to `--targets`.

### No voice during cursor movement

**Do not start a sentence while the pointer is traveling.** Narration competes with motion and
reads as rushed or out of sync. For each sentence:

1. Find the frame where the cursor **lands** on the element you are describing — not the frame
   where movement begins.
2. Set `--targets[i]` to that settled moment (add gap before the sentence if the raw `.mp3`
   would speak too early).
3. If a beat requires both travel *and* a click, speak **after** the click completes and the UI
   has updated — never over the travel or click animation.

When in doubt, pause 0.5–1 s longer before the line rather than talking over cursor motion.

---

## 3. Captions (`cues.txt`)

One line per readable cue — **≤ 60 characters preferred, 80 hard max** (the plan builder fails
above `--max-cue-chars`, default 80; a longer line physically overflows the caption bar at the
default fontsize). Split long sentences at natural clause breaks; lines starting with `only` /
`same` get an em dash prefix in the plan builder.

Compound sentence = **one audio segment**, multiple caption lines. Whisper word times set each
cue's `[start,end]` inside that segment.

---

## 4. Build plan + trim video

```bash
node scripts/build-plan-from-align.js \
  --align aligned.json --out plan.json \
  --video work.mp4 --audio narration.mp3 --output final.mp4 \
  --targets 0,2,8,16,19.64,24.42,28 \
  --cues-file cues.txt \
  --tail-pad 1.0
```

Prints: `speech ends at Xs → trim video to Ys (tail-pad 1s)` — plus any sentence merges
(then `--targets` needs one value per **merged** segment, not per script sentence).

**Important:** that `expectedVideoDuration` is the **padded audio length**, not a mandate to cut
the screen recording. If the silent video is longer, keep it — the extra tail is usually the
visual payoff after the last word (see validate warning: `video is longer than built timeline` → OK).

Plan fields:
- `segments` — `[start,end]` in **original mp3** time, word-safe padding already baked in
- `segmentPreRoll` / `segmentPostRoll` — **0** in emitted plans (padding baked into `segments`)
- `audioDuration` — full `.mp3` length from alignment (used for final-segment tail)
- `gaps` — silence inserted **between** segments so each starts at `--targets[i]`
- `trailGap` — `--tail-pad` (default **1.0 s** after last word)
- `expectedVideoDuration` — padded audio length (`speech end + tail-pad`); informational only
- `segmentTargets` / `segmentTexts` — echoed for `spot-check.mjs`

### Video trim (conservative — default: **no trim**)

**Start from the full silent video.** The sync script accepts a video longer than the padded
audio; output duration follows the video. After the last caption, the viewer should still see
key beats from the beat script.

Only cut when you have **verified** the removed section adds nothing:

1. **Before any cut** — re-read the beat script and every planned narration clause.
2. **Contact sheet** — generate one for the full recording; map each beat to a cell/time.
3. **Decide** — if a proposed cut removes any mapped beat, **do not cut**.
4. **Spot-check** — grab frames at the proposed cut point and 2 s after the planned end:
   `ffmpeg -y -ss <t> -i no-sound.mp4 -update 1 -frames:v 1 check.png`

| Situation | Action |
|-----------|--------|
| **Default** | `-c:v copy` the full silent video → `work.mp4`; ignore `expectedVideoDuration` |
| Video longer than padded audio (validate warning) | **Expected** — keep the video; tail holds visual payoff |
| Dead tail *after* the last beat (cursor idle, blank screen, stop-recording artefact) | Trim only that dead tail (typically ≤ 1–2 s) |
| Dead head *before* the first beat (accidental pre-roll) | `-ss` head trim only if the first 2+ s contain **no** beat content |
| `trailGap` > 1.5 s in validate output | Wrong gap/targets — fix `--targets`, do not inflate `trailGap` to fill dead video |
| Tempted to trim to `expectedVideoDuration` to "tighten" runtime | **Stop** — check whether that removes a payoff first |

**Never** combine head trim + tail trim to match audio length without cross-checking every beat.
When in doubt, ship the full recording. Keep the silent master and `.mp3` untouched — only the
final `.mp4` ships.

---

## 5. Validate + render

```bash
node scripts/sync-narration.mjs plan.json --validate-only   # mandatory
node scripts/sync-narration.mjs plan.json
```

Read the printed timeline. Every caption window must sit inside a speech block. `trail silence`
should be ≤ `--tail-pad` (≈ 1 s).

A validate warning like `video is longer than built timeline` is **normal** when keeping the full
recording for post-narration visual payoffs — confirm the extra tail matches a beat, then render.

Verify sync **and** payoff — mandatory, on the FINAL render:

```bash
node scripts/spot-check.mjs plan.json
```

It extracts a frame at the start and end of **every** audio segment plus the midpoint of every
long gap, and writes `spot-check/spot-check.json`. Read **every** PNG:

- At a sentence's start frame, the screen must **already show** what the sentence talks about —
  never narrate a result ("it's saved") while a spinner is still visible.
- The pointer should be **idle** on the described element, not mid-travel.
- During a long gap frame, something must visibly be happening (otherwise tighten the gap).

Re-run `build-plan-from-align.js` with later `--targets` if any line starts too early.

---

## Caption style & fonts

Default look (override any field via `plan.style`): full-width black bar at bottom
(`barColor: 'black@0.82'`), 1px white top border, centered monospace, no drop shadow.

`sync-narration.mjs` auto-detects a system monospace font (Windows: Consolas; macOS: Menlo;
Linux: DejaVu Sans Mono / Liberation Mono). If none is found on your system, set
`plan.style.fontfile` to an absolute path to a `.ttf`/`.ttc` file.

---

## Manual plan.json (fallback)

Only if Whisper cannot run. Same rules: sentence segments only, gaps between sentences,
captions via `{ text, segment, start, end }`, `trailGap` ≤ 1.5 s, `segmentPreRoll` 0.12 s,
`segmentPostRoll` 0.20 s (unless ending still clips), never cut where silence < 0.22 s,
trim video to match.

---

## ffmpeg gotchas (cross-platform)

- Pass `-filter_complex` via `spawnSync` args — not `-filter_complex_script` with raw drive
  paths on Windows.
- Windows only: escape drive colons in filter values (`C\\:/Windows/...`) — `sync-narration.mjs`
  does this automatically via `ffPath()`.
- Use `textfile=` for captions, never `text=` (apostrophes/colons break the graph).
