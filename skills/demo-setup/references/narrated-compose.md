# Compose flags for narrated videos

After recording, `film-demo` composes the silent master:

```bash
node demos/_engine/compose.mjs <renderDir> \
  --preset studio-dark \
  --speedup idleGapMin=9999,toolWaitMax=2.5,preToolWaitMax=2,tailHold=4
```

## Why these caps

| Flag | Value | Reason |
|------|-------|--------|
| `idleGapMin=9999` | disable idle compression | Narration holds are deliberate pauses — default idle compression would eat them |
| `toolWaitMax=2.5` | spinner ≤ 2.5s on screen | Long API waits still compress; don't raise above 3 without user approval |
| `preToolWaitMax=2` | pre-spinner latency | Keeps click → spinner gap tight |
| `tailHold=4` | end padding | Payoff must stay readable after the last action |

Lead/tail **trim** stays on — preload the app off-camera so the first timeline
event is the first Show beat (no early `open()` before recording starts).

## Silent-only demos

Use defaults (omit custom `--speedup`) — idle compression keeps pacing tight:

```bash
node demos/_engine/compose.mjs <renderDir> --preset studio-dark
```

## Who runs this

The **agent** runs compose during `film-demo` / `produce-video`. You don't type
this unless debugging a render folder by hand.
