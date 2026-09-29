import { defineConfig } from '@playwright/test'

/**
 * End-to-end configuration for Dentiva Pro desktop (Electron) acceptance tests.
 *
 * These tests launch the REAL packaged/built Electron application (out/main/index.js)
 * and drive it through Playwright's Electron API. They are executed in GitHub Actions
 * on windows-latest (see .github/workflows/ci.yml) because the product is a Windows
 * desktop application.
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.e2e.ts'],
  timeout: 120_000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../test-results/e2e-report', open: 'never' }],
    ['json', { outputFile: '../../test-results/e2e-results.json' }]
  ],
  outputDir: '../../test-results/e2e-artifacts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  }
})
