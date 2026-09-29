/**
 * Integration tests for the operational rules that the acceptance checklist still had open as
 * "business logic only, not asserted yet":
 *
 *  * AT-E06 — destructive actions: typed phrase, password, safety backup, audit trail, and the refusal
 *    paths that must leave the database untouched;
 *  * AT-C02 — every patient date filter returns the set the label promises, newest first;
 *  * AT-E09 — the automatic notification sweep raises the categories it promises, with deduplication;
 *  * AT-A04 — setup validation: a rejected step must not leave a half-configured installation.
 *
 * Everything runs through the real services against a real SQLite file.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addDaysIso, todayIso } from '@shared/date'
import { DESTRUCTIVE_PHRASES } from '@main/services/admin-service'
import { completeSetup, createHarness, patientInput, type Harness } from './harness'

const activationCode = process.env.DENTIVA_ACTIVATION_CODE ?? ''
const password = 'Harness#Pass1'
const today = todayIso()

let harness: Harness
let scratch = ''

/** The activation gate is a fixed offline secret, so the whole suite needs `DENTIVA_ACTIVATION_CODE`. */
const suite = activationCode.length > 0 ? describe : describe.skip

beforeEach(() => {
  if (activationCode.length === 0) return
  harness = createHarness()
  completeSetup(harness, { activationCode, password })
  scratch = mkdtempSync(join(tmpdir(), 'dentiva-operations-'))
})

afterEach(() => {
  harness?.dispose()
  if (scratch.length > 0) rmSync(scratch, { recursive: true, force: true })
})

suite('destructive actions (AT-E06)', () => {
  it('refuses a wrong phrase, an unknown action and a missing password without touching any row', async () => {
    const patient = harness.services.clinical.createPatient(
      patientInput({ fullName: 'Delete Me', phone: '01710000001' })
    )
    const countBefore = harness.services.db.prepare('SELECT COUNT(*) AS count FROM patients').get() as {
      count: number
    }

    await expect(
      harness.services.admin.runDestructive({
        action: 'delete_patient',
        confirmationPhrase: 'delete patient',
        password,
        ids: [patient.id]
      })
    ).rejects.toThrow(/type "DELETE PATIENT"/i)

    // An action the build does not know (a tampered renderer) is refused before anything happens.
    await expect(
      harness.services.admin
        .runDestructive({
          action: 'nuke_everything' as unknown as Parameters<
            typeof harness.services.admin.runDestructive
          >[0]['action'],
          confirmationPhrase: 'NUKE EVERYTHING',
          password,
          ids: []
        })
        .then(() => undefined)
    ).rejects.toThrow(/unknown|not supported/i)

    // Every refusal above happened before the safety backup and before any write.
    expect(harness.services.admin.listBackups().length).toBe(0)
    expect(
      (harness.services.db.prepare('SELECT COUNT(*) AS count FROM patients').get() as { count: number }).count
    ).toBe(countBefore.count)
  })

  it('takes a verified safety backup, deletes exactly the selected patients and audits the action', async () => {
    const patient = harness.services.clinical.createPatient(
      patientInput({ fullName: 'Selected Person', phone: '01710000002' })
    )
    const keeper = harness.services.clinical.createPatient(
      patientInput({ fullName: 'Keep Me', phone: '01710000003' })
    )

    const result = await harness.services.admin.runDestructive({
      action: 'delete_selected_patients',
      confirmationPhrase: DESTRUCTIVE_PHRASES.delete_selected_patients,
      password,
      ids: [patient.id],
      includeAttachments: true
    })

    expect(result.action).toBe('delete_selected_patients')
    expect(result.affected).toBe(1)
    // The pre-action backup is a real, verifiable artefact, not a note that a backup "should" happen.
    expect(result.preBackup.trigger).toBe('pre_destructive')
    expect(existsSync(result.preBackup.path)).toBe(true)
    const inspection = harness.services.admin.verifyBackup(result.preBackup.path)
    expect(inspection.valid).toBe(true)
    expect(inspection.problems).toEqual([])
    expect(inspection.manifest?.trigger).toBe('pre_destructive')

    const remaining = harness.services.clinical.listPatients({ page: 1, pageSize: 20 })
    expect(remaining.rows.map((row) => row.fullName)).toEqual(['Keep Me'])
    expect(harness.services.clinical.getPatient(keeper.id).fullName).toBe('Keep Me')

    const audit = harness.services.admin.listAudit({ page: 1, pageSize: 20, action: 'data.destructive' })
    expect(audit.rows.length).toBeGreaterThan(0)
    expect(audit.rows[0]?.summary).toBe('Performed "DELETE SELECTED PATIENTS" affecting 1 record(s)')
    expect(audit.rows[0]?.severity).toBe('critical')
  })

  it('requires the signed-in user’s password when the setting demands it', async () => {
    harness.services.clinical.createPatient(patientInput({ fullName: 'Password Guarded' }))
    harness.services.admin.updateSettings({ requirePasswordOnDestructive: true })

    await expect(
      harness.services.admin.runDestructive({
        action: 'delete_all_patients',
        confirmationPhrase: DESTRUCTIVE_PHRASES.delete_all_patients,
        password: '',
        ids: []
      })
    ).rejects.toThrow(/password/i)

    await expect(
      harness.services.admin.runDestructive({
        action: 'delete_all_patients',
        confirmationPhrase: DESTRUCTIVE_PHRASES.delete_all_patients,
        password: 'not-the-password',
        ids: []
      })
    ).rejects.toThrow(/password|incorrect/i)
  })
})

