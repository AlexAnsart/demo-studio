# README inline video (GitHub CDN)

GitHub **does not** render `<video>` tags unless `src` points at
`https://github.com/user-attachments/assets/<uuid>` (or the legacy
`user-images` host for drag-and-drop uploads).

These **do not** work in README markdown (sanitizer strips the tag → empty block):

| Source | Example |
|--------|---------|
| GitHub Release asset | `releases/download/demo-assets/promo.mp4` |
| Raw repo file | `raw.githubusercontent.com/.../promo.mp4` |
| Relative repo path | `docs/assets/promo.mp4` |
| YouTube / iframe | blocked entirely |

See [community discussion #19403](https://github.com/orgs/community/discussions/19403).

## One-time upload (~30 s)

1. Open the README editor on GitHub:  
   [Edit README.md](https://github.com/AlexAnsart/demo-studio/edit/main/README.md)
2. Place the cursor where the promo should play.
3. Drag `docs/assets/promo.mp4` from your machine into the editor.
4. Wait for GitHub to replace it with a `user-attachments` URL.
5. Wrap it for controls + width (GitHub strips `poster`):

   ```html
   <video src="https://github.com/user-attachments/assets/YOUR-UUID" controls width="900"></video>
   ```

6. Commit. Re-upload only when the promo file changes.

Alternative: comment on [issue #1](https://github.com/AlexAnsart/demo-studio/issues/1),
drag the MP4 into the comment box, copy the URL, paste into README.

## CLI (needs browser session cookie)

PAT/`GH_TOKEN` alone is **not** enough for the upload API (422). Use
[`gh-image`](https://github.com/drogers0/gh-image) while logged into GitHub in
your browser:

```bash
gh extension install drogers0/gh-image
gh image extract-token   # or paste user_session from DevTools → Application → Cookies
gh image --repo AlexAnsart/demo-studio docs/assets/promo.mp4
```

Or run `node scripts/upload-readme-video.mjs` after exporting a valid
`GH_SESSION_TOKEN` (same cookie value).

## Updating the promo

1. Replace `docs/assets/promo.mp4` locally.
2. Re-upload to user-attachments (steps above) — UUID changes each upload.
3. Optional: `gh release upload demo-assets docs/assets/promo.mp4 --clobber` keeps a
   direct-download mirror (not inline in README).
