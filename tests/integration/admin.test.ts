/**
 * Integration tests for administration: catalogue, staff, users and roles, settings, notifications,
 * attachments and data export (acceptance tests AT-B05, AT-C02, AT-C04, AT-E01, AT-E03–AT-E07, AT-E09).
 *
 * Everything here runs against the real database and the real service layer, signed in as a real user, so
 * the authorization checks are exercised the way the application exercises them — a denied call must throw
 * `FORBIDDEN` and must not return data, not merely hide a button.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { completeSetup, createHarness, patientInput, type Harness } from './harness'

const activationCode = process.env.DENTIVA_ACTIVATION_CODE ?? ''
const password = 'Harness#Pass1'

/**
 * The activation gate is a fixed offline secret, so the whole suite needs `DENTIVA_ACTIVATION_CODE`.
 * Without it the tests are reported as skipped (CI refuses to run this job without the secret), never
 * silently "passing".
 */
const suite = activationCode.length > 0 ? describe : describe.skip

let harness: Harness
let scratch: string

beforeEach(() => {
  if (activationCode.length === 0) return
  harness = createHarness()
  completeSetup(harness, { activationCode, password })
  scratch = mkdtempSync(join(tmpdir(), 'dentiva-admin-'))
})

afterEach(() => {
  harness?.dispose()
  if (scratch) rmSync(scratch, { recursive: true, force: true })
})

function admin() {
  return harness.services.admin
}

function expectRefusal(run: () => unknown, expectedCode = 'FORBIDDEN'): string {
  try {
    run()
  } catch (error) {
    const appError = error as { code?: string; message?: string }
    expect(appError.code).toBe(expectedCode)
    return appError.message ?? ''
  }
  throw new Error('The call was expected to be refused but it succeeded.')
}

suite('treatment catalogue', () => {
  it('creates, updates, lists and deactivates treatments from the database, not from code', () => {
    const created = harness.services.clinical.saveTreatment({
      code: 'RCT',
      name: 'Root canal treatment',
      nameBn: 'রুট ক্যানেল',
      category: 'Endodontics',
      description: 'Single-visit root canal treatment',
      defaultFeePoisha: 850000,
      durationMinutes: 60,
      isSystemDefault: false,
      isActive: true
    })
    expect(created.id).toBeGreaterThan(0)

    const active = harness.services.clinical.listTreatments({ page: 1, pageSize: 50 })
    expect(active.rows.map((row) => row.name)).toContain('Root canal treatment')

    const renamed = harness.services.clinical.saveTreatment({
      id: created.id,
      code: 'RCT',
      name: 'Root canal treatment (molar)',
      nameBn: null,
      category: 'Endodontics',
      description: 'Molar endodontics, single visit',
      defaultFeePoisha: 950000,
      durationMinutes: 75,
      isSystemDefault: false,
      isActive: true
    })
    expect(renamed.id).toBe(created.id)
    expect(renamed.name).toBe('Root canal treatment (molar)')
    expect(renamed.defaultFeePoisha).toBe(950000)

    harness.services.clinical.deactivateTreatment(created.id)
    const stillActive = harness.services.clinical.listTreatments({ page: 1, pageSize: 50 })
    expect(stillActive.rows.map((row) => row.id)).not.toContain(created.id)
    const all = harness.services.clinical.listTreatments({ page: 1, pageSize: 50, includeInactive: true })
    expect(all.rows.map((row) => row.id)).toContain(created.id)
  })
})

