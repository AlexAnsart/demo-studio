/**
 * Loads `demo.config.json` from the target project. Every field has a safe
 * default, so a project with no config file still works (silent narration,
 * studio-dark frame, 1920x1080). See docs/CONFIG.md at the repo root for the
 * full schema — this file only defines defaults and the merge.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

export const DEFAULT_CONFIG = {
  app: { baseUrl: 'http://localhost:5173', viewport: { width: 1920, height: 1080 } },
  auth: { loginRequired: false },
  cursor: { scale: 1.6, color: '#0A0A0A' },
  camera: { padding: 0.22, maxZoom: 1.7, transitionSec: 0.72 },
  speedup: { toolWaitMax: 4, preToolWaitMax: 2.5, idleGapMax: 1.8, idleGapMin: 3.5 },
  frame: { preset: 'studio-dark', canvasWidth: 1920, canvasHeight: 1080 },
  narration: { provider: 'none', voiceName: 'Rachel', modelId: 'eleven_v3', stability: 1.0, apiKeyEnv: 'ELEVENLABS_API_KEY' },
  captions: { enabled: true, maxCharsPerLine: 60 },
  output: { dir: 'demos' },
}

function deepMerge(base, override) {
  if (!override) return base
  const out = { ...base }
  for (const key of Object.keys(override)) {
    const b = base[key]
    const o = override[key]
    out[key] = b && o && typeof b === 'object' && typeof o === 'object' && !Array.isArray(o) ? deepMerge(b, o) : o
  }
  return out
}

/**
 * @param {string} [cwd] directory to look for demo.config.json in (defaults to process.cwd())
 */
export function loadConfig(cwd = process.cwd()) {
  const path = join(cwd, 'demo.config.json')
  if (!existsSync(path)) return DEFAULT_CONFIG
  const user = JSON.parse(readFileSync(path, 'utf8'))
  return deepMerge(DEFAULT_CONFIG, user)
}
