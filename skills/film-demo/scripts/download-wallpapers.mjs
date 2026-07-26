/**
 * Downloads curated wallpapers from Unsplash into ../assets/wallpapers/.
 * All images: Unsplash License (free commercial use, modification OK).
 *
 * Usage: node download-wallpapers.mjs [--only name1,name2]
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'assets', 'wallpapers')

const TARGET_W = 2400
const TARGET_H = 1350

function u(id) {
  return `https://unsplash.com/photos/${id}/download?force=true&w=${TARGET_W}&h=${TARGET_H}&fit=crop`
}

/** Curated for demo frames — rich photos + abstract waves. See ATTRIBUTION.md. */
const CATALOG = [
  // Abstract / gradients
  { name: 'wave-purple-pink', category: 'abstract', url: u('cYhZC4Vm3oI'), credit: 'Unsplash', desc: 'Gradient waves blue purple pink' },
  { name: 'wave-blue-minimal', category: 'abstract', url: u('_E6sXQHsgQc'), credit: 'Unsplash', desc: 'Soft blue minimal wave' },
  { name: 'wave-ocean-teal', category: 'abstract', url: u('dYksH3vHorc'), credit: 'Hassaan Here / Unsplash', desc: 'Teal fluid waves' },
  { name: 'wave-teal-white', category: 'abstract', url: u('v1B5sqG7EmU'), credit: 'Unsplash', desc: 'Teal white wavy pattern' },
  { name: 'wave-glass-purple', category: 'abstract', url: u('cdI3mxAQXZg'), credit: 'Oxana Golubets / Unsplash', desc: 'Glass purple waves' },

  // Beach / ocean (aerial)
  { name: 'photo-beach-tropical', category: 'beach', url: u('CSofr6E0TuM'), credit: 'Eduard Delputte / Unsplash', desc: 'Aerial tropical beach clear water' },
  { name: 'photo-beach-aerial', category: 'beach', url: u('yCFvgBQd7C8'), credit: 'Unsplash', desc: 'Bird-eye beach Brazil' },
  { name: 'photo-beach-topdown', category: 'beach', url: u('LkHOCMS1cJ0'), credit: 'Derek Liang / Unsplash', desc: 'Top-down seashore' },
  { name: 'photo-beach-waves', category: 'beach', url: u('Oy5ADtAHq9A'), credit: 'Kristaps Ungurs / Unsplash', desc: 'Aerial beach ocean waves' },
  { name: 'photo-beach-rocks', category: 'beach', url: u('TbDlWg2jW8M'), credit: 'Anatolii Bazarov / Unsplash', desc: 'Aerial beach Portugal' },
  { name: 'photo-beach-drone', category: 'beach', url: u('7Kxy5mUWiVc'), credit: 'Kalyan Mukherjee / Unsplash', desc: 'Drone aerial sandy beach ocean' },
  { name: 'photo-coast-aerial', category: 'beach', url: u('WD6jyaFrVM8'), credit: 'Unsplash', desc: 'Top-down beach Australia' },
  { name: 'photo-island-aerial', category: 'beach', url: u('1eb1T_At3vw'), credit: 'Bernd Dittrich / Unsplash', desc: 'Island turquoise coral reefs' },
  { name: 'photo-island-turquoise', category: 'beach', url: u('bVpbD3cwy7k'), credit: 'Adrien Brun / Unsplash', desc: 'White sand island Philippines' },

  // Mountains / city
  { name: 'photo-mountains-dusk', category: 'mountains', url: u('sZXjKxZ2Diw'), credit: 'Unsplash', desc: 'City lights mountains dusk' },
  { name: 'photo-city-night-bergen', category: 'city', url: u('g_ykfRZUDkk'), credit: 'Unsplash', desc: 'Bergen aerial at night' },
  { name: 'photo-city-mountains', category: 'city', url: u('wEPR1xAe5Mc'), credit: 'Radomir Moysia / Unsplash', desc: 'City beside mountains' },
  { name: 'photo-city-neon', category: 'city', url: u('x6YWgAN3SX8'), credit: 'Aleksandr Popov / Unsplash', desc: 'Neon city night Tbilisi' },
  { name: 'photo-milkyway-mountains', category: 'space', url: u('9wH624ALFQA'), credit: 'Unsplash', desc: 'Milky way over mountains' },

  // Forest / nature
  { name: 'photo-forest-canopy', category: 'forest', url: u('XRbJBMBLLvo'), credit: 'Unsplash', desc: 'Aerial forest canopy' },
  { name: 'photo-forest-mist', category: 'forest', url: u('oYEGPZebzGw'), credit: 'Roberto Shumski / Unsplash', desc: 'Misty forest valley mountains' },
  { name: 'photo-lake-alps', category: 'nature', url: u('K785Da4A_JA'), credit: 'Unsplash', desc: 'Alpine lake mountains' },
  { name: 'photo-waterfall-jungle', category: 'nature', url: u('JEcQJ1yIaxE'), credit: 'Unsplash', desc: 'Wide waterfall green jungle' },
  { name: 'photo-rice-terraces', category: 'nature', url: u('Q1p7bh3SHj8'), credit: 'Unsplash', desc: 'Green rice terraces aerial' },

  // Desert
  { name: 'photo-desert-dunes', category: 'desert', url: u('dfkQhikGGZ0'), credit: 'Unsplash', desc: 'Aerial sand dunes' },
  { name: 'photo-desert-dunes-2', category: 'desert', url: u('7sMNwUopm-o'), credit: 'Kristaps Ungurs / Unsplash', desc: 'Dunes sparse vegetation' },
  { name: 'photo-desert-milkyway', category: 'space', url: u('7uvixXrQkfw'), credit: 'Jimmy Larry / Unsplash', desc: 'Desert milky way' },

  // Space / aurora
  { name: 'photo-starry-sky', category: 'space', url: u('NLHFp9qdDLs'), credit: 'Dev Benjamin / Unsplash', desc: 'Starry night milky way' },
  { name: 'photo-aurora', category: 'space', url: u('R3pUGn5YiTg'), credit: 'Marcelo Quinan / Unsplash', desc: 'Northern lights Norway' },
  { name: 'photo-architecture-white', category: 'architecture', url: u('_b4NT2WV1p4'), credit: 'Kouji Tsuru / Unsplash', desc: 'White modern building facade' },
  { name: 'photo-bokeh-warm', category: 'texture', url: u('luAFESue6Ws'), credit: 'Tsuyoshi Kozu / Unsplash', desc: 'Warm bokeh city lights' },
  { name: 'photo-texture-concrete', category: 'texture', url: u('K0ZvQTepkoQ'), credit: 'Colin Watts / Unsplash', desc: 'Gray stone concrete texture' },
  { name: 'photo-snow-peaks', category: 'mountains', url: u('YFFGkE3y4F8'), credit: 'Unsplash', desc: 'Snow covered mountain peaks' },
]

