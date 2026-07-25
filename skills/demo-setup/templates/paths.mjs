/** Render folder numbering + run log — copy to demos/_lib/ during demo-setup. */
import { mkdirSync, appendFileSync, readdirSync } from 'fs'
import { join } from 'path'

export function nextRenderDir(demoDir) {
  const renders = join(demoDir, 'renders')
  mkdirSync(renders, { recursive: true })
  const n =
    readdirSync(renders)
      .filter((d) => /^\d+$/.test(d))
      .map(Number)
      .reduce((a, b) => Math.max(a, b), 0) + 1
  const dir = join(renders, String(n).padStart(3, '0'))
  mkdirSync(dir, { recursive: true })
  return { dir, n }
}

export function initRunLog(renderDir) {
  appendFileSync(join(renderDir, 'run.log'), `[${new Date().toISOString()}] start\n`)
}

export function logRun(msg, renderDir) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  if (renderDir) appendFileSync(join(renderDir, 'run.log'), line)
  console.log(`[demo] ${msg}`)
}
