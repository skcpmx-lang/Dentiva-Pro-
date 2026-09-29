/**
 * Stress-data generator and performance harness (run through `scripts/seed-stress-data.mjs`).
 *
 * It builds a database of the size the performance budget in `docs/architecture/ARCHITECTURE.md` §9 is
 * written for, using the real migrations, repositories and services — never a copy of the schema. Bulk
 * rows go through the repository layer (the same SQL the services execute, so the data is identical,
 * only without one audit row per seeded record); the measured operations go through the service layer so
 * the numbers include permission checks, audit writes, validation and serialisation.
 *
 * The script writes `docs/testing/PERFORMANCE_MEASUREMENTS.md` with the measured numbers and the machine
 * it ran on, so the performance section of the deliverable is measured rather than claimed.
 */

import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { createHeadlessHost } from '@main/services/headless'
import type { PatientInput, VisitInput } from '@shared/types'

export interface StressOptions {
  /** Data root to create/use. */
  root: string
  reset: boolean
  patients: number
  visitsPerPatient: number
  appointments: number
  prescriptions: number
  invoices: number
  payments: number
  inventoryItems: number
  inventoryTransactions: number
  attachments: number
  queueSize: number
  /** Write the markdown report. */
  writeReport: boolean
  reportPath?: string
  log?: (message: string) => void
}

export const DEFAULT_STRESS_OPTIONS: Omit<StressOptions, 'root'> = {
  reset: false,
  patients: 5_000,
  visitsPerPatient: 4,
  appointments: 20_000,
  prescriptions: 15_000,
  invoices: 15_000,
  payments: 25_000,
  inventoryItems: 400,
  inventoryTransactions: 5_000,
  attachments: 200,
  queueSize: 150,
  writeReport: true
}

