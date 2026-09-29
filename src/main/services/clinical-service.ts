/**
 * Clinical services: patients, visits, dental chart, prescriptions, referrals, appointments,
 * queue and the dashboard. Business rules and permission checks live here.
 */

import { todayIso } from '@shared/date'
import { conflict, notFound, validationError } from '@shared/errors'
import { formatSequence } from '@shared/ids'
import type {
  AppointmentInput,
  AppointmentQuery,
  AppointmentSummary,
  DentalChartState,
  DashboardWidgetData,
  Patient,
  PatientInput,
  PatientProfile,
  PatientQuery,
  PatientSummary,
  Prescription,
  PrescriptionInput,
  PrescriptionQuery,
  QueueSnapshot,
  Referral,
  ReferralInput,
  Visit,
  VisitInput,
  VisitQuery,
  Paged
} from '@shared/types'
import type { AppointmentStatus, QueueStatus } from '@shared/constants'
import { dentitionOf } from '@shared/dental'
import type { SqliteDatabase } from '../db/connection'
import type {
  AppointmentRepository,
  AuditRepository,
  DentalChartRepository,
  NotificationRepository,
  PatientRepository,
  PrescriptionRepository,
  QueueRepository,
  ReferralRepository,
  VisitRepository
} from '../db/repositories-clinical'
import type { CounterRepository, DentistRepository, SettingsRepository } from '../db/repositories-core'
import type {
  InvoiceRepository,
  PaymentRepository,
  InventoryRepository,
  TreatmentRepository
} from '../db/repositories-billing'
import type { SessionManager } from '../security/session'
import type { AuthService } from './auth-service'

export interface ClinicalServiceDeps {
  db: SqliteDatabase
  patients: PatientRepository
  visits: VisitRepository
  chart: DentalChartRepository
  prescriptions: PrescriptionRepository
  referrals: ReferralRepository
  appointments: AppointmentRepository
  queue: QueueRepository
  dentists: DentistRepository
  treatments: TreatmentRepository
  invoices: InvoiceRepository
  payments: PaymentRepository
  inventory: InventoryRepository
  counters: CounterRepository
  settings: SettingsRepository
  notifications: NotificationRepository
  audit: AuditRepository
  auth: AuthService
  session: SessionManager
  appVersion: string
}

export class ClinicalService {
  constructor(private readonly deps: ClinicalServiceDeps) {}

  private audit(
    action: string,
    summary: string,
    options: {
      entityType?: string | null
      entityId?: string | number | null
      before?: unknown
      after?: unknown
      severity?: 'info' | 'warning' | 'critical'
    } = {}
  ): void {
    this.deps.audit.append({
      actorUserId: this.deps.session.userId,
      actorUsername: this.deps.session.username,
      action,
      entityType: options.entityType ?? null,
      entityId: options.entityId ?? null,
      summary,
      before: options.before,
      after: options.after,
      severity: options.severity ?? 'info',
      appVersion: this.deps.appVersion
    })
  }

  private require(permission: Parameters<SessionManager['assertPermission']>[0]): void {
    this.deps.session.assertPermission(permission)
  }

  // -------------------------------------------------------------------------------------------
  // Patients
  // -------------------------------------------------------------------------------------------

  listPatients(query: PatientQuery): Paged<PatientSummary> {
    this.require('patients.view')
    return this.deps.patients.list(query)
  }

  getPatient(id: number): Patient {
    this.require('patients.view')
    const patient = this.deps.patients.findById(id)
    if (!patient) throw notFound('Patient', id)
    return patient
  }

  getPatientByCode(code: string): Patient {
    this.require('patients.view')
    const patient = this.deps.patients.findByCode(code)
    if (!patient) throw notFound(`Patient ${code}`)
    return patient
  }

  createPatient(input: PatientInput): Patient {
    this.require('patients.create')
    if (this.deps.patients.findByPhone(input.phone)) {
      // Duplicate phone numbers are allowed (families share numbers) but we surface it as information,
      // not a block; the unique business key of a patient is the generated code.
    }
    const settings = this.deps.settings.get()
    const run = this.deps.db.transaction(() => {
      const next = this.deps.counters.next('patient_code')
      const code = formatSequence(next, {
        prefix: settings.patientCodePrefix,
        padding: settings.patientCodePadding
      })
      const id = this.deps.patients.create(code, input, this.deps.session.username ?? 'system')
      this.audit('patients.create', `Registered patient ${code} (${input.fullName})`, {
        entityType: 'patient',
        entityId: id,
        after: { code, fullName: input.fullName, phone: input.phone }
      })
      return id
    })
    const id = run()
    return this.deps.patients.findById(id) as Patient
  }

  updatePatient(id: number, input: PatientInput): Patient {
    this.require('patients.edit')
    const existing = this.deps.patients.findById(id)
    if (!existing) throw notFound('Patient', id)
    this.deps.patients.update(id, input, this.deps.session.username ?? 'system')
    this.audit('patients.update', `Updated patient ${existing.code}`, {
      entityType: 'patient',
      entityId: id,
      before: { fullName: existing.fullName, phone: existing.phone },
      after: { fullName: input.fullName, phone: input.phone }
    })
    return this.deps.patients.findById(id) as Patient
  }

  archivePatient(id: number): void {
    this.require('patients.delete')
    const existing = this.deps.patients.findById(id)
    if (!existing) throw notFound('Patient', id)
    this.deps.patients.archive(id, this.deps.session.username ?? 'system')
    this.audit('patients.delete', `Archived patient ${existing.code} (${existing.fullName})`, {
      entityType: 'patient',
      entityId: id,
      before: { code: existing.code, fullName: existing.fullName },
      severity: 'critical'
    })
  }

