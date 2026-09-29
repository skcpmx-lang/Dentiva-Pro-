/**
 * End-to-end harness for the real Electron application.
 *
 * Every test launches `out/main/index.js` through Playwright's Electron support: the real main process,
 * the real preload bridge, the real service layer and a real SQLite database in a throwaway folder.
 *
 * Isolation matters more than it looks. `APPDATA` alone is not enough on Windows: Electron resolves its
 * application-data path through the Win32 shell API, which ignores the environment variable, so two test
 * files would share one database. The application therefore honours an explicit `DENTIVA_DATA_ROOT`
 * override (the same switch a portable installation uses), and each launch points it at a fresh folder.
 */

import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const repoRoot = resolve(__dirname, '..', '..')
export const mainBundle = join(repoRoot, 'out', 'main', 'index.js')
export const activationCode = process.env.DENTIVA_ACTIVATION_CODE ?? ''
export const e2eSkipReason =
  'The end-to-end suite needs the built application (npm run build:app) and, for the setup wizard, DENTIVA_ACTIVATION_CODE.'

// The password policy refuses a password that contains the username (a real rule, enforced by the service
// layer), so the test credential must not contain "admin".
export const adminPassword = 'Dentiva-E2E-Passw0rd!2026'

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  /** Root of the throwaway clinic data (database, attachments, backups, logs). */
  dataRoot: string
  /** Folder that stands in for %APPDATA%\Dentiva Pro. */
  appDataDir: string
  close: () => Promise<void>
}

export interface LaunchOptions {
  /** Reuse an existing data root (for the second launch of a two-part test). */
  appDataDir?: string
  /** Extra environment variables (e.g. a device pixel ratio for the DPI tests). */
  env?: Record<string, string>
  /** Keep the application data after the test (for debugging). */
  keepData?: boolean
}

function temporaryRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const appDataDir = options.appDataDir ?? temporaryRoot('dentiva-e2e-appdata-')
  const dataRoot = join(appDataDir, 'Data')
  mkdirSync(dataRoot, { recursive: true })

  const app = await electron.launch({
    args: [mainBundle],
    env: {
      ...process.env,
      // The explicit override is what actually isolates the run (see the note at the top); APPDATA and
      // LOCALAPPDATA are redirected as well so window state and caches land in the throwaway folder too.
      DENTIVA_DATA_ROOT: dataRoot,
      APPDATA: appDataDir,
      LOCALAPPDATA: appDataDir,
      // No update checks, no dev server: the test drives the built bundles.
      DENTIVA_DEV_SERVER_URL: '',
      DENTIVA_E2E: '1',
      ...options.env
    }
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // The window is only useful once the bridge is installed and the first render finished.
  // `globalThis` keeps this file free of DOM types: the callback runs inside the renderer, not in Node.
  await page.waitForFunction(() => Boolean((globalThis as unknown as { dentiva?: unknown }).dentiva), null, {
    timeout: 30_000
  })

  const close = async (): Promise<void> => {
    await app.close().catch(() => undefined)
    if (!options.keepData) {
      // Give the main process a moment to release the database before deleting the folder.
      await new Promise((done) => setTimeout(done, 250))
      rmSync(appDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }

  return { app, page, dataRoot, appDataDir, close }
}

/** Call a channel through the real preload bridge and throw on a refused result. */
export async function invoke<T = unknown>(page: Page, channel: string, payload?: unknown): Promise<T> {
  const result = (await page.evaluate(
    async ([channelName, body]) => {
      const bridge = (
        globalThis as unknown as { dentiva: { invoke: (c: string, p: unknown) => Promise<unknown> } }
      ).dentiva
      return await bridge.invoke(channelName as string, body)
    },
    [channel, payload ?? undefined] as const
  )) as { ok: boolean; data?: T; error?: { message: string } }
  if (!result.ok) throw new Error(`${channel} failed: ${result.error?.message ?? 'unknown error'}`)
  return result.data as T
}

/** Complete the setup wizard through the interface, exactly as a clinic would. */
export async function completeSetupThroughUi(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /setup|welcome|activate/i }).first()).toBeVisible({
    timeout: 30_000
  })

  // Step 1 — activation.
  await page.getByLabel('Activation code').fill(activationCode)
  await page.getByRole('button', { name: /activate/i }).click()

  // Step 2 — clinic.
  await page.getByLabel('Clinic name', { exact: true }).fill('E2E Dental Care')
  await page.getByLabel('Address').fill('12 Test Road')
  await page.getByLabel('City').fill('Dhaka')
  await page.getByLabel('Postal code').fill('1205')
  await page.getByLabel('Country').fill('Bangladesh')
  await page.getByLabel('Phone', { exact: true }).fill('+8801700000000')
  await page.getByRole('button', { name: /^continue$/i }).click()

  // Step 3 — the first dentist.
  await page.getByLabel('Full name').first().fill('Dr. E2E Dentist')
  await page.getByLabel('Designations').first().fill('Consultant')
  await page.getByLabel('Qualifications').first().fill('BDS')
  await page.getByRole('button', { name: /^continue$/i }).click()

  // Step 4 — administrator.
  await page.getByLabel('Username').fill('admin')
  await page.getByLabel('Display name').fill('E2E Administrator')
  await page.getByLabel('Password', { exact: true }).fill(adminPassword)
  await page.getByLabel('Confirm password').fill(adminPassword)
  await page.getByRole('button', { name: /finish|complete setup|create account/i }).click()
}

/** Sign in from the sign-in screen or the lock screen. */
export async function signInThroughUi(
  page: Page,
  password = adminPassword,
  username = 'admin'
): Promise<void> {
  const usernameField = page.getByLabel(/username/i).first()
  if (await usernameField.isVisible().catch(() => false)) {
    await usernameField.fill(username)
  }
  await page
    .getByLabel(/^password$/i)
    .first()
    .fill(password)
  await page
    .getByRole('button', { name: /sign in|unlock/i })
    .first()
    .click()
}

/** Wait until the application shell is on screen (sidebar + header). */
export async function waitForShell(page: Page): Promise<void> {
  await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 30_000 })
}

/**
 * Reload the renderer and settle on the shell after the setup wizard was completed through the bridge
 * rather than through the interface: the renderer still shows the setup screens, so it has to boot again
 * and pick up the signed-in session the service created.
 */
export async function resumeAfterSetup(page: Page): Promise<void> {
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  const passwordField = page.getByLabel(/^password$/i).first()
  if (await passwordField.isVisible().catch(() => false)) {
    await signInThroughUi(page)
  }
  await waitForShell(page)
}

/** Navigate with the sidebar and wait for the requested screen. */
export async function openScreen(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('link', { name }).first().click()
}
