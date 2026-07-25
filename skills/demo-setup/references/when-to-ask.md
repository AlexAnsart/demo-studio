# When to ask the user (and when not to)

**Default: infer and proceed.** Only interrupt when a wrong guess would waste a
recording take or leak bad credentials.

## Never ask

| Detected | Action |
|----------|--------|
| Vite + `scripts.dev` on port 5173 | `baseUrl: http://localhost:5173`, `devCommand` from package.json |
| Next.js default | `baseUrl: http://localhost:3000` |
| Static `index.html`, no server | Record via `file://` — no dev server question |
| No `/login` route, no auth middleware hints | `auth.loginRequired: false`, omit auth block from config |
| User said "silent" / "no voice" / no ElevenLabs key in env | `narration.provider: "none"` |
| Monochrome / dark UI | `frame.preset: "studio-dark"` |
| Light SaaS marketing site | Offer `clean-light` only if the UI is clearly light-first |

## Ask only when necessary

| Situation | Question |
|-----------|----------|
| Multiple possible dev ports / monorepo | "Which URL should demos open — A or B?" |
| Login page exists OR user said "authenticated flow" | "Do demos need to log in? If yes I'll inspect the login form for selectors." |
| Selectors not obvious after DOM inspect | "Confirm email field is `#email` / submit is `button[type=submit]`?" |
| User wants narration but no `ELEVENLABS_API_KEY` | "Set the key in `.env` or switch to silent mode?" |
| User wants narration + key present | "Which voice name from your ElevenLabs library?" (default from config if they don't care) |
| User already described the full demo flow | **Do not** ask "what should the demo show?" — pre-fill `script.md` |

## Prefer reading over asking

Before asking about selectors or URLs:

1. Read `package.json`, framework config, `.env.example`.
2. If the dev server is not running, start it (`devCommand` from config).
3. Open the login page once and read accessible labels / `id` / `data-testid`.
4. Read `references/script-format.md` and match the user's request to the closest
   `examples/` pattern — scaffold from that, don't start from a blank template.