const args = process.argv.slice(2)
const onlyIdx = args.indexOf('--only')
const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',').map((s) => s.trim())) : null

mkdirSync(outDir, { recursive: true })
const manifest = []
const items = only ? CATALOG.filter((c) => only.has(c.name)) : CATALOG

console.log(`Fetching ${items.length} wallpapers → ${outDir}\n`)

for (const item of items) {
  const out = join(outDir, `${item.name}.png`)
  process.stdout.write(`${item.name}… `)
  try {
    const res = await fetch(item.url, { redirect: 'follow', headers: { 'User-Agent': 'demo-studio-wallpaper-fetch/1.0' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await sharp(buf)
      .resize(TARGET_W, TARGET_H, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 9 })
      .toFile(out)
    console.log('ok')
    manifest.push({ ...item, file: `${item.name}.png`, license: 'Unsplash License' })
  } catch (err) {
    console.log(`skip (${err.message})`)
  }
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(mergeManifest(manifest), null, 2))
console.log(`\n${manifest.length}/${items.length} saved. manifest.json updated.`)

function mergeManifest(fetched) {
  const manifestPath = join(outDir, 'manifest.json')
  let existing = []
  if (existsSync(manifestPath)) {
    try { existing = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { /* ignore */ }
  }
  const byName = new Map(existing.map((m) => [m.name, m]))
  for (const item of fetched) byName.set(item.name, item)
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
