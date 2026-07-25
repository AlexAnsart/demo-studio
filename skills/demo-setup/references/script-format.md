# Script format (`demos/<slug>/script.md`)

Two parallel tracks, **same beat order**. Used by `produce-video` (narrated) and
`film-demo` (Show only).

```markdown
# Create a task

## Say
1. "Here's the task board."
2. "Type what you need, hit add, and it appears instantly."
3. "No reload — the list updates in place."

## Show
1. Open the app, wait for it to settle.
2. Wide — establish the board.
3. Focus the task input.
4. Type "Ship the v1 release".
5. Click Add — expect the new row in the list.
6. Wide — viewer must see the list update (never stay zoomed on the input after submit).
7. Focus the new row, hold ~3s (payoff).
8. Wide, hold ~2.5s, stop.
```

## Rules

- **One Show beat ≈ one camera moment.** Merge tiny micro-steps; split when the
  UI changes state (nav → form → result).
- **Say length:** ~150 words per minute of planned video. Undersized Say forces
  mute gaps at sync time — expand bridge sentences (what's loading, why it
  matters) rather than leaving dead air.
- **Silent mode:** omit the entire `## Say` section.
- **Clause markers (optional):** add `(¢ "first words of clause…")` on a Show line
  when the beat must align to a specific sentence at sync time — same idea as a
  production script's timecode notes.
- **Prep notes (optional):** role, seed data, files to read — keep in a `## Prep`
  section; never put secrets here.

See `examples/create-item/script.md` and `examples/search-flow/script.md`.
