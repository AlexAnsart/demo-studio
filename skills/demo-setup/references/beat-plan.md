# Beat plan (narrated videos)

After Whisper alignment (`align-narration.py`), build this table **before**
recording. Paste it as a comment block at the top of `run.mjs`:

```
// BEAT PLAN (from aligned.json)
// #  sentence (first words…)           dur    Show beat              min hold
// 1  "Here's the task board…"          2.4s   app settled, wide      3.5s
// 2  "Type what you need…"             5.1s   type + add             6.5s
// 3  "No reload — the list…"           3.8s   focus new row + wide   5.0s
```

## Min hold formula

**min hold = sentence duration + ~1.2s**

The sync stage can insert silence *between* sentences. It cannot extend a beat
that already left the screen — if the hold is too short, narration spills into
the next visual.

## Implementation in `run.mjs`

```javascript
async function holdMin(sec, label) {
  await pause(Math.max(0, Math.round(sec * 1000)))
  logRun(`Hold "${label}" ${sec}s`)
}

// After the "type + add" beat settles:
await holdMin(6.5, 'sentence-2')
```

During planned holds, `inactivity` / `zoom-too-long` guardrails are **expected**
— justify them against the beat plan row, don't "fix" by compressing idle time
(see `narrated-compose.md`).

## 1:1 mapping rule

Every on-screen action illustrates a clause. Cut unmotivated clicks. Every clause
needs something visible — if Say mentions a loading state, the Show beat must
include `appear`/`done` or a wide hold on the spinner/result.
