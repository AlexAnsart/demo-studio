/**
 * Film-grade pointer cursor — black arrow, scaled for visibility, subtle press
 * animation on the pointer itself only (no surrounding ring/halo). Recorded
 * into the raw capture via DOM injection.
 *
 * Event-driven: the pointer follows REAL input events (mousemove / mousedown /
 * mouseup) dispatched by Playwright, entirely inside the page. No per-step
 * page.evaluate round-trips (that produces visible jitter), and the press
 * animation fires exactly when the real click does (a decoupled "pulse" can
 * read as a double-click).
 *
 * Navigation: a fresh document remounts the cursor. `resyncFilmCursor` (called
 * automatically by record.mjs's framenavigated hook) restores the last known
 * position so the pointer never teleports back to the center of the screen.
 */

export async function installFilmCursor(page, { scale = 1.6, color = '#0A0A0A' } = {}) {
  await page.addInitScript(
    ({ scale, color }) => {
      if (window.__filmCursorInstalled) return
      window.__filmCursorInstalled = true
      window.__demoMouse = { x: 960, y: 540 }

      const BASE_SCALE = scale
      let pointer = null
      let pressed = false

      function applyTransform(s) {
        if (!pointer) return
        const { x, y } = window.__demoMouse
        pointer.style.transform = `translate(${x}px, ${y}px) scale(${s})`
      }

      function mount() {
        if (document.getElementById('film-cursor-root')) return
        const parent = document.body ?? document.documentElement
        if (!parent) return

        const root = document.createElement('div')
        root.id = 'film-cursor-root'
        Object.assign(root.style, {
          position: 'fixed',
          left: '0',
          top: '0',
          width: '0',
          height: '0',
          zIndex: '2147483646',
          pointerEvents: 'none',
        })

        pointer = document.createElement('div')
        pointer.id = 'film-cursor-pointer'
        // Classic filled arrow pointer (lucide "mouse-pointer-2" path) — colored
        // fill, thin white outline so it reads on both light and dark app surfaces.
        pointer.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"
            fill="${color}" stroke="#FFFFFF" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>`
        Object.assign(pointer.style, {
          position: 'absolute',
          width: '24px',
          height: '24px',
          filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.5))',
          transformOrigin: '3px 3px',
          // No transition on movement — position updates ride the real mousemove
          // stream (~60Hz from filmMove), a transition on top only adds lag/rubber.
          transition: 'none',
        })
        applyTransform(BASE_SCALE)

        root.appendChild(pointer)
        parent.appendChild(root)
      }

      // Listeners attach immediately (document exists at init-script time) so no
      // early event is lost even before <body> / mount.
      document.addEventListener(
        'mousemove',
        (e) => {
          window.__demoMouse = { x: e.clientX, y: e.clientY }
          if (pointer) {
            pointer.style.transition = 'none'
            applyTransform(pressed ? BASE_SCALE * 0.8 : BASE_SCALE)
          }
        },
        { capture: true, passive: true },
      )
      document.addEventListener(
        'mousedown',
        () => {
          pressed = true
          if (!pointer) return
          pointer.style.transition = 'transform 70ms cubic-bezier(0.4, 0, 1, 1)'
          applyTransform(BASE_SCALE * 0.8)
        },
        { capture: true, passive: true },
      )
      document.addEventListener(
        'mouseup',
        () => {
          pressed = false
          if (!pointer) return
          pointer.style.transition = 'transform 160ms cubic-bezier(0.34, 1.4, 0.64, 1)'
          applyTransform(BASE_SCALE)
          setTimeout(() => {
            if (pointer) pointer.style.transition = 'none'
          }, 170)
        },
        { capture: true, passive: true },
      )

      // Manual position sync — used after navigations (new document mounts the
      // cursor wherever the last real mousemove left it, which a fresh document
      // has never seen).
      window.__demoCursorMove = (x, y) => {
        if (window.__filmCursorAnimId) {
          cancelAnimationFrame(window.__filmCursorAnimId)
          window.__filmCursorAnimId = null
        }
        window.__demoMouse = { x, y }
        if (pointer) {
          pointer.style.transition = 'none'
          applyTransform(BASE_SCALE)
        }
      }

      /**
       * Smooth travel at compositor refresh rate — one call, no per-step CDP
       * round-trips from Node (those cap effective motion at ~10-15 Hz).
       * Ease-out cubic matches filmMove / zoompan-expr.mjs.
       */
      window.__filmCursorAnimate = ({ fromX, fromY, toX, toY, durationMs }) => {
        return new Promise((resolve) => {
          if (window.__filmCursorAnimId) cancelAnimationFrame(window.__filmCursorAnimId)
          const start = performance.now()
          const easeOutCubic = (t) => 1 - (1 - t) ** 3

          const tick = (now) => {
            const elapsed = now - start
            const linear = Math.min(1, elapsed / durationMs)
            const e = easeOutCubic(linear)
            const x = fromX + (toX - fromX) * e
            const y = fromY + (toY - fromY) * e
            window.__demoMouse = { x, y }
            if (pointer) {
              pointer.style.transition = 'none'
              applyTransform(pressed ? BASE_SCALE * 0.8 : BASE_SCALE)
            }
            if (linear < 1) {
              window.__filmCursorAnimId = requestAnimationFrame(tick)
            } else {
              window.__filmCursorAnimId = null
              resolve()
            }
          }

          window.__demoMouse = { x: fromX, y: fromY }
          if (pointer) {
            pointer.style.transition = 'none'
            applyTransform(pressed ? BASE_SCALE * 0.8 : BASE_SCALE)
          }
          window.__filmCursorAnimId = requestAnimationFrame(tick)
        })
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount, { once: true })
      } else {
        mount()
      }
    },
    { scale, color },
  )
}

/**
 * Restores the pointer position on the CURRENT document (after a navigation).
 * Reads the position record.mjs tracks on the page object.
 */
export async function resyncFilmCursor(page) {
  const pos = page.__filmCursorPos ?? { x: 960, y: 540 }
  await page
    .evaluate(({ x, y }) => window.__demoCursorMove?.(x, y), pos)
    .catch(() => {})
}

/** Manual sync (rarely needed — real mouse events drive the pointer). */
export async function syncFilmCursor(page, x, y) {
  page.__filmCursorPos = { x, y }
  await page
    .evaluate(({ x, y }) => window.__demoCursorMove?.(x, y), { x, y })
    .catch(() => {})
}

/** Compositor-rate eased travel — returns when the animation completes. */
export async function animateFilmCursor(page, fromX, fromY, toX, toY, durationMs) {
  await page
    .evaluate(
      ({ fromX, fromY, toX, toY, durationMs }) =>
        window.__filmCursorAnimate?.({ fromX, fromY, toX, toY, durationMs }),
      { fromX, fromY, toX, toY, durationMs },
    )
    .catch(() => {})
}
