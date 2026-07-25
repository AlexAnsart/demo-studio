#!/usr/bin/env node
// Build sync-narration plan.json from align-narration.py output.
//
// Usage:
//   node build-plan-from-align.js --align aligned.json --out plan.json \
//     --video work.mp4 --audio narration.mp3 --output final.mp4 \
//     --targets 0,2,8,16,19.64,24.42,28 \
//     --cues-file cues.txt \
//     --tail-pad 1.0 \
//     [--seg-preroll 0.12] [--seg-postroll 0.20] [--min-silence 0.22] [--max-cue-chars 80]
//
// cues.txt = one caption cue per line, in script order.
// segmentTargets = when each audio segment should start in the final video (from a contact sheet).
// tail-pad = seconds of video (and silence) after the last spoken word — keep ≤ 1.5s.
// seg-preroll / seg-postroll = padding around Whisper word bounds, silence-aware
//   (never more than half the available inter-sentence silence, never mid-word).
// min-silence = below this boundary silence two sentences are MERGED into one
//   segment (cutting there would clip the TTS attack/release).
// max-cue-chars = hard cap per caption line (default fits a 1920px bar at fontsize 34).

import { readFileSync, writeFileSync } from 'node:fs'

function fail(msg) {
  console.error(`[build-plan] ${msg}`)
  process.exit(1)
}

const DEFAULT_SEG_PREROLL = 0.12
const DEFAULT_SEG_POSTROLL = 0.2
const DEFAULT_MIN_SILENCE = 0.22
const DEFAULT_MAX_CUE_CHARS = 80

/**
 * Whisper sentence bounds are unreliable at boundaries: a split word (e.g.
 * "any" + "time") can leave its tail token in no-man's land between two
 * sentences, and a gap inserted there cuts the word in half in the output.
 * Absorb every word that ends before the next sentence starts into the
 * EARLIER sentence — a sentence's audio runs until the next one begins.
 */
function absorbOrphanWords(segments, words) {
  return segments.map(([s, e], i) => {
    const nextStart = i + 1 < segments.length ? segments[i + 1][0] : Infinity
    let end = e
    for (const w of words) {
      if (w.start >= e - 0.01 && w.end <= nextStart + 0.001 && w.end > end) end = w.end
    }
    return [s, +end.toFixed(3)]
  })
}

/**
 * Merge sentences whose boundary silence is too small to cut cleanly — any
 * atrim there would clip the TTS release or attack. Returns { segments,
 * merges } where merges[k] lists the original sentence indices now fused.
 */
function mergeTightBoundaries(segments, minSilence) {
  const merged = []
  const groups = []
  for (let i = 0; i < segments.length; i++) {
    const last = merged[merged.length - 1]
    if (last && segments[i][0] - last[1] < minSilence) {
      last[1] = segments[i][1]
      groups[groups.length - 1].push(i)
    } else {
      merged.push([...segments[i]])
      groups.push([i])
    }
  }
  return { segments: merged, merges: groups.filter((g) => g.length > 1) }
}

/**
 * Word-aware padding: each cut point moves into the surrounding silence, but
 * never more than half of it (so the neighbouring sentence keeps its share)
 * and never past the requested pre/post-roll. The final segment always runs
 * to the end of the mp3 so the TTS release tail is never clipped.
 */
function applySegmentPadding(segments, preRoll, postRoll, audioDuration) {
  return segments.map(([s, e], i) => {
    const prevEnd = i === 0 ? 0 : segments[i - 1][1]
    const nextStart = i + 1 < segments.length ? segments[i + 1][0] : (audioDuration ?? e + postRoll)
    const silBefore = Math.max(0, s - prevEnd)
    const silAfter = Math.max(0, nextStart - e)
    const newStart = +(s - Math.min(preRoll, i === 0 ? s : silBefore / 2)).toFixed(3)
    const newEnd =
      i === segments.length - 1 && audioDuration != null
        ? +audioDuration.toFixed(3)
        : +(e + Math.min(postRoll, silAfter / 2)).toFixed(3)
    return [Math.max(0, newStart), newEnd]
  })
}

function parseArgs(argv) {
  const opts = { tailPad: 1.0, segPreroll: DEFAULT_SEG_PREROLL, segPostroll: DEFAULT_SEG_POSTROLL }
  const positional = []
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--align') opts.align = argv[++i]
    else if (a === '--out') opts.out = argv[++i]
    else if (a === '--video') opts.video = argv[++i]
    else if (a === '--audio') opts.audio = argv[++i]
    else if (a === '--output') opts.output = argv[++i]
    else if (a === '--targets') opts.targets = argv[++i].split(',').map(Number)
    else if (a === '--cues-file') opts.cuesFile = argv[++i]
    else if (a === '--tail-pad') opts.tailPad = Number(argv[++i])
    else if (a === '--head-pad') opts.headPad = Number(argv[++i])
    else if (a === '--seg-preroll') opts.segPreroll = Number(argv[++i])
    else if (a === '--seg-postroll') opts.segPostroll = Number(argv[++i])
    else if (a === '--min-silence') opts.minSilence = Number(argv[++i])
    else if (a === '--max-cue-chars') opts.maxCueChars = Number(argv[++i])
    else positional.push(a)
  }
  // Legacy: positional align [out]
  if (!opts.align && positional[0]) opts.align = positional[0]
  if (!opts.out && positional[1]) opts.out = positional[1]
  return opts
}

function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9']/g, '')
}