  /** Restore an archived patient (the record and all history were kept). */
  restorePatient(id: number): Patient {
    this.require('patients.delete')
    const existing = this.deps.patients.findById(id)
    if (!existing) throw notFound('Patient', id)
    this.deps.patients.restore(id, this.deps.session.username ?? 'system')
    this.audit('patients.restore', `Restored archived patient ${existing.code} (${existing.fullName})`, {
      entityType: 'patient',
      entityId: id,
      severity: 'critical'
    })
    return this.deps.patients.findById(id) as Patient
  }

  getPatientProfile(id: number): PatientProfile {
    this.require('patients.view')
    const patient = this.deps.patients.findById(id)
    if (!patient) throw notFound('Patient', id)

    const financial = this.deps.session.hasPermission('invoices.view')
      ? this.deps.patients.financialSummary(id)
      : null

    const recentVisits = this.deps.visits.list({ patientId: id, page: 1, pageSize: 1 })
    const lastVisit = recentVisits.rows[0]
    return {
      patient,
      financial,
      counts: this.deps.patients.counts(id),
      lastVisit: lastVisit
        ? { id: lastVisit.id, visitDate: lastVisit.visitDate, diagnosis: lastVisit.diagnosis }
        : null,
      upcomingAppointments: this.deps.appointments.upcomingForPatient(id),
      latestChart: this.deps.chart.forPatient(id)
    }
  }

  patientTimeline(id: number): ReturnType<PatientRepository['timeline']> {
    this.require('patients.view')
    const entries = this.deps.patients.timeline(id)
    if (!this.deps.session.hasPermission('invoices.view')) {
      return entries.filter((entry) => entry.type !== 'invoice' && entry.type !== 'payment')
    }
    return entries
  }

  addPatientNote(patientId: number, note: string): number {
    this.require('patients.edit')
    if (note.trim().length < 2) {
      throw validationError('Enter a note.', [{ field: 'note', message: 'Note is too short.' }])
    }
    const id = this.deps.patients.addNote(patientId, note.trim(), this.deps.session.username ?? 'system')
    this.audit('patients.note', `Added a note to patient ${patientId}`, {
      entityType: 'patient',
      entityId: patientId
    })
    return id
  }

  // -------------------------------------------------------------------------------------------
  // Visits
  // -------------------------------------------------------------------------------------------

  listVisits(query: VisitQuery): Paged<Visit> {
    this.require('visits.view')
    return this.deps.visits.list(query)
  }

  getVisit(id: number): Visit {
    this.require('visits.view')
    const visit = this.deps.visits.findById(id)
    if (!visit) throw notFound('Visit', id)
    return visit
  }

  createVisit(input: VisitInput): Visit {
    this.require('visits.create')
    const patient = this.deps.patients.findById(input.patientId)
    if (!patient)
      throw validationError('Choose a patient.', [{ field: 'patientId', message: 'Unknown patient.' }])
    const dentist = this.deps.dentists.findById(input.dentistId)
    if (!dentist || !dentist.isActive) {
      throw validationError('Choose an active dentist.', [
        { field: 'dentistId', message: 'Unknown dentist.' }
      ])
    }
    for (const treatment of input.treatments) {
      if (treatment.treatmentId && !this.deps.treatments.findById(treatment.treatmentId)) {
        throw validationError('One of the treatments no longer exists.', [
          { field: 'treatments', message: `Unknown treatment #${treatment.treatmentId}` }
        ])
      }
    }
    const id = this.deps.visits.create(input.patientId, input, this.deps.session.username ?? 'system')
    // Mark the appointment as completed when the visit came from one.
    if (input.appointmentId) {
      this.deps.appointments.setStatus(
        input.appointmentId,
        'completed',
        null,
        this.deps.session.username ?? 'system'
      )
    }
    this.audit('visits.create', `Recorded visit for ${patient.code} (${patient.fullName})`, {
      entityType: 'visit',
      entityId: id,
      after: { visitDate: input.visitDate, dentistId: input.dentistId }
    })
    return this.deps.visits.findById(id) as Visit
  }

  updateVisit(id: number, input: VisitInput): Visit {
    this.require('visits.edit')
    const existing = this.deps.visits.findById(id)
    if (!existing) throw notFound('Visit', id)
    if (existing.status !== 'draft' && !this.deps.session.hasPermission('visits.amend')) {
      throw conflict('This visit is finalized. Amending it requires the "visits.amend" permission.')
    }
    this.deps.visits.update(id, input, this.deps.session.username ?? 'system')
    this.audit('visits.update', `Updated visit #${existing.visitNo} of ${existing.patientCode}`, {
      entityType: 'visit',
      entityId: id,
      before: { diagnosis: existing.diagnosis, status: existing.status },
      after: { diagnosis: input.diagnosis ?? null }
    })
    return this.deps.visits.findById(id) as Visit
  }

  finalizeVisit(id: number): Visit {
    this.require('visits.finalize')
    const visit = this.deps.visits.findById(id)
    if (!visit) throw notFound('Visit', id)
    if (visit.status === 'final') throw conflict('This visit is already finalized.')
    const run = this.deps.db.transaction(() => {
      const chartEntries = this.deps.chart.forPatient(visit.patientId)
      this.deps.chart.snapshotForVisit(
        id,
        visit.patientId,
        chartEntries.map((entry) => ({
          toothNumber: entry.toothNumber,
          conditionCode: entry.conditionCode,
          surfaces: entry.surfaces,
          status: entry.status
        })),
        this.deps.session.username ?? 'system'
      )
      this.deps.visits.finalize(id, this.deps.session.username ?? 'system')
    })
    run()
    this.audit('visits.finalize', `Finalized visit #${visit.visitNo} of ${visit.patientCode}`, {
      entityType: 'visit',
      entityId: id,
      severity: 'warning'
    })
    return this.deps.visits.findById(id) as Visit
  }

  deleteVisit(id: number): void {
    this.require('visits.delete')
    const visit = this.deps.visits.findById(id)
    if (!visit) throw notFound('Visit', id)
    this.deps.visits.softDelete(id, this.deps.session.username ?? 'system')
    this.audit('visits.delete', `Deleted visit #${visit.visitNo} of ${visit.patientCode}`, {
      entityType: 'visit',
      entityId: id,
      severity: 'critical'
    })
  }

