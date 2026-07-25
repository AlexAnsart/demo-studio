#!/usr/bin/env node
// Builds a final video from (1) a silent screen recording and (2) a separately
// generated narration track, by inserting calculated silence gaps into the
// audio so it lines up with the video, then burning styled captions.
// See ../SKILL.md for the full workflow (silence detection, contact sheet, plan design).
//
// Usage: node sync-narration.mjs <plan.json> [--validate-only]

import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { platform } from 'node:os'

const DEFAULT_SEG_PREROLL = 0.08
const DEFAULT_SEG_POSTROLL = 0.12

/** Extend atrim bounds: pre-roll before first word; post-roll after last word (full mp3 tail on final segment). */
function applySegmentPadding(segments, preRoll, postRoll, audioDuration) {
  if (!preRoll && !postRoll) return segments
  return segments.map(([s, e], i) => {
    const floor = i === 0 ? 0 : segments[i - 1][1]
    const newStart = preRoll ? Math.max(floor, +(s - preRoll).toFixed(3)) : s
    let newEnd = e
    if (postRoll) {
      if (i === segments.length - 1 && audioDuration != null) {
        newEnd = +audioDuration.toFixed(3)
      } else if (i < segments.length - 1) {
        const nextStart = segments[i + 1][0]
        newEnd = +Math.min(nextStart, e + postRoll).toFixed(3)
      } else {
        newEnd = +(e + postRoll).toFixed(3)
      }
    }
    return [newStart, newEnd]
  })
}

/**
 * A monospace font is required for a stable caption bar width across ffmpeg
 * builds. Try common per-OS system fonts and fall back to `null` — if none
 * are found, `plan.style.fontfile` (or `--font`) must supply one explicitly.
 */
function findDefaultFont() {
  const candidates = {
    win32: ['C:/Windows/Fonts/consola.ttf', 'C:/Windows/Fonts/cour.ttf'],
    darwin: ['/System/Library/Fonts/Menlo.ttc', '/Library/Fonts/Menlo.ttc'],
    linux: [
      '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
    ],
  }
  for (const p of candidates[platform()] ?? []) {
    if (existsSync(p)) return p
  }
  return null
}

const DEFAULT_STYLE = {
  fontfile: findDefaultFont(),
  fontsize: 34,
  barHeight: 92,
  barColor: 'black@0.82',
  borderColor: 'white@0.35',
  borderHeight: 2,
  sampleRate: 44100,
}

function fail(msg) {
  console.error(`[sync-narration] ${msg}`)
  process.exit(1)
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' })
  if (res.status !== 0) {
    console.error(res.stdout)
    console.error(res.stderr)
    fail(`${cmd} exited with code ${res.status}`)
  }
  return res
}

function ffprobeDuration(path) {
  const res = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path])
  return parseFloat(res.stdout.trim())
}

/** Escapes a path for use inside an ffmpeg filter value (drive-letter colons, backslashes). */
function ffPath(p) {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\\\:')
}

function planPath() {
  const p = process.argv[2]
  if (!p || p.startsWith('--')) fail('usage: node sync-narration.mjs <plan.json> [--validate-only]')
  return resolve(p)
}

function findSegmentIndex(segments, t) {
  for (let i = 0; i < segments.length; i++) {
    const [s, e] = segments[i]
    if (t >= s - 0.001 && t <= e + 0.001) return i
  }
  return -1
}

function toOutputTime(segments, newStartOfSegment, t) {
  const i = findSegmentIndex(segments, t)
  if (i < 0) fail(`timestamp ${t}s falls outside every segment — cannot map to output timeline`)
  return newStartOfSegment[i] + (t - segments[i][0])
}

