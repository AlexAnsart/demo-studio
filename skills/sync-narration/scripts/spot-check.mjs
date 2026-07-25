#!/usr/bin/env node
// Spot-check narration ↔ picture sync on the FINAL rendered video.
//
// Extracts one frame at the start and end of every audio segment (plus the
// midpoint of every long inserted gap) and writes a JSON map "sentence ↔
// timestamp ↔ frame file". You MUST read every frame and confirm the on-screen
// state matches what the narration says at that moment (e.g. don't say "it's
// saved" while a spinner is still visible).
//
// Usage: node spot-check.mjs <plan.json> [--video path] [--out-dir dir]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'

function fail(msg) {
  console.error(`[spot-check] ${msg}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const planFile = args[0]
if (!planFile || planFile.startsWith('--')) fail('usage: node spot-check.mjs <plan.json> [--video path] [--out-dir dir]')
const opt = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}

const plan = JSON.parse(readFileSync(resolve(planFile), 'utf8'))
const planDir = dirname(resolve(planFile))
const video = resolve(planDir, opt('--video') ?? plan.output)
const outDir = resolve(planDir, opt('--out-dir') ?? 'spot-check')
if (!existsSync(video)) fail(`video not found: ${video} — run sync-narration.mjs first`)
mkdirSync(outDir, { recursive: true })

const segments = plan.segments
const gaps = plan.gaps ?? []
const leadGap = plan.leadGap ?? 0
const MAX_LEAD_GAP = 5
if (leadGap > MAX_LEAD_GAP) {
  fail(
    `leadGap ${leadGap}s exceeds ${MAX_LEAD_GAP}s — the viewer hears nothing while the video runs. ` +
      'Fix: preload the app off-camera before recording starts (first timeline event = first beat), ' +
      'then set --head-pad to the composed timestamp of that first beat, not the raw pre-recording offset.',
  )
}
const starts = []
let acc = leadGap
for (let i = 0; i < segments.length; i++) {
  starts.push(acc)
  acc += segments[i][1] - segments[i][0] + (gaps[i] ?? 0)
}

function grab(t, name) {
  const out = join(outDir, name)
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.max(0, t)), '-i', video, '-frames:v', '1', out], {
    encoding: 'utf8',
    timeout: 60_000,
  })
  return r.status === 0 && existsSync(out) ? out : null
}

const checks = []
checks.push({
  openingLeadSilence: true,
  leadGapSec: +leadGap.toFixed(3),
  frameAt05: grab(0.5, 'opening-0.5s.png'),
  frameAt2: grab(Math.min(2, leadGap > 0 ? leadGap - 0.1 : 2), 'opening-pre-narration.png'),
  note:
    leadGap > 3
      ? `${leadGap}s muted lead — confirm visible on-screen motion, not a static/blank opening frame`
      : 'lead gap OK — narration starts within 3s',
})
for (let i = 0; i < segments.length; i++) {
  const len = segments[i][1] - segments[i][0]
  const text = plan.segmentTexts?.[i] ?? plan.captions?.find((c) => c.segment === i)?.text ?? `(segment ${i})`
  const tStart = starts[i] + 0.2
  const tEnd = starts[i] + len - 0.2
  checks.push({
    segment: i,
    text,
    startsAt: +starts[i].toFixed(2),
    endsAt: +(starts[i] + len).toFixed(2),
    frameAtStart: grab(tStart, `seg${i}-start.png`),
    frameAtEnd: grab(Math.max(tStart + 0.1, tEnd), `seg${i}-end.png`),
  })
  const gap = gaps[i] ?? 0
  if (gap >= 2.5) {
    checks.push({
      gapAfterSegment: i,
      gapSec: +gap.toFixed(2),
      note: gap > 5 ? 'LONG silent stretch — something visible must be happening on screen here' : 'silent stretch',
      frameAtMid: grab(starts[i] + len + gap / 2, `gap${i}-mid.png`),
    })
  }
}

const report = {
  video,
  agentInstructions:
    'Read EVERY frame below. For each segment: the on-screen state at frameAtStart must already show what the sentence talks about (never narrate a result before it is visible), and frameAtEnd must still show it. For each gap frame: confirm something visibly happens during the silence (otherwise tighten the gap or move the target).',
  checks,
}
writeFileSync(join(outDir, 'spot-check.json'), JSON.stringify(report, null, 2), 'utf8')
for (const c of checks) {
  if (c.openingLeadSilence) {
    console.log(`opening lead silence: ${c.leadGapSec}s — ${c.note}`)
  } else if (c.text != null) {
    console.log(`seg ${c.segment}  ${c.startsAt}–${c.endsAt}s  "${c.text}"`)
  } else {
    console.log(`gap after seg ${c.gapAfterSegment}: ${c.gapSec}s (${c.note})`)
  }
}
console.log(`[spot-check] wrote ${join(outDir, 'spot-check.json')} — read every PNG before delivering.`)
