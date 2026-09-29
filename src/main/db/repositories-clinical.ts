/**
 * Repositories — patients, clinical records, scheduling, queue, attachments, notifications and audit.
 * SQL only; permission decisions live in the service/router layer.
 */

import { nowEpochMs, nowSql } from '@shared/date'
import { containsPattern } from '@shared/ids'
import type {
  AppointmentInput,
  AppointmentQuery,
  AppointmentSummary,
  Attachment,
  AttachmentQuery,
  AuditEntry,
  AuditQuery,
  DentalChartEntry,
  Dentist,
  Notification,
  Paged,
  Patient,
  PatientInput,
  PatientNote,
  PatientQuery,
  PatientSummary,
  PatientTimelineEntry,
  Prescription,
  PrescriptionInput,
  PrescriptionQuery,
  QueueEntry,
  QueueSnapshot,
  Referral,
  ReferralInput,
  Visit,
  VisitInput,
  VisitQuery
} from '@shared/types'
import type { AppointmentStatus, QueuePriority, QueueStatus, VisitStatus } from '@shared/constants'
import type { SqliteDatabase } from './connection'
import { computeAuditHash, serializeAuditPayload, type AuditHashRow } from '../security/audit-hash'

const NOW = (): string => nowSql()

const PATIENT_SELECT = `
  SELECT p.*,
         (SELECT MAX(v.visit_date) FROM visits v WHERE v.patient_id = p.id AND v.deleted_at IS NULL) AS last_visit_date,
         COALESCE((SELECT SUM(i.balance_poisha) FROM invoices i WHERE i.patient_id = p.id AND i.status <> 'void'), 0) AS outstanding_poisha
    FROM patients p`

