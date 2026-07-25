# Cursor, Claude Code, and other agents

## What a "skill" is here

Each skill is a folder with:

- `SKILL.md` — instructions the agent reads when triggered
- `scripts/` — deterministic tools the agent **runs** (Node, Python, ffmpeg)

There is no background daemon. The agent is the orchestrator.

## How users invoke it

| Environment | Typical invocation |
|-------------|-------------------|
| **Cursor** | `@produce-video` in chat, or describe the task ("produce a demo video of…") — Cursor loads matching skills from `.cursor/skills/` |
| **Claude Code** | Same pattern under `.claude/skills/` — mention the skill or ask for an end-to-end demo video |
| **Any agent with skills support** | `npx skills add AlexAnsart/demo-studio --all --agent <name>` |

Install once per machine/project:

```bash
npx skills add AlexAnsart/demo-studio --all --agent cursor --copy
```

Then run `demo-setup` in the **target app repo** (not inside the demo-studio repo
unless you're dogfooding the hello example).

## What the user should NOT run manually

For a normal production run, the user asks in natural language. The agent:

1. Writes `demos/<slug>/script.md` and `run.mjs`
2. Runs `node demos/<slug>/run.mjs` (record)
3. Runs `node demos/_engine/compose.mjs …` (zoom + frame + speed-up)
4. Runs guardrails / inspect / verify
5. (Narrated) runs narrate → align → sync-narration
6. Delivers the `.mp4` path

Commands like `compose.mjs` are **pipeline internals** — documented so agents
(and debuggers) know the exact flags, not because end users run them daily.

## Repo-only commands (`hello-demo`)

The root README's `npm run example:hello` and manual `compose.mjs` on
`examples/hello-demo/renders/001` are for **validating the demo-studio checkout**
(GIF generation, CI). They are not the user workflow after `npx skills add`.

## First-time project flow

```
User: "Set up demo-studio for this project"
  → demo-setup skill (config + vendor engine + scaffold)

User: "Produce a narrated demo of creating a task"
  → produce-video skill (chains narrate + film-demo + sync-narration)
```

Silent clip only:

```
User: "Record a silent demo of the signup flow"
  → film-demo skill
```
