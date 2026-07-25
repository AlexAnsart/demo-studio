#!/usr/bin/env python3
"""Align narration audio to a known script using faster-whisper word timestamps.

No API key required — runs locally. First run downloads a small Whisper model.

Usage:
  python align-narration.py <audio.mp3> [--script "full text"] [--script-file path.txt]
  python align-narration.py <audio.mp3> --sentences sentence1|||sentence2|||...

Outputs JSON to stdout (or --out file.json):
  { "duration": 34.1, "words": [...], "sentences": [{ "text", "start", "end", "words" }] }
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def normalize_token(s: str) -> str:
    return re.sub(r"[^a-z0-9']+", "", s.lower())


def split_script_sentences(text: str) -> list[str]:
    # Split on sentence boundaries while keeping em-dash clauses attached when glued.
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def align_sentences_to_words(sentences: list[str], words: list[dict]) -> list[dict]:
    """Greedy match script sentences to whisper word stream."""
    wi = 0
    aligned = []
    for sentence in sentences:
        sent_tokens = [normalize_token(t) for t in sentence.split() if normalize_token(t)]
        if not sent_tokens:
            continue
        start_idx = wi
        matched = 0
        while wi < len(words) and matched < len(sent_tokens):
            wt = normalize_token(words[wi]["word"])
            st = sent_tokens[matched]
            if not wt:
                wi += 1
                continue
            if wt == st or wt in st or st in wt:
                matched += 1
                wi += 1
                continue
            # whisper sometimes merges/splits — skip one word in stream
            wi += 1
        if matched == 0:
            print(f"[align] warning: could not match sentence: {sentence[:60]}...", file=sys.stderr)
            continue
        chunk = words[start_idx:wi]
        aligned.append(
            {
                "text": sentence,
                "start": chunk[0]["start"],
                "end": chunk[-1]["end"],
                "words": chunk,
            }
        )
    return aligned


def transcribe(audio_path: Path, model_size: str) -> tuple[list[dict], float]:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(audio_path), word_timestamps=True, language="en")
    words: list[dict] = []
    for seg in segments:
        if not seg.words:
            continue
        for w in seg.words:
            token = w.word.strip()
            if token:
                words.append({"word": token, "start": round(w.start, 3), "end": round(w.end, 3)})
    return words, float(info.duration)


def main() -> None:
    parser = argparse.ArgumentParser(description="Align narration audio to script (local Whisper)")
    parser.add_argument("audio", type=Path)
    parser.add_argument("--script", type=str, help="Full narration script")
    parser.add_argument("--script-file", type=Path, help="File containing script")
    parser.add_argument("--sentences", type=str, help="Sentences joined by |||")
    # "base" gives noticeably tighter word boundaries than "tiny" — worth the
    # one-time ~150 MB download; clipped TTS onsets usually trace back to tiny.
    parser.add_argument("--model", default="base", help="Whisper model size (default: base)")
    parser.add_argument("--out", type=Path, help="Write JSON here instead of stdout")
    args = parser.parse_args()

    if not args.audio.exists():
        print(f"audio not found: {args.audio}", file=sys.stderr)
        sys.exit(1)

    script = args.script
    if args.script_file:
        script = args.script_file.read_text(encoding="utf-8").strip()
    if args.sentences:
        sentences = [s.strip() for s in args.sentences.split("|||") if s.strip()]
    elif script:
        sentences = split_script_sentences(script)
    else:
        sentences = []

    print(f"[align] transcribing {args.audio.name} (model={args.model})...", file=sys.stderr)
    words, duration = transcribe(args.audio, args.model)
    print(f"[align] {len(words)} words, {duration:.2f}s", file=sys.stderr)

    result: dict = {"duration": round(duration, 3), "words": words}
    if sentences:
        result["sentences"] = align_sentences_to_words(sentences, words)
        print(f"[align] matched {len(result['sentences'])}/{len(sentences)} sentences", file=sys.stderr)
        for s in result["sentences"]:
            print(f"  {s['start']:6.3f}-{s['end']:6.3f}  {s['text'][:72]}", file=sys.stderr)

    payload = json.dumps(result, indent=2, ensure_ascii=False)
    if args.out:
        args.out.write_text(payload, encoding="utf-8")
        print(f"[align] wrote {args.out}", file=sys.stderr)
    else:
        print(payload)


if __name__ == "__main__":
    main()
