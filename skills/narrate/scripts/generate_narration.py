#!/usr/bin/env python3
"""Generate a single narration .mp3 with ElevenLabs.

No project-specific defaults — pass --voice-name / --voice-id / --model /
--stability, or hardcode your own choices once you've picked them (see
demo.config.json -> narration in the repo root for a place to record them).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from elevenlabs import VoiceSettings
from elevenlabs.client import ElevenLabs

DEFAULT_VOICE_NAME = "Rachel"
DEFAULT_MODEL_ID = "eleven_v3"
DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"
DEFAULT_STABILITY = 1.0  # v3 scale: 0.0 Creative, 0.5 Natural, 1.0 Robust


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a narration .mp3 with ElevenLabs.")
    parser.add_argument("--out", required=True, help="Output .mp3 path (overwrites if exists)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--text", help="Narration text")
    group.add_argument("--text-file", help="Path to a text file with narration")
    parser.add_argument("--voice-name", default=DEFAULT_VOICE_NAME, help=f"Voice name to search for (default: {DEFAULT_VOICE_NAME})")
    parser.add_argument("--voice-id", help="Exact voice ID — skips the name search if given")
    parser.add_argument("--model", default=DEFAULT_MODEL_ID, help=f"ElevenLabs model ID (default: {DEFAULT_MODEL_ID})")
    parser.add_argument("--stability", type=float, default=DEFAULT_STABILITY, help=f"Voice stability 0.0-1.0 (default: {DEFAULT_STABILITY})")
    parser.add_argument("--similarity-boost", type=float, default=0.75)
    parser.add_argument("--style", type=float, default=0.0)
    parser.add_argument("--format", default=DEFAULT_OUTPUT_FORMAT, help=f"Output format (default: {DEFAULT_OUTPUT_FORMAT})")
    args = parser.parse_args()

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        print("ELEVENLABS_API_KEY is required (see .env.example)", file=sys.stderr)
        return 1

    text = args.text
    if args.text_file:
        text = Path(args.text_file).read_text(encoding="utf-8").strip()
    if not text:
        print("Narration text is empty", file=sys.stderr)
        return 1

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    client = ElevenLabs(api_key=api_key)

    voice_id = args.voice_id
    if not voice_id:
        voices = client.voices.search(search=args.voice_name)
        match = next((v for v in voices.voices if v.name == args.voice_name), None)
        if not match:
            print(
                f"Voice not found: '{args.voice_name}'. Add it to your ElevenLabs "
                "account's Voice Library first, or pass --voice-id directly.",
                file=sys.stderr,
            )
            return 1
        voice_id = match.voice_id

    voice_settings = VoiceSettings(
        stability=args.stability,
        similarity_boost=args.similarity_boost,
        style=args.style,
        use_speaker_boost=True,
    )

    audio = client.text_to_speech.convert(
        text=text,
        voice_id=voice_id,
        model_id=args.model,
        voice_settings=voice_settings,
        output_format=args.format,
    )
    out.write_bytes(b"".join(audio))
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