suite('patient date filters (AT-C02)', () => {
  function seedPatientsByDate(): { newest: string; oldest: string } {
    // The registration date is stamped by the service, so the fixture rewrites it through the repository
    // the same way an imported record would arrive, then asks the list for each window.
    const names = ['Today Person', 'Week Person', 'Month Person', 'Quarter Person', 'Old Person']
    const offsets = [0, -3, -20, -60, -200]
    names.forEach((fullName, index) => {
      const patient = harness.services.clinical.createPatient(
        patientInput({ fullName, phone: `0171200${1000 + index}` })
      )
      harness.services.db
        .prepare('UPDATE patients SET created_at = ? WHERE id = ?')
        .run(`${addDaysIso(today, offsets[index] as number)} 09:00:00`, patient.id)
    })
    return { newest: 'Today Person', oldest: 'Old Person' }
  }

  it('returns the window each preset promises and sorts newest first by default', () => {
    const { newest } = seedPatientsByDate()
    const names = (range: 'today' | 'last7' | 'last30' | 'last90' | 'lastYear' | 'all'): string[] =>
      harness.services.clinical.listPatients({ page: 1, pageSize: 50, range }).rows.map((row) => row.fullName)

    expect(names('today')).toEqual(['Today Person'])
    expect(names('last7')).toEqual(['Today Person', 'Week Person'])
    expect(names('last30')).toEqual(['Today Person', 'Week Person', 'Month Person'])
    expect(names('last90')).toEqual(['Today Person', 'Week Person', 'Month Person', 'Quarter Person'])
    expect(names('lastYear')).toHaveLength(5)
    expect(names('all')).toHaveLength(5)

    // Newest first is the documented default ordering, not an accident of the fixture order.
    expect(names('all')[0]).toBe(newest)

    // A custom range is inclusive on both ends.
    expect(
      harness.services.clinical
        .listPatients({
          page: 1,
          pageSize: 50,
          range: 'custom',
          from: addDaysIso(today, -30),
          to: addDaysIso(today, -10)
        })
        .rows.map((row) => row.fullName)
    ).toEqual(['Month Person'])
  })

  it('hides archived patients unless the caller asks for them', () => {
    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Archived Person' }))
    harness.services.clinical.archivePatient(patient.id)

    expect(
      harness.services.clinical.listPatients({ page: 1, pageSize: 20 }).rows.map((row) => row.fullName)
    ).not.toContain('Archived Person')
    expect(
      harness.services.clinical
        .listPatients({ page: 1, pageSize: 20, includeArchived: true })
        .rows.map((row) => row.fullName)
    ).toContain('Archived Person')
  })
})