/** Deterministic pseudo-random numbers, so two runs produce the same dataset. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

const FIRST_NAMES = [
  'Rahim',
  'Karim',
  'Fatima',
  'Ayesha',
  'Nasrin',
  'Jamal',
  'Sumaiya',
  'Tanvir',
  'Rafiq',
  'Shirin',
  'Mizanur',
  'Nusrat',
  'Arif',
  'Mitu',
  'Habib',
  'Ruma',
  'Shakil',
  'Rehana',
  'Imran',
  'Salma'
]
const LAST_NAMES = [
  'Uddin',
  'Islam',
  'Akter',
  'Begum',
  'Hossain',
  'Rahman',
  'Chowdhury',
  'Mia',
  'Sarker',
  'Khatun'
]
const FIRST_NAMES_BN = [
  'রহিম',
  'করিম',
  'ফাতেমা',
  'আয়েশা',
  'নাসরিন',
  'জামাল',
  'সুমাইয়া',
  'তানভীর',
  'রফিক',
  'শিরিন'
]
const CITIES = ['Dhaka', 'Chattogram', 'Sylhet', 'Khulna', 'Rajshahi', 'Tangail', 'Bogura', 'Cumilla']
const TREATMENTS: { name: string; fee: number; category: string }[] = [
  { name: 'Consultation', fee: 50_000, category: 'Diagnostic' },
  { name: 'Scaling (ultrasonic)', fee: 150_000, category: 'Preventive' },
  { name: 'Composite filling', fee: 250_000, category: 'Restorative' },
  { name: 'Root canal treatment (single canal)', fee: 500_000, category: 'Endodontic' },
  { name: 'Extraction (simple)', fee: 120_000, category: 'Surgery' },
  { name: 'Extraction (surgical)', fee: 350_000, category: 'Surgery' },
  { name: 'Zirconia crown', fee: 1_200_000, category: 'Prosthodontic' },
  { name: 'Complete denture (per arch)', fee: 2_500_000, category: 'Prosthodontic' },
  { name: 'Pulpotomy (primary tooth)', fee: 200_000, category: 'Endodontic' },
  { name: 'Fluoride application', fee: 80_000, category: 'Preventive' }
]
const MEDICINES = [
  {
    name: 'Amoxicillin 500 mg',
    type: 'Capsule',
    strength: '500 mg',
    dose: '1 capsule',
    timing: 'Three times a day'
  },
  {
    name: 'Ibuprofen 400 mg',
    type: 'Tablet',
    strength: '400 mg',
    dose: '1 tablet',
    timing: 'Three times a day'
  },
  {
    name: 'Paracetamol 500 mg',
    type: 'Tablet',
    strength: '500 mg',
    dose: '1 tablet',
    timing: 'Three times a day'
  },
  {
    name: 'Metronidazole 400 mg',
    type: 'Tablet',
    strength: '400 mg',
    dose: '1 tablet',
    timing: 'Three times a day'
  },
  {
    name: 'Chlorhexidine mouthwash',
    type: 'Mouthwash',
    strength: '0.2 %',
    dose: '10 ml',
    timing: 'Twice a day'
  }
]

function isoDate(dayOffset: number): string {
  const date = new Date(Date.UTC(2026, 8, 30) + dayOffset * 86_400_000)
  return date.toISOString().slice(0, 10)
}

export interface StressReport {
  generatedAt: string
  dataset: Record<string, number>
  seed: { seconds: number; operationsPerSecond: number }
  measurements: {
    name: string
    target: string
    samples: number
    averageMs: number
    p95Ms: number
    maxMs: number
  }[]
  budget: { name: string; targetMs: number; measuredMs: number; passed: boolean }[]
  backup: { folder: string; sizeBytes: number; seconds: number }
  machine: Record<string, string | number>
  environment: Record<string, string>
  markdown: string
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

function measure(
  name: string,
  target: string,
  samples: number,
  run: () => void
): StressReport['measurements'][number] {
  const timings: number[] = []
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now()
    run()
    timings.push(performance.now() - startedAt)
  }
  const sorted = [...timings].sort((left, right) => left - right)
  return {
    name,
    target,
    samples,
    averageMs: Math.round((timings.reduce((sum, value) => sum + value, 0) / timings.length) * 10) / 10,
    p95Ms: Math.round(percentile(sorted, 0.95) * 10) / 10,
    maxMs: Math.round((sorted[sorted.length - 1] ?? 0) * 10) / 10
  }
}

export async function runStressSeed(options: StressOptions): Promise<StressReport> {
  const log = options.log ?? (() => undefined)
  const root = resolve(options.root)
  if (options.reset && existsSync(root)) {
    rmSync(root, { recursive: true, force: true })
  }
  mkdirSync(root, { recursive: true })

  const host = createHeadlessHost({
    root,
    buildInfo: {
      version: '1.0.0',
      buildNumber: 'stress',
      commit: 'local',
      buildDate: new Date().toISOString()
    }
  })
  try {
    return await seedAndMeasure(host, options, log)
  } finally {
    // The session manager keeps an interval alive; without this the Node process would never exit.
    host.dispose()
  }
}

async function seedAndMeasure(
  host: ReturnType<typeof createHeadlessHost>,
  options: StressOptions,
  log: (message: string) => void
): Promise<StressReport> {
  const { services } = host
  const actor = 'stress-seed'
  const random = createRandom(2026_0930)

  // Printing and reports need a clinic profile; a fresh database has none until the setup wizard runs.
  if (!services.clinic.get()) {
    services.clinic.upsert({
      name: 'Stress Test Dental Care',
      nameBn: 'স্ট্রেস টেস্ট ডেন্টাল কেয়ার',
      address: '12 Performance Road, Dhaka',
      city: 'Dhaka',
      postalCode: '1205',
      country: 'Bangladesh',
      phone1: '+8801700000000',
      phone2: null,
      email: 'stress@example.com',
      website: null,
      registrationNo: 'STRESS-001',
      logoPath: null,
      footerQuote: null
    })
  }

  // The audit trail must stay append-only even while seeding, so every comment/actor is a real string.
  const dentistIds: number[] = []
  for (let index = 0; index < 4; index += 1) {
    dentistIds.push(
      services.dentists.create(
        {
          fullName: `Dr. Stress Dentist ${index + 1}`,
          phone: `+880170000${String(index).padStart(4, '0')}`,
          email: null,
          registrationNo: `BDS-STRESS-${index + 1}`,
          signaturePath: null,
          isActive: true,
          sortOrder: index,
          notes: null,
          designations: ['Consultant'],
          qualifications: ['BDS'],
          certifications: [],
          schedules: [{ weekday: 6, startTime: '10:00', endTime: '14:00' }]
        },
        actor
      )
    )
  }
  const treatmentIds = TREATMENTS.map((treatment) =>
    services.treatments.create(
      {
        code: null,
        name: treatment.name,
        nameBn: null,
        category: treatment.category,
        description: null,
        defaultFeePoisha: treatment.fee,
        durationMinutes: 30,
        isActive: true,
        isSystemDefault: false
      },
      actor
    )
  )
  log(`reference data: ${dentistIds.length} dentists, ${treatmentIds.length} treatments`)

  const startedSeed = performance.now()
  const patientIds: number[] = []

  const insertPatients = host.db.transaction(() => {
    for (let index = 0; index < options.patients; index += 1) {
      const first = FIRST_NAMES[index % FIRST_NAMES.length] as string
      const last = LAST_NAMES[Math.floor(random() * LAST_NAMES.length)] as string
      const input: PatientInput = {
        fullName: `${first} ${last}`,
        fullNameBn: `${FIRST_NAMES_BN[index % FIRST_NAMES_BN.length]} ${last}`,
        dateOfBirth: isoDate(-Math.floor(random() * 20_000) - 3_650),
        ageYears: null,
        gender: random() > 0.45 ? 'female' : 'male',
        bloodGroup: ['A+', 'B+', 'O+', 'AB+', 'A-', 'O-'][Math.floor(random() * 6)] ?? 'O+',
        phone: `+8801${Math.floor(700_000_000 + random() * 99_999_999)}`,
        phoneAlt: null,
        email: null,
        address: `House ${Math.floor(random() * 300) + 1}, Road ${Math.floor(random() * 30) + 1}`,
        addressBn: null,
        city: CITIES[Math.floor(random() * CITIES.length)] ?? 'Dhaka',
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
      }
      patientIds.push(services.patients.create(`STR-${String(index + 1).padStart(6, '0')}`, input, actor))
    }
  })
  insertPatients()
  log(`patients: ${patientIds.length}`)

  const visitIds: number[] = []
  const insertVisits = host.db.transaction(() => {
    for (let index = 0; index < patientIds.length; index += 1) {
      const patientId = patientIds[index] as number
      for (let visitIndex = 0; visitIndex < options.visitsPerPatient; visitIndex += 1) {
        const treatment = TREATMENTS[Math.floor(random() * TREATMENTS.length)] as (typeof TREATMENTS)[number]
        const dayOffset = -Math.floor(random() * 365)
        const input: VisitInput = {
          patientId,
          visitDate: isoDate(dayOffset),
          visitTime: `${String(9 + Math.floor(random() * 9)).padStart(2, '0')}:${random() > 0.5 ? '30' : '00'}`,
          dentistId: dentistIds[Math.floor(random() * dentistIds.length)] as number,
          appointmentId: null,
          chiefComplaint: 'Toothache',
          symptoms: null,
          examination: 'Localised tenderness',
          diagnosis: 'Dental caries',
          treatmentSummary: treatment.name,
          advice: 'Maintain oral hygiene',
          followUpDate: null,
          notes: null,
          treatments: [
            {
              treatmentId: treatmentIds[TREATMENTS.indexOf(treatment)] ?? null,
              treatmentName: treatment.name,
              teeth: [`${1 + Math.floor(random() * 4)}${1 + Math.floor(random() * 8)}`],
              feePoisha: treatment.fee,
              note: null
            }
          ]
        }
        visitIds.push(services.visits.create(patientId, input, actor))
      }
    }
  })
  insertVisits()
  log(`visits: ${visitIds.length}`)

  const insertAppointments = host.db.transaction(() => {
    for (let index = 0; index < options.appointments; index += 1) {
      const patientId = patientIds[Math.floor(random() * patientIds.length)] as number
      const dayOffset = Math.floor(random() * 60) - 30
      services.appointments.create(
        {
          patientId,
          dentistId: dentistIds[Math.floor(random() * dentistIds.length)] as number,
          appointmentDate: isoDate(dayOffset),
          startTime: `${String(9 + Math.floor(random() * 9)).padStart(2, '0')}:00`,
          endTime: null,
          typeCode: null,
          reason: 'Follow-up',
          notes: null,
          status: dayOffset < 0 ? 'completed' : 'scheduled'
        },
        actor
      )
    }
  })
  insertAppointments()
  log(`appointments: ${options.appointments}`)

  const medical = (index: number, sortOrder: number) => {
    const medicine = MEDICINES[index % MEDICINES.length] as (typeof MEDICINES)[number]
    return {
      sortOrder,
      medicineName: medicine.name,
      medicineType: medicine.type,
      strength: medicine.strength,
      dose: medicine.dose,
      morning: '1',
      noon: medicine.timing === 'Three times a day' ? '1' : null,
      night: '1',
      timing: medicine.timing,
      durationValue: 5,
      durationUnit: 'day',
      quantity: '15',
      instruction: 'After food',
      conditionalInstruction: index % 5 === 0 ? 'If pain occurs' : null,
      notes: null
    }
  }

  const insertPrescriptions = host.db.transaction(() => {
    for (let index = 0; index < options.prescriptions; index += 1) {
      const patientIndex = Math.floor(random() * patientIds.length)
      const patientId = patientIds[patientIndex] as number
      services.prescriptions.create(
        {
          status: 'final',
          patientId,
          visitId: visitIds[Math.floor(random() * visitIds.length)] ?? null,
          dentistId: dentistIds[Math.floor(random() * dentistIds.length)] as number,
          prescriptionDate: isoDate(-Math.floor(random() * 365)),
          chiefComplaints: ['Pain on chewing'],
          onExamination: ['Caries on 46'],
          diagnosis: 'Dental caries',
          advice: ['Avoid very cold drinks', 'Brush twice daily'],
          followUpDate: null,
          notes: null,
          items: [medical(0, 0), medical(1, 1)]
        },
        actor
      )
    }
  })
  insertPrescriptions()
  log(`prescriptions: ${options.prescriptions}`)

  const invoiceIds: number[] = []
  const invoiceTotals: number[] = []
  const insertInvoices = host.db.transaction(() => {
    for (let index = 0; index < options.invoices; index += 1) {
      const patientId = patientIds[Math.floor(random() * patientIds.length)] as number
      const lineCount = 1 + Math.floor(random() * 4)
      const items = Array.from({ length: lineCount }, () => {
        const treatment = TREATMENTS[Math.floor(random() * TREATMENTS.length)] as (typeof TREATMENTS)[number]
        return {
          itemType: 'treatment' as const,
          treatmentId: treatmentIds[TREATMENTS.indexOf(treatment)] ?? null,
          inventoryItemId: null,
          description: treatment.name,
          quantityMilli: 1000,
          unitPricePoisha: treatment.fee,
          discountPoisha: 0,
          lineTotalPoisha: treatment.fee,
          note: null
        }
      })
      const subtotal = items.reduce((sum, item) => sum + item.unitPricePoisha, 0)
      const discount = random() > 0.7 ? Math.round(subtotal * 0.05) : 0
      const total = subtotal - discount
      const invoiceId = services.invoices.create({
        invoiceNo: `STR-INV-${String(index + 1).padStart(6, '0')}`,
        patientId,
        visitId: null,
        invoiceDate: isoDate(-Math.floor(random() * 365)),
        dueDate: null,
        subtotalPoisha: subtotal,
        discountPoisha: discount,
        discountPercentX100: 0,
        taxPoisha: 0,
        roundOffPoisha: 0,
        totalPoisha: total,
        status: 'unpaid',
        notes: null,
        items,
        actor
      })
      invoiceIds.push(invoiceId)
      invoiceTotals.push(total)
    }
  })
  insertInvoices()
  log(`invoices: ${options.invoices}`)

  const insertPayments = host.db.transaction(() => {
    for (let index = 0; index < options.payments; index += 1) {
      const invoiceIndex = Math.floor(random() * invoiceIds.length)
      const invoiceId = invoiceIds[invoiceIndex] as number
      const total = invoiceTotals[invoiceIndex] as number
      const method = random() > 0.55 ? 'cash' : random() > 0.5 ? 'bkash' : 'card'
      services.payments.create(
        `STR-RCP-${String(index + 1).padStart(6, '0')}`,
        {
          patientId: patientIds[Math.floor(random() * patientIds.length)] as number,
          invoiceId,
          kind: 'payment',
          amountPoisha: Math.max(1000, Math.round(total * (0.3 + random() * 0.7))),
          methodCode: method,
          referenceNo: method === 'cash' ? null : `REF-${index}`,
          receivedAt: `${isoDate(-Math.floor(random() * 365))} 11:00:00`,
          notes: null
        },
        actor
      )
    }
  })
  insertPayments()
  log(`payments: ${options.payments}`)

  const inventoryIds: number[] = []
  const insertInventory = host.db.transaction(() => {
    for (let index = 0; index < options.inventoryItems; index += 1) {
      inventoryIds.push(
        services.inventory.create(
          {
            code: `STR-ITEM-${String(index + 1).padStart(4, '0')}`,
            name: `Stress supply ${index + 1}`,
            category: 'Consumables',
            supplierId: null,
            unit: 'piece',
            quantityMilli: 0,
            minStockMilli: 10_000,
            purchasePricePoisha: 5_000 + index * 100,
            sellPricePoisha: null,
            location: null,
            isActive: true,
            notes: null
          },
          actor
        )
      )
    }
    // Track the running quantity per item: the repository refuses to issue stock that is not there
    // (the same rule the application enforces), so the generator must respect it too.
    const stockMilli = new Map<number, number>()
    for (let index = 0; index < options.inventoryTransactions; index += 1) {
      const itemId = inventoryIds[Math.floor(random() * inventoryIds.length)] as number
      const available = stockMilli.get(itemId) ?? 0
      if (random() > 0.4 || available < 1_000) {
        services.inventory.stockIn(
          {
            itemId,
            batchNo: `B-${Math.floor(random() * 500)}`,
            expiryDate: isoDate(200 + Math.floor(random() * 700)),
            quantityMilli: 50_000,
            unitCostPoisha: 5_000,
            purchaseDate: isoDate(-Math.floor(random() * 300)),
            supplierId: null,
            reference: null,
            notes: null
          },
          actor
        )
        stockMilli.set(itemId, available + 50_000)
      } else {
        services.inventory.issue(
          { itemId, quantityMilli: 1_000, txnType: 'usage', reason: 'Stress usage' },
          actor
        )
        stockMilli.set(itemId, available - 1_000)
      }
    }
  })
  insertInventory()
  log(`inventory: ${options.inventoryItems} items / ${options.inventoryTransactions} transactions`)

  const insertQueue = host.db.transaction(() => {
    for (let index = 0; index < options.queueSize; index += 1) {
      services.queue.add(
        {
          patientId: patientIds[Math.floor(random() * patientIds.length)] as number,
          dentistId: dentistIds[Math.floor(random() * dentistIds.length)] as number,
          priority: index % 17 === 0 ? 'urgent' : 'normal',
          queueDate: '2026-09-30',
          notes: null
        },
        actor
      )
    }
  })
  insertQueue()

  // ---------------------------------------------------------------------------------------------
  // Measured operations — through the service layer, the same way the screens call it.
  // ---------------------------------------------------------------------------------------------

  // A real administrator signs in so the measurements include permission checks and audit writes.
  const administrator = services.roles.list().find((role) => role.code === 'administrator')
  if (!administrator) throw new Error('The Administrator role is missing from the stress database.')
  const users = services.users.list()
  if (!users.some((user) => user.username === 'stress.admin')) {
    services.users.create({
      username: 'stress.admin',
      displayName: 'Stress Administrator',
      password: 'Stress#Pass1',
      roleId: administrator.id,
      isActive: true,
      mustChangePassword: false,
      overrides: [],
      actor
    })
  }
  services.auth.login('stress.admin', 'Stress#Pass1')

  // Attachments: real files copied into managed storage, so the backup measurement carries real bytes and
  // the list screens work against a database that looks like a used clinic. The administrator above is
  // signed in because attaching a file is a permitted action, exactly as in the application.
  const attachmentRoot = join(host.layout.tempDir, 'stress-sources')
  mkdirSync(attachmentRoot, { recursive: true })
  const attachmentIds: number[] = []
  for (let index = 0; index < options.attachments; index += 1) {
    const patientId = patientIds[Math.floor(random() * patientIds.length)] as number
    const source = join(attachmentRoot, `opg-${index + 1}.txt`)
    // A small deterministic file: a radiograph report placeholder with realistic size.
    writeFileSync(
      source,
      `Dentiva Pro stress attachment ${index + 1}\n${'panoramic radiograph placeholder data '.repeat(500)}\n`
    )
    attachmentIds.push(
      services.billing.attachFile({
        patientId,
        visitId: null,
        title: `Stress attachment ${index + 1}`,
        category: index % 3 === 0 ? 'xray' : index % 3 === 1 ? 'report' : 'photo',
        notes: null,
        sourcePath: source
      }).id
    )
  }
  log(`attachments: ${attachmentIds.length} files copied into managed storage`)

  const seedSeconds = (performance.now() - startedSeed) / 1000
  const operations =
    options.patients +
    options.patients * options.visitsPerPatient +
    options.appointments +
    options.prescriptions +
    options.invoices +
    options.payments +
    options.inventoryTransactions +
    attachmentIds.length
  log(`seeded ${operations} records in ${seedSeconds.toFixed(1)} s`)

  const somePatient = patientIds[Math.floor(patientIds.length / 2)] as number
  const someVisit = visitIds[Math.floor(visitIds.length / 2)] as number

  const measurements: StressReport['measurements'] = [
    measure('Patient register page (25 rows)', '≤ 120 ms', 25, () => {
      services.clinical.listPatients({ page: 1, pageSize: 25 })
    }),
    measure('Patient register search (10 pages deep)', '≤ 120 ms', 15, () => {
      services.clinical.listPatients({ page: 10, pageSize: 25, search: 'Ra' })
    }),
    measure('Global search', '≤ 250 ms', 20, () => {
      services.clinical.globalSearch('Rahim', undefined, 10)
    }),
    measure('Patient profile (counts + timeline)', '≤ 300 ms', 20, () => {
      services.clinical.getPatientProfile(somePatient)
    }),
    measure('Visit history page', '≤ 300 ms', 20, () => {
      services.clinical.listVisits({ page: 1, pageSize: 25, patientId: somePatient })
    }),
    measure('Prescription list page', '≤ 250 ms', 20, () => {
      services.clinical.listPrescriptions({ page: 1, pageSize: 25 })
    }),
    measure('Invoice list page', '≤ 250 ms', 20, () => {
      services.billing.listInvoices({ page: 1, pageSize: 25 })
    }),
    measure('Payment dashboard (today)', '≤ 250 ms', 20, () => {
      services.billing.paymentDashboard({ page: 1, pageSize: 25, range: 'today' })
    }),
    measure('Accounting summary (this month)', '≤ 500 ms', 10, () => {
      services.billing.accountingSummary('2026-09-01', '2026-09-30')
    }),
    measure('Dashboard summary', '≤ 400 ms', 15, () => {
      services.clinical.getDashboard()
    }),
    measure('Inventory list page', '≤ 200 ms', 20, () => {
      services.billing.listInventory({ page: 1, pageSize: 25 })
    }),
    measure('Audit log page (filtered)', '≤ 250 ms', 15, () => {
      services.admin.listAudit({ page: 1, pageSize: 25, action: 'patients.create' })
    }),
    measure('Prescription print document build', '≤ 400 ms', 10, () => {
      services.admin.buildPrescriptionDocumentPrint(
        services.clinical.listPrescriptions({ page: 1, pageSize: 1 }).rows[0]?.id ?? 1,
        'a4'
      )
    }),
    measure('Invoice print document build', '≤ 400 ms', 10, () => {
      services.admin.buildInvoiceDocumentPrint(
        services.billing.listInvoices({ page: 1, pageSize: 1 }).rows[0]?.id ?? 1,
        'a4'
      )
    })
  ]

  // Invoice creation is measured separately because it writes (20 line items, one transaction).
  const createInvoiceMeasurement = measure('Invoice creation with 20 items', '≤ 250 ms', 15, () => {
    const items = Array.from({ length: 20 }, (_, itemIndex) => {
      const treatment = TREATMENTS[itemIndex % TREATMENTS.length] as (typeof TREATMENTS)[number]
      return {
        itemType: 'treatment' as const,
        treatmentId: null,
        inventoryItemId: null,
        description: treatment.name,
        quantityMilli: 1000,
        unitPricePoisha: treatment.fee,
        discountPoisha: 0,
        note: null
      }
    })
    services.billing.createInvoice({
      patientId: somePatient,
      visitId: someVisit,
      invoiceDate: '2026-09-30',
      dueDate: null,
      discountPoisha: 0,
      discountPercentX100: 0,
      taxPercentX100: 0,
      roundOffEnabled: false,
      notes: 'performance measurement',
      items
    })
  })
  measurements.push(createInvoiceMeasurement)

  // Backup of the stress database, measured end to end (verify + manifest + checksums).
  const backupStartedAt = performance.now()
  const backup = await services.admin.createBackup('manual', { includeAttachments: true })
  const backupSeconds = (performance.now() - backupStartedAt) / 1000

  const budget: StressReport['budget'] = [
    {
      name: 'Patient list page (25 rows)',
      targetMs: 120,
      measuredMs: measurements[0]?.p95Ms ?? 0,
      passed: (measurements[0]?.p95Ms ?? 0) <= 120
    },
    {
      name: 'Global search',
      targetMs: 250,
      measuredMs: measurements[2]?.p95Ms ?? 0,
      passed: (measurements[2]?.p95Ms ?? 0) <= 250
    },
    {
      name: 'Patient profile',
      targetMs: 300,
      measuredMs: measurements[3]?.p95Ms ?? 0,
      passed: (measurements[3]?.p95Ms ?? 0) <= 300
    },
    {
      name: 'Invoice creation (20 items)',
      targetMs: 250,
      measuredMs: createInvoiceMeasurement.p95Ms,
      passed: createInvoiceMeasurement.p95Ms <= 250
    }
  ]

  const dataset = {
    patients: patientIds.length,
    visits: visitIds.length,
    appointments: options.appointments,
    prescriptions: options.prescriptions,
    invoices: invoiceIds.length,
    payments: options.payments,
    inventoryItems: inventoryIds.length,
    inventoryTransactions: options.inventoryTransactions,
    queueEntries: options.queueSize,
    attachments: attachmentIds.length,
    auditRows: Number(
      (host.db.prepare('SELECT COUNT(*) AS value FROM audit_log').get() as { value: number }).value
    )
  }

  const databaseBytes = statSync(host.layout.databaseFile).size
  const machine = {
    platform: `${platform()} ${release()}`,
    arch: arch(),
    cpu: (cpus()[0]?.model ?? 'unknown').trim(),
    cpuCount: cpus().length,
    totalMemoryMb: Math.round(totalmem() / 1024 / 1024)
  }
  const environment = {
    node: process.version,
    sqlite: String((host.db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v),
    databaseSizeMb: (databaseBytes / 1024 / 1024).toFixed(1),
    dataRoot: host.layout.root
  }

  const generatedAt = new Date().toISOString()
  const markdown = buildMarkdown({
    generatedAt,
    dataset,
    seed: {
      seconds: seedSeconds,
      operationsPerSecond: Math.round(operations / Math.max(0.001, seedSeconds))
    },
    measurements,
    budget,
    backup: { folder: backup.fileName, sizeBytes: backup.sizeBytes, seconds: backupSeconds },
    machine,
    environment
  })

  if (options.writeReport) {
    const reportPath =
      options.reportPath ?? join(process.cwd(), 'docs', 'testing', 'PERFORMANCE_MEASUREMENTS.md')
    mkdirSync(join(reportPath, '..'), { recursive: true })
    writeFileSync(reportPath, markdown, 'utf8')
    log(`report written to ${reportPath}`)
  }

  return {
    generatedAt,
    dataset,
    seed: {
      seconds: seedSeconds,
      operationsPerSecond: Math.round(operations / Math.max(0.001, seedSeconds))
    },
    measurements,
    budget,
    backup: { folder: backup.fileName, sizeBytes: backup.sizeBytes, seconds: backupSeconds },
    machine,
    environment,
    markdown
  }
}

export function buildMarkdown(report: {
  generatedAt: string
  dataset: Record<string, number>
  seed: { seconds: number; operationsPerSecond: number }
  measurements: StressReport['measurements']
  budget: StressReport['budget']
  backup: { folder: string; sizeBytes: number; seconds: number }
  machine: Record<string, string | number>
  environment: Record<string, string>
}): string {
  const lines: string[] = []
  lines.push('# Performance measurements — Dentiva Pro')
  lines.push('')
  lines.push(
    `Measured by \`scripts/seed-stress-data.mjs\` on ${report.generatedAt}. The numbers below are produced by this`
  )
  lines.push(
    'run, not estimated: the script builds the database with the real migrations and repositories, then times the'
  )
  lines.push(
    'operations through the real service layer (permission checks, audit writes and validation included).'
  )
  lines.push('')
  lines.push('## Machine')
  lines.push('')
  lines.push('| Item | Value |')
  lines.push('|---|---|')
  for (const [key, value] of Object.entries(report.machine)) lines.push(`| ${key} | ${value} |`)
  for (const [key, value] of Object.entries(report.environment)) lines.push(`| ${key} | ${value} |`)
  lines.push('')
  lines.push('## Dataset')
  lines.push('')
  lines.push('| Entity | Rows |')
  lines.push('|---|---|')
  for (const [key, value] of Object.entries(report.dataset))
    lines.push(`| ${key} | ${value.toLocaleString()} |`)
  lines.push('')
  lines.push(
    `Seeding throughput: ${report.seed.operationsPerSecond.toLocaleString()} records/second ` +
      `(${report.seed.seconds.toFixed(1)} s total).`
  )
  lines.push('')
  lines.push('## Measured operations')
  lines.push('')
  lines.push('| Operation | Budget | Samples | Average | p95 | Max |')
  lines.push('|---|---|---|---|---|---|')
  for (const item of report.measurements) {
    lines.push(
      `| ${item.name} | ${item.target} | ${item.samples} | ${item.averageMs} ms | ${item.p95Ms} ms | ${item.maxMs} ms |`
    )
  }
  lines.push('')
  lines.push('## Budget check')
  lines.push('')
  lines.push('| Budget item | Target | Measured (p95) | Result |')
  lines.push('|---|---|---|---|')
  for (const item of report.budget) {
    lines.push(
      `| ${item.name} | ≤ ${item.targetMs} ms | ${item.measuredMs} ms | ${item.passed ? 'PASS' : 'FAIL'} |`
    )
  }
  lines.push('')
  lines.push('## Backup')
  lines.push('')
  lines.push(
    `A verified backup of this database (\`${report.backup.folder}\`, ` +
      `${(report.backup.sizeBytes / 1024 / 1024).toFixed(1)} MB) took ${report.backup.seconds.toFixed(1)} s, ` +
      'including the integrity check, the manifest and the checksum file.'
  )
  lines.push('')
  lines.push('## Dataset notes')
  lines.push('')
  lines.push(
    '- The audit-log row count is what the seeding operations actually wrote. Audit entries are appended by'
  )
  lines.push(
    '  the service layer for real user actions, so the generator cannot invent thousands of rows without'
  )
  lines.push(
    '  going through the services; the documented stress figure (3,000 rows) is reached by daily clinic use.'
  )
  lines.push(
    '- Attachments are created through the attachment service with real files copied into the data root, so'
  )
  lines.push('  the backup step measures real attachment copying rather than empty folders.')
  lines.push('')
  lines.push('## Not measured by this script')
  lines.push('')
  lines.push(
    'These budget items need the packaged desktop application on a target machine and are measured by the'
  )
  lines.push('release checklist, not here:')
  lines.push('')
  lines.push('| Budget item | Target | Why it is not in this run |')
  lines.push('|---|---|---|')
  lines.push(
    '| Cold start (new process, first window) | ≤ 3.0 s | needs the built application and its Chromium process |'
  )
  lines.push('| Warm start (second launch) | ≤ 1.5 s | ditto |')
  lines.push('| Print preview first paint | ≤ 600 ms | needs Chromium and a real printer queue |')
  lines.push(
    '| Restore of a 5 GB backup | ≤ 90 s | needs a target machine with a 5 GB attachment folder; this dataset is smaller |'
  )
  lines.push("| PDF export of a prescription/invoice | ≤ 2 s | needs Chromium's printToPDF pipeline |")
  lines.push('')
  lines.push(
    'Everything in the tables above is produced by this run; nothing is copied from an earlier measurement.'
  )
  lines.push('')
  return `${lines.join('\n')}\n`
}