  // -------------------------------------------------------------------------------------------
  // Dental chart
  // -------------------------------------------------------------------------------------------

  getChart(patientId: number, visitId: number | null = null): DentalChartState {
    this.require('chart.view')
    return {
      patientId,
      visitId,
      entries: this.deps.chart.forPatient(patientId, visitId),
      snapshotAt: visitId ? (this.deps.chart.snapshot(visitId)?.takenAt ?? null) : null
    }
  }

  saveChart(
    patientId: number,
    entries: {
      toothNumber: string
      conditionCode: string
      treatmentCode: string | null
      surfaces: string[]
      status: 'existing' | 'planned' | 'completed'
      note: string | null
    }[],
    visitId: number | null = null
  ): DentalChartState {
    this.require('chart.edit')
    const patient = this.deps.patients.findById(patientId)
    if (!patient) throw notFound('Patient', patientId)
    const problems: { field: string; message: string }[] = []
    const normalized = entries.map((entry) => {
      const dentition = dentitionOf(entry.toothNumber)
      if (!dentition)
        problems.push({ field: 'toothNumber', message: `Invalid tooth number ${entry.toothNumber}` })
      return { ...entry, dentition: dentition ?? 'permanent' }
    })
    if (problems.length > 0) throw validationError('The dental chart contains invalid entries.', problems)

    if (visitId) {
      this.deps.chart.snapshotForVisit(
        visitId,
        patientId,
        normalized.map((entry) => ({
          toothNumber: entry.toothNumber,
          conditionCode: entry.conditionCode,
          surfaces: entry.surfaces,
          status: entry.status
        })),
        this.deps.session.username ?? 'system'
      )
    }
    this.deps.chart.replaceCurrent(patientId, normalized, this.deps.session.username ?? 'system')
    this.audit(
      'chart.update',
      `Updated the dental chart of ${patient.code} (${normalized.length} tooth entries)`,
      {
        entityType: 'patient',
        entityId: patientId
      }
    )
    return this.getChart(patientId)
  }

  // -------------------------------------------------------------------------------------------
  // Prescriptions
  // -------------------------------------------------------------------------------------------

  listPrescriptions(query: PrescriptionQuery): Paged<Prescription> {
    this.require('prescriptions.view')
    return this.deps.prescriptions.list(query)
  }

  getPrescription(id: number): Prescription {
    this.require('prescriptions.view')
    const prescription = this.deps.prescriptions.findById(id)
    if (!prescription) throw notFound('Prescription', id)
    return prescription
  }

  createPrescription(input: PrescriptionInput): Prescription {
    this.require('prescriptions.create')
    const patient = this.deps.patients.findById(input.patientId)
    if (!patient)
      throw validationError('Choose a patient.', [{ field: 'patientId', message: 'Unknown patient.' }])
    const dentist = this.deps.dentists.findById(input.dentistId)
    if (!dentist)
      throw validationError('Choose a dentist.', [{ field: 'dentistId', message: 'Unknown dentist.' }])
    if (!input.items || input.items.length === 0) {
      throw validationError('Add at least one medicine.', [
        { field: 'items', message: 'A prescription needs at least one medicine.' }
      ])
    }
    if ((input.status as string | undefined) === 'void') {
      throw validationError('Use the void action to cancel a prescription.', [
        { field: 'status', message: 'A prescription cannot be created as void.' }
      ])
    }
    const id = this.deps.prescriptions.create(input, this.deps.session.username ?? 'system')
    this.audit(
      'prescriptions.create',
      `Created prescription for ${patient.code} (${input.items.length} medicines)`,
      {
        entityType: 'prescription',
        entityId: id,
        after: { patientId: input.patientId, visitId: input.visitId ?? null }
      }
    )
    return this.deps.prescriptions.findById(id) as Prescription
  }

  updatePrescription(id: number, input: PrescriptionInput): Prescription {
    this.require('prescriptions.edit')
    const existing = this.deps.prescriptions.findById(id)
    if (!existing) throw notFound('Prescription', id)
    if (existing.status === 'void') {
      throw conflict('This prescription was voided and can no longer be edited.')
    }
    if ((input.status as string | undefined) === 'void') {
      throw validationError('Use the void action to cancel a prescription.', [
        { field: 'status', message: 'Use the void action to cancel a prescription.' }
      ])
    }
    const nextStatus = input.status ?? existing.status
    this.deps.prescriptions.update(id, input, this.deps.session.username ?? 'system')
    this.audit(
      'prescriptions.update',
      nextStatus !== existing.status ? `Finalised prescription #${id}` : `Updated prescription #${id}`,
      {
        entityType: 'prescription',
        entityId: id,
        before: { itemCount: existing.items.length, status: existing.status },
        after: { itemCount: input.items.length, status: nextStatus }
      }
    )
    return this.deps.prescriptions.findById(id) as Prescription
  }

  voidPrescription(id: number, reason: string): void {
    this.require('prescriptions.delete')
    const existing = this.deps.prescriptions.findById(id)
    if (!existing) throw notFound('Prescription', id)
    if (existing.status === 'void') throw conflict('This prescription is already void.')
    const trimmed = (reason ?? '').trim()
    if (trimmed.length < 3) {
      throw validationError('Enter a reason for voiding this prescription.', [
        { field: 'reason', message: 'A reason of at least 3 characters is required.' }
      ])
    }
    const actor = this.deps.session.username ?? 'system'
    this.deps.db.transaction(() => {
      this.deps.prescriptions.void(id, trimmed, actor)
      this.audit('prescriptions.void', `Voided prescription #${id}: ${trimmed}`, {
        entityType: 'prescription',
        entityId: id,
        before: { status: existing.status },
        severity: 'warning'
      })
    })()
  }

  // -------------------------------------------------------------------------------------------
  // Referrals
  // -------------------------------------------------------------------------------------------

