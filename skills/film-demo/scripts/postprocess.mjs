#!/usr/bin/env node
/**
 * Post-record: trim lead + compress dead air. Usually run automatically by compose.mjs.
 * Usage: node postprocess.mjs <renderDir>
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { postprocessRecording } from './speedup.mjs'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const renderDir = process.argv[2]
  if (!renderDir) {
    console.error('Usage: node postprocess.mjs <renderDir>')
    process.exit(1)
  }
  const data = JSON.parse(readFileSync(join(renderDir, 'timeline.json'), 'utf8'))
  const result = postprocessRecording(renderDir, data, {}, (msg) => console.log(msg))
  console.log(JSON.stringify({ events: result.events.length, lastT: result.events[result.events.length - 1]?.t }, null, 2))
}
