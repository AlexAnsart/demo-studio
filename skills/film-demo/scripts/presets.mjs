/**
 * Built-in styled-frame looks for `applyStyledFrame` (see render.mjs). Kept as
 * plain data here (not read from a repo-level file) so this skill folder stays
 * self-contained when installed standalone via `npx skills add`.
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
}

export function loadPreset(name = 'studio-dark') {
  return PRESETS[name] ?? PRESETS['studio-dark']
}
