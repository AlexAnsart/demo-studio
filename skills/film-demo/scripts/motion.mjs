/** Small timing/scroll helpers shared by actions.mjs. No app-specific logic. */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const pause = sleep

/** Gradual wheel scroll — never a single large jump (reads as a jump-cut). */
export async function smoothScroll(page, deltaY, { steps = 18, stepMs = 70 } = {}) {
  const step = deltaY / steps
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, step)
    await sleep(stepMs)
  }
  await pause(400)
}
