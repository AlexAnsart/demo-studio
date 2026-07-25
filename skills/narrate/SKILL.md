---
name: narrate
description: Generates a narration voiceover .mp3 for a demo video script using the ElevenLabs API — configurable voice/model/stability, deterministic output filename. Use when the user asks to add a voiceover, narration, or spoken audio to a demo/tutorial video, or names ElevenLabs explicitly.
---

# Narrate — generate a voiceover with ElevenLabs

Turns a plain-text script into an `.mp3` narration track. This is stage 1 of the
full pipeline (`produce-video`); use it standalone if you already have a silent
video and just need the voice.

**Requires** `ELEVENLABS_API_KEY` (see `.env.example` at the project root — get
a key at https://elevenlabs.io). No key, no narration — `produce-video` and
`film-demo` both work fine without this skill (silent video only).

## Quick start

```bash
pip install -r scripts/requirements.txt   # once

python scripts/generate_narration.py \
  --out demos/<slug>/narration.mp3 \
  --text "Here's how it works. Type your task, hit add, and watch it appear instantly."
```

Or `--text-file script.txt` for longer scripts. The script writes exactly one
`.mp3` at `--out` — no auto-naming, so it composes cleanly into a pipeline.

## Defaults (override via flags or `demo.config.json` → `narration`)

| Setting | Default | Flag |
|---------|---------|------|
| Voice | "Rachel" (search by name in your ElevenLabs voice library) | `--voice-name` |
| Voice ID (skips the name search) | — | `--voice-id` |
| Model | `eleven_v3` | `--model` |
| Stability | `1.0` (Robust — v3 scale: 0.0 Creative, 0.5 Natural, 1.0 Robust) | `--stability` |
| Output format | `mp3_44100_128` | `--format` |

Pick a voice from your own ElevenLabs account (or a shared voice you've added
to your library) and set it once in `demo.config.json` → `narration.voiceName`
so every video in the project uses the same voice. `--voice-name` does a
`voices.search()` by exact name — if you get "voice not found", the voice
either isn't in your account yet (add it from the ElevenLabs Voice Library
first) or the name doesn't match exactly; pass `--voice-id` instead to skip
the search entirely.

## Script-writing rules (these make sync easier later)

- **Plain sentences, one idea each.** `sync-narration` aligns and cuts at
  sentence boundaries — a 40-word sentence covering three on-screen actions
  cannot be split apart later.
- **Write to match the pacing you'll film**, not the other way around. ~150
  words/minute is natural TTS speed — a 60-90s video needs roughly 150-220
  words of narration.
- **No stage directions or brackets** ("[pause]", "(click here)") — the model
  reads them aloud. Convey pacing with actual punctuation and sentence breaks.
- **Say what's on screen in the order it happens.** `sync-narration` maps
  sentence order to beat order 1:1 — reordering later means re-aligning.

## Gate before moving on

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 demos/<slug>/narration.mp3
```

Confirm the duration is plausible for the word count (~150 wpm). Regenerating
costs API credits — only do it when the script text actually changes; reuse
the existing `.mp3` otherwise.

## Deliverable

Report the output path, duration, voice/model used, and word count. If
`ELEVENLABS_API_KEY` is missing, say so explicitly and stop — do not silently
fall back to a different provider or skip narration without telling the user.