function mapPatientRow(row: Record<string, unknown>): Patient {
  return {
    id: row.id as number,
    code: row.code as string,
    fullName: row.full_name as string,
    fullNameBn: (row.full_name_bn as string) ?? null,
    ageYears: (row.age_years as number | null) ?? null,
    dateOfBirth: (row.date_of_birth as string) ?? null,
    gender: (row.gender as Patient['gender']) ?? null,
    bloodGroup: (row.blood_group as string) ?? null,
    phone: row.phone as string,
    phoneAlt: (row.phone_alt as string) ?? null,
    address: (row.address as string) ?? null,
    chiefComplaint: (row.chief_complaint as string) ?? null,
    isActive: Number(row.is_active) === 1,
    isArchived: row.deleted_at != null,
    createdAt: row.created_at as string,
    lastVisitDate: (row.last_visit_date as string) ?? null,
    outstandingPoisha: Number(row.outstanding_poisha ?? 0),
    email: (row.email as string) ?? null,
    addressBn: (row.address_bn as string) ?? null,
    city: (row.city as string) ?? null,
    occupation: (row.occupation as string) ?? null,
    maritalStatus: (row.marital_status as string) ?? null,
    nationalId: (row.national_id as string) ?? null,
    guardianName: (row.guardian_name as string) ?? null,
    emergencyName: (row.emergency_name as string) ?? null,
    emergencyPhone: (row.emergency_phone as string) ?? null,
    relationship: (row.relationship as string) ?? null,
    referralSource: (row.referral_source as string) ?? null,
    medicalHistory: (row.medical_history as string) ?? null,
    dentalHistory: (row.dental_history as string) ?? null,
    allergies: (row.allergies as string) ?? null,
    currentMedications: (row.current_medications as string) ?? null,
    notes: (row.notes as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    updatedAt: row.updated_at as string,
    updatedBy: (row.updated_by as string) ?? null
  }
}

export class PatientRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(query: PatientQuery): Paged<PatientSummary> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 25
    const where: string[] = []
    const params: Record<string, unknown> = { limit: pageSize, offset: (page - 1) * pageSize }

    // Archived (soft-deleted) and deactivated patients are hidden unless the register explicitly
    // asks for them, in which case the caller must display which state each row is in.
    if (!query.includeArchived) {
      where.push('p.deleted_at IS NULL')
      where.push('p.is_active = 1')
    }
    if (query.range && query.range !== 'all' && query.range !== 'custom') {
      where.push(`date(p.created_at) >= date(?)`)
      params.rangeFrom = rangeStart(query.range)
    }
    if (query.range === 'custom' && query.from && query.to) {
      where.push('date(p.created_at) >= date(@from) AND date(p.created_at) <= date(@to)')
      params.from = query.from
      params.to = query.to
    }
    if (query.gender) {
      where.push('p.gender = @gender')
      params.gender = query.gender
    }
    if (query.search && query.search.trim() !== '') {
      where.push(
        `(p.code LIKE @search ESCAPE '\\' OR p.full_name LIKE @search ESCAPE '\\' OR p.full_name_bn LIKE @search ESCAPE '\\'
          OR p.phone LIKE @search ESCAPE '\\' OR p.phone_alt LIKE @search ESCAPE '\\' OR p.national_id LIKE @search ESCAPE '\\')`
      )
      params.search = containsPattern(query.search.trim())
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number(
      (
        this.db.prepare(`SELECT COUNT(*) AS count FROM patients p ${whereSql}`).get(params) as {
          count: number
        }
      ).count
    )
    const rows = this.db
      .prepare(
        `${PATIENT_SELECT} ${whereSql}
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT @limit OFFSET @offset`
      )
      .all(params) as Record<string, unknown>[]

    return {
      rows: rows.map((row) => {
        const patient = mapPatientRow(row)
        const { email: _email, ...summary } = patient
        void _email
        return summary as PatientSummary
      }),
      total,
      page,
      pageSize
    }
  }

  findById(id: number): Patient | null {
    const row = this.db.prepare(`${PATIENT_SELECT} WHERE p.id = ?`).get(id) as
      Record<string, unknown> | undefined
    return row ? mapPatientRow(row) : null
  }

  findByCode(code: string): Patient | null {
    const row = this.db.prepare(`${PATIENT_SELECT} WHERE p.code = ? COLLATE NOCASE`).get(code) as
      Record<string, unknown> | undefined
    return row ? mapPatientRow(row) : null
  }

  findByPhone(phone: string): Patient | null {
    const row = this.db
      .prepare(`${PATIENT_SELECT} WHERE p.phone = ? OR p.phone_alt = ?`)
      .get(phone, phone) as Record<string, unknown> | undefined
    return row ? mapPatientRow(row) : null
  }

  create(code: string, input: PatientInput, actor: string): number {
    const result = this.db
      .prepare(
        `INSERT INTO patients (code, full_name, full_name_bn, date_of_birth, age_years, gender, blood_group, phone,
                               phone_alt, email, address, address_bn, city, occupation, marital_status, national_id,
                               guardian_name, emergency_name, emergency_phone, relationship, referral_source,
                               chief_complaint, medical_history, dental_history, allergies, current_medications,
                               notes, is_active, created_at, created_by, updated_at, updated_by)
         VALUES (@code, @fullName, @fullNameBn, @dateOfBirth, @ageYears, @gender, @bloodGroup, @phone,
                 @phoneAlt, @email, @address, @addressBn, @city, @occupation, @maritalStatus, @nationalId,
                 @guardianName, @emergencyName, @emergencyPhone, @relationship, @referralSource,
                 @chiefComplaint, @medicalHistory, @dentalHistory, @allergies, @currentMedications,
                 @notes, 1, @createdAt, @createdBy, @updatedAt, @updatedBy)`
      )
      .run({
        code,
        fullName: input.fullName,
        fullNameBn: input.fullNameBn ?? null,
        dateOfBirth: input.dateOfBirth ?? null,
        ageYears: input.ageYears ?? null,
        gender: input.gender ?? null,
        bloodGroup: input.bloodGroup ?? null,
        phone: input.phone,
        phoneAlt: input.phoneAlt ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        addressBn: input.addressBn ?? null,
        city: input.city ?? null,
        occupation: input.occupation ?? null,
        maritalStatus: input.maritalStatus ?? null,
        nationalId: input.nationalId ?? null,
        guardianName: input.guardianName ?? null,
        emergencyName: input.emergencyName ?? null,
        emergencyPhone: input.emergencyPhone ?? null,
        relationship: input.relationship ?? null,
        referralSource: input.referralSource ?? null,
        chiefComplaint: input.chiefComplaint ?? null,
        medicalHistory: input.medicalHistory ?? null,
        dentalHistory: input.dentalHistory ?? null,
        allergies: input.allergies ?? null,
        currentMedications: input.currentMedications ?? null,
        notes: input.notes ?? null,
        createdAt: NOW(),
        createdBy: actor,
        updatedAt: NOW(),
        updatedBy: actor
      })
    return Number(result.lastInsertRowid)
  }

  update(id: number, input: PatientInput, actor: string): void {
    this.db
      .prepare(
        `UPDATE patients SET full_name = @fullName, full_name_bn = @fullNameBn, date_of_birth = @dateOfBirth,
                age_years = @ageYears, gender = @gender, blood_group = @bloodGroup, phone = @phone,
                phone_alt = @phoneAlt, email = @email, address = @address, address_bn = @addressBn, city = @city,
                occupation = @occupation, marital_status = @maritalStatus, national_id = @nationalId,
                guardian_name = @guardianName, emergency_name = @emergencyName, emergency_phone = @emergencyPhone,
                relationship = @relationship, referral_source = @referralSource, chief_complaint = @chiefComplaint,
                medical_history = @medicalHistory, dental_history = @dentalHistory, allergies = @allergies,
                current_medications = @currentMedications, notes = @notes, is_active = @isActive,
                updated_at = @updatedAt, updated_by = @updatedBy
          WHERE id = @id`
      )
      .run({
        id,
        fullName: input.fullName,
        fullNameBn: input.fullNameBn ?? null,
        dateOfBirth: input.dateOfBirth ?? null,
        ageYears: input.ageYears ?? null,
        gender: input.gender ?? null,
        bloodGroup: input.bloodGroup ?? null,
        phone: input.phone,
        phoneAlt: input.phoneAlt ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        addressBn: input.addressBn ?? null,
        city: input.city ?? null,
        occupation: input.occupation ?? null,
        maritalStatus: input.maritalStatus ?? null,
        nationalId: input.nationalId ?? null,
        guardianName: input.guardianName ?? null,
        emergencyName: input.emergencyName ?? null,
        emergencyPhone: input.emergencyPhone ?? null,
        relationship: input.relationship ?? null,
        referralSource: input.referralSource ?? null,
        chiefComplaint: input.chiefComplaint ?? null,
        medicalHistory: input.medicalHistory ?? null,
        dentalHistory: input.dentalHistory ?? null,
        allergies: input.allergies ?? null,
        currentMedications: input.currentMedications ?? null,
        notes: input.notes ?? null,
        isActive: input.isActive === false ? 0 : 1,
        updatedAt: NOW(),
        updatedBy: actor
      })
  }

  archive(id: number, actor: string): void {
    this.db
      .prepare('UPDATE patients SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .run(NOW(), NOW(), actor, id)
  }

  /** Undo an archive. The record itself was never deleted, so restoring is an exact reversal. */
  restore(id: number, actor: string): void {
    this.db
      .prepare('UPDATE patients SET deleted_at = NULL, updated_at = ?, updated_by = ? WHERE id = ?')
      .run(NOW(), actor, id)
  }

  counts(patientId: number): {
    visits: number
    appointments: number
    prescriptions: number
    invoices: number
    payments: number
    attachments: number
    referrals: number
  } {
    const one = (sql: string): number =>
      Number((this.db.prepare(sql).get(patientId) as { count: number }).count)
    return {
      visits: one('SELECT COUNT(*) AS count FROM visits WHERE patient_id = ? AND deleted_at IS NULL'),
      appointments: one(
        'SELECT COUNT(*) AS count FROM appointments WHERE patient_id = ? AND deleted_at IS NULL'
      ),
      prescriptions: one('SELECT COUNT(*) AS count FROM prescriptions WHERE patient_id = ?'),
      invoices: one("SELECT COUNT(*) AS count FROM invoices WHERE patient_id = ? AND status <> 'void'"),
      payments: one('SELECT COUNT(*) AS count FROM payments WHERE patient_id = ? AND voided_at IS NULL'),
      attachments: one(
        'SELECT COUNT(*) AS count FROM attachments WHERE patient_id = ? AND deleted_at IS NULL'
      ),
      referrals: one('SELECT COUNT(*) AS count FROM referrals WHERE patient_id = ?')
    }
  }

  notes(patientId: number): PatientNote[] {
    const rows = this.db
      .prepare('SELECT * FROM patient_notes WHERE patient_id = ? ORDER BY created_at DESC, id DESC')
      .all(patientId) as Record<string, string | number>[]
    return rows.map((row) => ({
      id: row.id as number,
      patientId: row.patient_id as number,
      note: row.note as string,
      createdAt: row.created_at as string,
      createdBy: (row.created_by as string) ?? null
    }))
  }

  addNote(patientId: number, note: string, actor: string): number {
    const result = this.db
      .prepare('INSERT INTO patient_notes (patient_id, note, created_at, created_by) VALUES (?, ?, ?, ?)')
      .run(patientId, note, NOW(), actor)
    return Number(result.lastInsertRowid)
  }

  financialSummary(patientId: number): {
    totalInvoicedPoisha: number
    totalPaidPoisha: number
    balancePoisha: number
    invoiceCount: number
    paymentCount: number
    lastPaymentAt: string | null
  } {
    const invoices = this.db
      .prepare(
        `SELECT COALESCE(SUM(total_poisha), 0) AS total, COALESCE(SUM(paid_poisha), 0) AS paid,
                COUNT(*) AS count
           FROM invoices WHERE patient_id = ? AND status <> 'void'`
      )
      .get(patientId) as { total: number; paid: number; count: number }
    const payments = this.db
      .prepare(
        `SELECT COUNT(*) AS count, MAX(received_at) AS last FROM payments WHERE patient_id = ? AND voided_at IS NULL`
      )
      .get(patientId) as { count: number; last: string | null }
    return {
      totalInvoicedPoisha: invoices.total,
      totalPaidPoisha:
        payments.count > 0
          ? Number(
              (
                this.db
                  .prepare(
                    `SELECT COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount_poisha ELSE amount_poisha END), 0) AS value
                     FROM payments WHERE patient_id = ? AND voided_at IS NULL`
                  )
                  .get(patientId) as { value: number }
              ).value
            )
          : 0,
      balancePoisha: invoices.total - invoices.paid,
      invoiceCount: invoices.count,
      paymentCount: payments.count,
      lastPaymentAt: payments.last
    }
  }

  timeline(patientId: number): PatientTimelineEntry[] {
    const rows = this.db
      .prepare(
        `SELECT 'visit' AS type, v.id, v.visit_date || ' ' || v.visit_time AS at,
                'Visit #' || v.visit_no AS title,
                COALESCE(v.diagnosis, v.treatment_summary, v.chief_complaint) AS summary,
                NULL AS amount_poisha
           FROM visits v WHERE v.patient_id = @id AND v.deleted_at IS NULL
         UNION ALL
         SELECT 'appointment', a.id, a.appointment_date || ' ' || a.start_time,
                'Appointment - ' || replace(a.status, '_', ' '), a.reason, NULL
           FROM appointments a WHERE a.patient_id = @id AND a.deleted_at IS NULL
         UNION ALL
         SELECT 'prescription', r.id, r.prescription_date || ' 00:00', 'Prescription', r.diagnosis, NULL
           FROM prescriptions r WHERE r.patient_id = @id
         UNION ALL
         SELECT 'invoice', i.id, i.invoice_date || ' 00:00', 'Invoice ' || i.invoice_no, i.notes, i.total_poisha
           FROM invoices i WHERE i.patient_id = @id AND i.status <> 'void'
         UNION ALL
         SELECT 'payment', p.id, p.received_at, 'Payment ' || p.receipt_no, p.notes, p.amount_poisha
           FROM payments p WHERE p.patient_id = @id AND p.voided_at IS NULL
         UNION ALL
         SELECT 'referral', f.id, f.referral_date || ' 00:00', 'Referral to ' || f.referred_to_name, f.reason, NULL
           FROM referrals f WHERE f.patient_id = @id
         UNION ALL
         SELECT 'attachment', at.id, at.uploaded_at, 'Attachment: ' || COALESCE(at.title, at.original_name), at.notes, NULL
           FROM attachments at WHERE at.patient_id = @id AND at.deleted_at IS NULL
         UNION ALL
         SELECT 'note', n.id, n.created_at, 'Note', n.note, NULL
           FROM patient_notes n WHERE n.patient_id = @id
         UNION ALL
         SELECT 'registration', p.id, p.created_at, 'Patient registered', p.chief_complaint, NULL
           FROM patients p WHERE p.id = @id
         ORDER BY at DESC
         LIMIT 500`
      )
      .all({ id: patientId }) as Record<string, unknown>[]
    return rows.map((row) => ({
      id: `${row.type}-${row.id}`,
      type: row.type as string,
      at: row.at as string,
      title: row.title as string,
      summary: (row.summary as string) ?? null,
      amountPoisha: (row.amount_poisha as number | null) ?? null,
      route: null
    }))
  }

  countAll(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM patients WHERE deleted_at IS NULL').get() as {
      count: number
    }
    return row.count
  }
}