  listReferrals(patientId: number): Referral[] {
    this.require('visits.view')
    return this.deps.referrals.listForPatient(patientId)
  }

  createReferral(input: ReferralInput): Referral {
    this.require('visits.create')
    const patient = this.deps.patients.findById(input.patientId)
    if (!patient) throw notFound('Patient', input.patientId)
    const id = this.deps.referrals.create(input, this.deps.session.username ?? 'system')
    this.audit('referrals.create', `Referred ${patient.code} to ${input.referredToName}`, {
      entityType: 'referral',
      entityId: id,
      after: { reason: input.reason }
    })
    return this.deps.referrals
      .listForPatient(input.patientId)
      .find((referral) => referral.id === id) as Referral
  }

  updateReferralStatus(id: number, status: Referral['status'], outcome: string | null): void {
    this.require('visits.edit')
    this.deps.referrals.updateStatus(id, status, outcome, this.deps.session.username ?? 'system')
    this.audit('referrals.update', `Referral #${id} marked ${status}`, {
      entityType: 'referral',
      entityId: id
    })
  }

  // -------------------------------------------------------------------------------------------
  // Appointments
  // -------------------------------------------------------------------------------------------

  listAppointments(query: AppointmentQuery): Paged<AppointmentSummary> {
    this.require('appointments.view')
    return this.deps.appointments.list(query)
  }

  getAppointment(id: number): AppointmentSummary {
    this.require('appointments.view')
    const appointment = this.deps.appointments.findById(id)
    if (!appointment) throw notFound('Appointment', id)
    return appointment
  }

  createAppointment(input: AppointmentInput): AppointmentSummary {
    this.require('appointments.create')
    const patient = this.deps.patients.findById(input.patientId)
    if (!patient)
      throw validationError('Choose a patient.', [{ field: 'patientId', message: 'Unknown patient.' }])
    const dentist = this.deps.dentists.findById(input.dentistId)
    if (!dentist || !dentist.isActive) {
      throw validationError('Choose an active dentist.', [
        { field: 'dentistId', message: 'Unknown dentist.' }
      ])
    }
    if (this.hasClash(input.dentistId, input.appointmentDate, input.startTime, null)) {
      throw conflict('This dentist already has an appointment at that time. Choose another slot.')
    }
    const id = this.deps.appointments.create(input, this.deps.session.username ?? 'system')
    this.audit(
      'appointments.create',
      `Booked appointment for ${patient.code} on ${input.appointmentDate} ${input.startTime}`,
      {
        entityType: 'appointment',
        entityId: id
      }
    )
    return this.deps.appointments.findById(id) as AppointmentSummary
  }

  private hasClash(dentistId: number, date: string, startTime: string, excludeId: number | null): boolean {
    const row = this.deps.db
      .prepare(
        `SELECT COUNT(*) AS count FROM appointments
          WHERE dentist_id = ? AND appointment_date = ? AND start_time = ? AND deleted_at IS NULL
            AND status NOT IN ('cancelled','no_show','rescheduled') AND (? IS NULL OR id <> ?)`
      )
      .get(dentistId, date, startTime, excludeId, excludeId) as { count: number }
    return row.count > 0
  }

  updateAppointment(id: number, input: AppointmentInput): AppointmentSummary {
    this.require('appointments.edit')
    const existing = this.deps.appointments.findById(id)
    if (!existing) throw notFound('Appointment', id)
    if (existing.status === 'completed') {
      throw conflict('Completed appointments cannot be edited. Use reschedule to book a new slot.')
    }
    if (this.hasClash(input.dentistId, input.appointmentDate, input.startTime, id)) {
      throw conflict('This dentist already has an appointment at that time. Choose another slot.')
    }
    this.deps.appointments.update(id, input, this.deps.session.username ?? 'system')
    this.audit('appointments.update', `Updated appointment #${id}`, {
      entityType: 'appointment',
      entityId: id,
      before: { date: existing.appointmentDate, time: existing.startTime, status: existing.status },
      after: { date: input.appointmentDate, time: input.startTime }
    })
    return this.deps.appointments.findById(id) as AppointmentSummary
  }

  setAppointmentStatus(id: number, status: AppointmentStatus, reason: string | null): AppointmentSummary {
    if (status === 'cancelled') this.require('appointments.cancel')
    else this.require('appointments.edit')
    const existing = this.deps.appointments.findById(id)
    if (!existing) throw notFound('Appointment', id)
    this.deps.appointments.setStatus(id, status, reason, this.deps.session.username ?? 'system')
    if (status === 'arrived') {
      const alreadyQueued = this.deps.queue.activeEntryForPatient(
        existing.patientId,
        existing.appointmentDate
      )
      if (!alreadyQueued) {
        this.deps.queue.add(
          {
            patientId: existing.patientId,
            appointmentId: id,
            dentistId: existing.dentistId,
            queueDate: existing.appointmentDate
          },
          this.deps.session.username ?? 'system'
        )
      }
    }
    this.audit('appointments.status', `Appointment #${id} marked ${status}`, {
      entityType: 'appointment',
      entityId: id,
      before: { status: existing.status },
      after: { status, reason }
    })
    return this.deps.appointments.findById(id) as AppointmentSummary
  }

  rescheduleAppointment(
    id: number,
    input: {
      appointmentDate: string
      startTime: string
      endTime?: string | null
      dentistId?: number
      reason?: string | null
    }
  ): AppointmentSummary {
    this.require('appointments.edit')
    const existing = this.deps.appointments.findById(id)
    if (!existing) throw notFound('Appointment', id)
    if (this.hasClash(input.dentistId ?? existing.dentistId, input.appointmentDate, input.startTime, null)) {
      throw conflict('This dentist already has an appointment at that time. Choose another slot.')
    }
    const newId = this.deps.appointments.reschedule(
      id,
      {
        appointmentDate: input.appointmentDate,
        startTime: input.startTime,
        endTime: input.endTime ?? existing.endTime,
        dentistId: input.dentistId
      },
      this.deps.session.username ?? 'system'
    )
    this.audit(
      'appointments.reschedule',
      `Rescheduled appointment #${id} to ${input.appointmentDate} ${input.startTime}`,
      {
        entityType: 'appointment',
        entityId: newId,
        before: { date: existing.appointmentDate, time: existing.startTime },
        after: { date: input.appointmentDate, time: input.startTime, reason: input.reason ?? null }
      }
    )
    return this.deps.appointments.findById(newId) as AppointmentSummary
  }

