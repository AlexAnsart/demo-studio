#!/usr/bin/env node
/**
 * Environment sanity check for the demo-studio skills — run once during setup
 * and any time a video pipeline fails mysteriously. No dependency on the
 * other skills' code, so this works even before the engine is vendored.
 */
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'

function check(label, fn) {
  try {
    const result = fn()
    console.log(`[ok]   ${label}${result ? ` — ${result}` : ''}`)
    return true
  } catch (err) {
    console.log(`[FAIL] ${label} — ${err.message}`)
    return false
  }
}

function version(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  if (r.status !== 0 && r.error) throw new Error(r.error.message)
  if (r.status !== 0) throw new Error(`exit code ${r.status}`)
  return r.stdout.trim().split('\n')[0]
}

let allOk = true
allOk = check('node', () => process.version) && allOk
allOk = check('ffmpeg on PATH', () => version('ffmpeg')) && allOk
allOk = check('ffprobe on PATH', () => version('ffprobe')) && allOk
allOk =
  check('python3 on PATH (needed for narrate / sync-narration)', () => {
    try {
      return version('python3')
    } catch {
      return version('python')
    }
  }) && allOk
allOk = check('demo.config.json present', () => {
  if (!existsSync('demo.config.json')) throw new Error('not found in cwd — run demo-setup')
  return 'found'
}) && allOk

console.log('')
console.log(allOk ? 'All checks passed.' : 'Fix the FAILs above before recording.')
process.exit(allOk ? 0 : 1)