function rangeStart(range: string): string {
  const days =
    range === 'today' ? 0 : range === 'last7' ? 6 : range === 'last30' ? 29 : range === 'last90' ? 89 : 364
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------------------------
// Visits and dental chart
// ---------------------------------------------------------------------------------------------

export class VisitRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(query: VisitQuery): Paged<Visit> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 25
    const where: string[] = ['v.deleted_at IS NULL']
    const params: Record<string, unknown> = { limit: pageSize, offset: (page - 1) * pageSize }
    if (query.patientId) {
      where.push('v.patient_id = @patientId')
      params.patientId = query.patientId
    }
    if (query.dentistId) {
      where.push('v.dentist_id = @dentistId')
      params.dentistId = query.dentistId
    }
    if (query.from) {
      where.push('v.visit_date >= @from')
      params.from = query.from
    }
    if (query.to) {
      where.push('v.visit_date <= @to')
      params.to = query.to
    }
    if (query.search?.trim()) {
      where.push(
        `(v.diagnosis LIKE @search ESCAPE '\\' OR v.chief_complaint LIKE @search ESCAPE '\\'
          OR v.treatment_summary LIKE @search ESCAPE '\\' OR p.code LIKE @search ESCAPE '\\'
          OR p.full_name LIKE @search ESCAPE '\\')`
      )
      params.search = containsPattern(query.search.trim())
    }
    const whereSql = `WHERE ${where.join(' AND ')}`
    const total = Number(
      (
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM visits v JOIN patients p ON p.id = v.patient_id ${whereSql}`
          )
          .get(params) as { count: number }
      ).count
    )
    const rows = this.db
      .prepare(
        `SELECT v.*, p.code AS patient_code, p.full_name AS patient_name, d.full_name AS dentist_name
           FROM visits v
           JOIN patients p ON p.id = v.patient_id
           JOIN dentists d ON d.id = v.dentist_id
           ${whereSql}
          ORDER BY v.visit_date DESC, v.visit_time DESC, v.id DESC
          LIMIT @limit OFFSET @offset`
      )
      .all(params) as Record<string, unknown>[]

    return {
      rows: rows.map((row) => this.mapVisit(row)),
      total,
      page,
      pageSize
    }
  }

  private mapVisit(row: Record<string, unknown>): Visit {
    const id = row.id as number
    return {
      id,
      patientId: row.patient_id as number,
      patientCode: (row.patient_code as string) ?? '',
      patientName: (row.patient_name as string) ?? '',
      visitNo: row.visit_no as number,
      visitDate: row.visit_date as string,
      visitTime: row.visit_time as string,
      dentistId: row.dentist_id as number,
      dentistName: (row.dentist_name as string) ?? '',
      appointmentId: (row.appointment_id as number | null) ?? null,
      chiefComplaint: (row.chief_complaint as string) ?? null,
      symptoms: (row.symptoms as string) ?? null,
      examination: (row.examination as string) ?? null,
      diagnosis: (row.diagnosis as string) ?? null,
      treatmentSummary: (row.treatment_summary as string) ?? null,
      advice: (row.advice as string) ?? null,
      followUpDate: (row.follow_up_date as string) ?? null,
      notes: (row.notes as string) ?? null,
      status: row.status as VisitStatus,
      finalizedAt: (row.finalized_at as string) ?? null,
      amendmentOfVisitId: (row.amendment_of_visit_id as number | null) ?? null,
      treatments: this.treatments(id),
      prescriptionId:
        ((
          this.db.prepare('SELECT id FROM prescriptions WHERE visit_id = ? ORDER BY id LIMIT 1').get(id) as
            { id: number } | undefined
        )?.id as number | undefined) ?? null,
      invoiceIds: (
        this.db.prepare('SELECT id FROM invoices WHERE visit_id = ?').all(id) as { id: number }[]
      ).map((invoice) => invoice.id),
      createdAt: row.created_at as string,
      createdBy: (row.created_by as string) ?? null,
      updatedAt: row.updated_at as string,
      updatedBy: (row.updated_by as string) ?? null
    }
  }

  findById(id: number): Visit | null {
    const row = this.db
      .prepare(
        `SELECT v.*, p.code AS patient_code, p.full_name AS patient_name, d.full_name AS dentist_name
           FROM visits v JOIN patients p ON p.id = v.patient_id JOIN dentists d ON d.id = v.dentist_id
          WHERE v.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined
    return row ? this.mapVisit(row) : null
  }

  treatments(visitId: number): Visit['treatments'] {
    const rows = this.db
      .prepare('SELECT * FROM visit_treatments WHERE visit_id = ? ORDER BY id')
      .all(visitId) as Record<string, string | number>[]
    return rows.map((row) => ({
      id: row.id as number,
      visitId: row.visit_id as number,
      treatmentId: (row.treatment_id as number | null) ?? null,
      treatmentName: row.treatment_name as string,
      teeth: JSON.parse((row.teeth_json as string) || '[]') as string[],
      feePoisha: row.fee_poisha as number,
      note: (row.note as string) ?? null
    }))
  }

  nextVisitNo(patientId: number): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(visit_no), 0) + 1 AS next FROM visits WHERE patient_id = ?')
      .get(patientId) as { next: number }
    return row.next
  }

  create(patientId: number, input: VisitInput, actor: string): number {
    const run = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO visits (patient_id, visit_no, visit_date, visit_time, dentist_id, appointment_id, chief_complaint,
                               symptoms, examination, diagnosis, treatment_summary, advice, follow_up_date, notes,
                               status, created_at, created_by, updated_at, updated_by)
           VALUES (@patientId, @visitNo, @visitDate, @visitTime, @dentistId, @appointmentId, @chiefComplaint,
                   @symptoms, @examination, @diagnosis, @treatmentSummary, @advice, @followUpDate, @notes,
                   'draft', @createdAt, @createdBy, @updatedAt, @updatedBy)`
        )
        .run({
          patientId,
          visitNo: this.nextVisitNo(patientId),
          visitDate: input.visitDate,
          visitTime: input.visitTime,
          dentistId: input.dentistId,
          appointmentId: input.appointmentId ?? null,
          chiefComplaint: input.chiefComplaint ?? null,
          symptoms: input.symptoms ?? null,
          examination: input.examination ?? null,
          diagnosis: input.diagnosis ?? null,
          treatmentSummary: input.treatmentSummary ?? null,
          advice: input.advice ?? null,
          followUpDate: input.followUpDate ?? null,
          notes: input.notes ?? null,
          createdAt: NOW(),
          createdBy: actor,
          updatedAt: NOW(),
          updatedBy: actor
        })
      const visitId = Number(result.lastInsertRowid)
      this.replaceTreatments(visitId, input.treatments)
      return visitId
    })
    return run()
  }

  update(id: number, input: VisitInput, actor: string): void {
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE visits SET visit_date = @visitDate, visit_time = @visitTime, dentist_id = @dentistId,
                  appointment_id = @appointmentId, chief_complaint = @chiefComplaint, symptoms = @symptoms,
                  examination = @examination, diagnosis = @diagnosis, treatment_summary = @treatmentSummary,
                  advice = @advice, follow_up_date = @followUpDate, notes = @notes,
                  updated_at = @updatedAt, updated_by = @updatedBy
            WHERE id = @id`
        )
        .run({
          id,
          visitDate: input.visitDate,
          visitTime: input.visitTime,
          dentistId: input.dentistId,
          appointmentId: input.appointmentId ?? null,
          chiefComplaint: input.chiefComplaint ?? null,
          symptoms: input.symptoms ?? null,
          examination: input.examination ?? null,
          diagnosis: input.diagnosis ?? null,
          treatmentSummary: input.treatmentSummary ?? null,
          advice: input.advice ?? null,
          followUpDate: input.followUpDate ?? null,
          notes: input.notes ?? null,
          updatedAt: NOW(),
          updatedBy: actor
        })
      this.replaceTreatments(id, input.treatments)
    })
    run()
  }

  private replaceTreatments(visitId: number, treatments: VisitInput['treatments']): void {
    this.db.prepare('DELETE FROM visit_treatments WHERE visit_id = ?').run(visitId)
    const insert = this.db.prepare(
      `INSERT INTO visit_treatments (visit_id, treatment_id, treatment_name, teeth_json, fee_poisha, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const treatment of treatments) {
      insert.run(
        visitId,
        treatment.treatmentId,
        treatment.treatmentName,
        JSON.stringify(treatment.teeth ?? []),
        treatment.feePoisha,
        treatment.note ?? null,
        NOW()
      )
    }
  }

  finalize(id: number, actor: string): void {
    this.db
      .prepare(
        `UPDATE visits SET status = CASE WHEN status = 'final' THEN 'amended' ELSE 'final' END,
                finalized_at = ?, finalized_by = ?, updated_at = ?, updated_by = ? WHERE id = ?`
      )
      .run(NOW(), actor, NOW(), actor, id)
  }

  softDelete(id: number, actor: string): void {
    this.db
      .prepare('UPDATE visits SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .run(NOW(), NOW(), actor, id)
  }

  countForPatient(patientId: number): number {
    return Number(
      (
        this.db
          .prepare('SELECT COUNT(*) AS count FROM visits WHERE patient_id = ? AND deleted_at IS NULL')
          .get(patientId) as { count: number }
      ).count
    )
  }

  recent(limit = 10): Visit[] {
    const rows = this.db
      .prepare(
        `SELECT v.*, p.code AS patient_code, p.full_name AS patient_name, d.full_name AS dentist_name
           FROM visits v JOIN patients p ON p.id = v.patient_id JOIN dentists d ON d.id = v.dentist_id
          WHERE v.deleted_at IS NULL
          ORDER BY v.visit_date DESC, v.id DESC LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[]
    return rows.map((row) => this.mapVisit(row))
  }
}