function resolveCaptions(plan, segments, newStartOfSegment) {
  if (plan.captionTexts) {
    if (plan.captionTexts.length !== segments.length) {
      fail(`captionTexts.length (${plan.captionTexts.length}) must match segments.length (${segments.length})`)
    }
    return plan.captionTexts.map((text, i) => ({
      text,
      startOut: newStartOfSegment[i],
      endOut: newStartOfSegment[i] + (segments[i][1] - segments[i][0]),
    }))
  }

  if (!plan.captions?.length) fail('plan must include captions[] or captionTexts[]')

  return plan.captions.map((cap, idx) => {
    if (cap.startOut != null && cap.endOut != null) {
      return { text: cap.text, startOut: cap.startOut, endOut: cap.endOut }
    }

    if (cap.segment != null) {
      const i = cap.segment
      if (i < 0 || i >= segments.length) fail(`caption ${idx}: segment index ${i} out of range`)
      const [s, e] = segments[i]
      const relStart = cap.start ?? s
      const relEnd = cap.end ?? e
      if (relStart < s - 0.001 || relEnd > e + 0.001) {
        fail(`caption ${idx}: [${relStart}, ${relEnd}] must lie within segment ${i} [${s}, ${e}]`)
      }
      return {
        text: cap.text,
        startOut: toOutputTime(segments, newStartOfSegment, relStart),
        endOut: toOutputTime(segments, newStartOfSegment, relEnd),
      }
    }

    // Legacy: original-audio timestamps — map start and end independently.
    const startOut = toOutputTime(segments, newStartOfSegment, cap.start)
    const endOut = toOutputTime(segments, newStartOfSegment, cap.end)
    if (findSegmentIndex(segments, cap.start) !== findSegmentIndex(segments, cap.end)) {
      fail(
        `caption ${idx} spans multiple audio segments (${cap.start}–${cap.end}). ` +
        'Use segment + start/end sub-ranges, or split into separate cues.'
      )
    }
    return { text: cap.text, startOut, endOut }
  })
}

function validateCaptions(captions, totalAudioDuration) {
  for (let i = 0; i < captions.length; i++) {
    const c = captions[i]
    if (c.endOut <= c.startOut + 0.05) fail(`caption ${i} endOut must be after startOut`)
    if (c.startOut < -0.001 || c.endOut > totalAudioDuration + 0.05) {
      fail(`caption ${i} [${c.startOut.toFixed(3)}, ${c.endOut.toFixed(3)}] outside padded audio (${totalAudioDuration.toFixed(3)}s)`)
    }
    if (i > 0 && c.startOut < captions[i - 1].endOut - 0.02) {
      fail(`caption ${i} overlaps previous cue (starts ${c.startOut.toFixed(3)}, prev ends ${captions[i - 1].endOut.toFixed(3)})`)
    }
  }
}

function printTimeline(captions, segments, newStartOfSegment, gaps, leadGap, trailGap) {
  console.log('[sync-narration] timeline (output seconds):')
  if (leadGap > 0) console.log(`  ${(0).toFixed(3)}–${leadGap.toFixed(3)}  [lead silence]`)
  segments.forEach(([s, e], i) => {
    const outS = newStartOfSegment[i]
    const outE = outS + (e - s)
    console.log(`  ${outS.toFixed(3)}–${outE.toFixed(3)}  [audio seg ${i}] original ${s}–${e}`)
    if (i < gaps.length) {
      const gS = outE
      const gE = gS + gaps[i]
      console.log(`  ${gS.toFixed(3)}–${gE.toFixed(3)}  [inserted gap ${i}]`)
    }
  })
  if (trailGap > 0) {
    const tS = newStartOfSegment[segments.length - 1] + (segments.at(-1)[1] - segments.at(-1)[0])
    console.log(`  ${tS.toFixed(3)}–${(tS + trailGap).toFixed(3)}  [trail silence]`)
  }
  console.log('[sync-narration] captions:')
  captions.forEach((c, i) => {
    console.log(`  ${c.startOut.toFixed(3)}–${c.endOut.toFixed(3)}  ${JSON.stringify(c.text)}`)
  })
}