  deleteAppointment(id: number): void {
    this.require('appointments.delete')
    const existing = this.deps.appointments.findById(id)
    if (!existing) throw notFound('Appointment', id)
    this.deps.appointments.softDelete(id, this.deps.session.username ?? 'system')
    this.audit('appointments.delete', `Deleted appointment #${id}`, {
      entityType: 'appointment',
      entityId: id,
      severity: 'critical'
    })
  }

  // -------------------------------------------------------------------------------------------
  // Queue
  // -------------------------------------------------------------------------------------------

  getQueue(date?: string): QueueSnapshot {
    this.require('queue.view')
    const snapshot = this.deps.queue.snapshot(date)
    const avgMinutes = snapshot.averageWaitMinutes ?? 12
    const waiting = snapshot.entries.filter(
      (entry) => entry.status === 'waiting' || entry.status === 'called'
    )
    waiting.forEach((entry, index) => {
      entry.estimatedWaitMinutes = Math.max(0, index * avgMinutes)
    })
    return snapshot
  }

  addToQueue(input: {
    patientId: number
    appointmentId?: number | null
    dentistId?: number | null
    priority?: 'normal' | 'urgent' | 'emergency'
    notes?: string | null
  }): QueueSnapshot {
    this.require('queue.manage')
    const patient = this.deps.patients.findById(input.patientId)
    if (!patient) throw notFound('Patient', input.patientId)
    const queueDate = todayIso()
    const existing = this.deps.queue.activeEntryForPatient(input.patientId, queueDate)
    if (existing) throw conflict('This patient is already waiting in the queue.')
    if (input.priority && input.priority !== 'normal') this.require('queue.priority')
    this.deps.queue.add({ ...input, queueDate }, this.deps.session.username ?? 'system')
    this.audit('queue.add', `Added ${patient.code} to the queue`, {
      entityType: 'queue',
      entityId: input.patientId
    })
    return this.getQueue()
  }

  updateQueueEntry(
    id: number,
    patch: {
      status?: QueueStatus
      priority?: 'normal' | 'urgent' | 'emergency'
      dentistId?: number | null
      notes?: string | null
    }
  ): QueueSnapshot {
    this.require('queue.manage')
    if (patch.priority && patch.priority !== 'normal') this.require('queue.priority')
    this.deps.queue.update(id, patch, this.deps.session.username ?? 'system')
    this.audit('queue.update', `Queue entry #${id} set to ${patch.status ?? 'unchanged'}`, {
      entityType: 'queue',
      entityId: id
    })
    return this.getQueue()
  }

  reorderQueue(date: string, orderedIds: number[]): QueueSnapshot {
    this.require('queue.reorder')
    this.deps.queue.reorder(date, orderedIds, this.deps.session.username ?? 'system')
    this.audit('queue.reorder', `Reordered the queue for ${date}`, { entityType: 'queue', entityId: null })
    return this.getQueue(date)
  }

  // -------------------------------------------------------------------------------------------
  // Treatment catalogue and clinical option lists
  // -------------------------------------------------------------------------------------------

  listConditions(): import('@shared/types').DentalCondition[] {
    this.require('chart.view')
    const rows = this.deps.db
      .prepare('SELECT * FROM dental_conditions WHERE is_active = 1 ORDER BY category, sort_order, name')
      .all() as Record<string, string | number>[]
    return rows.map((row) => ({
      id: row.id as number,
      code: row.code as string,
      name: row.name as string,
      color: row.color as string,
      textColor: row.text_color as string,
      category: row.category as import('@shared/types').DentalCondition['category'],
      appliesTo: row.applies_to as import('@shared/types').DentalCondition['appliesTo'],
      isActive: Number(row.is_active) === 1,
      sortOrder: row.sort_order as number,
      isSystemDefault: Number(row.is_system_default) === 1
    }))
  }

  listTreatments(query: {
    search?: string | null
    category?: string | null
    includeInactive?: boolean
    page?: number
    pageSize?: number
  }): Paged<import('@shared/types').Treatment> {
    this.require('treatments.view')
    return this.deps.treatments.list(query)
  }

  saveTreatment(
    input: import('@shared/types').TreatmentInput & { id?: number }
  ): import('@shared/types').Treatment {
    this.require('treatments.manage')
    const problems: { field: string; message: string }[] = []
    if (input.name.trim().length < 2) problems.push({ field: 'name', message: 'Enter the treatment name.' })
    if (input.category.trim().length < 2) problems.push({ field: 'category', message: 'Enter a category.' })
    if (input.defaultFeePoisha < 0)
      problems.push({ field: 'defaultFeePoisha', message: 'Fee cannot be negative.' })
    if (problems.length > 0) throw validationError('The treatment details are incomplete.', problems)

    const actor = this.deps.session.username ?? 'system'
    const before = input.id ? this.deps.treatments.findById(input.id) : null
    const treatmentId = input.id
      ? (this.deps.treatments.update(input.id, input, actor), input.id)
      : this.deps.treatments.create(input, actor)
    this.audit(
      input.id ? 'treatments.update' : 'treatments.create',
      `Saved treatment "${input.name.trim()}"`,
      {
        entityType: 'treatment',
        entityId: treatmentId,
        before: before ? { name: before.name, fee: before.defaultFeePoisha } : null,
        after: { name: input.name.trim(), fee: input.defaultFeePoisha, isActive: input.isActive }
      }
    )
    return this.deps.treatments.findById(treatmentId) as import('@shared/types').Treatment
  }

