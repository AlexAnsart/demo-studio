/**
 * Frame inspector — lets the agent SEE what the final video shows without
 * watching it. Extracts frames from the raw capture and draws, on each frame:
 *   - the crop rect the final video displays at that instant (white, 4px)
 *   - the focus zone box, when the active shot has one (gray)
 *   - the scripted cursor position (filled square)
 * plus a JSON sidecar with exact numbers (crop, cursor, distances to edges).
 *
 * Usage:
 *   node inspect.mjs <renderDir>                 # auto: settle + midpoint of every shot
 *   node inspect.mjs <renderDir> --times 3,10.5  # specific timestamps (final-video time)
 *   node inspect.mjs <renderDir> --alerts        # frames at every guardrail alert
 */
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { spawnSync } from 'child_process'
import { pathToFileURL } from 'url'
import { cameraAt } from './zoompan-expr.mjs'
import { cursorAt } from './guardrails.mjs'
import { FILM_VIEWPORT, rawVideoPath } from './record.mjs'

const MAX_FRAMES = 24

function extractAnnotated(rawPath, t, cam, cur, zone, outPath) {
  const boxes = []
  boxes.push(`drawbox=x=${Math.round(cam.x)}:y=${Math.round(cam.y)}:w=${Math.round(cam.w)}:h=${Math.round(cam.h)}:color=white@0.9:t=4`)
  if (zone) boxes.push(`drawbox=x=${zone.x}:y=${zone.y}:w=${zone.w}:h=${zone.h}:color=gray@0.8:t=2`)
  if (cur) boxes.push(`drawbox=x=${Math.round(cur.x) - 8}:y=${Math.round(cur.y) - 8}:w=16:h=16:color=white@1:t=fill`)
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-ss', String(t), '-i', rawPath, '-frames:v', '1', '-vf', boxes.join(','), outPath],
    { encoding: 'utf8', timeout: 60_000 },
  )
  return r.status === 0 && existsSync(outPath)
}

export function inspectFilm(renderDir, times) {
  const { width: W, height: H } = FILM_VIEWPORT
  const { cursor } = JSON.parse(readFileSync(join(renderDir, 'timeline.json'), 'utf8'))
  const shots = JSON.parse(readFileSync(join(renderDir, 'zoom-plan.json'), 'utf8'))
  const rawPath = rawVideoPath(renderDir)
  const outDir = join(renderDir, 'review')
  mkdirSync(outDir, { recursive: true })

  const duration = shots.length ? shots[shots.length - 1].tEnd : 0
  let ts = times
  if (!ts?.length) {
    ts = []
    for (const s of shots) {
      ts.push(Math.min(s.tStart + (s.transSec ?? 0.72) + 0.15, s.tEnd - 0.05)) // settled
      if (s.tEnd - s.tStart > 4) ts.push((s.tStart + s.tEnd) / 2) // midpoint of long holds
    }
  }
  ts = [...new Set(ts.map((t) => Math.round(Math.min(Math.max(t, 0), Math.max(duration - 0.05, 0)) * 10) / 10))]
    .sort((a, b) => a - b)
    .slice(0, MAX_FRAMES)

  const frames = []
  for (const t of ts) {
    const cam = cameraAt(shots, t, { sourceW: W, sourceH: H })
    const cur = cursorAt(cursor, t)
    const shot = shots[cam.shotIndex]
    const file = join(outDir, `inspect-${t.toFixed(1)}s.png`)
    const ok = extractAnnotated(rawPath, t, cam, cur, shot?.zone, file)
    const inCrop = cur ? cur.x >= cam.x && cur.x <= cam.x + cam.w && cur.y >= cam.y && cur.y <= cam.y + cam.h : null
    frames.push({
      t,
      file: ok ? file : null,
      shot: cam.label,
      zoom: Math.round(cam.zoom * 100) / 100,
      crop: { x: Math.round(cam.x), y: Math.round(cam.y), w: Math.round(cam.w), h: Math.round(cam.h) },
      cursor: cur ? { x: Math.round(cur.x), y: Math.round(cur.y), inCrop } : null,
      cursorToEdges: cur
        ? {
            left: Math.round(cur.x - cam.x),
            right: Math.round(cam.x + cam.w - cur.x),
            top: Math.round(cur.y - cam.y),
            bottom: Math.round(cam.y + cam.h - cur.y),
          }
        : null,
      zone: shot?.zone ?? null,
    })
  }

  const meta = { note: 'crop = white box (what the final video shows), zone = gray box, cursor = filled square', frames }
  writeFileSync(join(outDir, 'inspect.json'), JSON.stringify(meta, null, 2), 'utf8')
  return meta
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const renderDir = args[0]
  if (!renderDir) {
    console.error('Usage: node inspect.mjs <renderDir> [--times t1,t2,...] [--alerts]')
    process.exit(2)
  }
  let times = null
  const tIdx = args.indexOf('--times')
  if (tIdx >= 0) times = args[tIdx + 1].split(',').map(Number).filter(Number.isFinite)
  if (args.includes('--alerts')) {
    const report = JSON.parse(readFileSync(join(renderDir, 'guardrails-report.json'), 'utf8'))
    times = report.alerts.flatMap((a) => (a.tEnd ? [a.tStart, (a.tStart + a.tEnd) / 2] : [a.tStart]))
    if (!times.length) {
      console.log('No alerts — nothing to inspect. Run without --alerts for a full pass.')
      process.exit(0)
    }
  }
  const meta = inspectFilm(renderDir, times)
  for (const f of meta.frames) {
    console.log(
      `${f.t.toFixed(1)}s  shot="${f.shot}" zoom=${f.zoom} cursor=${f.cursor ? `${f.cursor.x},${f.cursor.y} ${f.cursor.inCrop ? 'IN' : 'OUT-OF'}-crop` : 'n/a'}  ${f.file ?? 'EXTRACT FAILED'}`,
    )
  }
}
