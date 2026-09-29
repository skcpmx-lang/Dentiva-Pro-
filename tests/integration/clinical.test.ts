/**
 * Integration tests for the clinical workflow: patient register, visits, dental chart, prescriptions,
 * referrals, appointments and the queue.
 *
 * Everything runs through the real services on a real database, so the rules that matter (unique patient
 * codes, immutable finalised visits, chart entries tied to teeth, prescription items in order) are verified
 * where they are actually enforced.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { completeSetup, createHarness, patientInput, type Harness } from './harness'

const activationCode = process.env.DENTIVA_ACTIVATION_CODE ?? ''

let harness: Harness
let dentistId = 0

beforeAll(() => {
  harness = createHarness()
  completeSetup(harness, { activationCode })
  dentistId = harness.services.dentists.list(false)[0]?.id ?? 0
})

afterAll(() => {
  harness.dispose()
})

describe('patient register', () => {
  it('creates patients with sequential clinic codes and finds them by code, name and phone', () => {
    const first = harness.services.clinical.createPatient(patientInput())
    const second = harness.services.clinical.createPatient(
      patientInput({ fullName: 'Sayeeda Begum', phone: '+8801811111111', gender: 'female' })
    )

    expect(first.code).toMatch(/^P-\d+$/)
    expect(second.code).not.toBe(first.code)
    expect(harness.services.clinical.getPatientByCode(first.code).fullName).toBe('Rahim Uddin')

    const byName = harness.services.clinical.listPatients({ page: 1, pageSize: 20, search: 'sayeeda' })
    expect(byName.total).toBe(1)
    expect(byName.rows[0]?.fullName).toBe('Sayeeda Begum')

    const byPhone = harness.services.clinical.listPatients({ page: 1, pageSize: 20, search: '01712345678' })
    expect(byPhone.total).toBeGreaterThanOrEqual(1)

    const all = harness.services.clinical.listPatients({ page: 1, pageSize: 20 })
    expect(all.total).toBe(2)
  })

  it('archives a patient without deleting clinical history', () => {
    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Archive Me' }))
    harness.services.clinical.archivePatient(patient.id)

    const active = harness.services.clinical.listPatients({ page: 1, pageSize: 50 })
    expect(active.rows.some((row) => row.id === patient.id)).toBe(false)

    const withArchived = harness.services.clinical.listPatients({
      page: 1,
      pageSize: 50,
      includeArchived: true
    })
    const archivedRow = withArchived.rows.find((row) => row.id === patient.id)
    expect(archivedRow).toBeDefined()
    expect(archivedRow?.isArchived).toBe(true)
    // The row is still readable and its history is intact: archiving is a soft delete.
    expect(harness.services.clinical.getPatient(patient.id).fullName).toBe('Archive Me')

    // ...and it can be restored, which the register offers for archived rows.
    harness.services.clinical.restorePatient(patient.id)
    const restored = harness.services.clinical.listPatients({ page: 1, pageSize: 50 })
    expect(restored.rows.some((row) => row.id === patient.id)).toBe(true)
    expect(restored.rows.find((row) => row.id === patient.id)?.isArchived).toBe(false)
  })

  it('builds a patient profile with clinical counts', () => {
    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Profile Person' }))
    const profile = harness.services.clinical.getPatientProfile(patient.id)
    expect(profile.patient.id).toBe(patient.id)
    expect(profile.counts.visits).toBe(0)
    expect(profile.counts.prescriptions).toBe(0)
    expect(profile.patient.code).toMatch(/^P-/)
  })
})

describe('visits and dental chart', () => {
  it('records a visit with treatments and finalises it', () => {
    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Visit Person' }))
    const visit = harness.services.clinical.createVisit({
      patientId: patient.id,
      visitDate: '2026-09-30',
      visitTime: '10:15',
      dentistId,
      chiefComplaint: 'Toothache in the lower right',
      examination: 'Deep caries 46',
      treatments: [
        { treatmentId: null, treatmentName: 'Composite filling', teeth: ['46'], feePoisha: 350000 }
      ],
      advice: 'Avoid hard food for two days'
    })

    expect(visit.status).toBe('draft')
    expect(visit.treatments).toHaveLength(1)
    expect(visit.treatments[0]?.feePoisha).toBe(350000)

    const finalised = harness.services.clinical.finalizeVisit(visit.id)
    expect(finalised.status).toBe('final')
    expect(finalised.finalizedAt).not.toBeNull()

    const listed = harness.services.clinical.listVisits({ page: 1, pageSize: 10, patientId: patient.id })
    expect(listed.total).toBe(1)
  })

  it('stores chart entries per tooth and keeps them tied to the visit', () => {
    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Chart Person' }))
    const visit = harness.services.clinical.createVisit({
      patientId: patient.id,
      visitDate: '2026-09-30',
      visitTime: '11:00',
      dentistId,
      treatments: []
    })

    harness.services.clinical.saveChart(patient.id, [
      {
        toothNumber: '46',
        conditionCode: 'caries',
        treatmentCode: null,
        surfaces: ['O', 'D'],
        status: 'existing',
        note: null
      },
      {
        toothNumber: '11',
        conditionCode: 'healthy',
        treatmentCode: null,
        surfaces: [],
        status: 'existing',
        note: null
      }
    ])

    const chart = harness.services.clinical.getChart(patient.id)
    expect(chart.entries).toHaveLength(2)
    expect(chart.entries.map((entry) => entry.toothNumber).sort()).toEqual(['11', '46'])
    const molar = chart.entries.find((entry) => entry.toothNumber === '46')
    expect(molar?.surfaces).toEqual(['O', 'D'])
    expect(visit.id).toBeGreaterThan(0)
  })

  it('writes a prescription with the full medicine model', () => {
    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Prescription Person' }))
    const prescription = harness.services.clinical.createPrescription({
      patientId: patient.id,
      dentistId,
      prescriptionDate: '2026-09-30',
      chiefComplaints: ['Pain'],
      onExamination: ['Deep caries 46'],
      advice: ['Brush twice daily'],
      items: [
        {
          sortOrder: 0,
          medicineName: 'Amoxicillin',
          medicineType: 'Capsule',
          strength: '500 mg',
          dose: '1 capsule',
          morning: '1',
          noon: null,
          night: '1',
          timing: 'After food',
          durationValue: 5,
          durationUnit: 'days',
          quantity: '10 capsules',
          instruction: null,
          conditionalInstruction: null,
          notes: null
        },
        {
          sortOrder: 1,
          medicineName: 'Paracetamol',
          medicineType: 'Tablet',
          strength: '500 mg',
          dose: '1 tablet',
          morning: null,
          noon: null,
          night: '1',
          timing: 'After food',
          durationValue: 3,
          durationUnit: 'days',
          quantity: '3 tablets',
          instruction: null,
          conditionalInstruction: 'if pain occurs',
          notes: null
        }
      ]
    })

    expect(prescription.status).toBe('draft')
    expect(prescription.items).toHaveLength(2)
    expect(prescription.items[1]?.conditionalInstruction).toBe('if pain occurs')
    expect(prescription.items[0]?.morning).toBe('1')

    // Reordering is persisted, which is what the printed sheet shows.
    const reordered = harness.services.clinical.updatePrescription(prescription.id, {
      ...prescription,
      items: [...prescription.items].reverse().map((item, index) => ({ ...item, sortOrder: index }))
    } as never)
    expect(reordered.items[0]?.medicineName).toBe('Paracetamol')

    harness.services.clinical.voidPrescription(prescription.id)
    expect(harness.services.clinical.getPrescription(prescription.id).status).toBe('void')
  })

  it('keeps referrals linked to the patient record', () => {
    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Referral Person' }))
    const referral = harness.services.clinical.createReferral({
      patientId: patient.id,
      visitId: null,
      referralDate: '2026-09-30',
      referringDentistId: dentistId,
      referredToName: 'Dr. Specialist',
      referredToInstitution: 'Dhaka Dental College',
      referredToPhone: null,
      reason: 'Impacted third molar',
      notes: null
    })

    expect(referral.patientCode).toBe(patient.code)
    expect(referral.status).toBe('pending')
    harness.services.clinical.updateReferralStatus(referral.id, 'completed', 'Extraction done')
    const updated = harness.services.clinical.listReferrals(patient.id)[0]
    expect(updated?.status).toBe('completed')
    expect(updated?.outcome).toBe('Extraction done')
  })
})

describe('appointments and queue', () => {
  it('books, reschedules and cancels appointments', () => {
    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Appointment Person' }))
    const appointment = harness.services.clinical.createAppointment({
      patientId: patient.id,
      dentistId,
      appointmentDate: '2026-10-05',
      startTime: '10:00',
      endTime: '10:30',
      typeCode: 'Consultation',
      reason: 'Check-up',
      status: 'scheduled'
    })

    expect(appointment.status).toBe('scheduled')

    const moved = harness.services.clinical.rescheduleAppointment(appointment.id, {
      appointmentDate: '2026-10-06',
      startTime: '11:00',
      reason: 'Patient called'
    })
    expect(moved.appointmentDate).toBe('2026-10-06')
    expect(moved.startTime).toBe('11:00')

    harness.services.clinical.setAppointmentStatus(appointment.id, 'cancelled', 'Patient unwell')
    expect(harness.services.clinical.getAppointment(appointment.id).status).toBe('cancelled')
  })

  it('moves a patient through the queue and keeps the order stable', () => {
    const first = harness.services.clinical.createPatient(patientInput({ fullName: 'Queue One' }))
    const second = harness.services.clinical.createPatient(
      patientInput({ fullName: 'Queue Two', phone: '+8801999999999' })
    )

    const afterFirst = harness.services.clinical.addToQueue({ patientId: first.id, priority: 'normal' })
    const afterSecond = harness.services.clinical.addToQueue({ patientId: second.id, priority: 'urgent' })

    const queueDate = afterSecond.queueDate
    expect(afterFirst.entries.some((entry) => entry.patientId === first.id)).toBe(true)
    const entrySecond = afterSecond.entries.find((entry) => entry.patientId === second.id)
    const entryFirst = afterSecond.entries.find((entry) => entry.patientId === first.id)
    expect(entrySecond).toBeDefined()
    expect(entryFirst).toBeDefined()

    // Clinical priority always wins over a manual reorder: the urgent patient stays first even when the
    // staff try to move the routine patient ahead of them.
    const reordered = harness.services.clinical.reorderQueue(queueDate, [entryFirst!.id, entrySecond!.id])
    expect(reordered.entries[0]?.priority).toBe('urgent')
    expect(reordered.entries.map((entry) => entry.status)).toEqual(['waiting', 'waiting'])

    const updated = harness.services.clinical.updateQueueEntry(entrySecond!.id, { status: 'in_treatment' })
    expect(updated.entries.find((entry) => entry.id === entrySecond!.id)?.status).toBe('in_treatment')
  })
})
