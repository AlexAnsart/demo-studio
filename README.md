# demo-studio

Agent skills that turn a running web app into a polished, narrated demo video — no video editor, no manual screen recording.

Give an AI coding agent (Cursor, Claude Code, Codex, or any agent that reads `SKILL.md` files) a script of what to show, and it drives a real browser with Playwright, applies smart zooms and smooth cursor motion, optionally generates an ElevenLabs voiceover, syncs it to the recording, burns in captions, and hands you back an `.mp4`.

The GIF below **was produced by this repo's own** `film-demo` **skill**, recording the tiny fixture app in `[examples/hello-demo](examples/hello-demo)`:

demo-studio recording its own example app

## What's in the box


| Skill                                     | Does                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `[demo-setup](skills/demo-setup)`         | Run once per project — detects your dev server, asks a few questions, writes `demo.config.json`, vendors the recording engine |
| `[film-demo](skills/film-demo)`           | Records a silent, zoom-composited screen capture from a beat-by-beat script — the core engine                                 |
| `[narrate](skills/narrate)`               | Generates a voiceover `.mp3` from a script with ElevenLabs                                                                    |
| `[sync-narration](skills/sync-narration)` | Aligns narration to the recording (via Whisper), inserts pauses, burns styled captions                                        |
| `[produce-video](skills/produce-video)`   | Orchestrator — chains all of the above into one end-to-end pipeline                                                           |


Use `film-demo` alone for a silent product demo, or `produce-video` for the full narrated pipeline.

## Requirements

- Node.js 18+
- [ffmpeg](https://ffmpeg.org/download.html) and `ffprobe` on your `PATH`
- Python 3.9+ (only for `narrate` and `sync-narration`)
- An [ElevenLabs](https://elevenlabs.io) API key (only for narrated videos)



## Install

Skills are installed with the `skills` [CLI](https://github.com/vercel-labs/skills), which reads `SKILL.md` files straight from a GitHub repo — no npm package, no publishing step.

```bash
# All skills, into whichever agent(s) it detects in your project
npx skills add AlexAnsart/demo-studio --all

# Or pick specific ones
npx skills add AlexAnsart/demo-studio --skill demo-setup film-demo

# Target a specific agent explicitly (cursor, claude-code, codex, ...)
npx skills add AlexAnsart/demo-studio --all --agent cursor
```

This copies the skill folders into your agent's skills directory (e.g. `.cursor/skills/`, `.claude/skills/`). Nothing runs automatically — your agent reads the `SKILL.md` files when you ask (e.g. `@produce-video` in Cursor, or "produce a demo video of…") and runs the underlying scripts (`run.mjs`, `compose.mjs`, etc.) for you. You don't type those commands unless debugging.

See `[skills/demo-setup/references/agent-integration.md](skills/demo-setup/references/agent-integration.md)` for the full Cursor / Claude Code flow.

## Setup (once per project)

Open your project in the agent and ask it to run **demo-setup**. It will:

1. Detect your dev server (`baseUrl`, framework) or ask if it can't.
2. Ask whether the demo needs to log in, and whether you want narration.
3. Write `demo.config.json` at your project root (see `[docs/CONFIG.md](docs/CONFIG.md)` for every field).
4. Vendor the recording engine into `demos/_engine/`.
5. Scaffold a first `demos/<name>/` folder with a `script.md` template.
6. Run `check-setup.mjs` and the engine's own smoke test to confirm ffmpeg/Playwright/Node all work.

```
your-project/
├── demo.config.json
├── .env                 # API keys, demo login — gitignored
└── demos/
    ├── _engine/          # vendored film-demo scripts
    └── create-task/      # your first demo
```



## `.env`

```bash
# Only needed if you want a voiceover
ELEVENLABS_API_KEY=

# Only needed if demo.config.json sets auth.loginRequired: true
DEMO_USER_EMAIL=
DEMO_USER_PASSWORD=
```

Never commit real credentials — use a dedicated demo/test account.

## Usage

Once set up, just ask your agent, in plain language, in Cursor, Claude Code, or any agent with skills installed:

> "Use produce-video to record a demo of creating a task, with narration, and save it to `demos/create-task/output/demo.mp4`."

or for a silent-only clip:

> "Use film-demo to record the signup flow, no narration, save it to `out.mp4`."

The agent writes a beat script (`Show:` steps, `Say:` line if narrated — see `[skills/produce-video/SKILL.md](skills/produce-video/SKILL.md)`), then runs the pipeline end to end: record → speed up dead time → smart zoom/pan → style frame → (voice → align → sync + captions) → automated quality checks → deliver the file.

## Try it yourself

**1. Install** (from any project folder — your app, or this repo to dogfood the hello fixture):

```bash
npx skills add AlexAnsart/demo-studio --all
```

**2. First time in a project** — tag the setup skill in Cursor chat:

> @demo-setup Set up demo-studio for this project. Use the hello fixture in `examples/hello-demo/app` if there is no dev server.

**3. Record a silent demo** — tag the recording skill with a concrete script:

> @film-demo Record a silent demo of the hello fixture: open the task app, type "Ship the v1 release", click Add, show the new item in the list, save to `examples/hello-demo/output/demo.mp4`. Use the studio-dark preset.

The agent writes the beat script, runs Playwright, composes zooms and the styled frame, verifies quality, and delivers the `.mp4`. You don't run `compose.mjs` or other pipeline commands yourself.

**Narrated version** (needs `ELEVENLABS_API_KEY` in `.env`):

> @produce-video Produce a narrated demo of the hello fixture task flow — voiceover + burned captions — save to `examples/hello-demo/output/demo.mp4`.

Maintainers: reproduce the README GIF without an agent

## Configuration

All tunables (cursor style, zoom padding, speed-up thresholds, frame preset, narration voice, captions) live in `demo.config.json`. Full reference: `[docs/CONFIG.md](docs/CONFIG.md)`.

## License

MIT