function findCueFrom(words, text, cursor = 0) {
  const tokens = text.replace(/[^a-zA-Z0-9' ,—-]/g, ' ').trim().split(/\s+/).filter(Boolean)
  let wi = cursor
  let start = null
  let end = null
  for (const token of tokens) {
    const nt = norm(token)
    let matched = false
    while (wi < words.length) {
      const w0 = norm(words[wi].word)
      if (w0 === nt) {
        if (start == null) start = words[wi].start
        end = words[wi].end
        wi++
        matched = true
        break
      }
      const merged = wi + 1 < words.length ? w0 + norm(words[wi + 1].word) : ''
      if (merged === nt) {
        if (start == null) start = words[wi].start
        end = words[wi + 1].end
        wi += 2
        matched = true
        break
      }
      wi++
    }
    if (!matched) throw new Error(`token "${token}" not found after index ${cursor} in: ${text}`)
  }
  return { start, end, nextIdx: wi }
}

const opts = parseArgs(process.argv)
if (!opts.align) {
  console.error(`usage: node build-plan-from-align.js --align aligned.json --out plan.json \\
  --video work.mp4 --audio narration.mp3 --output final.mp4 \\
  --targets 0,2,8,... --cues-file cues.txt [--tail-pad 1.0] [--seg-preroll 0.08] [--seg-postroll 0.12]`)
  process.exit(1)
}

const alignment = JSON.parse(readFileSync(opts.align, 'utf8'))
const words = alignment.words
const segmentPreRoll = opts.segPreroll ?? DEFAULT_SEG_PREROLL
const segmentPostRoll = opts.segPostroll ?? DEFAULT_SEG_POSTROLL
const minSilence = opts.minSilence ?? DEFAULT_MIN_SILENCE
const audioDuration = alignment.duration ?? null

// 1. sentence bounds → 2. absorb boundary-orphan words (mid-word cut fix)
//   → 3. merge sentences with no usable silence between them → 4. silence-aware padding
const rawSegments = absorbOrphanWords(alignment.sentences.map((s) => [s.start, s.end]), words)
const { segments: mergedSegments, merges } = mergeTightBoundaries(rawSegments, minSilence)
const sentenceTexts = []
{
  let k = 0
  for (const [s, e] of mergedSegments) {
    const parts = []
    while (k < alignment.sentences.length && alignment.sentences[k].start <= e + 0.001) {
      parts.push(alignment.sentences[k].text)
      k++
    }
    sentenceTexts.push(parts.join(' '))
  }
}
for (const g of merges) {
  console.error(
    `[build-plan] merged sentences ${g.join('+')} — boundary silence < ${minSilence}s, a gap there would clip mid-word. Pass ONE target for the merged block.`,
  )
}
const adjSegments = applySegmentPadding(mergedSegments, segmentPreRoll, segmentPostRoll, audioDuration)
const segments = mergedSegments

if (!opts.cuesFile) fail('--cues-file required')
const cueTexts = readFileSync(opts.cuesFile, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)

const maxCueChars = opts.maxCueChars ?? DEFAULT_MAX_CUE_CHARS
let cursor = 0
const captions = cueTexts.map((text) => {
  const { start, end, nextIdx } = findCueFrom(words, text, cursor)
  cursor = nextIdx
  const display = text.startsWith('only') || text.startsWith('same') ? `— ${text}` : text
  // One caption line must fit the caption bar — long cues overflow off-screen,
  // split them at clause breaks in cues.txt instead.
  if (display.length > maxCueChars) {
    fail(`cue is ${display.length} chars (max ${maxCueChars}) — split it at a clause break:\n  "${display}"`)
  }
  if (display.length > 60) {
    console.error(`[build-plan] note: cue is ${display.length} chars — under the limit but long; prefer ≤ 60:\n  "${display}"`)
  }
  const segment = adjSegments.findIndex(([s, e]) => start >= s - 0.01 && end <= e + 0.01)
  if (segment < 0) throw new Error(`cue outside segments: ${text} [${start}, ${end}]`)
  return { text: display, segment, start, end }
})

const segmentTargets = opts.targets
if (!segmentTargets?.length) throw new Error('--targets required (comma-separated output start times per sentence)')
if (segmentTargets.length !== segments.length) {
  throw new Error(
    `--targets has ${segmentTargets.length} values, need ${segments.length} (one per audio segment${merges.length ? ` — ${merges.length} sentence merge(s) reduced the count, see notes above` : ''})`,
  )
}

const gaps = []
for (let i = 0; i < adjSegments.length - 1; i++) {
  const segEnd = segmentTargets[i] + (adjSegments[i][1] - adjSegments[i][0])
  gaps.push(Math.max(0, +(segmentTargets[i + 1] - segEnd).toFixed(3)))
}

const speechEnd = segmentTargets.at(-1) + (adjSegments.at(-1)[1] - adjSegments.at(-1)[0])
const trailGap = +(opts.tailPad ?? 1.0).toFixed(3)
const expectedVideoDuration = +(speechEnd + trailGap).toFixed(3)
const leadGap = opts.headPad ?? 0

const plan = {
  video: opts.video,
  audio: opts.audio,
  output: opts.output,
  expectedVideoDuration,
  // Padding is BAKED into these bounds (silence-aware, word-safe) — rolls are
  // zeroed so sync-narration.mjs does not re-apply them.
  segments: adjSegments,
  segmentPreRoll: 0,
  segmentPostRoll: 0,
  audioDuration,
  gaps,
  leadGap,
  trailGap,
  segmentTargets,
  segmentTexts: sentenceTexts,
  captions,
}

const json = JSON.stringify(plan, null, 2)
if (opts.out) writeFileSync(opts.out, json, 'utf8')
else console.log(json)

console.error(`[build-plan] speech ends at ${speechEnd.toFixed(3)}s → trim video to ${expectedVideoDuration}s (tail-pad ${trailGap}s)`)
