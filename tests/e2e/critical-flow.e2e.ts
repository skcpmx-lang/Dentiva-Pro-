/**
 * End-to-end: the critical clinic flow on the real application.
 *
 * Setup is completed through the service layer (the wizard itself is covered by setup-wizard.e2e.ts),
 * then the clinic path is exercised: register a patient in the interface, record a visit, write and
 * finalise a prescription, raise an invoice, take a payment, create a backup from the Backups screen and
 * confirm the audit trail recorded everything. Every call goes through the real preload bridge, the real
 * router and the real database of the launched application.
 */

import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import {
  activationCode,
  adminPassword,
  e2eSkipReason,
  invoke,
  launchApp,
  signInThroughUi,
  waitForShell,
  type LaunchedApp
} from './harness'

interface Patient {
  id: number
  code: string
  fullName: string
}

interface Visit {
  id: number
  patientId: number
}

interface Prescription {
  id: number
  status: string
}

interface Invoice {
  id: number
  invoiceNo: string
  totalPoisha: number
  balancePoisha: number
  status: string
}

interface Payment {
  id: number
  receiptNo: string
  amountPoisha: number
}

interface Dentist {
  id: number
  fullName: string
}

interface BackupRecord {
  id: number
  fileName: string
  path: string
  sizeBytes: number
  trigger: string
  status: string
}

