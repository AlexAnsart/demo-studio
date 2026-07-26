# Bundled wallpapers

Use any name with `--wallpaper <name>` or `frame.wallpaper` in config. Run
`node skills/film-demo/scripts/presets.mjs` is not needed — list files in this
folder or see `manifest.json` after download.

## Unsplash photos (`photo-*.png`)

Real photography — aerial beaches, cities, forests, deserts, aurora, etc.
Downloaded via `scripts/download-wallpapers.mjs`.

**License:** [Unsplash License](https://unsplash.com/license) — free commercial use, modification OK.

| Category | Names |
|----------|-------|
| **Beach / ocean** | `photo-beach-tropical`, `photo-beach-aerial`, `photo-beach-topdown`, `photo-beach-waves`, `photo-beach-rocks`, `photo-beach-drone`, `photo-coast-aerial`, `photo-island-aerial`, `photo-island-turquoise` |
| **Mountains** | `photo-mountains-dusk`, `photo-snow-peaks`, `photo-lake-alps` |
| **City** | `photo-city-night-bergen`, `photo-city-mountains`, `photo-city-neon` |
| **Forest / nature** | `photo-forest-canopy`, `photo-forest-mist`, `photo-waterfall-jungle`, `photo-rice-terraces` |
| **Desert** | `photo-desert-dunes`, `photo-desert-dunes-2`, `photo-desert-milkyway` |
| **Space / sky** | `photo-milkyway-mountains`, `photo-starry-sky`, `photo-aurora` |
| **Architecture / texture** | `photo-architecture-white`, `photo-bokeh-warm`, `photo-texture-concrete` |

## Unsplash abstract (`wave-*.png`)

Gradient / fluid waves (Recordly-style).

| File | Description |
|------|-------------|
| `wave-purple-pink` | Blue purple pink waves |
| `wave-blue-minimal` | Soft blue minimal |
| `wave-ocean-teal` | Teal fluid waves |
| `wave-teal-white` | Teal white pattern |
| `wave-glass-purple` | Glass purple waves |

## Synthetic (`ribbon-*.png`, legacy mesh)

Procedural from `generate-wallpaper.mjs` — **MIT**, no attribution.

| Names |
|-------|
| `ribbon-violet`, `ribbon-ocean`, `ribbon-sunset`, `ribbon-forest`, `ribbon-indigo`, `ribbon-slate` |
| `midnight-violet`, `aurora-teal`, `cosmic-indigo`, `deep-ocean`, `crimson-dusk`, `forest-night`, `slate-mono`, `sunset-amber` |

## Commands

```bash
# All Unsplash (abstract + photos)
node skills/film-demo/scripts/download-wallpapers.mjs

# Subset only
node skills/film-demo/scripts/download-wallpapers.mjs --only photo-beach-tropical,photo-beach-aerial

# Preview every wallpaper (10s macos-dark sample)
node skills/film-demo/scripts/render-wallpaper-samples.mjs examples/hello-demo/renders/006 --sec 10

# Use a beach aerial behind the window
node skills/film-demo/scripts/compose.mjs <renderDir> --preset macos-dark --wallpaper photo-beach-tropical
```
