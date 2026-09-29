/**
 * End-to-end: clean-machine install → first launch → activation + setup wizard → core clinic flow →
 * uninstall → data preservation.
 *
 * The windows-latest runner is a fresh machine with no previous installation — the exact situation of
 * a clinic downloading v1.0.0. This test drives the NSIS installer itself (silent /S, per-user,
 * asInvoker — no administrator rights), launches the INSTALLED executable (not the development
 * bundle), completes activation and the setup wizard through the interface, writes real data through
 * the real preload bridge, uninstalls silently, and proves the clinic data survives — the promise of
 * `deleteAppDataOnUninstall: false` and the customUnInstall hook in `build/installer.nsh`.
 *
 * It only has something to test in the Release workflow (the only place that builds release/*.exe);
 * in the regular CI job the installer does not exist and the test reports a reasoned skip.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { expect, test } from '@playwright/test'
import { activationCode, completeSetupThroughUi, invoke, launchApp, waitForShell } from './harness'

const repoRoot = resolve(__dirname, '..', '..')
const version = (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }).version
const installer = join(repoRoot, 'release', `DentivaPro-Setup-${version}-x64.exe`)

/** Per-user NSIS install (electron-builder.yml: perMachine false) lands here. */
const installDir = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Dentiva Pro')
const installedExe = join(installDir, 'Dentiva Pro.exe')
const uninstaller = join(installDir, 'Uninstall Dentiva Pro.exe')

test.describe('clean-machine installer (windows-latest)', () => {
  test.setTimeout(240_000)

  test('installs, activates, sets up, writes data, uninstalls and preserves the data', async () => {
    if (!existsSync(installer)) {
      test.skip(true, 'The clean-machine installer test needs the built release/*.exe (Release workflow).')
      return
    }
    if (activationCode.length === 0) {
      test.skip(true, 'The clean-machine installer test needs DENTIVA_ACTIVATION_CODE.')
      return
    }

    // The machine must actually be clean before the "clean machine" claim is meaningful. A failed
    // previous attempt on this runner (Playwright retries once in CI) may have left an installation
    // behind, so clear it first and then demand the clean state.
    if (existsSync(uninstaller)) {
      execFileSync(uninstaller, ['/S'], { stdio: 'inherit' })
    }
    expect(existsSync(installedExe), 'a previous installation could not be removed').toBe(false)

    const appDataDir = mkdtempSync(join(tmpdir(), 'dentiva-installer-appdata-'))
    const dataRoot = join(appDataDir, 'Data')

    try {
      // 1. Silent per-user install — no administrator rights (requestedExecutionLevel: asInvoker).
      execFileSync(installer, ['/S'], { stdio: 'inherit' })
      expect(existsSync(installedExe), 'the installer did not produce the executable').toBe(true)
      expect(existsSync(uninstaller), 'the installer did not register the uninstaller').toBe(true)

      // 2. First launch of the installed application: activation and the setup wizard, exactly as
      //    the clinic would do it. The data root is isolated through DENTIVA_DATA_ROOT.
      const app = await launchApp({ executablePath: installedExe, keepData: true })
      try {
        await completeSetupThroughUi(app.page)
        await waitForShell(app.page)

        // 3. A real record, written through the real bridge of the installed build.
        const patient = await invoke<{ id: number; code: string; fullName: string }>(app.page, 'patients.create', {
          fullName: 'Installer Check Patient',
          fullNameBn: 'ইনস্টলার চেক',
          dateOfBirth: '1990-01-01',
          ageYears: null,
          gender: 'male',
          bloodGroup: 'A+',
          phone: '01711000099',
          phoneAlt: null,
          email: null,
          address: '1 Installer Road',
          addressBn: null,
          city: 'Dhaka',
          occupation: null,
          maritalStatus: null,
          nationalId: null,
          guardianName: null,
          emergencyName: null,
          emergencyPhone: null,
          relationship: null,
          referralSource: null,
          chiefComplaint: null,
          medicalHistory: null,
          dentalHistory: null,
          allergies: null,
          currentMedications: null,
          notes: null,
          isActive: true
        })
        expect(patient.id).toBeGreaterThan(0)
        const listed = await invoke<{ total: number }>(app.page, 'patients.list', { page: 1, pageSize: 10 })
        expect(listed.total).toBe(1)

        // 4. A backup from the installed build: the strongest proof the database layer works as shipped.
        const backup = await invoke<{ fileName: string; path: string; status: string }>(app.page, 'backups.create', {
          includeAttachments: true
        })
        expect(backup.status).toBe('success')
        expect(existsSync(join(backup.path, 'manifest.json'))).toBe(true)
      } finally {
        await app.close()
      }

      // 5. Silent uninstall — removes binaries and shortcuts only.
      execFileSync(uninstaller, ['/S'], { stdio: 'inherit' })
      expect(existsSync(installedExe), 'the uninstaller left the executable behind').toBe(false)
      expect(existsSync(uninstaller), 'the uninstaller left itself behind').toBe(false)

      // 6. The clinic data survives, readable by an external tool: the patient and the audit trail.
      const databaseFile = join(dataRoot, 'Database', 'dentiva.db')
      expect(existsSync(databaseFile), 'the database must survive the uninstall').toBe(true)
      const db = new Database(databaseFile, { readonly: true, fileMustExist: true })
      try {
        const rows = db
          .prepare('SELECT full_name, full_name_bn FROM patients WHERE full_name = ?')
          .all('Installer Check Patient') as { full_name: string; full_name_bn: string }[]
        expect(rows).toHaveLength(1)
        expect(rows[0]?.full_name_bn).toBe('ইনস্টলার চেক')
        const audit = db.prepare('SELECT COUNT(*) AS count FROM audit_log').get() as { count: number }
        expect(audit.count).toBeGreaterThan(0)
        const backups = db.prepare('SELECT COUNT(*) AS count FROM backups').get() as { count: number }
        expect(backups.count).toBe(1)
      } finally {
        db.close()
      }
    } finally {
      rmSync(appDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
})