export class DentalChartRepository {
  constructor(private readonly db: SqliteDatabase) {}

  forPatient(patientId: number, visitId: number | null = null): DentalChartEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM dental_chart_entries
          WHERE patient_id = ? AND ${visitId === null ? 'visit_id IS NULL' : 'visit_id = ?'}
          ORDER BY tooth_number`
      )
      .all(...(visitId === null ? [patientId] : [patientId, visitId])) as Record<string, string | number>[]
    return rows.map((row) => ({
      id: row.id as number,
      patientId: row.patient_id as number,
      visitId: (row.visit_id as number | null) ?? null,
      toothNumber: row.tooth_number as string,
      dentition: row.dentition as DentalChartEntry['dentition'],
      conditionCode: row.condition_code as string,
      treatmentCode: (row.treatment_code as string) ?? null,
      surfaces: JSON.parse((row.surfaces_json as string) || '[]') as string[],
      status: row.status as DentalChartEntry['status'],
      note: (row.note as string) ?? null,
      updatedAt: row.updated_at as string
    }))
  }

  /** Replace the current chart state for a patient (visit_id NULL) in one transaction. */
  replaceCurrent(
    patientId: number,
    entries: {
      toothNumber: string
      dentition: DentalChartEntry['dentition']
      conditionCode: string
      treatmentCode: string | null
      surfaces: string[]
      status: DentalChartEntry['status']
      note: string | null
    }[],
    actor: string
  ): void {
    const run = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM dental_chart_entries WHERE patient_id = ? AND visit_id IS NULL')
        .run(patientId)
      const insert = this.db.prepare(
        `INSERT INTO dental_chart_entries (patient_id, visit_id, tooth_number, dentition, condition_code, treatment_code,
                                           surfaces_json, status, note, created_at, created_by, updated_at, updated_by)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const entry of entries) {
        insert.run(
          patientId,
          entry.toothNumber,
          entry.dentition,
          entry.conditionCode,
          entry.treatmentCode,
          JSON.stringify(entry.surfaces),
          entry.status,
          entry.note,
          NOW(),
          actor,
          NOW(),
          actor
        )
      }
    })
    run()
  }

  snapshotForVisit(
    visitId: number,
    patientId: number,
    entries: { toothNumber: string; conditionCode: string; surfaces: string[]; status: string }[],
    actor: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO visit_chart_snapshots (visit_id, patient_id, snapshot_json, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(visit_id) DO UPDATE SET snapshot_json = excluded.snapshot_json, created_at = excluded.created_at`
      )
      .run(visitId, patientId, JSON.stringify({ entries, takenAt: NOW(), takenBy: actor }), NOW())
  }

  snapshot(visitId: number): { entries: unknown[]; takenAt: string; takenBy: string } | null {
    const row = this.db
      .prepare('SELECT snapshot_json FROM visit_chart_snapshots WHERE visit_id = ?')
      .get(visitId) as { snapshot_json: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.snapshot_json) as { entries: unknown[]; takenAt: string; takenBy: string }
    } catch {
      return null
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Prescriptions and referrals
// ---------------------------------------------------------------------------------------------

export class PrescriptionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(query: PrescriptionQuery): Paged<Prescription> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 25
    const where: string[] = []
    const params: Record<string, unknown> = { limit: pageSize, offset: (page - 1) * pageSize }
    if (query.patientId) {
      where.push('r.patient_id = @patientId')
      params.patientId = query.patientId
    }
    if (query.dentistId) {
      where.push('r.dentist_id = @dentistId')
      params.dentistId = query.dentistId
    }
    if (query.from) {
      where.push('r.prescription_date >= @from')
      params.from = query.from
    }
    if (query.to) {
      where.push('r.prescription_date <= @to')
      params.to = query.to
    }
    if (query.status) {
      where.push('r.status = @status')
      params.status = query.status
    }
    if (query.search?.trim()) {
      where.push(
        `(p.full_name LIKE @search ESCAPE '\\' OR p.code LIKE @search ESCAPE '\\' OR r.diagnosis LIKE @search ESCAPE '\\')`
      )
      params.search = containsPattern(query.search.trim())
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number(
      (
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM prescriptions r JOIN patients p ON p.id = r.patient_id ${whereSql}`
          )
          .get(params) as { count: number }
      ).count
    )
    const rows = this.db
      .prepare(
        `SELECT r.*, p.code AS patient_code, p.full_name AS patient_name, p.date_of_birth, p.age_years, p.gender,
                d.full_name AS dentist_name
           FROM prescriptions r
           JOIN patients p ON p.id = r.patient_id
           JOIN dentists d ON d.id = r.dentist_id
           ${whereSql}
          ORDER BY r.prescription_date DESC, r.id DESC
          LIMIT @limit OFFSET @offset`
      )
      .all(params) as Record<string, unknown>[]
    return { rows: rows.map((row) => this.mapPrescription(row)), total, page, pageSize }
  }

  private mapPrescription(row: Record<string, unknown>): Prescription {
    const id = row.id as number
    return {
      id,
      patientId: row.patient_id as number,
      patientCode: (row.patient_code as string) ?? '',
      patientName: (row.patient_name as string) ?? '',
      patientAge: (row.age_years as number | null) != null ? `${row.age_years} years` : null,
      patientGender: (row.gender as Prescription['patientGender']) ?? null,
      visitId: (row.visit_id as number | null) ?? null,
      dentistId: row.dentist_id as number,
      dentistName: (row.dentist_name as string) ?? '',
      prescriptionDate: row.prescription_date as string,
      chiefComplaints: JSON.parse((row.chief_complaints_json as string) || '[]') as string[],
      onExamination: JSON.parse((row.on_examination_json as string) || '[]') as string[],
      diagnosis: (row.diagnosis as string) ?? null,
      advice: JSON.parse((row.advice_json as string) || '[]') as string[],
      followUpDate: (row.follow_up_date as string) ?? null,
      notes: (row.notes as string) ?? null,
      status: row.status as Prescription['status'],
      voidReason: (row.void_reason as string) ?? null,
      voidedAt: (row.voided_at as string) ?? null,
      printedCount: row.printed_count as number,
      lastPrintedAt: (row.last_printed_at as string) ?? null,
      items: this.items(id),
      createdAt: row.created_at as string,
      createdBy: (row.created_by as string) ?? null,
      updatedAt: row.updated_at as string,
      updatedBy: (row.updated_by as string) ?? null
    }
  }

  items(prescriptionId: number): Prescription['items'] {
    const rows = this.db
      .prepare('SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY sort_order, id')
      .all(prescriptionId) as Record<string, string | number | null>[]
    return rows.map((row) => ({
      id: row.id as number,
      sortOrder: row.sort_order as number,
      medicineName: row.medicine_name as string,
      medicineType: (row.medicine_type as string) ?? null,
      strength: (row.strength as string) ?? null,
      dose: (row.dose as string) ?? null,
      morning: (row.morning as string) ?? null,
      noon: (row.noon as string) ?? null,
      night: (row.night as string) ?? null,
      timing: (row.timing as string) ?? null,
      durationValue: (row.duration_value as number | null) ?? null,
      durationUnit: (row.duration_unit as string) ?? null,
      quantity: (row.quantity as string) ?? null,
      instruction: (row.instruction as string) ?? null,
      conditionalInstruction: (row.conditional_instruction as string) ?? null,
      notes: (row.notes as string) ?? null
    }))
  }

  findById(id: number): Prescription | null {
    const row = this.db
      .prepare(
        `SELECT r.*, p.code AS patient_code, p.full_name AS patient_name, p.age_years, p.gender, d.full_name AS dentist_name
           FROM prescriptions r JOIN patients p ON p.id = r.patient_id JOIN dentists d ON d.id = r.dentist_id
          WHERE r.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined
    return row ? this.mapPrescription(row) : null
  }

  create(input: PrescriptionInput, actor: string): number {
    const run = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO prescriptions (patient_id, visit_id, dentist_id, prescription_date, chief_complaints_json,
                                      on_examination_json, diagnosis, advice_json, follow_up_date, notes, status,
                                      created_at, created_by, updated_at, updated_by)
           VALUES (@patientId, @visitId, @dentistId, @prescriptionDate, @chiefComplaints, @onExamination, @diagnosis,
                   @advice, @followUpDate, @notes, @status, @createdAt, @createdBy, @updatedAt, @updatedBy)`
        )
        .run({
          patientId: input.patientId,
          visitId: input.visitId ?? null,
          dentistId: input.dentistId,
          prescriptionDate: input.prescriptionDate,
          chiefComplaints: JSON.stringify(input.chiefComplaints ?? []),
          onExamination: JSON.stringify(input.onExamination ?? []),
          diagnosis: input.diagnosis ?? null,
          advice: JSON.stringify(input.advice ?? []),
          followUpDate: input.followUpDate ?? null,
          notes: input.notes ?? null,
          status: input.status ?? 'draft',
          createdAt: NOW(),
          createdBy: actor,
          updatedAt: NOW(),
          updatedBy: actor
        })
      const prescriptionId = Number(result.lastInsertRowid)
      this.replaceItems(prescriptionId, input.items)
      return prescriptionId
    })
    return run()
  }

  update(id: number, input: PrescriptionInput, actor: string): void {
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE prescriptions SET patient_id = @patientId, visit_id = @visitId, dentist_id = @dentistId,
                  prescription_date = @prescriptionDate, chief_complaints_json = @chiefComplaints,
                  on_examination_json = @onExamination, diagnosis = @diagnosis, advice_json = @advice,
                  follow_up_date = @followUpDate, notes = @notes,
                  status = COALESCE(@status, status),
                  updated_at = @updatedAt, updated_by = @updatedBy
            WHERE id = @id`
        )
        .run({
          id,
          patientId: input.patientId,
          visitId: input.visitId ?? null,
          dentistId: input.dentistId,
          prescriptionDate: input.prescriptionDate,
          chiefComplaints: JSON.stringify(input.chiefComplaints ?? []),
          onExamination: JSON.stringify(input.onExamination ?? []),
          diagnosis: input.diagnosis ?? null,
          advice: JSON.stringify(input.advice ?? []),
          followUpDate: input.followUpDate ?? null,
          notes: input.notes ?? null,
          // Omitting the status keeps the stored one: editing a final sheet must not silently draft it.
          status: input.status ?? null,
          updatedAt: NOW(),
          updatedBy: actor
        })
      this.replaceItems(id, input.items)
    })
    run()
  }

  private replaceItems(prescriptionId: number, items: PrescriptionInput['items']): void {
    this.db.prepare('DELETE FROM prescription_items WHERE prescription_id = ?').run(prescriptionId)
    const insert = this.db.prepare(
      `INSERT INTO prescription_items (prescription_id, sort_order, medicine_name, medicine_type, strength, dose,
                                       morning, noon, night, timing, duration_value, duration_unit, quantity,
                                       instruction, conditional_instruction, notes)
       VALUES (@prescriptionId, @sortOrder, @medicineName, @medicineType, @strength, @dose, @morning, @noon, @night,
               @timing, @durationValue, @durationUnit, @quantity, @instruction, @conditionalInstruction, @notes)`
    )
    items.forEach((item, index) => {
      insert.run({
        prescriptionId,
        sortOrder: item.sortOrder ?? index,
        medicineName: item.medicineName,
        medicineType: item.medicineType ?? null,
        strength: item.strength ?? null,
        dose: item.dose ?? null,
        morning: item.morning ?? null,
        noon: item.noon ?? null,
        night: item.night ?? null,
        timing: item.timing ?? null,
        durationValue: item.durationValue ?? null,
        durationUnit: item.durationUnit ?? null,
        quantity: item.quantity ?? null,
        instruction: item.instruction ?? null,
        conditionalInstruction: item.conditionalInstruction ?? null,
        notes: item.notes ?? null
      })
    })
  }

  markPrinted(id: number): void {
    this.db
      .prepare('UPDATE prescriptions SET printed_count = printed_count + 1, last_printed_at = ? WHERE id = ?')
      .run(NOW(), id)
  }

  void(id: number, reason: string, actor: string): void {
    const at = NOW()
    this.db
      .prepare(
        `UPDATE prescriptions SET status = 'void', void_reason = ?, voided_at = ?,
                                  updated_at = ?, updated_by = ?
          WHERE id = ?`
      )
      .run(reason, at, at, actor, id)
  }
}

export class ReferralRepository {
  constructor(private readonly db: SqliteDatabase) {}

  listForPatient(patientId: number): Referral[] {
    const rows = this.db
      .prepare(
        `SELECT f.*, p.code AS patient_code, p.full_name AS patient_name, d.full_name AS referring_dentist_name
           FROM referrals f JOIN patients p ON p.id = f.patient_id LEFT JOIN dentists d ON d.id = f.referring_dentist_id
          WHERE f.patient_id = ? ORDER BY f.referral_date DESC, f.id DESC`
      )
      .all(patientId) as Record<string, string | number | null>[]
    return rows.map((row) => this.mapReferral(row))
  }

  search(query: string, limit = 50): Referral[] {
    const rows = this.db
      .prepare(
        `SELECT f.*, p.code AS patient_code, p.full_name AS patient_name, d.full_name AS referring_dentist_name
           FROM referrals f JOIN patients p ON p.id = f.patient_id LEFT JOIN dentists d ON d.id = f.referring_dentist_id
          WHERE f.referred_to_name LIKE ? ESCAPE '\\' OR f.reason LIKE ? ESCAPE '\\' OR p.full_name LIKE ? ESCAPE '\\'
          ORDER BY f.referral_date DESC LIMIT ?`
      )
      .all(containsPattern(query), containsPattern(query), containsPattern(query), limit) as Record<
      string,
      string | number | null
    >[]
    return rows.map((row) => this.mapReferral(row))
  }

  private mapReferral(row: Record<string, string | number | null>): Referral {
    return {
      id: row.id as number,
      patientId: row.patient_id as number,
      patientCode: (row.patient_code as string) ?? '',
      patientName: (row.patient_name as string) ?? '',
      visitId: (row.visit_id as number | null) ?? null,
      referralDate: row.referral_date as string,
      referringDentistId: (row.referring_dentist_id as number | null) ?? null,
      referringDentistName: (row.referring_dentist_name as string) ?? null,
      referredToName: row.referred_to_name as string,
      referredToInstitution: (row.referred_to_institution as string) ?? null,
      referredToPhone: (row.referred_to_phone as string) ?? null,
      reason: row.reason as string,
      notes: (row.notes as string) ?? null,
      status: row.status as Referral['status'],
      followUpDate: (row.follow_up_date as string) ?? null,
      outcome: (row.outcome as string) ?? null,
      createdAt: row.created_at as string,
      createdBy: (row.created_by as string) ?? null
    }
  }

  create(input: ReferralInput, actor: string): number {
    const result = this.db
      .prepare(
        `INSERT INTO referrals (patient_id, visit_id, referral_date, referring_dentist_id, referred_to_name,
                                referred_to_institution, referred_to_phone, reason, notes, status, follow_up_date,
                                created_at, created_by, updated_at, updated_by)
         VALUES (@patientId, @visitId, @referralDate, @referringDentistId, @referredToName, @referredToInstitution,
                 @referredToPhone, @reason, @notes, @status, @followUpDate, @createdAt, @createdBy, @updatedAt, @updatedBy)`
      )
      .run({
        patientId: input.patientId,
        visitId: input.visitId ?? null,
        referralDate: input.referralDate,
        referringDentistId: input.referringDentistId ?? null,
        referredToName: input.referredToName,
        referredToInstitution: input.referredToInstitution ?? null,
        referredToPhone: input.referredToPhone ?? null,
        reason: input.reason,
        notes: input.notes ?? null,
        status: input.status ?? 'pending',
        followUpDate: input.followUpDate ?? null,
        createdAt: NOW(),
        createdBy: actor,
        updatedAt: NOW(),
        updatedBy: actor
      })
    return Number(result.lastInsertRowid)
  }

  updateStatus(id: number, status: Referral['status'], outcome: string | null, actor: string): void {
    this.db
      .prepare('UPDATE referrals SET status = ?, outcome = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .run(status, outcome, NOW(), actor, id)
  }
}

// ---------------------------------------------------------------------------------------------
// Appointments and queue
// ---------------------------------------------------------------------------------------------

export class AppointmentRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(query: AppointmentQuery): Paged<AppointmentSummary> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 25
    const today = nowSql().slice(0, 10)
    const where: string[] = ['a.deleted_at IS NULL']
    const params: Record<string, unknown> = {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      today
    }

    switch (query.view) {
      case 'today':
        where.push('a.appointment_date = @today')
        break
      case 'upcoming':
        where.push('a.appointment_date >= @today')
        where.push("a.status IN ('scheduled','confirmed','arrived','in_queue','in_treatment')")
        break
      case 'past':
        where.push('a.appointment_date < @today')
        break
      case 'completed':
        where.push("a.status = 'completed'")
        break
      case 'no_show':
        where.push("a.status = 'no_show'")
        break
      case 'cancelled':
        where.push("a.status = 'cancelled'")
        break
      case 'rescheduled':
        where.push("a.status = 'rescheduled'")
        break
      case 'all':
      default:
        break
    }

    if (query.from) {
      where.push('a.appointment_date >= @from')
      params.from = query.from
    }
    if (query.to) {
      where.push('a.appointment_date <= @to')
      params.to = query.to
    }
    if (query.dentistId) {
      where.push('a.dentist_id = @dentistId')
      params.dentistId = query.dentistId
    }
    if (query.status) {
      where.push('a.status = @status')
      params.status = query.status
    }
    if (query.search?.trim()) {
      where.push(
        `(p.full_name LIKE @search ESCAPE '\\' OR p.code LIKE @search ESCAPE '\\' OR p.phone LIKE @search ESCAPE '\\')`
      )
      params.search = containsPattern(query.search.trim())
    }

    const whereSql = `WHERE ${where.join(' AND ')}`
    const total = Number(
      (
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM appointments a JOIN patients p ON p.id = a.patient_id ${whereSql}`
          )
          .get(params) as { count: number }
      ).count
    )
    const rows = this.db
      .prepare(
        `SELECT a.*, p.code AS patient_code, p.full_name AS patient_name, d.full_name AS dentist_name,
                q.status AS queue_status
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           JOIN dentists d ON d.id = a.dentist_id
           LEFT JOIN queue_entries q ON q.appointment_id = a.id AND q.queue_date = a.appointment_date
           ${whereSql}
          ORDER BY a.appointment_date ${query.view === 'past' ? 'DESC' : 'ASC'}, a.start_time ASC, a.id ASC
          LIMIT @limit OFFSET @offset`
      )
      .all(params) as Record<string, unknown>[]

    return { rows: rows.map(mapAppointment), total, page, pageSize }
  }

  findById(id: number): AppointmentSummary | null {
    const row = this.db
      .prepare(
        `SELECT a.*, p.code AS patient_code, p.full_name AS patient_name, d.full_name AS dentist_name,
                q.status AS queue_status
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           JOIN dentists d ON d.id = a.dentist_id
           LEFT JOIN queue_entries q ON q.appointment_id = a.id
          WHERE a.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined
    return row ? mapAppointment(row) : null
  }

  upcomingForPatient(patientId: number, limit = 5): AppointmentSummary[] {
    const rows = this.db
      .prepare(
        `SELECT a.*, p.code AS patient_code, p.full_name AS patient_name, d.full_name AS dentist_name, NULL AS queue_status
           FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN dentists d ON d.id = a.dentist_id
          WHERE a.patient_id = ? AND a.deleted_at IS NULL AND a.appointment_date >= date('now','localtime')
            AND a.status IN ('scheduled','confirmed')
          ORDER BY a.appointment_date ASC, a.start_time ASC LIMIT ?`
      )
      .all(patientId, limit) as Record<string, unknown>[]
    return rows.map(mapAppointment)
  }

  create(input: AppointmentInput, actor: string): number {
    const result = this.db
      .prepare(
        `INSERT INTO appointments (patient_id, dentist_id, appointment_date, start_time, end_time, type_code, reason,
                                   notes, status, created_at, created_by, updated_at, updated_by)
         VALUES (@patientId, @dentistId, @appointmentDate, @startTime, @endTime, @typeCode, @reason, @notes, @status,
                 @createdAt, @createdBy, @updatedAt, @updatedBy)`
      )
      .run({
        patientId: input.patientId,
        dentistId: input.dentistId,
        appointmentDate: input.appointmentDate,
        startTime: input.startTime,
        endTime: input.endTime ?? null,
        typeCode: input.typeCode ?? null,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        status: input.status ?? 'scheduled',
        createdAt: NOW(),
        createdBy: actor,
        updatedAt: NOW(),
        updatedBy: actor
      })
    return Number(result.lastInsertRowid)
  }

  update(id: number, input: AppointmentInput, actor: string): void {
    this.db
      .prepare(
        `UPDATE appointments SET dentist_id = @dentistId, appointment_date = @appointmentDate, start_time = @startTime,
                end_time = @endTime, type_code = @typeCode, reason = @reason, notes = @notes,
                updated_at = @updatedAt, updated_by = @updatedBy WHERE id = @id`
      )
      .run({
        id,
        dentistId: input.dentistId,
        appointmentDate: input.appointmentDate,
        startTime: input.startTime,
        endTime: input.endTime ?? null,
        typeCode: input.typeCode ?? null,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        updatedAt: NOW(),
        updatedBy: actor
      })
  }

  setStatus(id: number, status: AppointmentStatus, reason: string | null, actor: string): void {
    this.db
      .prepare(
        `UPDATE appointments SET status = ?, cancelled_reason = COALESCE(?, cancelled_reason),
                updated_at = ?, updated_by = ? WHERE id = ?`
      )
      .run(status, reason, NOW(), actor, id)
  }

  reschedule(
    id: number,
    input: { appointmentDate: string; startTime: string; endTime: string | null; dentistId?: number },
    actor: string
  ): number {
    const run = this.db.transaction(() => {
      const existing = this.findById(id)
      if (!existing) throw new Error('Appointment not found')
      const newId = this.create(
        {
          patientId: existing.patientId,
          dentistId: input.dentistId ?? existing.dentistId,
          appointmentDate: input.appointmentDate,
          startTime: input.startTime,
          endTime: input.endTime ?? existing.endTime,
          typeCode: existing.typeCode,
          reason: existing.reason,
          notes: existing.notes,
          status: 'scheduled'
        },
        actor
      )
      this.db
        .prepare(
          `UPDATE appointments SET status = 'rescheduled', updated_at = ?, updated_by = ? WHERE id = ?`
        )
        .run(NOW(), actor, id)
      this.db.prepare('UPDATE appointments SET rescheduled_from_id = ? WHERE id = ?').run(id, newId)
      return newId
    })
    return run()
  }

  softDelete(id: number, actor: string): void {
    this.db
      .prepare('UPDATE appointments SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .run(NOW(), NOW(), actor, id)
  }

  countToday(): { total: number; completed: number; pending: number; missed: number; upcoming: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN status IN ('scheduled','confirmed','arrived','in_queue','in_treatment') THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) AS missed,
                SUM(CASE WHEN status IN ('scheduled','confirmed') THEN 1 ELSE 0 END) AS upcoming
           FROM appointments
          WHERE appointment_date = date('now','localtime') AND deleted_at IS NULL`
      )
      .get() as { total: number; completed: number; pending: number; missed: number; upcoming: number }
    return {
      total: Number(row.total ?? 0),
      completed: Number(row.completed ?? 0),
      pending: Number(row.pending ?? 0),
      missed: Number(row.missed ?? 0),
      upcoming: Number(row.upcoming ?? 0)
    }
  }
}