suite('staff records', () => {
  it('keeps staff details, including the sensitive fields, and removes a record on request', () => {
    const staff = admin().saveStaff({
      name: 'Rahima Begum',
      age: 31,
      gender: 'female',
      address: 'Mirpur, Dhaka',
      bloodGroup: 'B+',
      identificationNo: 'NID-1990123456',
      photoPath: null,
      phone: '01712345678',
      position: 'Dental assistant',
      department: 'Clinical',
      salaryPoisha: 2500000,
      joiningDate: '2024-03-01',
      status: 'active',
      notes: null
    })
    expect(staff.id).toBeGreaterThan(0)

    const listed = admin().listStaff()
    const found = listed.find((row) => row.id === staff.id)
    expect(found?.name).toBe('Rahima Begum')
    expect(found?.salaryPoisha).toBe(2500000)
    expect(found?.identificationNo).toBe('NID-1990123456')

    admin().removeStaff(staff.id)
    expect(
      admin()
        .listStaff()
        .map((row) => row.id)
    ).not.toContain(staff.id)
  })
})

suite('users, roles and authorization', () => {
  it('creates a role and a user, then refuses a financial action at the service layer', () => {
    const receptionRole = harness.services.auth.listRoles().find((role) => role.code === 'receptionist')
    expect(receptionRole).toBeDefined()

    const user = harness.services.auth.createUser(
      {
        username: 'frontdesk',
        displayName: 'Front Desk',
        roleId: receptionRole!.id,
        isActive: true,
        mustChangePassword: false,
        overrides: [
          { code: 'payments.void', effect: 'deny' },
          { code: 'visits.view', effect: 'allow' }
        ]
      },
      password
    )
    expect(user.id).toBeGreaterThan(0)

    harness.services.auth.logout()
    const login = harness.services.auth.login('frontdesk', password)
    expect(login.snapshot.user?.username).toBe('frontdesk')
    expect(harness.services.session.hasPermission('patients.create')).toBe(true)
    expect(harness.services.session.hasPermission('payments.create')).toBe(true)
    // The per-user deny must stick even though the role grants the permission.
    expect(harness.services.session.hasPermission('payments.void')).toBe(false)
    // The per-user allow must add a permission the role does not have.
    expect(harness.services.session.hasPermission('visits.view')).toBe(true)
    // Nothing outside the role may leak in.
    expect(harness.services.session.hasPermission('users.manage')).toBe(false)

    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Restricted Person' }))

    // A permission the role does hold still works, and returns only what it should.
    const payments = harness.services.billing.listPayments({ page: 1, pageSize: 10 })
    expect(payments.total).toBe(0)
    expect(harness.services.clinical.getPatient(patient.id).fullName).toBe('Restricted Person')

    // Denied at the service layer, not hidden in the interface: the call throws, so no rows can leak.
    expectRefusal(() => harness.services.billing.accountingSummary(null, null))
    expectRefusal(() => harness.services.billing.revenueReport('2026-09-01', '2026-09-30'))
    expectRefusal(() => harness.services.admin.listAudit({ page: 1, pageSize: 10 }))
    expectRefusal(() =>
      harness.services.auth.updateUser(
        user.id,
        {
          username: 'frontdesk',
          displayName: 'Front Desk',
          roleId: receptionRole!.id,
          isActive: false,
          mustChangePassword: false,
          overrides: []
        },
        undefined
      )
    )
  })

  it('refuses to deactivate your own account', () => {
    const administrator = harness.services.auth.listUsers().find((row) => row.username === 'admin')
    expect(administrator).toBeDefined()

    const message = expectRefusal(
      () =>
        harness.services.auth.updateUser(
          administrator!.id,
          {
            username: administrator!.username,
            displayName: administrator!.displayName,
            roleId: administrator!.roleId,
            isActive: false,
            mustChangePassword: false,
            overrides: []
          },
          undefined
        ),
      'CONFLICT'
    )
    expect(message).toMatch(/your own account/i)
    expect(harness.services.auth.listUsers().find((row) => row.id === administrator!.id)?.isActive).toBe(true)
  })

  it('refuses to leave the clinic without an active administrator', () => {
    const administrator = harness.services.auth.listUsers().find((row) => row.username === 'admin')
    expect(administrator).toBeDefined()

    // A user who may manage accounts but is not an administrator themselves.
    const role = harness.services.auth.createRole({
      code: 'account_manager',
      name: 'Account manager',
      description: 'Manages user accounts without clinical or financial access.',
      permissions: ['dashboard.view', 'users.view', 'users.manage', 'audit.view']
    })
    harness.services.auth.createUser(
      {
        username: 'accountant2',
        displayName: 'Account Manager',
        roleId: role.id,
        isActive: true,
        mustChangePassword: false,
        overrides: []
      },
      password
    )
    harness.services.auth.logout()
    harness.services.auth.login('accountant2', password)

    const message = expectRefusal(
      () =>
        harness.services.auth.updateUser(
          administrator!.id,
          {
            username: administrator!.username,
            displayName: administrator!.displayName,
            roleId: administrator!.roleId,
            isActive: false,
            mustChangePassword: false,
            overrides: []
          },
          undefined
        ),
      'CONFLICT'
    )
    expect(message).toMatch(/at least one active administrator/i)
    expect(harness.services.auth.listUsers().find((row) => row.id === administrator!.id)?.isActive).toBe(true)
  })
})