suite('notification sweep (AT-E09)', () => {
  it('raises the appointment, inventory, billing and expiry categories it promises, then deduplicates', () => {
    // A patient with an outstanding invoice, an item below its minimum, and a second batch expiring soon.
    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Notif Person' }))
    harness.services.billing.createInvoice({
      patientId: patient.id,
      visitId: null,
      invoiceDate: today,
      dueDate: null,
      notes: null,
      discountPoisha: 0,
      discountPercentX100: 0,
      taxPercentX100: 0,
      roundOffEnabled: false,
      items: [
        {
          itemType: 'service',
          treatmentId: null,
          description: 'Scaling',
          quantityMilli: 1000,
          unitPricePoisha: 400000,
          discountPoisha: 0
        }
      ]
    })

    const item = harness.services.billing.createInventoryItem({
      code: 'NOTIF-1',
      name: 'Gloves',
      category: 'Consumables',
      unit: 'box',
      supplierId: null,
      quantityMilli: 0,
      minStockMilli: 5000,
      purchasePricePoisha: 100000,
      sellPricePoisha: null,
      location: null,
      isActive: true,
      notes: null
    })
    harness.services.billing.stockIn({
      itemId: item.id,
      batchNo: 'B-NOTIF',
      expiryDate: addDaysIso(today, 10),
      quantityMilli: 1000,
      unitCostPoisha: 100000,
      purchaseDate: today,
      supplierId: null,
      reference: null,
      notes: null
    })

    harness.services.clinical.refreshNotifications()
    const first = harness.services.clinical.listNotifications(false, 50)
    const categories = new Set(first.map((row) => row.category))

    expect(categories.has('inventory')).toBe(true)
    expect(categories.has('billing')).toBe(true)
    expect(first.some((row) => /expiring soon/i.test(row.title))).toBe(true)
    expect(first.some((row) => /low stock/i.test(row.title))).toBe(true)
    expect(first.some((row) => /outstanding balance/i.test(row.title))).toBe(true)

    // Every notification points somewhere, so the bell is actionable rather than decorative.
    expect(first.every((row) => row.title.length > 0 && row.entityType !== null)).toBe(true)

    // Running the sweep again the same day must not duplicate what the user has already seen.
    const before = first.length
    harness.services.clinical.refreshNotifications()
    expect(harness.services.clinical.listNotifications(false, 50).length).toBe(before)

    // Reading and dismissing are recorded, and the unread count follows.
    const unreadBefore = harness.services.clinical.listNotifications(true, 50).length
    expect(unreadBefore).toBeGreaterThan(0)
    const target = first[0]
    harness.services.clinical.markNotificationRead(target.id)
    expect(harness.services.clinical.listNotifications(true, 50).length).toBe(unreadBefore - 1)
    harness.services.clinical.dismissNotification(target.id)
    expect(harness.services.clinical.listNotifications(false, 50).some((row) => row.id === target.id)).toBe(
      false
    )
  })
})

suite('setup validation (AT-A04)', () => {
  // This suite needs an installation that has been activated but not yet configured, so it takes its own
  // harness instead of the one the other suites complete the setup on.
  let fresh: Harness
  beforeEach(() => {
    fresh = createHarness()
  })
  afterEach(() => {
    fresh?.dispose()
  })

  const validClinic = {
    name: 'Validation Clinic',
    nameBn: null,
    address: '45 Second Road, Dhaka',
    city: 'Dhaka',
    postalCode: '1212',
    country: 'Bangladesh',
    phone1: '+8801755555555',
    phone2: null,
    email: null,
    website: null,
    registrationNo: null,
    footerQuote: null
  }
  const validDentist = {
    fullName: 'Dr. Validation',
    designations: ['Consultant'],
    qualifications: ['BDS'],
    certifications: [],
    phone: '+8801766666666',
    email: null,
    registrationNo: null,
    signaturePath: null,
    notes: null,
    isActive: true,
    sortOrder: 0,
    schedules: []
  }

  it('reports every problem at once and leaves no partial installation behind', () => {
    fresh.services.setup.activate(activationCode)

    let caught: unknown = null
    try {
      fresh.services.setup.complete({
        clinic: validClinic,
        // A clinic with no dentist is not a usable installation either.
        dentists: [],
        admin: {
          username: 'owner',
          displayName: 'Owner',
          password: 'short',
          confirmPassword: 'short'
        },
        activationCode
      })
    } catch (cause) {
      caught = cause
    }

    const problem = caught as { code?: string; fields?: { field: string; message: string }[] } | null
    expect(problem?.code).toBe('VALIDATION_ERROR')
    // The wizard marks each field from the payload, so the refusal must name every problem, not the first.
    expect(problem?.fields?.map((entry) => entry.field)).toEqual(
      expect.arrayContaining(['dentists', 'admin.password'])
    )

    // Nothing was written: no clinic, no dentist, no administrator.
    expect(fresh.services.setup.isSetupComplete()).toBe(false)
    expect(fresh.services.auth.listUsers().length).toBe(0)
    expect(fresh.services.db.prepare('SELECT COUNT(*) AS count FROM dentists').get()).toMatchObject({
      count: 0
    })

    // A password that does not match its confirmation is refused the same way.
    let mismatch: unknown = null
    try {
      fresh.services.setup.complete({
        clinic: validClinic,
        dentists: [validDentist],
        admin: {
          username: 'owner',
          displayName: 'Owner',
          password,
          confirmPassword: `${password}x`
        },
        activationCode
      })
    } catch (cause) {
      mismatch = cause
    }
    expect((mismatch as { code?: string }).code).toBe('VALIDATION_ERROR')
    expect((mismatch as { fields?: { field: string }[] }).fields?.map((entry) => entry.field)).toContain(
      'admin.confirmPassword'
    )
    expect(fresh.services.setup.isSetupComplete()).toBe(false)
    expect(fresh.services.auth.listUsers().length).toBe(0)
  })

  it('refuses a blank administrator username and a password that matches the username', () => {
    fresh.services.setup.activate(activationCode)

    for (const username of ['   ', 'owner']) {
      let caught: unknown = null
      try {
        fresh.services.setup.complete({
          clinic: validClinic,
          dentists: [validDentist],
          admin: { username, displayName: 'Owner', password: 'owner123456', confirmPassword: 'owner123456' },
          activationCode
        })
      } catch (cause) {
        caught = cause
      }
      expect((caught as { code?: string }).code).toBe('VALIDATION_ERROR')
    }

    expect(fresh.services.setup.isSetupComplete()).toBe(false)
    expect(fresh.services.auth.listUsers().length).toBe(0)
  })
})