function mapAppointment(row: Record<string, unknown>): AppointmentSummary {
  return {
    id: row.id as number,
    patientId: row.patient_id as number,
    patientCode: (row.patient_code as string) ?? '',
    patientName: (row.patient_name as string) ?? '',
    dentistId: row.dentist_id as number,
    dentistName: (row.dentist_name as string) ?? '',
    appointmentDate: row.appointment_date as string,
    startTime: row.start_time as string,
    endTime: (row.end_time as string) ?? null,
    typeCode: (row.type_code as string) ?? null,
    reason: (row.reason as string) ?? null,
    status: row.status as AppointmentStatus,
    queueStatus: (row.queue_status as QueueStatus) ?? null,
    notes: (row.notes as string) ?? null,
    cancelledReason: (row.cancelled_reason as string) ?? null,
    rescheduledFromId: (row.rescheduled_from_id as number | null) ?? null,
    createdAt: row.created_at as string
  }
}

export class QueueRepository {
  constructor(private readonly db: SqliteDatabase) {}

  snapshot(date?: string): QueueSnapshot {
    const queueDate = date ?? nowSql().slice(0, 10)
    const rows = this.db
      .prepare(
        `SELECT q.*, p.code AS patient_code, p.full_name AS patient_name, d.full_name AS dentist_name
           FROM queue_entries q
           JOIN patients p ON p.id = q.patient_id
           LEFT JOIN dentists d ON d.id = q.dentist_id
          WHERE q.queue_date = ?
          -- Priority always wins: an emergency or urgent patient is never pushed behind a routine one by a
          -- manual reorder. Within the same priority the staff order (position) is respected.
          ORDER BY CASE q.priority WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, q.position, q.id`
      )
      .all(queueDate) as Record<string, unknown>[]

    const average = this.db
      .prepare(
        `SELECT AVG((julianday(COALESCE(started_at, completed_at)) - julianday(arrived_at)) * 24 * 60) AS avg_minutes
           FROM queue_entries WHERE queue_date = ? AND (started_at IS NOT NULL OR completed_at IS NOT NULL)`
      )
      .get(queueDate) as { avg_minutes: number | null }

    const entries: QueueEntry[] = rows.map((row) => ({
      id: row.id as number,
      patientId: row.patient_id as number,
      patientCode: (row.patient_code as string) ?? '',
      patientName: (row.patient_name as string) ?? '',
      appointmentId: (row.appointment_id as number | null) ?? null,
      dentistId: (row.dentist_id as number | null) ?? null,
      dentistName: (row.dentist_name as string) ?? null,
      queueDate: row.queue_date as string,
      position: row.position as number,
      priority: row.priority as QueuePriority,
      status: row.status as QueueStatus,
      arrivedAt: row.arrived_at as string,
      calledAt: (row.called_at as string) ?? null,
      startedAt: (row.started_at as string) ?? null,
      completedAt: (row.completed_at as string) ?? null,
      estimatedWaitMinutes: null,
      notes: (row.notes as string) ?? null
    }))

    return {
      queueDate,
      entries,
      waitingCount: entries.filter((entry) => entry.status === 'waiting' || entry.status === 'called').length,
      inTreatmentCount: entries.filter((entry) => entry.status === 'in_treatment').length,
      completedCount: entries.filter((entry) => entry.status === 'completed').length,
      averageWaitMinutes: average.avg_minutes == null ? null : Math.round(average.avg_minutes)
    }
  }