suite('settings, clinic and printer profiles', () => {
  it('persists settings changes and audits them', () => {
    const before = admin().settingsSnapshot()
    const updated = admin().updateSettings({
      autoLockMinutes: 15,
      inventoryLowStockAlerts: true,
      inventoryExpiryWarningDays: 120
    })
    expect(updated.settings.autoLockMinutes).toBe(15)
    expect(updated.settings.inventoryExpiryWarningDays).toBe(120)
    expect(updated.settings.inventoryLowStockAlerts).toBe(true)
    expect(before.settings.autoLockMinutes).not.toBe(15)

    // Read back through a fresh repository instance: the change is in the database, not in a cache.
    const reread = admin().settingsSnapshot()
    expect(reread.settings.autoLockMinutes).toBe(15)

    const entries = admin().listAudit({ page: 1, pageSize: 20, entityType: 'settings' })
    expect(entries.rows.length).toBeGreaterThan(0)
  })

  it('updates the clinic profile used by every printed document', () => {
    const clinic = admin().updateClinic({
      name: 'Harness Dental Studio',
      nameBn: 'হার্নেস ডেন্টাল স্টুডিও',
      address: '45 Green Road, Dhaka 1205',
      city: 'Dhaka',
      postalCode: '1205',
      country: 'Bangladesh',
      phone1: '01712345678',
      phone2: null,
      email: 'studio@example.com',
      website: null,
      registrationNo: 'DGDA-7788',
      footerQuote: null,
      logoPath: null
    })
    expect(clinic.name).toBe('Harness Dental Studio')
    expect(admin().settingsSnapshot().clinic.address).toBe('45 Green Road, Dhaka 1205')
  })

  it('keeps dentists with multi-value designations and qualifications, and can deactivate one', () => {
    const dentist = admin().saveDentist({
      fullName: 'Dr. Farhana Rahman',
      phone: '01712345678',
      email: null,
      registrationNo: 'BMDC-12345',
      signaturePath: null,
      isActive: true,
      sortOrder: 0,
      notes: null,
      designations: ['Chief Consultant', 'Oral Surgeon'],
      qualifications: ['BDS', 'FCPS (Oral & Maxillofacial)'],
      certifications: ['ACLS'],
      schedules: [{ weekday: 6, startTime: '10:00', endTime: '14:00' }]
    })
    expect(dentist.designations).toEqual(['Chief Consultant', 'Oral Surgeon'])
    expect(dentist.qualifications).toEqual(['BDS', 'FCPS (Oral & Maxillofacial)'])
    expect(dentist.certifications).toEqual(['ACLS'])
    expect(dentist.schedules?.[0]).toMatchObject({ weekday: 6, startTime: '10:00', endTime: '14:00' })

    const inactive = admin().setDentistActive(dentist.id, false)
    expect(inactive.isActive).toBe(false)
    expect(
      admin()
        .listDentists(true)
        .map((row) => row.id)
    ).toContain(dentist.id)
    expect(
      admin()
        .listDentists(false)
        .map((row) => row.id)
    ).not.toContain(dentist.id)
  })

  it('adds and retires clinical options that the prescription screen offers', () => {
    const options = harness.services.clinical.clinicalOptions('medicine_timing')
    expect(options.length).toBeGreaterThan(0)

    const added = harness.services.clinical.saveClinicalOption({
      listCode: 'medicine_timing',
      value: 'After breakfast',
      valueBn: 'সকালের নাস্তার পর',
      sortOrder: 99,
      isActive: true
    })
    expect(added.id).toBeGreaterThan(0)
    expect(harness.services.clinical.clinicalOptions('medicine_timing').map((row) => row.value)).toContain(
      'After breakfast'
    )

    harness.services.clinical.deactivateClinicalOption(added.id)
    expect(harness.services.clinical.clinicalOptions('medicine_timing').map((row) => row.id)).not.toContain(
      added.id
    )
  })

  it('saves and deletes printer profiles that remember the paper and the device', () => {
    const profile = admin().savePrinterProfile({
      id: 0,
      documentType: 'prescription',
      name: 'Front desk A5',
      printerName: 'HP LaserJet M404',
      paperSize: 'A5',
      customWidthMm: null,
      customHeightMm: null,
      orientation: 'portrait',
      marginTopMm: 10,
      marginRightMm: 10,
      marginBottomMm: 10,
      marginLeftMm: 10,
      scalePercent: 100,
      copies: 1,
      isDefault: true
    })
    expect(profile.id).toBeGreaterThan(0)
    expect(
      admin()
        .printerProfiles()
        .some((row) => row.id === profile.id)
    ).toBe(true)

    admin().deletePrinterProfile(profile.id)
    expect(
      admin()
        .printerProfiles()
        .some((row) => row.id === profile.id)
    ).toBe(false)
  })
})

