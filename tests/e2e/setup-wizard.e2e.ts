/**
 * End-to-end: the setup wizard, the application shell and the session rules.
 *
 * These tests drive the real Electron application: the wizard is filled in through the interface, the
 * About page is opened from the sidebar, the lock button is clicked and the sign-out path is exercised.
 * They run on windows-latest in CI (see .github/workflows/ci.yml) and need the activation code in
 * `DENTIVA_ACTIVATION_CODE`; without it the suite is skipped instead of failing.
 */

import { expect, test } from '@playwright/test'
import {
  activationCode,
  adminPassword,
  completeSetupThroughUi,
  e2eSkipReason,
  invoke,
  launchApp,
  signInThroughUi,
  waitForShell,
  type LaunchedApp
} from './harness'

test.describe('Setup wizard and application shell', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(activationCode.length === 0, e2eSkipReason)

  let app: LaunchedApp

  test.beforeAll(async () => {
    app = await launchApp()
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('the wizard creates the clinic, the first dentist and the administrator', async () => {
    const { page } = app

    const status = await invoke<{ setupRequired: boolean; activationRequired: boolean }>(page, 'setup.status')
    expect(status.setupRequired).toBe(true)
    if (status.setupRequired) {
      // A virgin installation must ask for both the activation code and the clinic profile. Playwright
      // retries a serial group against the same application, so a retry resumes on the installation the
      // first attempt left behind instead of pretending the wizard has never run.
      expect(status.activationRequired).toBe(true)
      await completeSetupThroughUi(page)
    } else {
      await signInThroughUi(page)
    }
    await waitForShell(page)

    // The wizard wrote real records: clinic profile, one dentist and one administrator account.
    const snapshot = await invoke<{ clinic: { name: string } }>(page, 'settings.snapshot')
    expect(snapshot.clinic.name).toBe('E2E Dental Care')
    const dentists = await invoke<unknown[]>(page, 'dentists.list')
    expect(dentists.length).toBe(1)
    const status2 = await invoke<{ setupRequired: boolean }>(page, 'setup.status')
    expect(status2.setupRequired).toBe(false)
  })

  test('the sidebar exposes the four groups and the About page reports the real product facts', async () => {
    const { page } = app
    await waitForShell(page)

    for (const group of ['Practice', 'Clinical', 'Billing', 'Administration']) {
      await expect(page.getByText(group, { exact: true }).first()).toBeVisible()
    }

    await page.getByRole('link', { name: /about/i }).first().click()
    await expect(page.getByText('Dentiva Pro', { exact: false }).first()).toBeVisible()

    const info = await invoke<{
      productName: string
      version: string
      author: string
      authorEmail: string
      thirdPartyCount: number
    }>(page, 'system.about')
    expect(info.productName).toBe('Dentiva Pro')
    expect(info.author).toBe('Shohan Khan')
    expect(info.authorEmail).toBe('helloiamshohan@gmail.com')
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/)
    // The count comes from the generated notices, so it is never zero in a real build.
    expect(info.thirdPartyCount).toBeGreaterThan(0)

    const notices = await invoke<string>(page, 'system.thirdPartyNotices')
    expect(notices).toContain('THIRD-PARTY NOTICES')
    expect(notices).toContain('better-sqlite3')
  })

  test('the session locks, unlocks with the password and ends at sign-out', async () => {
    const { page } = app
    await waitForShell(page)

    await invoke(page, 'auth.lock')
    await expect(page.getByText(/locked|enter your password/i).first()).toBeVisible({ timeout: 15_000 })
    await signInThroughUi(page)
    await waitForShell(page)

    await invoke(page, 'auth.logout')
    await expect(page.getByLabel(/^password$/i).first()).toBeVisible({ timeout: 20_000 })
    await signInThroughUi(page)
    await waitForShell(page)
  })

  test('a wrong password is refused and the correct password is accepted', async () => {
    const { page } = app
    await invoke(page, 'auth.logout')
    await page
      .getByLabel(/^password$/i)
      .first()
      .fill('not-the-password')
    await page
      .getByRole('button', { name: /sign in/i })
      .first()
      .click()
    // The service refuses the sign-in and the screen shows the reason in its alert region.
    const refusal = page.getByRole('alert').first()
    await expect(refusal).toBeVisible({ timeout: 15_000 })
    await expect(refusal).toContainText(/not correct|incorrect|not valid|wrong/i)

    await signInThroughUi(page)
    await waitForShell(page)
    expect(adminPassword.length).toBeGreaterThanOrEqual(10)
  })
})
