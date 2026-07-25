---
name: demo-setup
description: One-time setup that analyzes the current project and configures it to use the film-demo / narrate / sync-narration / produce-video skills — detects the dev server and framework, asks only when necessary, generates demo.config.json and .env entries, vendors the recording engine and project helpers, and scaffolds a first demo from reference patterns. Use when the user asks to set up, configure, or install demo-studio / video-recording skills for this project, or before running produce-video for the first time in a new codebase.
---

# Demo setup

Turns a generic install of `film-demo` / `narrate` / `sync-narration` /
`produce-video` into a working pipeline **for this specific project**. Run once
per project (re-run when URL, auth, or narration settings change).

**Read on demand (do not paste all into chat):**

| File | When |
|------|------|
| `references/when-to-ask.md` | Before asking the user anything |
| `references/script-format.md` | Scaffolding `script.md` |
| `references/beat-plan.md` | Narrated videos — sizing holds |
| `references/narrated-compose.md` | Compose flags after record |
| `references/agent-integration.md` | User asks how Cursor / Claude Code invoke skills |
| `examples/create-item/script.md` | Simple form + list payoff |
| `examples/search-flow/script.md` | Nav → query → scroll results |
| `examples/assistant-panel/script.md` | Side panel + tool wait bracket |
| `templates/run.mjs` | Starting point for `demos/<slug>/run.mjs` |

## What this produces

```
<project root>/
├── demo.config.json
├── .env                          # gitignored — API key + demo login only
└── demos/
    ├── _engine/                   # vendored copy of film-demo/scripts/*.mjs
    ├── _lib/                      # paths.mjs, auth.mjs (from templates/)
    └── <first-demo-slug>/
        ├── script.md
        └── run.mjs
```

`_engine/` = recording/zoom/guardrails library (same code as `film-demo/scripts/`).
`_lib/` = thin project helpers (render dirs, off-camera login) — patterns reused
across every demo in this repo.

## Steps

### 1. Detect the stack

Read `package.json`, framework config, existing `.env.example`. Infer `baseUrl`
and `devCommand`. See `references/when-to-ask.md` — **do not ask** if inference
is confident.

### 2. Ask only when necessary

Login selectors, ambiguous ports, narration voice — only when detection fails or
the user explicitly wants narration without a key. Default narration to `"none"`.

### 3. Write `demo.config.json`

Use `demo.config.example.json` at the demo-studio repo root as the schema.
Omit `auth` when `loginRequired: false`. Never put secrets in this file.

### 4. Write / update `.env`

Only the vars referenced by `demo.config.json`. Confirm `.env` is gitignored.

### 5. Vendor the recording engine

Copy the installed `film-demo` skill's entire `scripts/` folder →
`<project>/demos/_engine/`. If not installed:
`npx skills add AlexAnsart/demo-studio --skill film-demo --copy`

### 6. Copy project helpers

Copy from this skill's `templates/` → `<project>/demos/_lib/`:

- `paths.mjs` — `nextRenderDir`, `logRun`
- `auth.mjs` — login + `buildDemoSession` from `demo.config.json` + env

Skip `auth.mjs` usage in scaffolded `run.mjs` when `loginRequired: false`.

### 7. Scaffold the first demo

Pick the closest `examples/*/script.md` pattern to what the user described
(create-item, search-flow, assistant-panel). Copy/adapt it to
`demos/<slug>/script.md`.

Copy `templates/run.mjs` → `demos/<slug>/run.mjs`. Replace TODO selectors,
navigation paths, and beat plan comment. Match the Show section exactly.

If the user did not describe a flow yet, scaffold `create-item` as the default.

### 8. Verify

```bash
node <demo-setup-skill-dir>/scripts/check-setup.mjs
node demos/_engine/test-engine.mjs
```

Both must pass. If ffmpeg/ffprobe missing, stop — nothing downstream works.

## Deliverable

Report: inferred `baseUrl`, login on/off, narration provider, preset, scaffold
path, and which example pattern was used. Point the user to
`references/agent-integration.md` for how to invoke `produce-video` in Cursor or
Claude Code. Remind them to fill `.env` before narrated or login-gated runs.
