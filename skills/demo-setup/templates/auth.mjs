/**
 * Generic login helpers — reads selectors from demo.config.json and credentials
 * from env vars named in auth.credentialsEnv. Copy to demos/_lib/ during setup.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { pause } from '../_engine/motion.mjs'

function loadAuthConfig() {
  const path = join(process.cwd(), 'demo.config.json')
  if (!existsSync(path)) return { loginRequired: false }
  const cfg = JSON.parse(readFileSync(path, 'utf8'))
  return cfg.auth ?? { loginRequired: false }
}

export async function waitForAppReady(page, { timeout = 30000 } = {}) {
  await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {})
  await page.getByText(/loading|authenticating/i).first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  await pause(400)
}

export async function login(page, { baseUrl, email, password } = {}) {
  const auth = loadAuthConfig()
  if (!auth.loginRequired) return

  const credEnv = auth.credentialsEnv ?? {}
  const user = email ?? process.env[credEnv.email ?? 'DEMO_USER_EMAIL']
  const pass = password ?? process.env[credEnv.password ?? 'DEMO_USER_PASSWORD']
  if (!user || !pass) throw new Error('Demo login credentials missing — set env vars from demo.config.json auth.credentialsEnv')

  const loginUrl = `${baseUrl}${auth.loginPath ?? '/login'}`
  await page.goto(loginUrl, { waitUntil: 'commit' })
  await page.locator(auth.emailSelector ?? '#email').fill(user)
  await page.locator(auth.passwordSelector ?? '#password').fill(pass)
  await page.locator(auth.submitSelector ?? 'button[type=submit]').click()
  await waitForAppReady(page)
}

/** Off-camera session for authenticated recordings (storageState). */
export async function buildDemoSession(browser, { baseUrl, email, password } = {}) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await login(page, { baseUrl, email, password })
  const state = await context.storageState()
  await context.close()
  return state
}