function main() {
  const validateOnly = process.argv.includes('--validate-only')
  const plan = JSON.parse(readFileSync(planPath(), 'utf8'))
  const style = { ...DEFAULT_STYLE, ...(plan.style ?? {}) }
  const video = resolve(dirname(planPath()), plan.video)
  const audio = resolve(dirname(planPath()), plan.audio)
  const output = resolve(dirname(planPath()), plan.output)

  if (!existsSync(video)) fail(`video not found: ${video}`)
  if (!existsSync(audio)) fail(`audio not found: ${audio}`)
  if (!style.fontfile) fail('no monospace font found on this system — set style.fontfile in plan.json to an absolute .ttf/.ttc path')
  if (!existsSync(style.fontfile)) fail(`fontfile not found: ${style.fontfile}`)

  const segmentPreRoll = plan.segmentPreRoll ?? DEFAULT_SEG_PREROLL
  const segmentPostRoll = plan.segmentPostRoll ?? DEFAULT_SEG_POSTROLL
  const audioDuration = plan.audioDuration ?? ffprobeDuration(audio)
  const segments = applySegmentPadding(plan.segments, segmentPreRoll, segmentPostRoll, audioDuration)
  const gaps = plan.gaps ?? []
  const leadGap = plan.leadGap ?? 0
  const trailGap = plan.trailGap ?? 0
  if (gaps.length !== segments.length - 1) {
    fail(`gaps.length must be segments.length - 1 (got ${gaps.length} vs ${segments.length - 1})`)
  }

  const newStartOfSegment = []
  let acc = leadGap
  for (let i = 0; i < segments.length; i++) {
    newStartOfSegment.push(acc)
    acc += (segments[i][1] - segments[i][0]) + (gaps[i] ?? 0)
  }
  const totalAudioDuration = acc + trailGap

  const videoDuration = ffprobeDuration(video)
  if (Math.abs(totalAudioDuration - videoDuration) > 0.05) {
    console.warn(
      `[sync-narration] WARNING: built timeline is ${totalAudioDuration.toFixed(3)}s, ` +
      `video is ${videoDuration.toFixed(3)}s (diff ${(totalAudioDuration - videoDuration).toFixed(3)}s). Adjust trailGap/leadGap/gaps.`
    )
  }

  const captions = resolveCaptions(plan, segments, newStartOfSegment)
  validateCaptions(captions, totalAudioDuration)
  printTimeline(captions, segments, newStartOfSegment, gaps, leadGap, trailGap)

  if (validateOnly) {
    console.log('[sync-narration] validate-only: OK')
    return
  }

  const audioNodes = []
  const concatLabels = []
  if (leadGap > 0) {
    audioNodes.push(`anullsrc=r=${style.sampleRate}:cl=mono:d=${leadGap}[lead]`)
    concatLabels.push('[lead]')
  }
  segments.forEach(([s, e], i) => {
    audioNodes.push(`[1:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`)
    concatLabels.push(`[a${i}]`)
    if (i < gaps.length) {
      audioNodes.push(`anullsrc=r=${style.sampleRate}:cl=mono:d=${gaps[i]}[g${i}]`)
      concatLabels.push(`[g${i}]`)
    }
  })
  if (trailGap > 0) {
    audioNodes.push(`anullsrc=r=${style.sampleRate}:cl=mono:d=${trailGap}[trail]`)
    concatLabels.push('[trail]')
  }
  audioNodes.push(`${concatLabels.join('')}concat=n=${concatLabels.length}:v=0:a=1[aout]`)

  const scriptDir = mkdtempSync(resolve(tmpdir(), 'sync-narration-'))
  captions.forEach((cap, i) => {
    writeFileSync(resolve(scriptDir, `caption_${i}.txt`), cap.text, 'utf8')
  })

  const videoNodes = []
  let prev = '[0:v]'
  captions.forEach((cap, i) => {
    const start = cap.startOut.toFixed(3)
    const end = cap.endOut.toFixed(3)
    const barTop = `ih-${style.barHeight}`
    const nextBar = `[vb${i}]`
    const nextBorder = `[vd${i}]`
    const nextText = `[vt${i}]`
    const textfile = ffPath(resolve(scriptDir, `caption_${i}.txt`))
    videoNodes.push(`${prev}drawbox=x=0:y=${barTop}:w=iw:h=${style.barHeight}:color=${style.barColor}:t=fill:enable='between(t,${start},${end})'${nextBar}`)
    videoNodes.push(`${nextBar}drawbox=x=0:y=${barTop}:w=iw:h=${style.borderHeight}:color=${style.borderColor}:t=fill:enable='between(t,${start},${end})'${nextBorder}`)
    videoNodes.push(
      `${nextBorder}drawtext=fontfile=${ffPath(style.fontfile)}:textfile=${textfile}:reload=1:fontsize=${style.fontsize}:fontcolor=white:` +
      `x=(w-text_w)/2:y=(h-${style.barHeight})+(${style.barHeight}-text_h)/2:enable='between(t,${start},${end})'${nextText}`
    )
    prev = nextText
  })
  videoNodes.push(`${prev}null[vout]`)

  const filterScript = [...audioNodes, ...videoNodes].join(';')
  const scriptPath = resolve(scriptDir, 'filter.txt')
  writeFileSync(scriptPath, filterScript, 'utf8')

  console.log(`[sync-narration] filter graph (debug copy): ${scriptPath}`)
  console.log(`[sync-narration] rendering -> ${output}`)

  run('ffmpeg', [
    '-y',
    '-i', video,
    '-i', audio,
    '-filter_complex', filterScript,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    output,
  ])

  const finalDuration = ffprobeDuration(output)
  console.log(`[sync-narration] done. output duration: ${finalDuration.toFixed(3)}s (video was ${videoDuration.toFixed(3)}s)`)
}

main()