suite('notifications', () => {
  it('raises a low-stock notification that can be read, counted and dismissed', () => {
    admin().updateSettings({ notificationsEnabled: true, inventoryLowStockAlerts: true })
    const item = harness.services.billing.createInventoryItem({
      code: 'ALG-01',
      name: 'Alginate impression material',
      category: 'Consumables',
      unit: 'pack',
      supplierId: null,
      quantityMilli: 0,
      minStockMilli: 50000,
      purchasePricePoisha: 45000,
      sellPricePoisha: null,
      location: null,
      isActive: true,
      notes: null
    })
    harness.services.billing.stockIn({
      itemId: item.id,
      quantityMilli: 10000,
      unitCostPoisha: 45000,
      batchNo: 'B-1001',
      expiryDate: '2027-06-30',
      supplierId: null,
      purchaseDate: '2026-09-30',
      reference: null,
      notes: null
    })

    harness.services.clinical.refreshNotifications()
    const unread = harness.services.clinical.listNotifications(true)
    const stockNotification = unread.find((row) => row.category === 'inventory')
    expect(stockNotification).toBeDefined()
    expect(stockNotification?.title).toMatch(/low stock/i)
    expect(harness.services.clinical.notificationCount()).toBeGreaterThan(0)

    const first = stockNotification!
    harness.services.clinical.markNotificationRead(first.id)
    expect(harness.services.clinical.listNotifications(true).map((row) => row.id)).not.toContain(first.id)

    harness.services.clinical.dismissNotification(first.id)
    expect(harness.services.clinical.listNotifications(false).map((row) => row.id)).not.toContain(first.id)
  })
})