test.describe('Critical flow: patient → visit → prescription → invoice → payment → backup', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(activationCode.length === 0, e2eSkipReason)

  let app: LaunchedApp
  let patient: Patient
  let visit: Visit
  let prescription: Prescription
  let invoice: Invoice
  let payment: Payment

  test.beforeAll(async () => {
    app = await launchApp()
    const { page } = app

    // A retry of this serial group resumes on the installation the previous attempt configured: the wizard
    // is only driven when the application still asks for it.
    const setupStatus = await invoke<{ setupRequired: boolean }>(page, 'setup.status')
    if (!setupStatus.setupRequired) {
      await signInThroughUi(page)
      await waitForShell(page)
      return
    }

    // Complete the wizard through the real service layer, then sign in so the shell renders.
    const activation = await invoke<{ activated: boolean }>(page, 'setup.activate', { code: activationCode })
    expect(activation.activated).toBe(true)
    await invoke(page, 'setup.complete', {
      clinic: {
        name: 'E2E Critical Flow Clinic',
        nameBn: null,
        address: '5 Test Avenue',
        city: 'Dhaka',
        postalCode: '1205',
        country: 'Bangladesh',
        phone1: '+8801700000000',
        phone2: null,
        email: null,
        website: null,
        registrationNo: null,
        footerQuote: null
      },
      dentists: [
        {
          fullName: 'Dr. Flow Dentist',
          designations: ['Consultant'],
          qualifications: ['BDS'],
          certifications: [],
          phone: null,
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
        username: 'admin',
        displayName: 'Flow Administrator',
        password: adminPassword,
        confirmPassword: adminPassword
      },
      activationCode
    })
    await waitForShell(page)
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('a patient is registered through the interface and appears in the register', async () => {
    const { page } = app
    await page.getByRole('link', { name: 'Patients' }).first().click()
    await expect(page.getByRole('button', { name: /new patient/i })).toBeVisible()

    await page.getByRole('button', { name: /new patient/i }).click()
    await page.getByLabel('Full name').fill('E2E Flow Patient')
    await page.getByLabel('Name in Bangla').fill('ই২ই রোগী')
    await page.getByLabel('Date of birth').fill('1992-04-11')
    await page.getByLabel('Phone', { exact: true }).fill('+8801811111111')
    await page.getByLabel('City').fill('Tangail')
    await page.getByRole('button', { name: /register patient/i }).click()

    // The register lists the new patient, newest first, with its generated code.
    await expect(page.getByText('E2E Flow Patient').first()).toBeVisible({ timeout: 20_000 })

    const list = await invoke<{ rows: Patient[]; total: number }>(page, 'patients.list', {
      page: 1,
      pageSize: 20,
      search: 'E2E Flow Patient'
    })
    expect(list.total).toBe(1)
    patient = list.rows[0] as Patient
    expect(patient.code).toMatch(/\d/)
  })

  test('a visit is recorded and finalised', async () => {
    const { page } = app
    const dentists = await invoke<Dentist[]>(page, 'dentists.list')
    expect(dentists.length).toBe(1)

    visit = await invoke<Visit>(page, 'visits.create', {
      patientId: patient.id,
      visitDate: new Date().toISOString().slice(0, 10),
      visitTime: '11:15',
      dentistId: (dentists[0] as Dentist).id,
      chiefComplaint: 'Pain in the lower right back tooth',
      examination: 'Deep caries in 46',
      diagnosis: 'Dental caries',
      treatmentSummary: 'Composite restoration',
      advice: 'Avoid hard food for a day',
      treatments: [
        {
          treatmentId: null,
          treatmentName: 'Composite filling',
          teeth: ['46'],
          feePoisha: 350_000,
          note: null
        }
      ]
    })
    expect(visit.patientId).toBe(patient.id)

    const finalised = await invoke<{ status: string }>(page, 'visits.finalize', { id: visit.id })
    expect(finalised.status).toBe('final')

    // The patient profile shows the visit on its timeline.
    await page.getByRole('link', { name: 'Patients' }).first().click()
    await page
      .getByRole('button', { name: 'E2E Flow Patient' })
      .first()
      .click()
      .catch(async () => {
        await page.getByText('E2E Flow Patient').first().click()
      })
    await expect(page.getByText(/composite filling/i).first()).toBeVisible({ timeout: 20_000 })
  })

  test('a prescription is written, finalised and printable', async () => {
    const { page } = app
    const dentists = await invoke<Dentist[]>(page, 'dentists.list')
    const medicineType = await invoke<{ value: string }[]>(page, 'clinical.options', {
      listCode: 'medicine_type'
    })
    const medicineTiming = await invoke<{ value: string }[]>(page, 'clinical.options', {
      listCode: 'medicine_timing'
    })

    prescription = await invoke<Prescription>(page, 'prescriptions.create', {
      patientId: patient.id,
      visitId: visit.id,
      dentistId: (dentists[0] as Dentist).id,
      prescriptionDate: new Date().toISOString().slice(0, 10),
      chiefComplaints: ['Pain in the lower right back tooth'],
      onExamination: ['Deep caries in 46'],
      diagnosis: 'Dental caries',
      advice: ['Avoid hard food for a day', 'Warm saline rinse twice daily'],
      followUpDate: null,
      notes: null,
      status: 'final',
      items: [
        {
          sortOrder: 0,
          medicineName: 'Amoxicillin 500 mg',
          medicineType: medicineType[0]?.value ?? 'Capsule',
          strength: '500 mg',
          dose: '1 capsule',
          morning: '1',
          noon: '1',
          night: '1',
          timing: medicineTiming[0]?.value ?? 'Three times a day',
          durationValue: 5,
          durationUnit: 'day',
          quantity: '15',
          instruction: 'After food',
          conditionalInstruction: null,
          notes: null
        },
        {
          sortOrder: 1,
          medicineName: 'Paracetamol 500 mg',
          medicineType: medicineType[0]?.value ?? 'Tablet',
          strength: '500 mg',
          dose: '1 tablet',
          morning: null,
          noon: null,
          night: '1',
          timing: medicineTiming[0]?.value ?? 'At bedtime',
          durationValue: 3,
          durationUnit: 'day',
          quantity: '3',
          instruction: null,
          conditionalInstruction: 'If pain occurs',
          notes: null
        }
      ]
    })
    expect(prescription.status).toBe('final')

    // The print document is built from the real record: signature space stays empty, medicines present.
    const document = await invoke<{
      kind: string
      medicines: { medicine: string }[]
      signature: { clearanceMm: number }
    }>(page, 'print.build', { documentType: 'prescription', entityId: prescription.id, paper: 'A4' })
    expect(document.kind).toBe('prescription')
    expect(document.medicines.length).toBe(2)
    expect(document.signature.clearanceMm).toBeGreaterThanOrEqual(25)

    await page.getByRole('link', { name: 'Prescriptions' }).first().click()
    await expect(page.getByText('Amoxicillin 500 mg').first()).toBeVisible({ timeout: 20_000 })
  })

  test('an invoice is raised and a payment against it is recorded', async () => {
    const { page } = app
    invoice = await invoke<Invoice>(page, 'invoices.create', {
      patientId: patient.id,
      visitId: visit.id,
      invoiceDate: new Date().toISOString().slice(0, 10),
      dueDate: null,
      discountPoisha: 0,
      discountPercentX100: 0,
      taxPercentX100: 0,
      roundOffEnabled: false,
      notes: null,
      items: [
        {
          itemType: 'treatment',
          treatmentId: null,
          inventoryItemId: null,
          description: 'Composite filling (46)',
          quantityMilli: 1000,
          unitPricePoisha: 350_000,
          discountPoisha: 0,
          note: null
        }
      ]
    })
    expect(invoice.invoiceNo).toMatch(/^INV-/)
    expect(invoice.totalPoisha).toBe(350_000)

    payment = await invoke<Payment>(page, 'payments.create', {
      patientId: patient.id,
      invoiceId: invoice.id,
      amountPoisha: 200_000,
      methodCode: 'cash',
      referenceNo: null,
      receivedAt: new Date().toISOString().slice(0, 10)
    })
    expect(payment.receiptNo).toMatch(/^RCP-/)
    expect(payment.amountPoisha).toBe(200_000)

    const balance = await invoke<number>(page, 'invoices.patientBalance', { id: patient.id })
    expect(balance).toBe(150_000)

    await page.getByRole('link', { name: 'Invoices' }).first().click()
    await expect(page.getByText(invoice.invoiceNo).first()).toBeVisible({ timeout: 20_000 })
  })

  test('a backup is created from the Backups screen and the file exists on disk', async () => {
    const { page } = app
    await page
      .getByRole('link', { name: /backup/i })
      .first()
      .click()
    await expect(page.getByRole('button', { name: /back up now/i })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: /back up now/i }).click()

    await expect(page.getByText(/backup completed/i).first()).toBeVisible({ timeout: 60_000 })

    const backups = await invoke<BackupRecord[]>(page, 'backups.list')
    expect(backups.length).toBeGreaterThan(0)
    const latest = backups[0] as BackupRecord
    expect(latest.status).toBe('success')
    expect(latest.sizeBytes).toBeGreaterThan(0)
    expect(existsSync(latest.path)).toBe(true)
    expect(existsSync(`${latest.path}/manifest.json`)).toBe(true)
  })

  test('the audit log recorded the clinical and administrative actions', async () => {
    const { page } = app
    await page
      .getByRole('link', { name: /audit log/i })
      .first()
      .click()

    const audit = await invoke<{ rows: { action: string }[]; total: number }>(page, 'audit.list', {
      page: 1,
      pageSize: 50
    })
    const actions = audit.rows.map((row) => row.action)
    for (const expected of ['patients.create', 'visits.create', 'prescriptions.create', 'invoices.create']) {
      expect(actions).toContain(expected)
    }
    expect(actions.some((action) => action.startsWith('backup.'))).toBe(true)
  })
})
