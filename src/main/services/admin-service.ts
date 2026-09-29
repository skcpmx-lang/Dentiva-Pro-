/**
 * Administration services: settings, clinic profile, people, backups/restore, integrity,
 * printer profiles, print document building and destructive data management.
 *
 * Destructive operations always follow the same protocol (REQ-SAFE): typed confirmation phrase,
 * password re-authentication, a `pre_destructive` backup, then the action — all audited.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join, relative, resolve, sep } from 'node:path'

import { formatAge, nowSql, todayIso } from '@shared/date'
import { AppError, conflict, notFound, validationError } from '@shared/errors'
import { DEFAULT_SETTINGS, type AppSettingsShape } from '@shared/constants'
import type {
  AppInfoPayload,
  AuditQuery,
  BackupInspection,
  BackupRecord,
  ClinicInput,
  ClinicProfile,
  Dentist,
  DentistInput,
  IntegrityReport,
  JobProgress,
  Paged,
  PrinterInfo,
  PrinterProfile,
  RestoreRequest,
  SettingsSnapshot,
  StaffInput,
  StaffMember,
  AuditEntry
} from '@shared/types'
import {
  buildInvoiceDocument,
  buildPrescriptionDocument,
  buildPatientBlock,
  buildReportDocument,
  type ClinicForPrint,
  type DentistForPrint
} from '@shared/printing/documents'
import type { InvoiceDocument, PrescriptionDocument, ReportDocument } from '@shared/printing/model'
import { PAPER_SIZE_KEYS, resolvePaper, type PaperSizeKey } from '@shared/printing/paper'
import { assertWritableFolder, resolveStoredPath, toRelativePath, type DataLayout } from '../storage/paths'
import { sha256File } from '../storage/hashing'
import { closeDatabase, openDatabase, type SqliteDatabase } from '../db/connection'
import { runIntegrityCheck, verifyAuditChain } from '../db/integrity'
import { CatalogueRepository } from '../db/repositories-core'
import type {
  ClinicRepository,
  CounterRepository,
  DentistRepository,
  PrinterProfileRepository,
  SettingsRepository,
  StaffRepository
} from '../db/repositories-core'
import { AuditRepository } from '../db/repositories-clinical'
import type {
  AttachmentRepository,
  PatientRepository,
  PrescriptionRepository
} from '../db/repositories-clinical'
import type { InvoiceRepository } from '../db/repositories-billing'
import { BillingService } from './billing-service'
import type { AuthService } from './auth-service'
import type { SessionManager } from '../security/session'

export const DESTRUCTIVE_PHRASES: Record<DestructiveAction, string> = {
  delete_patient: 'DELETE PATIENT',
  delete_selected_patients: 'DELETE SELECTED PATIENTS',
  delete_all_patients: 'DELETE ALL PATIENTS',
  delete_business_data: 'DELETE ALL BUSINESS DATA',
  reset_database: 'RESET DATABASE'
}

export const RESTORE_PHRASE = 'RESTORE BACKUP'

export type DestructiveAction =
  | 'delete_patient'
  | 'delete_selected_patients'
  | 'delete_all_patients'
  | 'delete_business_data'
  | 'reset_database'

export interface AdminServiceDeps {
  db: SqliteDatabase
  layout: DataLayout
  settings: SettingsRepository
  clinic: ClinicRepository
  dentists: DentistRepository
  staff: StaffRepository
  printerProfiles: PrinterProfileRepository
  counters: CounterRepository
  audit: AuditRepository
  patients: PatientRepository
  invoices: InvoiceRepository
  prescriptions: PrescriptionRepository
  attachments: AttachmentRepository
  billing: BillingService
  auth: AuthService
  session: SessionManager
  appVersion: string
  buildInfo: { version: string; buildNumber: string; commit: string; buildDate: string }
  runtime: { electron: string; chrome: string; node: string; sqlite: string; thirdPartyCount: number }
  /** Re-open the live database connection after a restore swapped the file. */
  closeDb: () => void
  reopenDb: () => SqliteDatabase
  listSystemPrinters: () => Promise<PrinterInfo[]>
  onProgress?: (progress: JobProgress) => void
}

export class AdminService {
  constructor(private readonly deps: AdminServiceDeps) {}

