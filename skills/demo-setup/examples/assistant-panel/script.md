# AI assistant panel flow

## Say
1. "Open the assistant from anywhere in the app."
2. "Ask a question in plain language — the panel streams the answer as it thinks."
3. "When a tool runs, you see progress inline, then the result lands in the thread."

## Show
1. Preload app off-camera; close any open side panels for a clean opening frame.
2. Wide — main workspace visible.
3. Click the assistant launcher FAB — expect the side panel.
4. Focus the prompt textarea.
5. Type a short, realistic prompt (read from a fixture file if needed — never paste secrets).
6. Submit — `appear` immediately after click (no await on spinner box first).
7. Wide on the panel while the tool runs; `done` when the result block is visible.
8. Scroll the thread slowly so the answer and citation/tool block are readable.
9. Wide, hold ~3s on the final message (payoff), stop.

## Prep
- Use a dev account with assistant access enabled.
- Tool labels vary by product — locate the running/done state in DOM once, reuse selectors in `run.mjs`.
- **Never `focus()` during a tool wait** — stay wide on the panel; spinners flash under zoom.
- Default tool-wait compression: ≤ 2.5s on screen after compose.

## Clause markers
- (¢ "Open the assistant") — steps 2–3
- (¢ "Ask a question") — steps 4–5
- (¢ "When a tool runs") — steps 6–8
