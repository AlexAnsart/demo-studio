import { existsSync, readdirSync } from 'fs'
import { basename, dirname, join, resolve, extname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const WALLPAPERS_DIR = join(__dirname, '..', 'assets', 'wallpapers')

/** All bundled PNG names in `assets/wallpapers/` (Unsplash + synthetic). */
export function listBundledWallpapers() {
  if (!existsSync(WALLPAPERS_DIR)) return []
  return readdirSync(WALLPAPERS_DIR)
    .filter((f) => f.endsWith('.png'))
    .map((f) => basename(f, '.png'))
    .sort()
}

/** @deprecated Use listBundledWallpapers() — kept for backward compatibility. */
export const BUNDLED_WALLPAPERS = listBundledWallpapers()

const DEFAULT_TITLEBAR_DARK = 'rgba(22,22,27,0.94)'
const DEFAULT_TITLEBAR_LIGHT = 'rgba(246,246,248,0.96)'
const MACOS_DOTS = ['#ff5f57', '#febc2e', '#28c840']

/**
 * Resolves a `frame.wallpaper` value to a file path: a bundled name (e.g.
 * `midnight-violet`) → `assets/wallpapers/<name>.png`; anything containing a
 * path separator or an image extension is used as-is (resolved against
 * `cwd` if relative). Returns `null` for a falsy input.
 */
export function resolveWallpaper(value) {
  if (!value) return null
  const looksLikePath = /[\\/]/.test(value) || extname(value) !== ''
  if (!looksLikePath) {
    const bundled = join(WALLPAPERS_DIR, `${value}.png`)
    if (!existsSync(bundled)) {
      const names = listBundledWallpapers()
      throw new Error(`Unknown bundled wallpaper "${value}" — pick one of: ${names.join(', ')}, or pass a file path`)
    }
    return bundled
  }
  return resolve(value)
}

/**
 * Built-in styled-frame looks for `applyStyledFrame` (see render.mjs). Kept as
 * plain data here (not read from a repo-level file) so this skill folder stays
 * self-contained when installed standalone via `npx skills add`. Every field
 * can be overridden per-call (CLI flags on `compose.mjs`, or options passed
 * directly to `composeFilm()`) — see docs/CONFIG.md.
 */
export const PRESETS = {
  'studio-dark': {
    background: '0x0A0A0A',
    borderColor: 'white@0.35',
    shadowOpacity: 0.55,
  },
  'clean-light': {
    background: '0xF3F3F1',
    borderColor: 'black@0.12',
    shadowOpacity: 0.18,
  },
  none: {
    background: '0x000000',
    borderColor: 'black@0',
    shadowOpacity: 0,
  },
  // --- Wallpaper + rounded window + macOS-style title bar presets ---
  'rounded-dark': {
    background: '0x0A0A0A',
    borderColor: 'white@0.35',
    shadowOpacity: 0.55,
    radius: 18,
  },
  'macos-dark': {
    background: '0x0A0A0A',
    borderColor: 'rgba(255,255,255,0.16)',
    shadowOpacity: 0.5,
    wallpaper: 'wave-purple-pink',
    wallpaperDim: 0.2,
    wallpaperBlur: 0,
    radius: 18,
    titlebarHeight: 40,
    titlebarColor: DEFAULT_TITLEBAR_DARK,
    trafficLights: true,
    trafficLightColors: MACOS_DOTS,
  },
  'macos-light': {
    background: '0xF3F3F1',
    borderColor: 'rgba(0,0,0,0.12)',
    shadowOpacity: 0.35,
    wallpaper: 'wave-blue-minimal',
    wallpaperDim: 0.08,
    wallpaperBlur: 0,
    radius: 18,
    titlebarHeight: 40,
    titlebarColor: DEFAULT_TITLEBAR_LIGHT,
    trafficLights: true,
    trafficLightColors: MACOS_DOTS,
  },
}

export function loadPreset(name = 'studio-dark') {
  return PRESETS[name] ?? PRESETS['studio-dark']
}