  nextPosition(queueDate: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM queue_entries WHERE queue_date = ?')
      .get(queueDate) as { next: number }
    return row.next
  }

  add(
    input: {
      patientId: number
      appointmentId?: number | null
      dentistId?: number | null
      priority?: QueuePriority
      queueDate?: string
      notes?: string | null
    },
    actor: string
  ): number {
    const queueDate = input.queueDate ?? nowSql().slice(0, 10)
    const result = this.db
      .prepare(
        `INSERT INTO queue_entries (patient_id, appointment_id, dentist_id, queue_date, position, priority, status,
                                    arrived_at, notes, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.patientId,
        input.appointmentId ?? null,
        input.dentistId ?? null,
        queueDate,
        this.nextPosition(queueDate),
        input.priority ?? 'normal',
        nowSql(),
        input.notes ?? null,
        NOW(),
        actor,
        NOW(),
        actor
      )
    return Number(result.lastInsertRowid)
  }

  update(
    id: number,
    patch: {
      status?: QueueStatus
      priority?: QueuePriority
      dentistId?: number | null
      notes?: string | null
    },
    actor: string
  ): void {
    const entry = this.db.prepare('SELECT * FROM queue_entries WHERE id = ?').get(id) as
      Record<string, unknown> | undefined
    if (!entry) throw new Error('Queue entry not found')
    const status = patch.status ?? (entry.status as QueueStatus)
    const now = nowSql()
    this.db
      .prepare(
        `UPDATE queue_entries SET status = @status, priority = @priority, dentist_id = @dentistId, notes = @notes,
                called_at = CASE WHEN @status = 'called' AND called_at IS NULL THEN @now ELSE called_at END,
                started_at = CASE WHEN @status = 'in_treatment' AND started_at IS NULL THEN @now ELSE started_at END,
                completed_at = CASE WHEN @status IN ('completed','left','cancelled') AND completed_at IS NULL THEN @now ELSE completed_at END,
                updated_at = @now, updated_by = @actor
          WHERE id = @id`
      )
      .run({
        id,
        status,
        priority: patch.priority ?? (entry.priority as QueuePriority),
        dentistId: patch.dentistId === undefined ? (entry.dentist_id as number | null) : patch.dentistId,
        notes: patch.notes === undefined ? (entry.notes as string | null) : patch.notes,
        now,
        actor
      })
  }

  reorder(queueDate: string, orderedIds: number[], actor: string): void {
    const run = this.db.transaction(() => {
      const statement = this.db.prepare(
        'UPDATE queue_entries SET position = ?, updated_at = ?, updated_by = ? WHERE id = ? AND queue_date = ?'
      )
      orderedIds.forEach((id, index) => statement.run(index + 1, NOW(), actor, id, queueDate))
    })
    run()
  }

  activeEntryForPatient(patientId: number, queueDate: string): number | null {
    const row = this.db
      .prepare(
        `SELECT id FROM queue_entries WHERE patient_id = ? AND queue_date = ?
           AND status IN ('waiting','called','in_treatment') LIMIT 1`
      )
      .get(patientId, queueDate) as { id: number } | undefined
    return row?.id ?? null
  }
}

// ---------------------------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------------------------

export class AttachmentRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(query: AttachmentQuery): Paged<Attachment> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 25
    const params: Record<string, unknown> = {
      patientId: query.patientId,
      limit: pageSize,
      offset: (page - 1) * pageSize
    }
    const where = ['a.patient_id = @patientId', 'a.deleted_at IS NULL']
    if (query.category) {
      where.push('a.category = @category')
      params.category = query.category
    }
    const whereSql = `WHERE ${where.join(' AND ')}`
    const total = Number(
      (
        this.db.prepare(`SELECT COUNT(*) AS count FROM attachments a ${whereSql}`).get(params) as {
          count: number
        }
      ).count
    )
    const rows = this.db
      .prepare(
        `SELECT a.*, p.code AS patient_code FROM attachments a LEFT JOIN patients p ON p.id = a.patient_id
          ${whereSql} ORDER BY a.uploaded_at DESC, a.id DESC LIMIT @limit OFFSET @offset`
      )
      .all(params) as Record<string, string | number | null>[]
    return { rows: rows.map(mapAttachment), total, page, pageSize }
  }

  findById(id: number): Attachment | null {
    const row = this.db
      .prepare(
        `SELECT a.*, p.code AS patient_code FROM attachments a LEFT JOIN patients p ON p.id = a.patient_id
          WHERE a.id = ?`
      )
      .get(id) as Record<string, string | number | null> | undefined
    return row ? mapAttachment(row) : null
  }

  create(input: {
    patientId: number
    visitId?: number | null
    entityType: string
    entityId?: number | null
    originalName: string
    storedPath: string
    mimeType: string | null
    sizeBytes: number
    sha256: string
    title?: string | null
    category?: string | null
    notes?: string | null
    uploadedBy: string
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO attachments (patient_id, visit_id, entity_type, entity_id, original_name, stored_path, mime_type,
                                  size_bytes, sha256, title, category, notes, uploaded_at, uploaded_by)
         VALUES (@patientId, @visitId, @entityType, @entityId, @originalName, @storedPath, @mimeType, @sizeBytes,
                 @sha256, @title, @category, @notes, @uploadedAt, @uploadedBy)`
      )
      .run({
        ...input,
        visitId: input.visitId ?? null,
        entityId: input.entityId ?? null,
        title: input.title ?? null,
        category: input.category ?? null,
        notes: input.notes ?? null,
        uploadedAt: NOW()
      })
    return Number(result.lastInsertRowid)
  }