suite('attachments', () => {
  it('stores a copy inside the data folder, records its checksum and sanitises the name', () => {
    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Attachment Person' }))
    const source = join(scratch, 'X-ray  & report..txt')
    writeFileSync(source, 'panoramic x-ray report')

    const attachment = harness.services.billing.attachFile({
      patientId: patient.id,
      title: 'Panoramic X-ray',
      category: 'Radiograph',
      sourcePath: source
    })
    expect(attachment.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(attachment.sizeBytes).toBeGreaterThan(0)
    expect(attachment.originalName).not.toMatch(/[\\/]/)

    const stored = harness.services.billing.attachmentPath(attachment.id)
    expect(stored.startsWith(harness.root)).toBe(true)
    expect(stored).not.toBe(source)
    expect(existsSync(stored)).toBe(true)
    // The file was copied, not moved: the clinic keeps its original scan.
    expect(existsSync(source)).toBe(true)

    const renamed = harness.services.billing.renameAttachment(attachment.id, 'Panoramic X-ray (2026)')
    expect(renamed.title).toBe('Panoramic X-ray (2026)')

    harness.services.billing.deleteAttachment(attachment.id)
    expect(
      harness.services.billing.listAttachments({ patientId: patient.id, page: 1, pageSize: 10 }).rows
    ).toHaveLength(0)
  })

  it('refuses a disallowed file type and a file larger than the limit', () => {
    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Blocked Person' }))
    const executable = join(scratch, 'tool.exe')
    writeFileSync(executable, 'MZ fake')
    expect(() =>
      harness.services.billing.attachFile({ patientId: patient.id, sourcePath: executable })
    ).toThrow(/cannot be attached/i)

    const oversized = join(scratch, 'huge.txt')
    writeFileSync(oversized, 'x')
    truncateSync(oversized, 26 * 1024 * 1024)
    expect(statSync(oversized).size).toBeGreaterThan(25 * 1024 * 1024)
    expect(() =>
      harness.services.billing.attachFile({ patientId: patient.id, sourcePath: oversized })
    ).toThrow(/larger than/i)

    expect(
      harness.services.billing.listAttachments({ patientId: patient.id, page: 1, pageSize: 10 }).rows
    ).toHaveLength(0)
  })
})

suite('data export', () => {
  it('exports the patient register to CSV and JSON in the chosen folder', () => {
    harness.services.clinical.createPatient(patientInput({ fullName: 'Export Person', phone: '01712345678' }))
    const result = harness.services.billing.exportData({
      entity: 'patients',
      format: 'csv',
      targetFolder: scratch
    })
    expect(existsSync(result.filePath)).toBe(true)
    expect(result.rowCount).toBeGreaterThan(0)
    const content = readFileSync(result.filePath, 'utf8')
    expect(content.split('\n')[0]).toMatch(/code/i)
    expect(content).toContain('Export Person')

    const json = harness.services.billing.exportData({
      entity: 'patients',
      format: 'json',
      targetFolder: scratch
    })
    const parsed = JSON.parse(readFileSync(json.filePath, 'utf8')) as {
      entity: string
      rows: Record<string, unknown>[]
    }
    expect(parsed.entity).toBe('patients')
    expect(readFileSync(json.filePath, 'utf8')).toContain('Export Person')
    expect(Object.keys(parsed.rows[0] ?? {})).toContain('Name')
    expect(resolve(json.filePath).startsWith(resolve(scratch))).toBe(true)
  })

  it('refuses an export the signed-in user has no permission for', () => {
    const role = harness.services.auth.listRoles().find((entry) => entry.code === 'assistant')
    expect(role).toBeDefined()
    harness.services.auth.createUser(
      {
        username: 'assistant1',
        displayName: 'Assistant',
        roleId: role!.id,
        isActive: true,
        mustChangePassword: false,
        overrides: []
      },
      password
    )
    harness.services.auth.logout()
    harness.services.auth.login('assistant1', password)

    expectRefusal(() =>
      harness.services.billing.exportData({ entity: 'patients', format: 'csv', targetFolder: scratch })
    )
    expectRefusal(() =>
      harness.services.billing.exportData({ entity: 'audit', format: 'json', targetFolder: scratch })
    )
  })
})

suite('patient lists and timeline', () => {
  it('filters by date range and hides archived patients unless they are asked for', () => {
    const older = harness.services.clinical.createPatient(patientInput({ fullName: 'Older Person' }))
    // Registrations are stamped with the current time; backdate this one so the range filter has something
    // to exclude. Only test setup uses a raw statement — the application has no path that rewrites a date.
    harness.services.db
      .prepare("UPDATE patients SET created_at = '2026-01-15 09:00:00' WHERE id = ?")
      .run(older.id)
    harness.services.clinical.createPatient(patientInput({ fullName: 'Recent Person' }))
    harness.services.clinical.archivePatient(older.id)

    const visible = harness.services.clinical.listPatients({ page: 1, pageSize: 50 })
    expect(visible.rows.map((row) => row.fullName)).not.toContain('Older Person')

    const withArchived = harness.services.clinical.listPatients({
      page: 1,
      pageSize: 50,
      includeArchived: true
    })
    expect(withArchived.rows.map((row) => row.fullName)).toContain('Older Person')

    const custom = harness.services.clinical.listPatients({
      page: 1,
      pageSize: 50,
      range: 'custom',
      from: '2026-09-01',
      to: '2026-09-30'
    })
    expect(custom.rows.map((row) => row.fullName)).toContain('Recent Person')
    expect(custom.rows.map((row) => row.fullName)).not.toContain('Older Person')
  })

  it('merges visits, appointments, invoices and payments into one timeline', () => {
    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Timeline Person' }))
    const dentists = admin().listDentists(true)
    const dentistId = dentists[0]?.id ?? 1

    const appointment = harness.services.clinical.createAppointment({
      patientId: patient.id,
      dentistId,
      appointmentDate: '2026-09-30',
      startTime: '10:00',
      endTime: '10:30',
      reason: 'Check-up',
      notes: null
    })
    expect(appointment.id).toBeGreaterThan(0)

    const visit = harness.services.clinical.createVisit({
      patientId: patient.id,
      visitDate: '2026-09-30',
      visitTime: '10:05',
      dentistId,
      appointmentId: appointment.id,
      chiefComplaint: 'Sensitivity on the upper left molar',
      treatments: [],
      notes: null
    })
    harness.services.clinical.finalizeVisit(visit.id)

    const invoice = harness.services.billing.createInvoice({
      patientId: patient.id,
      visitId: visit.id,
      invoiceDate: '2026-09-30',
      dueDate: null,
      discountPoisha: 0,
      discountPercentX100: 0,
      taxPercentX100: 0,
      roundOffEnabled: false,
      notes: null,
      items: [
        {
          itemType: 'service',
          treatmentId: null,
          description: 'Consultation',
          quantityMilli: 1000,
          unitPricePoisha: 50000,
          discountPoisha: 0,
          note: null
        }
      ]
    })
    harness.services.billing.createPayment({
      patientId: patient.id,
      invoiceId: invoice.id,
      amountPoisha: 50000,
      methodCode: 'cash',
      receivedAt: '2026-09-30 10:30'
    })

    const timeline = harness.services.clinical.patientTimeline(patient.id)
    const types = new Set(timeline.map((entry) => entry.type))
    expect(types.has('visit')).toBe(true)
    expect(types.has('appointment')).toBe(true)
    expect(types.has('invoice')).toBe(true)
    expect(types.has('payment')).toBe(true)
    for (const entry of timeline) {
      expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}/)
      expect(entry.title.length).toBeGreaterThan(0)
    }

    const profile = harness.services.clinical.getPatientProfile(patient.id)
    expect(profile.patient.code).toBe(patient.code)
    expect(profile.counts.visits).toBeGreaterThanOrEqual(1)
  })
})

suite('integrity', () => {
  it('reports a healthy database and an intact audit chain', () => {
    const integrity = admin().runIntegrity(true)
    expect(integrity.ok).toBe(true)

    const chain = admin().auditChainStatus()
    expect(chain.valid).toBe(true)
  })
})