  private require(permission: Parameters<SessionManager['assertPermission']>[0]): void {
    this.deps.session.assertPermission(permission)
  }

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
    this.auditOn(this.deps.db, action, summary, options)
  }

  /**
   * Write an audit entry through one specific connection.
   *
   * A restore closes the connection the container was built with and swaps the database file, so the
   * entries written after the swap must go through the connection that was just re-opened — otherwise
   * the service would try to log a successful restore on a closed database and the whole operation
   * would appear to have failed.
   */
  private auditOn(
    db: SqliteDatabase,
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
    new AuditRepository(db).append({
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

  private progress(kind: JobProgress['kind'], phase: string, message: string, current = 0, total = 0): void {
    this.deps.onProgress?.({
      jobId: `${kind}-${Date.now()}`,
      kind,
      phase,
      current,
      total,
      message,
      done: false,
      failed: false
    })
  }

  // -------------------------------------------------------------------------------------------
  // Settings and clinic profile
  // -------------------------------------------------------------------------------------------

  /** Folder where automatic and manual backups are written (settings override the data folder). */
  backupFolderPath(): string {
    return this.deps.settings.get().backupFolder || this.deps.layout.backupsDir
  }

  settingsSnapshot(): SettingsSnapshot {
    this.require('settings.view')
    const clinic = this.deps.clinic.get()
    if (!clinic) throw notFound('Clinic profile')
    return { settings: this.deps.settings.get(), clinic }
  }

  updateSettings(patch: Partial<AppSettingsShape>): SettingsSnapshot {
    this.require('settings.manage')
    const before = this.deps.settings.get()
    const problems: { field: string; message: string }[] = []
    const allowed = Object.keys(DEFAULT_SETTINGS) as (keyof AppSettingsShape)[]
    const accepted: Partial<AppSettingsShape> = {}

    for (const [key, value] of Object.entries(patch) as [keyof AppSettingsShape, unknown][]) {
      if (!allowed.includes(key)) {
        problems.push({ field: String(key), message: 'Unknown setting.' })
        continue
      }
      const expected = typeof DEFAULT_SETTINGS[key]
      if (typeof value !== expected || value === null) {
        problems.push({ field: String(key), message: `Expected a ${expected} value.` })
        continue
      }
      if (expected === 'number' && (!Number.isFinite(value as number) || (value as number) < 0)) {
        problems.push({ field: String(key), message: 'Enter a value of zero or more.' })
        continue
      }
      accepted[key] = value as never
    }
    if (problems.length > 0) throw validationError('Some settings could not be saved.', problems)

    if (accepted.autoLockMinutes != null && ![5, 10, 15, 30].includes(accepted.autoLockMinutes as number)) {
      throw validationError('Choose an auto-lock timeout of 5, 10, 15 or 30 minutes.', [
        { field: 'autoLockMinutes', message: 'Unsupported auto-lock timeout.' }
      ])
    }
    if (accepted.backupFolder) {
      assertWritableFolder(accepted.backupFolder)
    }

    this.deps.db.transaction(() => {
      this.deps.settings.setMany(accepted, this.deps.session.username ?? 'system')
      this.audit('settings.update', `Updated ${Object.keys(accepted).length} setting(s)`, {
        entityType: 'settings',
        entityId: null,
        before: Object.fromEntries(
          Object.keys(accepted).map((key) => [key, before[key as keyof AppSettingsShape]])
        ),
        after: accepted,
        severity: 'warning'
      })
    })()

    const after = this.deps.settings.get()
    if (after.autoLockMinutes !== before.autoLockMinutes) {
      this.deps.session.setAutoLockMinutes(after.autoLockMinutes)
    }
    return this.settingsSnapshot()
  }

  updateClinic(input: ClinicInput): ClinicProfile {
    this.require('settings.manage')
    const before = this.deps.clinic.get()
    if (!input.name.trim() || !input.address.trim() || !input.phone1.trim()) {
      throw validationError('Clinic name, address and phone are required.', [
        { field: 'name', message: 'Required.' },
        { field: 'address', message: 'Required.' },
        { field: 'phone1', message: 'Required.' }
      ])
    }
    this.deps.clinic.upsert({
      ...input,
      logoPath: input.logoPath ?? before?.logoPath ?? null,
      name: input.name.trim(),
      address: input.address.trim()
    })
    this.audit('clinic.update', `Updated the clinic profile for "${input.name.trim()}"`, {
      entityType: 'clinic',
      entityId: 1,
      before: before ? { name: before.name, phone1: before.phone1 } : null,
      after: { name: input.name.trim(), phone1: input.phone1 },
      severity: 'warning'
    })
    return this.deps.clinic.get() as ClinicProfile
  }

  saveClinicLogo(sourcePath: string): ClinicProfile {
    this.require('settings.manage')
    if (!existsSync(sourcePath)) throw notFound('Logo file')
    const stats = statSync(sourcePath)
    const extension = extname(sourcePath).toLowerCase()
    const allowed = ['.png', '.jpg', '.jpeg', '.webp']
    if (!allowed.includes(extension)) {
      throw validationError('The logo must be a PNG, JPG or WEBP image.', [
        { field: 'sourcePath', message: `Allowed types: ${allowed.join(', ')}` }
      ])
    }
    if (stats.size > 4 * 1024 * 1024) {
      throw validationError('The logo image must be smaller than 4 MB.', [
        { field: 'sourcePath', message: 'File too large.' }
      ])
    }
    const targetFolder = this.deps.layout.configDir
    mkdirSync(targetFolder, { recursive: true })
    const target = join(targetFolder, `clinic-logo${extension}`)
    copyFileSync(sourcePath, target)
    const relativePath = toRelativePath(this.deps.layout, target)
    this.deps.clinic.updateLogo(relativePath)
    this.audit('clinic.logo', 'Updated the clinic logo', { entityType: 'clinic', entityId: 1 })
    return this.deps.clinic.get() as ClinicProfile
  }

  clearClinicLogo(): ClinicProfile {
    this.require('settings.manage')
    const clinic = this.deps.clinic.get()
    if (clinic?.logoPath) {
      const absolute = resolveStoredPath(this.deps.layout, clinic.logoPath)
      if (existsSync(absolute)) rmSync(absolute, { force: true })
    }
    this.deps.clinic.updateLogo(null)
    this.audit('clinic.logo', 'Removed the clinic logo', {
      entityType: 'clinic',
      entityId: 1,
      severity: 'warning'
    })
    return this.deps.clinic.get() as ClinicProfile
  }

  // -------------------------------------------------------------------------------------------
  // People — dentists, assistants, staff
  // -------------------------------------------------------------------------------------------

  listDentists(includeInactive = true): Dentist[] {
    this.require('staff.view')
    return this.deps.dentists.list(includeInactive)
  }

  saveDentist(input: DentistInput, id?: number): Dentist {
    this.require('staff.manage')
    const problems: { field: string; message: string }[] = []
    if (input.fullName.trim().length < 3)
      problems.push({ field: 'fullName', message: 'Enter the full name.' })
    if (input.designations.filter((value) => value.trim() !== '').length === 0) {
      problems.push({ field: 'designations', message: 'Add at least one designation.' })
    }
    if (input.qualifications.filter((value) => value.trim() !== '').length === 0) {
      problems.push({ field: 'qualifications', message: 'Add at least one qualification.' })
    }
    if (problems.length > 0) throw validationError('The dentist details are incomplete.', problems)

    const actor = this.deps.session.username ?? 'system'
    const before = id ? this.deps.dentists.findById(id) : null
    const dentistId = id
      ? (this.deps.dentists.update(id, input, actor), id)
      : this.deps.dentists.create(input, actor)
    this.audit(
      id ? 'staff.dentist_update' : 'staff.dentist_create',
      `Saved dentist "${input.fullName.trim()}"`,
      {
        entityType: 'dentist',
        entityId: dentistId,
        before: before ? { fullName: before.fullName, isActive: before.isActive } : null,
        after: { fullName: input.fullName.trim(), isActive: input.isActive },
        severity: 'warning'
      }
    )
    return this.deps.dentists.findById(dentistId) as Dentist
  }

  setDentistActive(id: number, isActive: boolean): Dentist {
    this.require('staff.manage')
    const dentist = this.deps.dentists.findById(id)
    if (!dentist) throw notFound('Dentist', id)
    if (!isActive) {
      const active = this.deps.dentists.list(false)
      if (active.length <= 1) throw conflict('At least one active dentist must remain.')
      const upcoming = this.deps.db
        .prepare(
          `SELECT COUNT(*) AS count FROM appointments
            WHERE dentist_id = ? AND deleted_at IS NULL AND appointment_date >= date('now','localtime')
              AND status IN ('scheduled','confirmed')`
        )
        .get(id) as { count: number }
      if (Number(upcoming.count) > 0) {
        throw conflict(
          `This dentist has ${upcoming.count} upcoming appointment(s). Reassign or cancel them before deactivating.`
        )
      }
    }
    if (isActive) {
      const active = this.deps.dentists.list(false)
      if (active.length >= 5)
        throw conflict('Up to five active dentists are supported in a single clinic profile.')
    }
    this.deps.dentists.update(
      id,
      { ...this.dentistToInput(dentist), isActive },
      this.deps.session.username ?? 'system'
    )
    this.audit(
      'staff.dentist_active',
      `${isActive ? 'Activated' : 'Deactivated'} dentist "${dentist.fullName}"`,
      {
        entityType: 'dentist',
        entityId: id,
        severity: 'warning'
      }
    )
    return this.deps.dentists.findById(id) as Dentist
  }

  private dentistToInput(dentist: Dentist): DentistInput {
    return {
      fullName: dentist.fullName,
      phone: dentist.phone,
      email: dentist.email,
      registrationNo: dentist.registrationNo,
      signaturePath: dentist.signaturePath,
      isActive: dentist.isActive,
      sortOrder: dentist.sortOrder,
      notes: dentist.notes,
      designations: dentist.designations,
      qualifications: dentist.qualifications,
      certifications: dentist.certifications,
      schedules: dentist.schedules.map((schedule) => ({
        weekday: schedule.weekday,
        startTime: schedule.startTime,
        endTime: schedule.endTime
      }))
    }
  }

  saveDentistSignature(id: number, sourcePath: string): Dentist {
    this.require('staff.manage')
    const dentist = this.deps.dentists.findById(id)
    if (!dentist) throw notFound('Dentist', id)
    if (!existsSync(sourcePath)) throw notFound('Signature file')
    const extension = extname(sourcePath).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
      throw validationError('The signature must be a PNG, JPG or WEBP image.', [
        { field: 'sourcePath', message: 'Unsupported image type.' }
      ])
    }
    if (statSync(sourcePath).size > 2 * 1024 * 1024) {
      throw validationError('The signature image must be smaller than 2 MB.', [
        { field: 'sourcePath', message: 'File too large.' }
      ])
    }
    const folder = join(this.deps.layout.configDir, 'signatures')
    mkdirSync(folder, { recursive: true })
    const target = join(folder, `dentist-${id}${extension}`)
    copyFileSync(sourcePath, target)
    this.deps.dentists.update(
      id,
      { ...this.dentistToInput(dentist), signaturePath: toRelativePath(this.deps.layout, target) },
      this.deps.session.username ?? 'system'
    )
    this.audit('staff.signature', `Updated the signature of "${dentist.fullName}"`, {
      entityType: 'dentist',
      entityId: id
    })
    return this.deps.dentists.findById(id) as Dentist
  }

  listStaff(): StaffMember[] {
    this.require('staff.view')
    return this.deps.staff.list()
  }

  saveStaff(input: StaffInput, id?: number): StaffMember {
    this.require('staff.manage')
    const problems: { field: string; message: string }[] = []
    if (input.name.trim().length < 3)
      problems.push({ field: 'name', message: 'Enter the staff member name.' })
    if (input.phone.trim().length < 6)
      problems.push({ field: 'phone', message: 'Enter a valid phone number.' })
    if (input.position.trim().length < 2) problems.push({ field: 'position', message: 'Enter the position.' })
    if (input.salaryPoisha != null && input.salaryPoisha < 0) {
      problems.push({ field: 'salaryPoisha', message: 'Salary cannot be negative.' })
    }
    if (problems.length > 0) throw validationError('The staff record is incomplete.', problems)

    const actor = this.deps.session.username ?? 'system'
    const before = id ? this.deps.staff.findById(id) : null
    const staffId = id ? (this.deps.staff.update(id, input, actor), id) : this.deps.staff.create(input, actor)
    this.audit(id ? 'staff.update' : 'staff.create', `Saved staff member "${input.name.trim()}"`, {
      entityType: 'staff',
      entityId: staffId,
      before: before ? { name: before.name, status: before.status } : null,
      after: { name: input.name.trim(), status: input.status },
      severity: 'warning'
    })
    return this.deps.staff.findById(staffId) as StaffMember
  }

  removeStaff(id: number): void {
    this.require('staff.manage')
    const staff = this.deps.staff.findById(id)
    if (!staff) throw notFound('Staff member', id)
    this.deps.staff.softDelete(id, this.deps.session.username ?? 'system')
    this.audit('staff.delete', `Removed staff member "${staff.name}"`, {
      entityType: 'staff',
      entityId: id,
      before: { name: staff.name, position: staff.position },
      severity: 'critical'
    })
  }

  // -------------------------------------------------------------------------------------------
  // Integrity and audit
  // -------------------------------------------------------------------------------------------

  runIntegrity(deep = false): IntegrityReport {
    this.require('settings.view')
    this.progress('import', 'integrity', 'Checking database integrity…')
    const report = runIntegrityCheck(this.deps.db, { deep })
    this.audit('system.integrity_check', `Integrity check ${report.ok ? 'passed' : 'found problems'}`, {
      entityType: 'system',
      entityId: null,
      after: { ok: report.ok, checks: report.checks.length },
      severity: report.ok ? 'info' : 'critical'
    })
    return report
  }

  auditChainStatus(): {
    valid: boolean
    checkedEntries: number
    firstBrokenId: number | null
    message: string
  } {
    this.require('audit.view')
    return verifyAuditChain(this.deps.db)
  }

  listAudit(query: AuditQuery): Paged<AuditEntry> {
    this.require('audit.view')
    return this.deps.audit.list(query)
  }

  // -------------------------------------------------------------------------------------------
  // About / diagnostics
  // -------------------------------------------------------------------------------------------

  aboutInfo(): AppInfoPayload {
    return {
      productName: 'Dentiva Pro',
      version: this.deps.buildInfo.version,
      buildNumber: this.deps.buildInfo.buildNumber,
      commit: this.deps.buildInfo.commit,
      buildDate: this.deps.buildInfo.buildDate,
      electron: this.deps.runtime.electron,
      chrome: this.deps.runtime.chrome,
      node: this.deps.runtime.node,
      sqlite: this.deps.runtime.sqlite,
      author: 'Shohan Khan',
      authorEmail: 'helloiamshohan@gmail.com',
      copyright: `Copyright © ${new Date().getFullYear()} Shohan Khan. All rights reserved.`,
      dataRoot: this.deps.layout.root,
      databasePath: this.deps.layout.databaseFile,
      logPath: this.deps.layout.logsDir,
      backupFolder: this.deps.settings.get().backupFolder || this.deps.layout.backupsDir,
      licence: 'Proprietary — single-clinic licence',
      thirdPartyCount: this.deps.runtime.thirdPartyCount
    }
  }

  // -------------------------------------------------------------------------------------------
  // Printer profiles
  // -------------------------------------------------------------------------------------------

  printerProfiles(): PrinterProfile[] {
    this.require('settings.view')
    return this.deps.printerProfiles.list()
  }

  savePrinterProfile(input: PrinterProfile): PrinterProfile {
    this.require('printers.manage')
    if (input.name.trim().length < 2) {
      throw validationError('Give the printer profile a name.', [
        { field: 'name', message: 'Name is too short.' }
      ])
    }
    if (input.scalePercent < 50 || input.scalePercent > 200) {
      throw validationError('The scale must be between 50% and 200%.', [
        { field: 'scalePercent', message: 'Out of range.' }
      ])
    }
    if (input.paperSize === 'custom' && (!input.customWidthMm || !input.customHeightMm)) {
      throw validationError('Enter the custom paper width and height.', [
        { field: 'customWidthMm', message: 'Required for custom paper.' }
      ])
    }
    const id = this.deps.printerProfiles.save(input)
    this.audit('printers.save', `Saved printer profile "${input.name.trim()}" for ${input.documentType}`, {
      entityType: 'printer_profile',
      entityId: id,
      after: { paperSize: input.paperSize, printer: input.printerName, isDefault: input.isDefault }
    })
    return this.deps.printerProfiles.list().find((profile) => profile.id === id) as PrinterProfile
  }

  deletePrinterProfile(id: number): void {
    this.require('printers.manage')
    const profile = this.deps.printerProfiles.list().find((entry) => entry.id === id)
    if (!profile) throw notFound('Printer profile', id)
    this.deps.printerProfiles.delete(id)
    this.audit('printers.delete', `Deleted printer profile "${profile.name}"`, {
      entityType: 'printer_profile',
      entityId: id,
      before: { name: profile.name, documentType: profile.documentType },
      severity: 'warning'
    })
  }

  async systemPrinters(): Promise<PrinterInfo[]> {
    this.require('settings.view')
    return this.deps.listSystemPrinters()
  }

  // -------------------------------------------------------------------------------------------
  // Print document building
  // -------------------------------------------------------------------------------------------

  private clinicForPrint(): ClinicForPrint {
    const clinic = this.deps.clinic.get()
    if (!clinic) throw notFound('Clinic profile')
    let logoDataUrl: string | null = null
    if (clinic.logoPath) {
      const absolute = resolveStoredPath(this.deps.layout, clinic.logoPath)
      if (existsSync(absolute)) {
        const extension = extname(absolute).slice(1).toLowerCase()
        const mime = extension === 'jpg' ? 'jpeg' : extension
        logoDataUrl = `data:image/${mime};base64,${readFileSync(absolute).toString('base64')}`
      }
    }
    return {
      name: clinic.name,
      nameBn: clinic.nameBn,
      logoDataUrl,
      address: [clinic.address, clinic.city, clinic.postalCode].filter(Boolean).join(', '),
      phone1: clinic.phone1,
      phone2: clinic.phone2,
      email: clinic.email,
      registrationNo: clinic.registrationNo
    }
  }

  private dentistForPrint(dentistId: number): DentistForPrint {
    const dentist = this.deps.dentists.findById(dentistId)
    if (!dentist) throw notFound('Dentist', dentistId)
    let signatureDataUrl: string | null = null
    if (dentist.signaturePath) {
      const absolute = resolveStoredPath(this.deps.layout, dentist.signaturePath)
      if (existsSync(absolute)) {
        const extension = extname(absolute).slice(1).toLowerCase()
        const mime = extension === 'jpg' ? 'jpeg' : extension
        signatureDataUrl = `data:image/${mime};base64,${readFileSync(absolute).toString('base64')}`
      }
    }
    return {
      fullName: dentist.fullName,
      qualifications: dentist.qualifications,
      designations: dentist.designations,
      signatureDataUrl
    }
  }

  private paperKeyOf(value: string): PaperSizeKey {
    return (PAPER_SIZE_KEYS as readonly string[]).includes(value) ? (value as PaperSizeKey) : 'A4'
  }

  buildPrescriptionDocumentPrint(prescriptionId: number, paperKey?: string): PrescriptionDocument {
    this.require('prescriptions.print')
    const prescription = this.deps.prescriptions.findById(prescriptionId)
    if (!prescription) throw notFound('Prescription', prescriptionId)
    const settings = this.deps.settings.get()
    const paper = resolvePaper(this.paperKeyOf(paperKey ?? settings.prescriptionPaper))
    const clinic = this.deps.clinic.get()
    const patient = this.deps.patients.findById(prescription.patientId)
    const ageText = patient?.dateOfBirth
      ? formatAge(patient.dateOfBirth)
      : patient?.ageYears != null
        ? `${patient.ageYears} years`
        : null

    this.progress('print', 'build', `Preparing prescription #${prescriptionId} for printing…`)
    return buildPrescriptionDocument({
      paper,
      clinic: this.clinicForPrint(),
      dentist: this.dentistForPrint(prescription.dentistId),
      patient: buildPatientBlock({
        name: prescription.patientName,
        nameBn: patient?.fullNameBn ?? null,
        age: ageText,
        gender: prescription.patientGender
          ? prescription.patientGender.replace(/^\w/, (letter) => letter.toUpperCase())
          : null,
        code: prescription.patientCode,
        phone: patient?.phone ?? null,
        date: prescription.prescriptionDate,
        dateFormat: settings.dateFormat
      }),
      chiefComplaints: prescription.chiefComplaints,
      onExamination: prescription.onExamination,
      remarks: prescription.diagnosis,
      advice: prescription.advice,
      medicines: prescription.items.map((item) => ({
        medicineName: item.medicineName,
        medicineType: item.medicineType,
        strength: item.strength,
        dose: item.dose,
        morning: item.morning,
        noon: item.noon,
        night: item.night,
        timing: item.timing,
        durationValue: item.durationValue,
        durationUnit: item.durationUnit,
        quantity: item.quantity,
        instruction: item.instruction,
        conditionalInstruction: item.conditionalInstruction
      })),
      followUpDate: prescription.followUpDate,
      footerQuote: clinic?.footerQuote ?? settings.prescriptionFooterQuote,
      consultationTiming: this.consultationTiming(prescription.dentistId),
      settings: {
        showDentist: true,
        showQualifications: settings.prescriptionShowDentistQualifications,
        showLogo: settings.prescriptionShowLogo,
        showConsultationTiming: settings.prescriptionShowConsultationTiming,
        dateFormat: settings.dateFormat
      },
      prescriptionId,
      generatedAt: nowSql()
    })
  }

  private consultationTiming(dentistId: number): string[] {
    const rows = this.deps.db
      .prepare(
        'SELECT weekday, start_time, end_time FROM dentist_schedules WHERE dentist_id = ? ORDER BY weekday, start_time'
      )
      .all(dentistId) as { weekday: number; start_time: string; end_time: string }[]
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    return rows.map((row) => `${names[row.weekday] ?? 'Day'}: ${row.start_time}–${row.end_time}`)
  }

  buildInvoiceDocumentPrint(invoiceId: number, paperKey?: string): InvoiceDocument {
    this.require('invoices.print')
    const invoice = this.deps.invoices.findById(invoiceId)
    if (!invoice) throw notFound('Invoice', invoiceId)
    const settings = this.deps.settings.get()
    const paper = resolvePaper(this.paperKeyOf(paperKey ?? settings.invoicePaper))
    const statusLabels: Record<string, string> = {
      unpaid: 'Unpaid',
      partial: 'Partially paid',
      paid: 'Paid',
      overpaid: 'Overpaid',
      void: 'Void'
    }
    this.progress('print', 'build', `Preparing invoice ${invoice.invoiceNo} for printing…`)
    return buildInvoiceDocument({
      paper,
      clinic: this.clinicForPrint(),
      dentist: settings.invoiceShowDentist
        ? this.dentistForPrint(this.dentistOfVisit(invoice.visitId))
        : null,
      patient: buildPatientBlock({
        name: invoice.patientName,
        nameBn: null,
        age: null,
        gender: null,
        code: invoice.patientCode,
        phone: invoice.patientPhone,
        date: invoice.invoiceDate,
        dateFormat: settings.dateFormat
      }),
      invoiceNo: invoice.invoiceNo,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      items: invoice.items.map((item) => ({
        description: item.description,
        quantityMilli: item.quantityMilli,
        unitPricePoisha: item.unitPricePoisha,
        discountPoisha: item.discountPoisha,
        lineTotalPoisha: item.lineTotalPoisha
      })),
      subtotalPoisha: invoice.subtotalPoisha,
      discountPoisha: invoice.discountPoisha,
      taxPoisha: invoice.taxPoisha,
      roundOffPoisha: invoice.roundOffPoisha,
      totalPoisha: invoice.totalPoisha,
      paidPoisha: invoice.paidPoisha,
      balancePoisha: invoice.balancePoisha,
      statusLabel: statusLabels[invoice.status] ?? invoice.status,
      payments: invoice.payments.map((payment) => ({
        receiptNo: payment.receiptNo,
        receivedAt: payment.receivedAt,
        methodName: payment.methodName,
        amountPoisha: payment.amountPoisha,
        referenceNo: payment.referenceNo
      })),
      termsNote: settings.invoiceTermsNote,
      settings: {
        showDentist: settings.invoiceShowDentist,
        showLogo: settings.invoiceShowLogo,
        showPaymentHistory: settings.invoiceShowPaymentHistory,
        dateFormat: settings.dateFormat
      },
      invoiceId,
      generatedAt: nowSql(),
      voided: invoice.status === 'void',
      voidReason: invoice.voidReason
    })
  }

  private dentistOfVisit(visitId: number | null): number {
    if (!visitId) {
      const row = this.deps.db
        .prepare('SELECT id FROM dentists WHERE is_active = 1 ORDER BY sort_order, id LIMIT 1')
        .get() as { id: number } | undefined
      return row?.id ?? 1
    }
    const row = this.deps.db.prepare('SELECT dentist_id FROM visits WHERE id = ?').get(visitId) as
      { dentist_id: number } | undefined
    return row?.dentist_id ?? 1
  }

  buildReportPrint(request: {
    title: string
    from: string
    to: string
    columns: { key: string; label: string; align: 'left' | 'right' | 'center' }[]
    rows: string[][]
    summaries: { label: string; value: string; emphasis?: boolean }[]
    footNotes?: string[]
    paper?: string
  }): ReportDocument {
    this.require('reports.financial.view')
    const paper = resolvePaper(this.paperKeyOf(request.paper ?? 'A4'))
    return buildReportDocument({
      paper,
      clinic: this.clinicForPrint(),
      title: request.title,
      from: request.from,
      to: request.to,
      columns: request.columns,
      rows: request.rows,
      summaries: request.summaries,
      footNotes: request.footNotes,
      generatedAt: nowSql(),
      generatedBy: this.deps.session.user?.displayName ?? this.deps.session.username ?? 'system'
    })
  }

  // -------------------------------------------------------------------------------------------
  // Backups
  // -------------------------------------------------------------------------------------------

  private backupRoot(): string {
    const configured = this.deps.settings.get().backupFolder
    const folder = configured && configured.trim() !== '' ? configured : this.deps.layout.backupsDir
    mkdirSync(folder, { recursive: true })
    return folder
  }

  private countRows(db: SqliteDatabase): Record<string, number> {
    const tables = [
      'patients',
      'visits',
      'appointments',
      'prescriptions',
      'invoices',
      'payments',
      'expenses',
      'attachments'
    ]
    const counts: Record<string, number> = {}
    for (const table of tables) {
      counts[table] = Number(
        (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
      )
    }
    return counts
  }

  async createBackup(
    trigger: BackupRecord['trigger'] = 'manual',
    options: { includeAttachments?: boolean; notes?: string | null; silent?: boolean } = {}
  ): Promise<BackupRecord> {
    if (!options.silent) this.require('backup.create')
    const includeAttachments = options.includeAttachments ?? true
    const settings = this.deps.settings.get()
    const stamp = nowSql().replace(/[: ]/g, '-')
    // The timestamp has second resolution, so two backups started in the same second must not share a
    // folder: the second one would silently overwrite the first.
    let folderName = `DentivaPro_Backup_${stamp}`
    for (let attempt = 2; existsSync(join(this.backupRoot(), folderName)); attempt += 1) {
      folderName = `DentivaPro_Backup_${stamp}_${attempt}`
    }
    const folderPath = join(this.backupRoot(), folderName)
    mkdirSync(folderPath, { recursive: true })

    this.progress('backup', 'database', 'Copying the database…', 0, includeAttachments ? 3 : 2)
    const databaseDir = join(folderPath, 'Database')
    mkdirSync(databaseDir, { recursive: true })
    const databaseFile = join(databaseDir, 'dentiva.db')

    try {
      if (!this.deps.db.open) throw new AppError('INTERNAL', 'The database is not open.')
      // better-sqlite3's online backup runs safely while the clinic keeps working.
      await this.deps.db.backup(databaseFile)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.recordBackupFailure(folderPath, trigger, message)
      throw new AppError('INTERNAL', `The backup could not be created: ${message}`)
    }

    const verification = openDatabase(databaseFile, { skipMigrations: true, readOnly: true })
    let integrityCheck: string
    let counts: Record<string, number>
    let auditChainHead: string | null
    try {
      const result = verification.pragma('integrity_check') as { integrity_check: string }[]
      integrityCheck = result[0]?.integrity_check ?? 'unknown'
      counts = this.countRows(verification)
      const head = verification.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get() as
        { hash: string } | undefined
      auditChainHead = head?.hash ?? null
    } finally {
      closeDatabase(verification)
    }

    this.progress('backup', 'config', 'Writing the configuration snapshot…', 1, includeAttachments ? 3 : 2)
    mkdirSync(join(folderPath, 'Config'), { recursive: true })
    const clinic = this.deps.clinic.get()
    writeFileSync(
      join(folderPath, 'Config', 'clinic-config.json'),
      JSON.stringify({ clinic, settings }, null, 2),
      { encoding: 'utf8', flag: 'w' }
    )

    if (includeAttachments) {
      this.progress('backup', 'attachments', 'Copying attachments…', 2, 3)
      const source = this.deps.layout.attachmentsDir
      if (existsSync(source)) {
        copyTree(source, join(folderPath, 'Attachments'))
      }
    }

    const databaseHash = sha256File(databaseFile)
    const schemaVersion = Number(
      (
        this.deps.db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as {
          version: number
        }
      ).version
    )
    const manifest = {
      format: 'dentiva-backup',
      formatVersion: 1,
      appVersion: this.deps.buildInfo.version,
      buildNumber: this.deps.buildInfo.buildNumber,
      dataSchemaVersion: schemaVersion,
      backupDate: nowSql(),
      trigger,
      clinic: clinic?.name ?? null,
      createdBy: this.deps.session.username ?? 'system',
      encrypted: false,
      counts,
      database: {
        file: 'Database/dentiva.db',
        sizeBytes: statSync(databaseFile).size,
        sha256: databaseHash,
        integrityCheck
      },
      auditChainHead,
      notes: options.notes ?? null
    }
    writeFileSync(join(folderPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

    writeFileSync(
      join(folderPath, 'README.txt'),
      [
        'Dentiva Pro backup',
        '==================',
        '',
        `Created: ${manifest.backupDate}`,
        `App version: ${manifest.appVersion} (build ${manifest.buildNumber})`,
        `Schema version: ${manifest.dataSchemaVersion}`,
        `Trigger: ${trigger}`,
        '',
        'Restore this backup from Dentiva Pro → Administration → Backup & Restore.',
        'Do not edit or add files inside this folder: the checksums in SHA256SUMS.txt would no longer match.',
        ''
      ].join('\n'),
      'utf8'
    )

    // The checksum file is written last so it always describes the finished folder.
    const sums = collectChecksums(folderPath, ['SHA256SUMS.txt'])
    writeFileSync(
      join(folderPath, 'SHA256SUMS.txt'),
      sums.map((entry) => `${entry.hash}  ${entry.path}`).join('\n') + '\n',
      'utf8'
    )

    const totalSize = folderSize(folderPath)
    const record = this.insertBackupRecord({
      fileName: folderName,
      path: folderPath,
      sizeBytes: totalSize,
      sha256: databaseHash,
      trigger,
      status: 'success',
      includesAttachments: includeAttachments,
      schemaVersion,
      errorMessage: null
    })
    this.audit(
      'backup.create',
      `Created backup ${folderName} (${Math.round(totalSize / 1024 / 1024)} MB, ${trigger})`,
      {
        entityType: 'backup',
        entityId: record.id,
        after: { folder: folderName, counts, integrityCheck },
        severity: 'warning'
      }
    )
    this.progress('backup', 'done', 'Backup complete.', 3, 3)
    this.pruneBackups(settings.autoBackupRetention, trigger)
    return record
  }

  private recordBackupFailure(folderPath: string, trigger: BackupRecord['trigger'], message: string): void {
    this.insertBackupRecord({
      fileName: basename(folderPath),
      path: folderPath,
      sizeBytes: 0,
      sha256: null,
      trigger,
      status: 'failed',
      includesAttachments: false,
      schemaVersion: 0,
      errorMessage: message
    })
    this.audit('backup.failed', `Backup to ${basename(folderPath)} failed: ${message}`, {
      entityType: 'backup',
      entityId: null,
      severity: 'critical'
    })
  }

  private insertBackupRecord(input: {
    fileName: string
    path: string
    sizeBytes: number
    sha256: string | null
    trigger: BackupRecord['trigger']
    status: BackupRecord['status']
    includesAttachments: boolean
    schemaVersion: number
    errorMessage: string | null
  }): BackupRecord {
    const result = this.deps.db
      .prepare(
        `INSERT INTO backups (file_name, path, size_bytes, sha256, created_at, created_by, trigger, status,
                              includes_attachments, app_version, schema_version, data_format_version, encrypted, error_message)
         VALUES (@fileName, @path, @sizeBytes, @sha256, @createdAt, @createdBy, @trigger, @status, @includesAttachments,
                 @appVersion, @schemaVersion, 1, 0, @errorMessage)`
      )
      .run({
        fileName: input.fileName,
        path: input.path,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        createdAt: nowSql(),
        createdBy: this.deps.session.username ?? 'system',
        trigger: input.trigger,
        status: input.status,
        includesAttachments: input.includesAttachments ? 1 : 0,
        appVersion: this.deps.buildInfo.version,
        schemaVersion: input.schemaVersion,
        errorMessage: input.errorMessage
      })
    const id = Number(result.lastInsertRowid)
    if (input.status === 'failed') {
      this.deps.db
        .prepare(
          `INSERT INTO notifications (category, priority, title, body, entity_type, entity_id, created_at, dedupe_key)
           VALUES ('system', 'critical', 'Backup failed', ?, 'backup', ?, ?, ?)`
        )
        .run(input.errorMessage, id, nowSql(), `backup-failed-${id}`)
    }
    return this.backups().find((record) => record.id === id) as BackupRecord
  }

  backups(): BackupRecord[] {
    const rows = this.deps.db
      .prepare('SELECT * FROM backups ORDER BY created_at DESC, id DESC')
      .all() as Record<string, string | number | null>[]
    return rows.map((row) => ({
      id: row.id as number,
      fileName: row.file_name as string,
      path: row.path as string,
      sizeBytes: Number(row.size_bytes),
      sha256: (row.sha256 as string) ?? null,
      createdAt: row.created_at as string,
      createdBy: (row.created_by as string) ?? null,
      trigger: row.trigger as BackupRecord['trigger'],
      status: row.status as BackupRecord['status'],
      includesAttachments: Number(row.includes_attachments) === 1,
      appVersion: row.app_version as string,
      schemaVersion: Number(row.schema_version),
      dataFormatVersion: Number(row.data_format_version),
      encrypted: Number(row.encrypted) === 1,
      errorMessage: (row.error_message as string) ?? null
    }))
  }

  listBackups(): BackupRecord[] {
    this.require('backup.create')
    return this.backups()
  }

  verifyBackup(folderPath: string): BackupInspection {
    this.require('backup.restore')
    return this.inspectBackupFolder(folderPath)
  }

  private inspectBackupFolder(folderPath: string): BackupInspection {
    const problems: string[] = []
    const manifestPath = join(folderPath, 'manifest.json')
    let manifest: BackupInspection['manifest'] = null
    let schemaCompatible = false
    let compatibilityMessage = 'The backup manifest could not be read.'

    if (!existsSync(manifestPath)) {
      problems.push('manifest.json is missing — this does not look like a Dentiva Pro backup folder.')
    } else {
      try {
        const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupInspection['manifest']
        manifest = parsed
        if (parsed && parsed.format !== 'dentiva-backup') {
          problems.push('The manifest does not describe a Dentiva Pro backup.')
        }
        if (parsed && parsed.formatVersion > 1) {
          problems.push(
            'This backup was created by a newer version of Dentiva Pro and cannot be restored here.'
          )
        }
        const currentSchema = Number(
          (
            this.deps.db
              .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
              .get() as {
              version: number
            }
          ).version
        )
        schemaCompatible = Boolean(parsed) && parsed!.dataSchemaVersion <= currentSchema
        compatibilityMessage = schemaCompatible
          ? `Schema ${parsed?.dataSchemaVersion} can be restored into schema ${currentSchema}.`
          : `The backup uses schema ${parsed?.dataSchemaVersion ?? '?'} which is newer than the installed schema ${currentSchema}.`
        if (!schemaCompatible) problems.push(compatibilityMessage)
      } catch (error) {
        problems.push(`manifest.json is not valid JSON: ${(error as Error).message}`)
      }
    }

    const databaseFile = join(folderPath, 'Database', 'dentiva.db')
    if (!existsSync(databaseFile)) {
      problems.push('Database/dentiva.db is missing.')
    } else if (manifest?.database?.sha256) {
      const hash = sha256File(databaseFile)
      if (hash !== manifest.database.sha256) {
        problems.push(
          'The database file does not match the checksum in the manifest (it was changed after the backup).'
        )
      }
    }

    const sumsPath = join(folderPath, 'SHA256SUMS.txt')
    let fileCount = 0
    if (existsSync(sumsPath)) {
      const lines = readFileSync(sumsPath, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
      for (const line of lines) {
        const match = /^([0-9a-f]{64})\s+(.+)$/.exec(line)
        if (!match) {
          problems.push(`SHA256SUMS.txt contains an unreadable line: ${line.slice(0, 60)}`)
          continue
        }
        const [, expected, relativeFile] = match
        const absolute = resolve(folderPath, relativeFile)
        if (!absolute.startsWith(resolve(folderPath))) {
          problems.push(`SHA256SUMS.txt references a path outside the backup folder: ${relativeFile}`)
          continue
        }
        if (!existsSync(absolute)) {
          problems.push(`Missing file listed in SHA256SUMS.txt: ${relativeFile}`)
          continue
        }
        fileCount += 1
        if (sha256File(absolute) !== expected) {
          problems.push(`Checksum mismatch: ${relativeFile}`)
        }
      }
      if (lines.length === 0) problems.push('SHA256SUMS.txt is empty.')
    } else {
      problems.push('SHA256SUMS.txt is missing — the backup was not completed.')
    }

    return {
      folderPath,
      valid: problems.length === 0 && manifest !== null,
      problems,
      manifest,
      sizeBytes: existsSync(folderPath) ? folderSize(folderPath) : 0,
      fileCount,
      schemaCompatible,
      compatibilityMessage
    }
  }

  deleteBackup(id: number, deleteFiles: boolean): void {
    this.require('backup.create')
    const record = this.backups().find((entry) => entry.id === id)
    if (!record) throw notFound('Backup', id)
    if (record.trigger === 'pre_restore' || record.trigger === 'pre_destructive') {
      throw conflict(
        'Safety backups created before a restore or destructive action cannot be deleted from the app.'
      )
    }
    if (deleteFiles && existsSync(record.path)) {
      rmSync(record.path, { recursive: true, force: true })
    }
    this.deps.db.prepare('DELETE FROM backups WHERE id = ?').run(id)
    this.audit(
      'backup.delete',
      `Deleted backup ${record.fileName}${deleteFiles ? ' (including files)' : ''}`,
      {
        entityType: 'backup',
        entityId: id,
        before: { fileName: record.fileName, path: record.path },
        severity: 'critical'
      }
    )
  }

  /** Keep only the newest `retention` automatic backups. Manual backups are never pruned. */
  pruneBackups(retention: number, trigger: BackupRecord['trigger'] = 'auto'): void {
    const keep = Math.max(1, retention)
    const records = this.backups().filter((entry) => entry.trigger === trigger)
    const stale = records.slice(keep)
    for (const entry of stale) {
      if (existsSync(entry.path)) {
        try {
          rmSync(entry.path, { recursive: true, force: true })
        } catch {
          continue
        }
      }
      this.deps.db.prepare('DELETE FROM backups WHERE id = ?').run(entry.id)
      this.audit('backup.prune', `Removed old automatic backup ${entry.fileName}`, {
        entityType: 'backup',
        entityId: entry.id,
        severity: 'warning'
      })
    }
  }

  /** Called by the scheduler; checks the interval and time of day before creating an automatic backup. */
  async runAutoBackupIfDue(): Promise<BackupRecord | null> {
    const settings = this.deps.settings.get()
    if (!settings.autoBackupEnabled) return null

    const [rawHour, rawMinute] = (settings.autoBackupTime || '21:00').split(':').map(Number)
    // 00:00 is a valid time, so the fallback must only apply to values that are missing or out of range.
    const hour = Number.isInteger(rawHour) && rawHour >= 0 && rawHour <= 23 ? rawHour : 21
    const minute = Number.isInteger(rawMinute) && rawMinute >= 0 && rawMinute <= 59 ? rawMinute : 0
    const now = new Date()
    const todayTarget = new Date()
    todayTarget.setHours(hour, minute, 0, 0)

    const last = this.backups().find((entry) => entry.trigger === 'auto' && entry.status !== 'failed')
    if (last) {
      const lastDate = new Date(last.createdAt.replace(' ', 'T'))
      const dueAt = new Date(lastDate.getTime() + settings.autoBackupIntervalDays * 24 * 60 * 60 * 1000)
      if (now.getTime() < dueAt.getTime()) return null
      if (last.createdAt.slice(0, 10) === todayIso()) return null
      return this.createBackup('auto', { includeAttachments: true, silent: true })
    }
    // No automatic backup has ever run: wait until the configured time of day before the first one.
    if (now.getTime() < todayTarget.getTime()) return null
    return this.createBackup('auto', { includeAttachments: true, silent: true })
  }

  async restoreBackup(
    request: RestoreRequest
  ): Promise<{ restoredAt: string; preRestoreBackup: BackupRecord }> {
    this.require('backup.restore')
    if (request.confirmationPhrase.trim() !== RESTORE_PHRASE) {
      throw validationError(`Type "${RESTORE_PHRASE}" to confirm the restore.`, [
        { field: 'confirmationPhrase', message: 'The confirmation phrase does not match.' }
      ])
    }
    const settings = this.deps.settings.get()
    if (settings.requirePasswordOnDestructive) {
      if (!request.password) {
        throw validationError('Enter your password to confirm the restore.', [
          { field: 'password', message: 'Password is required.' }
        ])
      }
      this.deps.auth.assertPassword(request.password)
    }

    const inspection = this.inspectBackupFolder(request.folderPath)
    if (!inspection.valid) {
      throw conflict(`This backup cannot be restored: ${inspection.problems.join(' ')}`)
    }
    this.progress('restore', 'pre-backup', 'Creating a safety backup of the current data…', 0, 5)
    const preRestoreBackup = await this.createBackup('pre_restore', {
      includeAttachments: true,
      notes: `Automatic safety backup taken before restoring ${basename(request.folderPath)}`
    })

    const stagingDir = join(this.deps.layout.tempDir, 'restore-staging')
    rmSync(stagingDir, { recursive: true, force: true })
    mkdirSync(stagingDir, { recursive: true })
    const stagedDatabase = join(stagingDir, 'dentiva.db')
    copyFileSync(join(request.folderPath, 'Database', 'dentiva.db'), stagedDatabase)

    this.progress('restore', 'migrate', 'Checking and upgrading the backup…', 1, 5)
    const staged = openDatabase(stagedDatabase, { appVersion: this.deps.buildInfo.version })
    let stagedAuditOk: boolean
    try {
      const integrity = staged.pragma('integrity_check') as { integrity_check: string }[]
      if ((integrity[0]?.integrity_check ?? '') !== 'ok') {
        throw conflict('The backup database failed its integrity check and was not restored.')
      }
      stagedAuditOk = verifyAuditChain(staged).valid
    } finally {
      closeDatabase(staged)
    }
    if (!stagedAuditOk) {
      // A broken audit chain is not fatal for the data, but the operator must know (tamper evidence).
      this.deps.db
        .prepare(
          `INSERT INTO notifications (category, priority, title, body, created_at, dedupe_key)
           VALUES ('system', 'critical', 'Restored audit chain does not verify',
                   'The backup you restored has an audit log whose hash chain does not match. This usually means the file was edited outside Dentiva Pro.',
                   ?, ?)`
        )
        .run(nowSql(), `restore-audit-${Date.now()}`)
    }

    const rollbackDir = join(this.deps.layout.tempDir, 'restore-rollback')
    rmSync(rollbackDir, { recursive: true, force: true })
    mkdirSync(rollbackDir, { recursive: true })

    this.progress('restore', 'swap', 'Replacing the database…', 2, 5)
    const liveDatabase = this.deps.layout.databaseFile
    const liveWal = `${liveDatabase}-wal`
    const liveShm = `${liveDatabase}-shm`
    this.deps.closeDb()
    try {
      if (existsSync(liveDatabase)) renameSync(liveDatabase, join(rollbackDir, 'dentiva.db'))
      if (existsSync(liveWal)) renameSync(liveWal, join(rollbackDir, 'dentiva.db-wal'))
      if (existsSync(liveShm)) renameSync(liveShm, join(rollbackDir, 'dentiva.db-shm'))
      copyFileSync(stagedDatabase, liveDatabase)
    } catch (error) {
      // Roll back the file swap before re-opening the original database.
      try {
        rmSync(liveDatabase, { force: true })
        if (existsSync(join(rollbackDir, 'dentiva.db')))
          renameSync(join(rollbackDir, 'dentiva.db'), liveDatabase)
      } catch {
        // Ignore: reopenDb() below will surface a clear failure.
      }
      this.deps.reopenDb()
      throw new AppError(
        'INTERNAL',
        `Restoring the database failed and the previous database was re-opened: ${String(error)}`
      )
    }

    this.progress('restore', 'verify', 'Verifying the restored clinic data…', 3, 5)
    let verified: boolean
    let verificationMessage: string
    let live = this.deps.reopenDb()
    try {
      const db = live
      const integrity = db.pragma('integrity_check') as { integrity_check: string }[]
      const foreignKeys = db.pragma('foreign_key_check') as unknown[]
      verified = (integrity[0]?.integrity_check ?? '') === 'ok' && foreignKeys.length === 0
      verificationMessage = verified
        ? 'Integrity check passed.'
        : `Integrity check failed: ${integrity[0]?.integrity_check ?? 'unknown'}, ${foreignKeys.length} foreign key problems.`
    } catch (error) {
      verified = false
      verificationMessage = String(error)
    }

    if (!verified) {
      // Roll back to the pre-restore database: the restore is atomic from the operator's point of view.
      this.deps.closeDb()
      rmSync(liveDatabase, { force: true })
      renameSync(join(rollbackDir, 'dentiva.db'), liveDatabase)
      live = this.deps.reopenDb()
      this.auditOn(
        live,
        'backup.restore_failed',
        `Restore of ${basename(request.folderPath)} failed and was rolled back: ${verificationMessage}`,
        {
          entityType: 'backup',
          entityId: preRestoreBackup.id,
          severity: 'critical'
        }
      )
      throw new AppError(
        'INTERNAL',
        `The restored data failed verification and was rolled back. ${verificationMessage}`
      )
    }

    this.progress('restore', 'attachments', 'Restoring attachments…', 4, 5)
    const backupAttachments = join(request.folderPath, 'Attachments')
    if (existsSync(backupAttachments)) {
      const liveAttachments = this.deps.layout.attachmentsDir
      if (existsSync(liveAttachments)) {
        copyTree(liveAttachments, join(rollbackDir, 'Attachments'))
        rmSync(liveAttachments, { recursive: true, force: true })
      }
      copyTree(backupAttachments, liveAttachments)
    }

    rmSync(stagingDir, { recursive: true, force: true })
    this.auditOn(live, 'backup.restore', `Restored the clinic data from ${basename(request.folderPath)}`, {
      entityType: 'backup',
      entityId: preRestoreBackup.id,
      after: { folder: request.folderPath, verification: verificationMessage },
      severity: 'critical'
    })
    this.progress('restore', 'done', 'Restore complete. Please sign in again.', 5, 5)
    // A restored database may contain different users, so the current session must end.
    this.deps.session.signOut()
    return { restoredAt: nowSql(), preRestoreBackup }
  }

  // -------------------------------------------------------------------------------------------
  // Destructive data management
  // -------------------------------------------------------------------------------------------

  async runDestructive(request: {
    action: DestructiveAction
    confirmationPhrase: string
    password: string
    ids?: number[]
    includeAttachments?: boolean
  }): Promise<{ action: DestructiveAction; affected: number; preBackup: BackupRecord }> {
    this.require('data.destructive')
    const expected = DESTRUCTIVE_PHRASES[request.action]
    if (!expected) {
      throw validationError('Unknown destructive action.', [{ field: 'action', message: 'Not supported.' }])
    }
    if (request.confirmationPhrase.trim() !== expected) {
      throw validationError(`Type "${expected}" to confirm this action.`, [
        { field: 'confirmationPhrase', message: 'The confirmation phrase does not match.' }
      ])
    }
    const settings = this.deps.settings.get()
    if (settings.requirePasswordOnDestructive) {
      if (!request.password) {
        throw validationError('Enter your password to confirm this action.', [
          { field: 'password', message: 'Password is required.' }
        ])
      }
      this.deps.auth.assertPassword(request.password)
    }

    this.progress('import', 'pre-backup', 'Creating a safety backup…')
    const preBackup = await this.createBackup('pre_destructive', {
      includeAttachments: true,
      notes: `Safety backup taken before "${expected}"`
    })

    const affected = this.deps.db.transaction(() => {
      switch (request.action) {
        case 'delete_patient':
        case 'delete_selected_patients': {
          const ids = request.ids ?? []
          if (ids.length === 0) {
            throw validationError('Choose at least one patient to delete.', [
              { field: 'ids', message: 'No patients selected.' }
            ])
          }
          const statement = this.deps.db.prepare(
            'UPDATE patients SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL'
          )
          let changed = 0
          for (const id of ids) {
            changed += statement.run(nowSql(), nowSql(), this.deps.session.username ?? 'system', id).changes
          }
          return changed
        }
        case 'delete_all_patients': {
          const result = this.deps.db
            .prepare(
              'UPDATE patients SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE deleted_at IS NULL'
            )
            .run(nowSql(), nowSql(), this.deps.session.username ?? 'system')
          return result.changes
        }
        case 'delete_business_data':
          return this.purgeBusinessData()
        case 'reset_database':
          return this.purgeEverything()
        default:
          throw validationError('Unknown destructive action.', [
            { field: 'action', message: 'Not supported.' }
          ])
      }
    })()

    this.audit('data.destructive', `Performed "${expected}" affecting ${affected} record(s)`, {
      entityType: 'system',
      entityId: null,
      before: { action: request.action, ids: request.ids ?? null },
      after: { affected, preBackup: preBackup.fileName },
      severity: 'critical'
    })
    if (request.action === 'reset_database') {
      this.deps.session.signOut()
    }
    return { action: request.action, affected, preBackup }
  }

  private purgeBusinessData(): number {
    const db = this.deps.db
    let affected = 0
    const tables = [
      'invoice_items',
      'payments',
      'invoices',
      'prescription_items',
      'prescriptions',
      'referrals',
      'visit_treatments',
      'visit_chart_snapshots',
      'visits',
      'dental_chart_entries',
      'queue_entries',
      'appointments',
      'patient_notes',
      'patients',
      'inventory_transactions',
      'inventory_batches',
      'inventory_items',
      'expenses',
      'attachments',
      'notifications'
    ]
    for (const table of tables) {
      affected += db.prepare(`DELETE FROM ${table}`).run().changes
    }
    // Keep the counters and audit log: the audit trail must survive data deletion.
    db.prepare('UPDATE counters SET value = 0').run()
    return affected
  }

  private purgeEverything(): number {
    const db = this.deps.db
    const affected = this.purgeBusinessData()
    const tables = [
      'user_permissions',
      'login_attempts',
      'users',
      'role_permissions',
      'roles',
      'permissions',
      'dentist_designations',
      'dentist_qualifications',
      'dentist_certifications',
      'dentist_schedules',
      'dentists',
      'staff',
      'treatment_catalog',
      'clinical_options',
      'dental_conditions',
      'payment_methods',
      'expense_categories',
      'suppliers',
      'printer_profiles',
      'settings',
      'clinic_profile',
      'backups'
    ]
    for (const table of tables) {
      db.prepare(`DELETE FROM ${table}`).run()
    }
    db.prepare("DELETE FROM app_meta WHERE key NOT IN ('data_schema_version')").run()
    return affected
  }

  /** Rebuild the default catalogue after a reset (used by the setup wizard path). */
  reseedDefaults(): void {
    this.require('data.destructive')
    this.deps.db.transaction(() => {
      const catalogue = new CatalogueRepository(this.deps.db)
      catalogue.seedDefaults()
      catalogue.seedRoles()
    })()
  }
}

function copyTree(source: string, target: string): void {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name)
    const targetPath = join(target, entry.name)
    if (entry.isDirectory()) copyTree(sourcePath, targetPath)
    else if (entry.isFile()) copyFileSync(sourcePath, targetPath)
  }
}

function collectChecksums(root: string, exclude: string[]): { path: string; hash: string }[] {
  const entries: { path: string; hash: string }[] = []
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const absolute = join(folder, entry.name)
      const relativePath = relative(root, absolute).split(sep).join('/')
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile() && !exclude.includes(relativePath)) {
        entries.push({ path: relativePath, hash: sha256File(absolute) })
      }
    }
  }
  walk(root)
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

function folderSize(folder: string): number {
  let total = 0
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile()) total += statSync(absolute).size
    }
  }
  walk(folder)
  return total
}