  deactivateTreatment(id: number): void {
    this.require('treatments.manage')
    const treatment = this.deps.treatments.findById(id)
    if (!treatment) throw notFound('Treatment', id)
    this.deps.treatments.deactivate(id, this.deps.session.username ?? 'system')
    this.audit('treatments.deactivate', `Deactivated treatment "${treatment.name}"`, {
      entityType: 'treatment',
      entityId: id,
      before: { name: treatment.name },
      after: { isActive: false },
      severity: 'warning'
    })
  }

  /** Clinical option lists (chief complaints, advice, examination findings, medicine types…). */
  clinicalOptions(listCode?: string): import('@shared/types').ClinicalOption[] {
    this.require('visits.view')
    const rows = this.deps.db
      .prepare(
        `SELECT * FROM clinical_options WHERE is_active = 1 ${listCode ? 'AND list_code = ?' : ''}
          ORDER BY list_code, sort_order, value`
      )
      .all(...(listCode ? [listCode] : [])) as Record<string, string | number | null>[]
    return rows.map((row) => ({
      id: row.id as number,
      listCode: row.list_code as string,
      value: row.value as string,
      valueBn: (row.value_bn as string) ?? null,
      sortOrder: row.sort_order as number,
      isActive: Number(row.is_active) === 1,
      isSystemDefault: Number(row.is_system_default) === 1
    }))
  }

