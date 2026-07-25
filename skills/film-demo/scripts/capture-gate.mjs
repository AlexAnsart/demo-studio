/**
 * Hard gate on CDP screencast health — refuse compose/sync/verify when capture
 * starved (choppy cursor). Written by screencast.mjs after every record.
 */
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'

export const CAPTURE_MIN_FPS = 25
export const CAPTURE_MAX_P90_MS = 80

export function loadCaptureStats(renderDir) {
  const path = join(renderDir, 'capture-stats.json')
  if (!existsSync(path)) return { path, stats: null }
  return { path, stats: JSON.parse(readFileSync(path, 'utf8')) }
}

/**
 * @returns {{ pass: boolean, issues: string[], stats: object|null, path: string }}
 */
export function checkCaptureStats(renderDir, options = {}) {
  const minFps = options.minFps ?? CAPTURE_MIN_FPS
  const maxP90Ms = options.maxP90Ms ?? CAPTURE_MAX_P90_MS
  const { path, stats } = loadCaptureStats(renderDir)
  const issues = []

  if (!stats) {
    issues.push(`Missing ${path} — record step did not finish screencast assembly`)
    return { pass: false, issues, stats: null, path }
  }

  const fps = stats.capturedFps
  const p90 = stats.frameIntervalMs?.p90

  if (!Number.isFinite(fps) || fps < minFps) {
    issues.push(
      `Capture fps too low: ${fps ?? 'n/a'} (min ${minFps}) — cursor will look choppy; re-record with less machine load or shorter LLM waits (use appear/done + loadingStart/loadingEnd brackets)`,
    )
  }
  if (!Number.isFinite(p90) || p90 > maxP90Ms) {
    issues.push(
      `Capture frame interval p90 too high: ${p90 ?? 'n/a'}ms (max ${maxP90Ms}ms) — irregular screencast; re-record`,
    )
  }

  return { pass: issues.length === 0, issues, stats, path }
}

/** Throws with a multi-line message when capture stats fail the gate. */
export function assertCaptureStats(renderDir, options = {}) {
  const result = checkCaptureStats(renderDir, options)
  if (!result.pass) {
    const detail = result.stats
      ? ` (${result.stats.frameCount} frames, ${result.stats.capturedFps} fps, p90=${result.stats.frameIntervalMs?.p90}ms)`
      : ''
    throw new Error(`Capture gate failed${detail}:\n${result.issues.map((i) => `  - ${i}`).join('\n')}`)
  }
  return result.stats
}