  rename(id: number, title: string): void {
    this.db.prepare('UPDATE attachments SET title = ? WHERE id = ?').run(title, id)
  }

  softDelete(id: number, actor: string): void {
    this.db
      .prepare('UPDATE attachments SET deleted_at = ?, deleted_by = ? WHERE id = ?')
      .run(NOW(), actor, id)
  }

  countForPatient(patientId: number): number {
    return Number(
      (
        this.db
          .prepare('SELECT COUNT(*) AS count FROM attachments WHERE patient_id = ? AND deleted_at IS NULL')
          .get(patientId) as { count: number }
      ).count
    )
  }
}

function mapAttachment(row: Record<string, string | number | null>): Attachment {
  return {
    id: row.id as number,
    patientId: (row.patient_id as number | null) ?? null,
    patientCode: (row.patient_code as string) ?? null,
    visitId: (row.visit_id as number | null) ?? null,
    entityType: row.entity_type as string,
    entityId: (row.entity_id as number | null) ?? null,
    originalName: row.original_name as string,
    storedPath: row.stored_path as string,
    mimeType: (row.mime_type as string) ?? null,
    sizeBytes: Number(row.size_bytes),
    sha256: (row.sha256 as string) ?? null,
    title: (row.title as string) ?? null,
    category: (row.category as string) ?? null,
    notes: (row.notes as string) ?? null,
    uploadedAt: row.uploaded_at as string,
    uploadedBy: (row.uploaded_by as string) ?? null
  }
}

