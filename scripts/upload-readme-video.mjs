#!/usr/bin/env node
/**
 * Upload an MP4 to GitHub user-attachments for README inline playback.
 * GitHub only renders <video> when src is github.com/user-attachments/assets/* —
 * release URLs and raw repo paths are stripped by the sanitizer.
 *
 * Usage: GH_TOKEN=... node scripts/upload-readme-video.mjs [path/to/video.mp4]
 */
import { readFileSync, statSync } from 'fs'
import { basename } from 'path'
import { spawnSync } from 'child_process'

const owner = 'AlexAnsart'
const repo = 'demo-studio'
const filePath = process.argv[2] ?? 'docs/assets/promo.mp4'

function getToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  const r = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  })
  const line = r.stdout.split('\n').find((l) => l.startsWith('password='))
  if (!line) throw new Error('No GH_TOKEN and git credential fill returned no password')
  return line.slice('password='.length)
}

async function ghApi(token, path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'demo-studio-upload',
      ...(opts.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub API ${path}: ${res.status} ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function getUploadToken(token) {
  const res = await fetch(`https://github.com/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'demo-studio-upload',
      Accept: 'text/html',
    },
  })
  if (!res.ok) throw new Error(`Repo page ${res.status}`)
  const html = await res.text()
  const m = html.match(/"uploadToken":"([^"]+)"/)
  if (!m) throw new Error('uploadToken not found — need repo write access')
  return m[1]
}

async function requestPolicy(token, uploadToken, repoId, fileName, fileSize) {
  const form = new FormData()
  form.append('name', fileName)
  form.append('size', String(fileSize))
  form.append('content_type', 'video/mp4')
  form.append('authenticity_token', uploadToken)
  form.append('repository_id', String(repoId))

  const res = await fetch('https://github.com/upload/policies/assets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      Origin: 'https://github.com',
      Referer: `https://github.com/${owner}/${repo}`,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'demo-studio-upload',
    },
    body: form,
  })
  if (res.status !== 201) {
    throw new Error(`Policy ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  return res.json()
}

async function uploadToS3(policy, filePath, fileName) {
  const body = new FormData()
  for (const [k, v] of Object.entries(policy.form)) body.append(k, v)
  body.append('file', new Blob([readFileSync(filePath)], { type: 'video/mp4' }), fileName)

  const res = await fetch(policy.upload_url, { method: 'POST', body })
  if (![200, 201, 204].includes(res.status)) {
    throw new Error(`S3 upload ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
}

async function finalize(token, policy) {
  const form = new FormData()
  form.append('authenticity_token', policy.asset_upload_authenticity_token)

  const res = await fetch(`https://github.com${policy.asset_upload_url}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      Origin: 'https://github.com',
      Referer: `https://github.com/${owner}/${repo}`,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'demo-studio-upload',
    },
    body: form,
  })
  if (res.status !== 200) {
    throw new Error(`Finalize ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  return res.json()
}

async function main() {
  const token = getToken()
  const stat = statSync(filePath)
  const fileName = basename(filePath)
  const repoId = (await ghApi(token, `/repos/${owner}/${repo}`)).id

  console.log(`Uploading ${filePath} (${(stat.size / 1e6).toFixed(2)} MB) → ${owner}/${repo}...`)

  const uploadToken = await getUploadToken(token)
  const policy = await requestPolicy(token, uploadToken, repoId, fileName, stat.size)
  await uploadToS3(policy, filePath, fileName)
  const result = await finalize(token, policy)

  console.log('\nAsset URL (use in README):')
  console.log(result.href)
  console.log('\nREADME snippet:')
  console.log(`<video src="${result.href}" controls width="900"></video>`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