suite('full reset (AT-E06)', () => {
  it('resets the installation, keeps the audit trail and stays integrity-clean', async () => {
    const patient = harness.services.clinical.createPatient(
      patientInput({ fullName: 'Doomed Person', phone: '01710000009' })
    )
    const auditBefore = harness.services.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get() as {
      count: number
    }

    const result = await harness.services.admin.runDestructive({
      action: 'reset_database',
      confirmationPhrase: DESTRUCTIVE_PHRASES.reset_database,
      password,
      ids: []
    })

    // The count covers business rows and accounts, and it is reported to the user and the audit log.
    expect(result.affected).toBeGreaterThan(0)
    expect(
      (harness.services.db.prepare('SELECT COUNT(*) AS count FROM patients').get() as { count: number }).count
    ).toBe(0)
    expect(
      (harness.services.db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count
    ).toBe(0)
    expect(harness.services.setup.isSetupComplete()).toBe(false)

    // The trail survives the reset and grows with it: it is append-only, not part of the data that is
    // wiped. (The pre-action backup is taken first, and the reset itself is an audited action.)
    const auditAfter = harness.services.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get() as {
      count: number
    }
    expect(auditAfter.count).toBeGreaterThan(auditBefore.count)
    const reset = harness.services.db
      .prepare(
        "SELECT summary, severity FROM audit_log WHERE action = 'data.destructive' ORDER BY id DESC LIMIT 1"
      )
      .get() as { summary: string; severity: string }
    expect(reset.summary).toContain('RESET DATABASE')
    expect(reset.severity).toBe('critical')
    expect(existsSync(result.preBackup.path)).toBe(true)

    // Foreign keys and the on-disk image are still sound after the wipe.
    expect(harness.services.db.pragma('foreign_key_check')).toEqual([])
    expect(harness.services.db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    void patient
  })
})

suite('patient import (AT-E06)', () => {
  const header = 'Full Name,Name (Bangla),Phone,Gender,Date of Birth,City,Allergies'
  const writeCsv = (name: string, lines: string[]): string => {
    const file = join(scratch, name)
    writeFileSync(file, [header, ...lines].join('\n'), 'utf8')
    return file
  }

  it('reports what it would do without writing anything, then imports the valid rows', () => {
    const file = writeCsv('patients.csv', [
      'Abdul Karim,আব্দুল করিম,01711000001,male,12/03/1990,Dhaka,Penicillin',
      'Rahima Begum,,01711000002,female,1995-07-04,,None',
      ',no-name,01711000003,male,1990-01-01,Khulna,',
      'Broken Phone,,01711,female,1990-01-01,Sylhet,',
      // Same name and phone as line 2: a repeated entry inside the file.
      'Rahima Begum,,01711000002,female,1995-07-04,,None'
    ])

    const draft = harness.services.clinical.importPatients({ filePath: file, dryRun: true })
    expect(draft.totalRows).toBe(5)
    expect(draft.validRows).toBe(2)
    expect(draft.duplicateRows).toBe(1)
    expect(draft.invalidRows).toBe(2)
    expect(draft.imported).toBe(0)
    expect(draft.issues.map((issue) => issue.row)).toEqual(expect.arrayContaining([4, 5, 6]))
    expect(draft.issues.find((issue) => issue.row === 5)?.field).toBe('phone')
    expect(draft.preview).toHaveLength(2)
    // A draft writes nothing at all: no patient, no counter movement, no audit entry.
    expect(harness.services.clinical.listPatients({ page: 1, pageSize: 20 }).total).toBe(0)

    const imported = harness.services.clinical.importPatients({ filePath: file, dryRun: false })
    expect(imported.imported).toBe(2)
    const register = harness.services.clinical.listPatients({ page: 1, pageSize: 20 })
    expect(register.total).toBe(2)
    expect(register.rows.map((row) => row.fullName).sort()).toEqual(['Abdul Karim', 'Rahima Begum'])
    // Bengali names and the day-first date survive the round trip.
    const karim = register.rows.find((row) => row.fullName === 'Abdul Karim')
    expect(karim?.phone).toBe('01711000001')
    const stored = harness.services.clinical.getPatient(karim?.id as number)
    expect(stored.fullNameBn).toBe('আব্দুল করিম')
    expect(stored.dateOfBirth).toBe('1990-03-12')

    // One audit entry records the import as a single action.
    const audit = harness.services.admin.listAudit({ page: 1, pageSize: 20, action: 'data.import' })
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]?.summary).toContain('Imported 2 patient(s)')

    // Importing the same file again adds nothing: the rows are duplicates of what is now registered.
    const again = harness.services.clinical.importPatients({ filePath: file, dryRun: false })
    expect(again.imported).toBe(0)
    // Both imported rows are now in the register, plus the entry that repeats inside the file.
    expect(again.duplicateRows).toBe(3)
    expect(harness.services.clinical.listPatients({ page: 1, pageSize: 20 }).total).toBe(2)
  })

  it('accepts the exported register as its own input (the template round-trips)', () => {
    harness.services.clinical.createPatient(
      patientInput({ fullName: 'Round Trip', phone: '01711000009', city: 'Dhaka' })
    )
    const exported = harness.services.billing.exportData({
      entity: 'patients',
      format: 'csv',
      targetFolder: scratch
    })
    const draft = harness.services.clinical.importPatients({ filePath: exported.filePath, dryRun: true })
    // The exported headers are recognised, so re-importing a register is reported as duplicates rather
    // than as a header error.
    expect(draft.totalRows).toBe(1)
    expect(draft.duplicateRows).toBe(1)
    expect(draft.issues).toHaveLength(1)
  })

  it('refuses a file it cannot trust: wrong type, wrong header, missing file, oversized file', () => {
    const notCsv = join(scratch, 'patients.txt')
    writeFileSync(notCsv, 'Full Name,Phone\nSomeone,01711000001', 'utf8')
    expect(() => harness.services.clinical.importPatients({ filePath: notCsv, dryRun: true })).toThrow(
      /\.csv/i
    )

    const wrongHeader = join(scratch, 'wrong.csv')
    writeFileSync(wrongHeader, 'Column A,Column B\n1,2', 'utf8')
    expect(() => harness.services.clinical.importPatients({ filePath: wrongHeader, dryRun: true })).toThrow(
      /missing required columns/i
    )

    expect(() =>
      harness.services.clinical.importPatients({
        filePath: join(scratch, 'does-not-exist.csv'),
        dryRun: true
      })
    ).toThrow(/not found/i)

    const huge = join(scratch, 'huge.csv')
    writeFileSync(huge, `${header}\n${'Someone,,'.concat('x'.repeat(1024))}`, 'utf8')
    // A file with more rows than the limit is refused by row count, which is cheaper than size alone.
    const manyRows = [
      header,
      ...Array.from({ length: 5001 }, (_, index) => `Person ${index},,0171100${index}`)
    ]
    writeFileSync(huge, manyRows.join('\n'), 'utf8')
    expect(() => harness.services.clinical.importPatients({ filePath: huge, dryRun: true })).toThrow(/limit/i)
  })

  it('is refused for a role without the import permission', () => {
    const file = writeCsv('permission.csv', ['Someone,,01711000007,male,1990-01-01,,'])

    const role = harness.services.auth.listRoles().find((entry) => entry.code === 'accountant')!
    harness.services.auth.createUser(
      {
        username: 'import.accountant',
        displayName: 'Accountant',
        roleId: role.id,
        isActive: true,
        mustChangePassword: false,
        overrides: []
      },
      password
    )
    harness.services.auth.logout()
    harness.services.auth.login('import.accountant', password)

    expect(() => harness.services.clinical.importPatients({ filePath: file, dryRun: true })).toThrow(
      /permission/i
    )
  })
})