// ---------------------------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------------------------

export class NotificationRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(options: { onlyUnread?: boolean; limit?: number; category?: string } = {}): Notification[] {
    const where = ['dismissed_at IS NULL']
    if (options.onlyUnread) where.push('read_at IS NULL')
    if (options.category) where.push('category = ?')
    const params: unknown[] = []
    if (options.category) params.push(options.category)
    params.push(options.limit ?? 100)
    const rows = this.db
      .prepare(
        `SELECT * FROM notifications WHERE ${where.join(' AND ')}
          ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC LIMIT ?`
      )
      .all(...params) as Record<string, string | number | null>[]
    return rows.map((row) => ({
      id: row.id as number,
      category: row.category as Notification['category'],
      priority: row.priority as Notification['priority'],
      title: row.title as string,
      body: (row.body as string) ?? null,
      entityType: (row.entity_type as string) ?? null,
      entityId: (row.entity_id as number | null) ?? null,
      actionType: (row.action_type as string) ?? null,
      actionPayload: row.action_payload_json
        ? (JSON.parse(row.action_payload_json as string) as Record<string, unknown>)
        : null,
      createdAt: row.created_at as string,
      readAt: (row.read_at as string) ?? null,
      dismissedAt: (row.dismissed_at as string) ?? null
    }))
  }

  create(input: {
    category: Notification['category']
    priority: Notification['priority']
    title: string
    body?: string | null
    entityType?: string | null
    entityId?: number | null
    actionType?: string | null
    actionPayload?: Record<string, unknown> | null
    dedupeKey?: string | null
  }): number | null {
    const result = this.db
      .prepare(
        `INSERT INTO notifications (category, priority, title, body, entity_type, entity_id, action_type,
                                     action_payload_json, dedupe_key, created_at)
         VALUES (@category, @priority, @title, @body, @entityType, @entityId, @actionType, @actionPayload, @dedupeKey, @createdAt)
         ON CONFLICT(dedupe_key) DO NOTHING`
      )
      .run({
        category: input.category,
        priority: input.priority,
        title: input.title,
        body: input.body ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actionType: input.actionType ?? null,
        actionPayload: input.actionPayload ? JSON.stringify(input.actionPayload) : null,
        dedupeKey: input.dedupeKey ?? null,
        createdAt: NOW()
      })
    return result.changes > 0 ? Number(result.lastInsertRowid) : null
  }

  markRead(id: number): void {
    this.db.prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?').run(NOW(), id)
  }

  markAllRead(): void {
    this.db
      .prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE read_at IS NULL')
      .run(NOW())
  }

  dismiss(id: number): void {
    this.db
      .prepare('UPDATE notifications SET dismissed_at = ?, read_at = COALESCE(read_at, ?) WHERE id = ?')
      .run(NOW(), NOW(), id)
  }

  unreadCount(): number {
    return Number(
      (
        this.db
          .prepare(
            'SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL AND dismissed_at IS NULL'
          )
          .get() as { count: number }
      ).count
    )
  }
}

// ---------------------------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------------------------

export class AuditRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /** Append an entry, chaining it to the previous hash (call inside the mutation's transaction). */
  append(input: {
    actorUserId: number | null
    actorUsername: string | null
    action: string
    entityType?: string | null
    entityId?: string | number | null
    summary: string
    before?: unknown
    after?: unknown
    severity?: 'info' | 'warning' | 'critical'
    appVersion: string
  }): number {
    const previous = this.db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get() as
      { hash: string } | undefined
    const prevHash = previous?.hash ?? null
    const at = nowSql()
    const atEpochMs = nowEpochMs()
    const row: AuditHashRow = {
      at,
      at_epoch_ms: atEpochMs,
      actor_user_id: input.actorUserId,
      actor_username: input.actorUsername,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId == null ? null : String(input.entityId),
      summary: input.summary,
      before_json: serializeAuditPayload(input.before),
      after_json: serializeAuditPayload(input.after),
      severity: input.severity ?? 'info',
      app_version: input.appVersion
    }
    const hash = computeAuditHash(row, prevHash)
    const result = this.db
      .prepare(
        `INSERT INTO audit_log (at, at_epoch_ms, actor_user_id, actor_username, action, entity_type, entity_id,
                                summary, before_json, after_json, severity, app_version, hash, prev_hash)
         VALUES (@at, @atEpochMs, @actorUserId, @actorUsername, @action, @entityType, @entityId, @summary,
                 @beforeJson, @afterJson, @severity, @appVersion, @hash, @prevHash)`
      )
      .run({
        at,
        atEpochMs,
        actorUserId: row.actor_user_id,
        actorUsername: row.actor_username,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        summary: row.summary,
        beforeJson: row.before_json,
        afterJson: row.after_json,
        severity: row.severity,
        appVersion: row.app_version,
        hash,
        prevHash
      })
    return Number(result.lastInsertRowid)
  }

  list(query: AuditQuery): Paged<AuditEntry> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 50
    const where: string[] = []
    const params: Record<string, unknown> = { limit: pageSize, offset: (page - 1) * pageSize }
    if (query.from) {
      where.push('date(a.at) >= date(@from)')
      params.from = query.from
    }
    if (query.to) {
      where.push('date(a.at) <= date(@to)')
      params.to = query.to
    }
    if (query.actorUserId) {
      where.push('a.actor_user_id = @actorUserId')
      params.actorUserId = query.actorUserId
    }
    if (query.action) {
      where.push("a.action LIKE @action ESCAPE '\\'")
      params.action = containsPattern(query.action)
    }
    if (query.entityType) {
      where.push('a.entity_type = @entityType')
      params.entityType = query.entityType
    }
    if (query.severity) {
      where.push('a.severity = @severity')
      params.severity = query.severity
    }
    if (query.search?.trim()) {
      where.push(
        `(a.summary LIKE @search ESCAPE '\\' OR a.actor_username LIKE @search ESCAPE '\\' OR a.action LIKE @search ESCAPE '\\')`
      )
      params.search = containsPattern(query.search.trim())
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number(
      (
        this.db.prepare(`SELECT COUNT(*) AS count FROM audit_log a ${whereSql}`).get(params) as {
          count: number
        }
      ).count
    )
    const rows = this.db
      .prepare(`SELECT * FROM audit_log a ${whereSql} ORDER BY a.id DESC LIMIT @limit OFFSET @offset`)
      .all(params) as Record<string, string | number | null>[]
    return {
      rows: rows.map((row) => ({
        id: row.id as number,
        at: row.at as string,
        atEpochMs: row.at_epoch_ms as number,
        actorUserId: (row.actor_user_id as number | null) ?? null,
        actorUsername: (row.actor_username as string) ?? null,
        action: row.action as string,
        entityType: (row.entity_type as string) ?? null,
        entityId: (row.entity_id as string) ?? null,
        summary: row.summary as string,
        beforeJson: (row.before_json as string) ?? null,
        afterJson: (row.after_json as string) ?? null,
        severity: row.severity as AuditEntry['severity'],
        appVersion: row.app_version as string,
        hash: row.hash as string,
        prevHash: (row.prev_hash as string) ?? null
      })),
      total,
      page,
      pageSize
    }
  }

  recent(limit = 8): AuditEntry[] {
    return this.list({ page: 1, pageSize: limit }).rows
  }
}

export type { Dentist }
