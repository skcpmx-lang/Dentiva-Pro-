/**
 * Integration test harness.
 *
 * Boots the real main-process stack — migrations, repositories, services, session manager and audit chain —
 * on a throwaway data folder, exactly the way the application does. Nothing is stubbed except the two
 * things that genuinely belong to Electron (system printer enumeration) and the clock, which is injected so
 * auto-lock and throttle behaviour can be tested without waiting.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, openDatabase, type SqliteDatabase } from '@main/db/connection'
import { ensureLayout, resolveLayout, type DataLayout } from '@main/storage/paths'
import { SessionManager } from '@main/security/session'
import { applyInitialDefaults, createServices, type Services } from '@main/services/container'
import { verifyActivationCode } from '@main/security/activation'
import type { PatientInput } from '@shared/types'

export const BUILD_INFO = {
  version: '1.0.0',
  buildNumber: 'test',
  commit: 'test',
  buildDate: '2026-09-30'
}

export interface Harness {
  /** Live services: a restore rebuilds the container, so always read through this accessor. */
  services: Services
  session: SessionManager
  layout: DataLayout
  root: string
  /** Advance the injected clock (drives auto-lock and lockout windows). */
  advance: (ms: number) => void
  /** Fire the session manager's scheduled ticks (idle check / auto-lock). */
  tickTimers: () => void
  /** Create a second connection to the same file (used to test concurrency/immutability). */
  reopen: () => SqliteDatabase
  /**
   * Rebuild the service container on the current connection. The IPC host performs exactly this step
   * right after a restore swapped the database file.
   */
  rebuildContainer: () => void
  dispose: () => void
}

export function createHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'dentiva-test-'))
  const layout = resolveLayout(root)
  ensureLayout(layout)

  let clock = Date.parse('2026-09-30T09:00:00+06:00')
  // The session manager schedules its idle/auto-lock check through the injected scheduler; the harness
  // keeps the callback so a test can fire it deterministically instead of waiting for a real timer.
  const intervals: (() => void)[] = []
  let db = openDatabase(layout.databaseFile, { appVersion: BUILD_INFO.version })
  // Exactly what the application bootstrap does before the window opens.
  applyInitialDefaults(db, BUILD_INFO.version)

  let activated = false
  const session = new SessionManager({
    autoLockMinutes: 10,
    now: () => clock,
    scheduler: {
      setInterval: (handler) => {
        intervals.push(handler)
        return intervals.length - 1
      },
      clearInterval: (handle) => {
        const index = Number(handle)
        if (Number.isInteger(index)) intervals[index] = () => undefined
      }
    },
    activationInfo: () => ({ activatedAt: activated ? '2026-09-30 09:00:00' : null })
  })

  function containerOptions(connection: SqliteDatabase): Parameters<typeof createServices>[0] {
    return {
      db: connection,
      layout,
      session,
      appVersion: BUILD_INFO.version,
      buildInfo: BUILD_INFO,
      runtime: { electron: 'test', chrome: 'test', node: 'test', sqlite: 'test', thirdPartyCount: 0 },
      activation: {
        get activated() {
          return activated
        },
        verify: (input) => verifyActivationCode(input),
        markActivated: () => {
          activated = true
        },
        activationStateHash: () => 'test-state-hash'
      },
      closeDb: () => closeDatabase(connection),
      reopenDb: () => {
        db = openDatabase(layout.databaseFile, { appVersion: BUILD_INFO.version })
        return db
      },
      listSystemPrinters: async () => [],
      onProgress: () => undefined
    }
  }

  let services = createServices(containerOptions(db))

  const seed = db.transaction(() => {
    services.permissions.syncCatalogue()
    services.catalogue.seedDefaults()
    services.catalogue.seedRoles()
  })
  seed()

  return {
    get services() {
      return services
    },
    session,
    layout,
    root,
    advance: (ms) => {
      clock += ms
    },
    tickTimers: () => {
      for (const handler of intervals) handler()
    },
    reopen: () => openDatabase(layout.databaseFile, { appVersion: BUILD_INFO.version }),
    rebuildContainer: () => {
      services = createServices(containerOptions(db))
    },
    dispose: () => {
      try {
        session.shutdown()
      } catch {
        // already shut down
      }
      try {
        closeDatabase(db)
      } catch {
        // already closed
      }
      rmSync(root, { recursive: true, force: true })
    }
  }
}

/** Run the one-time setup the way the wizard does, and leave an authenticated Administrator session. */
export function completeSetup(
  harness: Harness,
  options: { username?: string; password?: string; activationCode: string }
): void {
  const activation = harness.services.setup.activate(options.activationCode)
  if (!activation.activated) throw new Error(`Activation failed in the harness: ${activation.message}`)
  harness.services.setup.complete({
    clinic: {
      name: 'Harness Dental Care',
      nameBn: 'হারনেস ডেন্টাল কেয়ার',
      address: '12 Test Road, Dhaka',
      city: 'Dhaka',
      postalCode: '1205',
      country: 'Bangladesh',
      phone1: '+8801700000000',
      phone2: null,
      email: 'clinic@example.com',
      website: null,
      registrationNo: 'REG-001',
      footerQuote: null
    },
    dentists: [
      {
        fullName: 'Dr. Test Dentist',
        designations: ['Consultant'],
        qualifications: ['BDS'],
        certifications: [],
        phone: '+8801711111111',
        email: null,
        registrationNo: null,
        signaturePath: null,
        notes: null,
        isActive: true,
        sortOrder: 0,
        schedules: [{ weekday: 6, startTime: '10:00', endTime: '14:00' }]
      }
    ],
    admin: {
      username: options.username ?? 'admin',
      displayName: 'Clinic Administrator',
      password: options.password ?? 'Harness#Pass1',
      confirmPassword: options.password ?? 'Harness#Pass1'
    },
    activationCode: options.activationCode
  })
  // `setup.complete` signs the new administrator in, exactly like the wizard does.
  if (harness.services.session.sessionState !== 'authenticated') {
    throw new Error('Setup did not leave an authenticated session.')
  }
}

/** Minimal valid patient used by several suites; override any field. */
export function patientInput(overrides: Partial<PatientInput> = {}): PatientInput {
  return {
    fullName: 'Rahim Uddin',
    fullNameBn: 'রহিম উদ্দিন',
    dateOfBirth: '1990-05-15',
    ageYears: null,
    gender: 'male',
    bloodGroup: 'O+',
    phone: '+8801712345678',
    phoneAlt: null,
    email: null,
    address: '45 Green Road',
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
    isActive: true,
    ...overrides
  }
}