  /** Create or update a clinical option list entry (settings → clinical lists). */
  saveClinicalOption(input: {
    id?: number
    listCode: string
    value: string
    valueBn?: string | null
    sortOrder?: number
    isActive?: boolean
  }): import('@shared/types').ClinicalOption {
    this.require('treatments.manage')
    const now = new Date().toISOString()
    let id: number
    if (input.id) {
      this.deps.db
        .prepare(
          'UPDATE clinical_options SET value = ?, value_bn = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?'
        )
        .run(
          input.value,
          input.valueBn ?? null,
          input.sortOrder ?? 0,
          input.isActive === false ? 0 : 1,
          now,
          input.id
        )
      id = input.id
    } else {
      const result = this.deps.db
        .prepare(
          `INSERT INTO clinical_options (list_code, value, value_bn, sort_order, is_active, is_system_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(
          input.listCode,
          input.value,
          input.valueBn ?? null,
          input.sortOrder ?? 999,
          input.isActive === false ? 0 : 1,
          now,
          now
        )
      id = Number(result.lastInsertRowid)
    }
    const option = this.clinicalOptions(undefined).find((entry) => entry.id === id)
    if (!option) throw notFound('Clinical option', id)
    this.audit('clinical_option.save', `Saved clinical list entry "${input.value}" (${input.listCode})`, {
      entityType: 'clinical_option',
      entityId: id,
      after: { listCode: input.listCode, value: input.value, valueBn: input.valueBn ?? null }
    })
    return option
  }

  /** Deactivate a clinical option list entry — history keeps referring to it, new entries cannot pick it. */
  deactivateClinicalOption(id: number): void {
    this.require('treatments.manage')
    const option = this.clinicalOptions(undefined).find((entry) => entry.id === id)
    if (!option) throw notFound('Clinical option', id)
    if (option.isSystemDefault) {
      throw validationError('Built-in list entries can be renamed but not removed.')
    }
    this.deps.db
      .prepare('UPDATE clinical_options SET is_active = 0, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id)
    this.audit('clinical_option.deactivate', `Deactivated clinical list entry "${option.value}"`, {
      entityType: 'clinical_option',
      entityId: id,
      before: { value: option.value, isActive: true },
      after: { value: option.value, isActive: false },
      severity: 'warning'
    })
  }

  // -------------------------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------------------------

  getDashboard(): DashboardWidgetData {
    this.require('dashboard.view')
    const today = todayIso()
    const appointments = this.deps.appointments.countToday()
    const queue = this.deps.queue.snapshot(today)
    const newPatients = Number(
      (
        this.deps.db
          .prepare(
            "SELECT COUNT(*) AS count FROM patients WHERE date(created_at) = date('now','localtime') AND deleted_at IS NULL"
          )
          .get() as { count: number }
      ).count
    )
    const patientsSeen = Number(
      (
        this.deps.db
          .prepare(
            "SELECT COUNT(DISTINCT patient_id) AS count FROM visits WHERE visit_date = date('now','localtime') AND deleted_at IS NULL"
          )
          .get() as { count: number }
      ).count
    )
    const revenueRow = this.deps.db
      .prepare(
        `SELECT COALESCE(SUM(total_poisha), 0) AS revenue FROM invoices
          WHERE invoice_date = date('now','localtime') AND status <> 'void'`
      )
      .get() as { revenue: number }
    const collected = this.deps.payments.collectedBetween(today, today)
    const trend: DashboardWidgetData['revenueTrend'] = []
    const trendRows = this.deps.db
      .prepare(
        `SELECT d.day AS date,
                COALESCE((SELECT SUM(total_poisha) FROM invoices i WHERE i.invoice_date = d.day AND i.status <> 'void'), 0) AS revenue,
                COALESCE((SELECT SUM(CASE WHEN p.kind = 'refund' THEN -p.amount_poisha ELSE p.amount_poisha END)
                            FROM payments p WHERE date(p.received_at) = d.day AND p.voided_at IS NULL), 0) AS collected
           FROM (SELECT date('now','localtime', '-13 days') AS day
                 UNION ALL SELECT date('now','localtime','-12 days')
                 UNION ALL SELECT date('now','localtime','-11 days')
                 UNION ALL SELECT date('now','localtime','-10 days')
                 UNION ALL SELECT date('now','localtime','-9 days')
                 UNION ALL SELECT date('now','localtime','-8 days')
                 UNION ALL SELECT date('now','localtime','-7 days')
                 UNION ALL SELECT date('now','localtime','-6 days')
                 UNION ALL SELECT date('now','localtime','-5 days')
                 UNION ALL SELECT date('now','localtime','-4 days')
                 UNION ALL SELECT date('now','localtime','-3 days')
                 UNION ALL SELECT date('now','localtime','-2 days')
                 UNION ALL SELECT date('now','localtime','-1 days')
                 UNION ALL SELECT date('now','localtime')) d
          ORDER BY d.day`
      )
      .all() as { date: string; revenue: number; collected: number }[]
    for (const row of trendRows) {
      trend.push({
        date: row.date,
        revenuePoisha: Number(row.revenue),
        collectedPoisha: Number(row.collected)
      })
    }

    const lowStock = this.deps.session.hasPermission('inventory.view') ? this.deps.inventory.lowStock(6) : []
    const expiring = this.deps.session.hasPermission('inventory.view')
      ? this.deps.inventory.expiring(90, 6)
      : []
    const recentPatients = this.deps.patients.list({ page: 1, pageSize: 6, range: 'all' }).rows

    const settings = this.deps.settings.get()
    return {
      kpis: {
        date: today,
        appointmentsTotal: appointments.total,
        appointmentsCompleted: appointments.completed,
        appointmentsPending: appointments.pending,
        appointmentsMissed: appointments.missed,
        appointmentsUpcoming: appointments.upcoming,
        newPatientsToday: newPatients,
        patientsSeenToday: patientsSeen,
        queueWaiting: queue.waitingCount,
        queueInTreatment: queue.inTreatmentCount,
        revenueTodayPoisha: Number(revenueRow.revenue),
        collectedTodayPoisha: collected,
        outstandingTotalPoisha: this.deps.session.hasPermission('invoices.view')
          ? this.deps.invoices.totalOutstanding()
          : 0,
        lowStockCount: lowStock.length,
        expiringCount: expiring.length,
        expiredCount: this.deps.inventory.expiredCount()
      },
      revenueTrend: trend,
      paymentMethods: this.deps.payments.methodBreakdown(today, today),
      upcomingAppointments: this.deps.appointments.list({ view: 'upcoming', pageSize: 6, page: 1 }).rows,
      recentPatients,
      recentActivity: this.deps.audit.recent(8),
      lowStockItems: lowStock,
      expiringItems: expiring,
      widgets: (settings as unknown as { dashboardWidgets?: string[] }).dashboardWidgets ?? [
        'todayAppointments',
        'todayPatients',
        'todayCompleted',
        'todayPending',
        'todayMissed',
        'queueCount',
        'todayRevenue',
        'todayCollected',
        'outstandingDues',
        'lowStock',
        'expiringStock',
        'revenueTrend',
        'paymentMethods',
        'upcomingAppointments',
        'recentPatients',
        'recentActivity',
        'quickActions'
      ]
    }
  }

  /** Smart search used by the header command bar (patients first, then operational records). */
  globalSearch(
    query: string,
    entityTypes: string[] | undefined,
    limit: number
  ): import('@shared/types').SearchResults {
    this.require('patients.view')
    const startedAt = Date.now()
    const term = query.trim()
    if (term.length === 0) return { query: term, hits: [], grouped: [], tookMs: 0 }
    const hits: import('@shared/types').SearchHit[] = []
    const canSeeFinance = this.deps.session.hasPermission('invoices.view')
    const wanted = (type: string): boolean =>
      !entityTypes || entityTypes.length === 0 || entityTypes.includes(type)

    if (wanted('patients')) {
      for (const patient of this.deps.patients.list({ search: term, pageSize: limit, range: 'all' }).rows) {
        hits.push({
          entityType: 'patients',
          entityId: patient.id,
          title: patient.fullName,
          subtitle: `${patient.code}${patient.phone ? ` · ${patient.phone}` : ''}`,
          meta: patient.lastVisitDate ? `Last visit ${patient.lastVisitDate}` : 'New patient',
          route: `/patients/${patient.id}`
        })
      }
    }
    if (wanted('invoices') && canSeeFinance) {
      for (const invoice of this.deps.invoices.list({ search: term, page: 1, pageSize: limit }).rows) {
        hits.push({
          entityType: 'invoices',
          entityId: invoice.id,
          title: invoice.invoiceNo,
          subtitle: `${invoice.patientName} · ${invoice.patientCode}`,
          meta: `${invoice.status} · balance ${(invoice.balancePoisha / 100).toFixed(2)}`,
          route: `/invoices/${invoice.id}`
        })
      }
    }
    if (wanted('payments') && canSeeFinance) {
      for (const payment of this.deps.payments.list({ search: term, page: 1, pageSize: limit, range: 'all' })
        .rows) {
        hits.push({
          entityType: 'payments',
          entityId: payment.id,
          title: payment.receiptNo,
          subtitle: `${payment.patientName} · ${payment.methodName}`,
          meta: `${(payment.amountPoisha / 100).toFixed(2)} on ${payment.receivedAt.slice(0, 10)}`,
          route: `/payments`
        })
      }
    }
    if (wanted('prescriptions')) {
      for (const prescription of this.deps.prescriptions.list({ search: term, pageSize: limit, page: 1 })
        .rows) {
        hits.push({
          entityType: 'prescriptions',
          entityId: prescription.id,
          title: `Prescription #${prescription.id}`,
          subtitle: `${prescription.patientName} · ${prescription.patientCode}`,
          meta: prescription.prescriptionDate,
          route: `/prescriptions/${prescription.id}`
        })
      }
    }
    if (wanted('appointments')) {
      for (const appointment of this.deps.appointments.list({
        view: 'all',
        search: term,
        page: 1,
        pageSize: limit
      }).rows) {
        hits.push({
          entityType: 'appointments',
          entityId: appointment.id,
          title: `${appointment.patientName}`,
          subtitle: `${appointment.appointmentDate} ${appointment.startTime} · ${appointment.dentistName}`,
          meta: appointment.status.replace('_', ' '),
          route: `/appointments`
        })
      }
    }
    if (wanted('treatments')) {
      for (const treatment of this.deps.treatments.list({ search: term, page: 1, pageSize: limit }).rows) {
        hits.push({
          entityType: 'treatments',
          entityId: treatment.id,
          title: treatment.name,
          subtitle: treatment.category,
          meta: `${(treatment.defaultFeePoisha / 100).toFixed(2)}`,
          route: '/treatments'
        })
      }
    }
    if (wanted('inventory') && this.deps.session.hasPermission('inventory.view')) {
      for (const item of this.deps.inventory.list({ search: term, page: 1, pageSize: limit }).rows) {
        hits.push({
          entityType: 'inventory',
          entityId: item.id,
          title: item.name,
          subtitle: item.category ?? '',
          meta: `${(item.quantityMilli / 1000).toFixed(2)} ${item.unit} in stock`,
          route: '/inventory'
        })
      }
    }

    const labels: Record<string, string> = {
      patients: 'Patients',
      invoices: 'Invoices',
      payments: 'Payments',
      prescriptions: 'Prescriptions',
      appointments: 'Appointments',
      treatments: 'Treatments',
      inventory: 'Inventory'
    }
    const grouped = Object.entries(
      hits.reduce<Record<string, import('@shared/types').SearchHit[]>>((acc, hit) => {
        acc[hit.entityType] = [...(acc[hit.entityType] ?? []), hit]
        return acc
      }, {})
    ).map(([entityType, groupHits]) => ({
      entityType,
      label: labels[entityType] ?? entityType,
      hits: groupHits
    }))

    return { query: term, hits, grouped, tookMs: Date.now() - startedAt }
  }

  /** Notification centre reads. */
  listNotifications(onlyUnread = false, limit = 50): import('@shared/types').Notification[] {
    this.require('notifications.view')
    return this.deps.notifications.list({ onlyUnread, limit })
  }

  notificationCount(): number {
    if (!this.deps.session.hasPermission('notifications.view')) return 0
    return this.deps.notifications.unreadCount()
  }

  markNotificationRead(id: number): void {
    this.require('notifications.view')
    this.deps.notifications.markRead(id)
  }

  markAllNotificationsRead(): void {
    this.require('notifications.view')
    this.deps.notifications.markAllRead()
  }

  dismissNotification(id: number): void {
    this.require('notifications.manage')
    this.deps.notifications.dismiss(id)
  }

  /** Recompute derived notifications (appointments, stock, dues) — called on a timer and on demand. */
  refreshNotifications(): void {
    const settings = this.deps.settings.get()
    if (!settings.notificationsEnabled) return
    const today = todayIso()
    const upcoming = this.deps.appointments.list({ view: 'today', pageSize: 200, page: 1 }).rows
    const soon = upcoming.filter((appointment) => {
      if (!['scheduled', 'confirmed'].includes(appointment.status)) return false
      const [hour, minute] = appointment.startTime.split(':').map(Number) as [number, number]
      const start = new Date()
      start.setHours(hour, minute, 0, 0)
      const diffMinutes = (start.getTime() - Date.now()) / 60000
      return diffMinutes > 0 && diffMinutes <= settings.appointmentReminderMinutes
    })
    for (const appointment of soon) {
      this.deps.notifications.create({
        category: 'appointment',
        priority: 'info',
        title: `Appointment soon: ${appointment.patientName}`,
        body: `${appointment.startTime} with ${appointment.dentistName}`,
        entityType: 'appointment',
        entityId: appointment.id,
        actionType: 'open_appointment',
        dedupeKey: `appointment-reminder-${appointment.id}-${today}-${appointment.startTime}`
      })
    }
    if (settings.notifyMissedAppointments) {
      const missed = this.deps.appointments.list({ view: 'no_show', pageSize: 20, page: 1 }).rows
      for (const appointment of missed) {
        this.deps.notifications.create({
          category: 'appointment',
          priority: 'warning',
          title: `Missed appointment: ${appointment.patientName}`,
          body: `${appointment.appointmentDate} at ${appointment.startTime}`,
          entityType: 'appointment',
          entityId: appointment.id,
          dedupeKey: `missed-${appointment.id}`
        })
      }
    }
    if (settings.inventoryLowStockAlerts) {
      for (const item of this.deps.inventory.lowStock(10)) {
        this.deps.notifications.create({
          category: 'inventory',
          priority: 'warning',
          title: `Low stock: ${item.name}`,
          body: `${(item.quantityMilli / 1000).toFixed(2)} ${item.unit} left (minimum ${(item.minStockMilli / 1000).toFixed(2)})`,
          entityType: 'inventory_item',
          entityId: item.id,
          actionType: 'open_inventory',
          dedupeKey: `low-stock-${item.id}-${today}`
        })
      }
    }
    for (const batch of this.deps.inventory.expiring(settings.inventoryExpiryWarningDays, 10)) {
      this.deps.notifications.create({
        category: 'inventory',
        priority: 'warning',
        title: `Expiring soon: ${batch.itemName}`,
        body: `Batch ${batch.batchNo ?? '—'} expires ${batch.expiryDate}`,
        entityType: 'inventory_item',
        entityId: batch.itemId,
        actionType: 'open_inventory',
        dedupeKey: `expiring-${batch.itemId}-${batch.expiryDate}`
      })
    }
    if (settings.notifyOutstandingBalances) {
      for (const row of this.deps.invoices.outstanding().slice(0, 10)) {
        if (row.outstandingPoisha < settings.outstandingBalanceThresholdPoisha) continue
        this.deps.notifications.create({
          category: 'billing',
          priority: 'warning',
          title: `Outstanding balance: ${row.patientName}`,
          body: `${(row.outstandingPoisha / 100).toFixed(2)} due across ${row.invoiceCount} invoice(s)`,
          entityType: 'patient',
          entityId: row.patientId,
          actionType: 'open_patient',
          dedupeKey: `outstanding-${row.patientId}-${today}`
        })
      }
    }
  }
}
