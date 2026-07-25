# Search across your data

## Say
1. "Search works two ways — keyword and semantic — so wording can differ and you still find the right record."
2. "Results stay scoped to what you're allowed to see."
3. "Open any hit to jump straight to the detail view."

## Show
1. Preload dashboard off-camera (authenticated session if required).
2. Wide — establish the main shell.
3. Click Search in the primary nav — expect the search view.
4. Focus the query input.
5. Type a realistic query (~40 chars), submit.
6. Wide while results load; `appear`/`done` if a spinner is visible.
7. Scroll results slowly so badges/columns read on screen (don't static-hold an empty state).
8. Wide pan across result columns, hold ~2.5s.
9. Click the first result — expect the detail page.
10. Wide on detail, hold ~3s payoff, stop.

## Prep
- Seed or pick a query that returns ≥ 3 results in dev.
- Long result loads: keep camera wide during spinner; never `focus()` on the search box while waiting.
- Narrated compose caps: `toolWaitMax=2.5`, `idleGapMin=9999`.

## Clause markers (for sync stage)
- (¢ "Search works two ways") — steps 2–7
- (¢ "Results stay scoped") — step 8
- (¢ "Open any hit") — steps 9–10
