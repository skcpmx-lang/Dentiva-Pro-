/**
 * IPC contract shared by the main process, the preload bridge and the renderer.
 *
 * There is exactly one transport: `dentiva.invoke(channel, payload)`. Every channel is declared here with
 * its payload and result type, so a channel that is not in this map cannot be called and cannot be handled.
 * The main process additionally validates every payload with a zod schema (see `src/main/ipc/registry.ts`)
 * and enforces the permission attached to each channel.
 */

import type { ExportEntity } from './constants'
import type { IpcResult } from './errors'
import type { PermissionCode, PermissionModule } from './permissions'
import type {
  AccountingSummary,
  ClinicalOption,
  ActivationResult,
  AppInfoPayload,
  AppointmentInput,
  AppointmentQuery,
  AppointmentSummary,
  Attachment,
  AttachmentQuery,
  AuditChainStatus,
  AuditEntry,
  AuditQuery,
  BackupInspection,
  BackupRecord,
  ClinicInput,
  ClinicProfile,
  DashboardWidgetData,
  DentalChartState,
  DentalCondition,
  Dentist,
  DentistInput,
  DestructiveRequest,
  Expense,
  ExpenseCategory,
  ExpenseInput,
  ExpenseQuery,
  ExportResult,
  PatientImportResult,
  IntegrityReport,
  InventoryBatch,
  InventoryItem,
  InventoryItemInput,
  InventoryQuery,
  InventoryTransaction,
  Invoice,
  InvoiceInput,
  InvoiceQuery,
  JobProgress,
  LoginResult,
  Notification,
  OutstandingRow,
  PageQuery,
  Paged,
  Patient,
  PatientFinancialSummary,
  PatientInput,
  PatientProfile,
  PatientSummary,
  PatientTimelineEntry,
  Payment,
  PaymentDashboard,
  PaymentInput,
  PaymentMethod,
  PaymentQuery,
  PermissionCatalogEntry,
  Prescription,
  PrescriptionInput,
  PrinterInfo,
  PrinterProfile,
  QueueSnapshot,
  Referral,
  ReferralInput,
  RestoreRequest,
  RevenueReportRow,
  RoleSummary,
  SearchResults,
  SessionSnapshot,
  SettingsSnapshot,
  SetupInput,
  SetupStatus,
  StaffMember,
  StaffInput,
  StockInInput,
  StockIssueInput,
  Supplier,
  Treatment,
  TreatmentInput,
  TreatmentRevenueRow,
  UserInput,
  UserSummary,
  Visit,
  VisitInput,
  VisitQuery
} from './types'
import type { AppointmentStatus, QueuePriority, QueueStatus, VisitStatus } from './constants'

// ---------------------------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------------------------

export interface IdPayload {
  id: number
}
export interface LoginPayload {
  username: string
  password: string
}
export interface UnlockPayload {
  password: string
}
export interface ChangePasswordPayload {
  currentPassword: string
  newPassword: string
}
export interface VoidPayload {
  id: number
  reason: string
}
export interface DentistSavePayload extends DentistInput {
  id?: number
}
export interface StaffSavePayload extends StaffInput {
  id?: number
}
export interface UserSavePayload extends UserInput {
  id?: number
  password?: string
}
export interface RoleSavePayload {
  id?: number
  name: string
  description?: string | null
  permissions: PermissionCode[]
}
export interface RoleDeletePayload {
  id: number
}
export interface DentistActivePayload {
  id: number
  isActive: boolean
}
export interface SignaturePayload {
  id: number
  sourcePath: string
}
export interface TreatmentSavePayload extends TreatmentInput {
  id?: number
}
export interface TreatmentQuery extends PageQuery {
  search?: string | null
  category?: string | null
  includeInactive?: boolean
}
export type TreatmentListPayload = TreatmentQuery

export interface ChartGetPayload {
  patientId: number
  visitId?: number | null
}
export interface ChartSavePayload {
  patientId: number
  visitId?: number | null
  entries: {
    toothNumber: string
    conditionCode: string
    treatmentCode: string | null
    surfaces: string[]
    status: 'existing' | 'planned' | 'completed'
    note: string | null
  }[]
}
export interface PatientTimelinePayload {
  patientId: number
}
export interface PatientNotePayload {
  patientId: number
  note: string
}
export interface ClinicalOptionSavePayload {
  id?: number
  listCode: string
  value: string
  valueBn?: string | null
  sortOrder?: number
  isActive?: boolean
}
export interface ClinicalOptionListPayload {
  listCode?: string
  includeInactive?: boolean
}
export interface ChartStatusPayload {
  id: number
  status: AppointmentStatus
  reason?: string | null
}
export interface ReschedulePayload {
  id: number
  appointmentDate: string
  startTime: string
  reason?: string | null
}
export interface QueueAddPayload {
  patientId: number
  appointmentId?: number | null
  dentistId?: number | null
  priority?: QueuePriority
  notes?: string | null
}
export interface QueueUpdatePayload {
  id: number
  status?: QueueStatus
  priority?: QueuePriority
  dentistId?: number | null
  notes?: string | null
}
export interface QueueReorderPayload {
  queueDate: string
  orderedIds: number[]
}
export interface ReferralStatusPayload {
  id: number
  status: Referral['status']
  outcome?: string | null
}
export interface VisitStatusPayload {
  id: number
  status: VisitStatus
}
export interface PrescriptionVoidPayload {
  id: number
  reason: string
}
export interface PrescriptionPrintPayload {
  id: number
  profileId?: number | null
}
export interface PrintBuildPayload {
  documentType: 'prescription' | 'invoice' | 'report'
  entityId: number
  paper?: string
  reportRequest?: ReportPrintRequest
}
export interface PrintOutPayload {
  documentType: 'prescription' | 'invoice' | 'report'
  entityId: number
  profileId?: number | null
  copies?: number
  mode: 'preview' | 'print' | 'pdf'
  targetPath?: string | null
  reportRequest?: ReportPrintRequest
}
export interface ReportPrintRequest {
  title: string
  from: string
  to: string
  columns: { key: string; label: string; align: 'left' | 'right' | 'center' }[]
  rows: string[][]
  summaries: { label: string; value: string; emphasis?: boolean }[]
  footNotes?: string[]
  paper?: string
}
export interface ReportDataPayload {
  report: string
  from: string
  to: string
}
export interface ReportDataResult {
  title: string
  columns: { key: string; label: string; align: 'left' | 'right' | 'center' }[]
  rows: (string | number)[][]
  summaries: { label: string; value: string; emphasis?: boolean }[]
  footNotes: string[]
}
export interface AccountingRangePayload {
  from: string | null
  to: string | null
}

export interface NotificationListPayload {
  onlyUnread?: boolean
  limit?: number
}
export interface SettingsPatchPayload {
  patch: Partial<Record<string, unknown>>
}
export interface ClinicLogoPayload {
  sourcePath: string
}
export interface PrinterSavePayload extends Omit<PrinterProfile, 'id'> {
  id?: number
}
export interface BackupCreatePayload {
  includeAttachments?: boolean
  notes?: string | null
  targetFolder?: string | null
}
export interface BackupDeletePayload {
  id: number
  deleteFiles?: boolean
}
export interface BackupVerifyPayload {
  folderPath: string
}
export type RestorePayload = RestoreRequest
export type DestructivePayload = DestructiveRequest
export interface IntegrityPayload {
  deep?: boolean
}
export interface ExportPayload {
  entity: ExportEntity
  format: 'csv' | 'json'
  from?: string | null
  to?: string | null
  targetFolder: string
}
export interface PatientImportPayload {
  filePath: string
  dryRun: boolean
}
export interface ReportExportPayload {
  report: string
  from: string
  to: string
  targetFolder: string
}
export interface ChooseFolderPayload {
  title?: string
  suggestedName?: string
}
export interface OpenPathPayload {
  path: string
}
export interface SearchPayload {
  term: string
  entityTypes?: string[]
  limit?: number
}
export type AttachmentListPayload = AttachmentQuery
export interface AttachmentAddPayload {
  patientId: number
  visitId?: number | null
  title: string
  category?: string | null
  sourcePath: string
  notes?: string | null
}
export interface AttachmentRenamePayload {
  id: number
  title: string
}
export interface SupplierSavePayload extends Omit<Supplier, 'id'> {
  id?: number
}
export interface InventorySavePayload extends InventoryItemInput {
  id?: number
}
export interface InventoryTxnPayload extends PageQuery {
  itemId?: number
  txnType?: InventoryTransaction['txnType']
  from?: string
  to?: string
}
export interface CategorySavePayload {
  id?: number
  code: string
  name: string
  nameBn?: string | null
}
export interface PrintReadyPayload {
  jobId: string
}

export interface ReportPrintResultPayload {
  title: string
  from: string
  to: string
  columns: { key: string; label: string; align: 'left' | 'right' | 'center' }[]
  rows: string[][]
  summaries: { label: string; value: string; emphasis?: boolean }[]
  footNotes?: string[]
  paper?: string
}

export interface LogBundle {
  entries: { at: string; level: string; message: string; scope?: string }[]
  files: { name: string; sizeBytes: number; modifiedAt: string }[]
}

export interface RuntimeInfo {
  productName: string
  version: string
  buildNumber: string
  commit: string
  buildDate: string
  electron: string
  chrome: string
  node: string
  sqlite: string
  v8: string
  platform: string
  arch: string
  dataRoot: string
  thirdPartyCount: number
}
export type PaymentDashboardPayload = PaymentQuery

// ---------------------------------------------------------------------------------------------
// Channel map
// ---------------------------------------------------------------------------------------------

export interface IpcChannelMap {
  // Application / session -------------------------------------------------------------------
  'app.ready': { payload: undefined; result: { ok: true } }
  'app.bootstrap': { payload: undefined; result: AppInfoPayload }
  'app.windowState': {
    payload: { isMaximized: boolean; isFullScreen: boolean; isFocused: boolean }
    result: { ok: true }
  }
  'auth.status': { payload: undefined; result: SessionSnapshot }
  'auth.login': { payload: LoginPayload; result: LoginResult }
  'auth.logout': { payload: undefined; result: { ok: true } }
  'auth.lock': { payload: undefined; result: { ok: true } }
  'auth.unlock': { payload: UnlockPayload; result: SessionSnapshot }
  'auth.touch': { payload: undefined; result: { ok: true } }
  'auth.changePassword': { payload: ChangePasswordPayload; result: { ok: true } }
  'session.snapshot': { payload: undefined; result: SessionSnapshot }

  // Setup / activation -----------------------------------------------------------------------
  'setup.status': { payload: undefined; result: SetupStatus }
  'setup.activate': { payload: { code: string }; result: ActivationResult }
  'setup.complete': { payload: SetupInput; result: LoginResult }

  // Dashboard / search ------------------------------------------------------------------------
  'dashboard.get': { payload: undefined; result: DashboardWidgetData }
  'search.global': { payload: SearchPayload; result: SearchResults }

  // Patients -----------------------------------------------------------------------------------
  'patients.list': {
    payload: PageQuery & {
      search?: string | null
      range?: string
      from?: string
      to?: string
      includeArchived?: boolean
    }
    result: Paged<PatientSummary>
  }
  'patients.get': { payload: IdPayload; result: Patient }
  'patients.profile': { payload: IdPayload; result: PatientProfile }
  'patients.create': { payload: PatientInput; result: Patient }
  'patients.update': { payload: { id: number; input: PatientInput }; result: Patient }
  'patients.archive': { payload: IdPayload; result: { ok: true } }
  'patients.restore': { payload: IdPayload; result: { ok: true } }
  'patients.timeline': { payload: PatientTimelinePayload; result: PatientTimelineEntry[] }
  'patients.addNote': { payload: PatientNotePayload; result: { ok: true } }
  'patients.financialSummary': { payload: IdPayload; result: PatientFinancialSummary }
  'patients.lookup': {
    payload: { term: string; limit?: number }
    result: { id: number; code: string; fullName: string; phone: string | null }[]
  }

  // Visits -------------------------------------------------------------------------------------
  'visits.list': { payload: VisitQuery; result: Paged<Visit> }
  'visits.get': { payload: IdPayload; result: Visit }
  'visits.create': { payload: VisitInput; result: Visit }
  'visits.update': { payload: { id: number; input: VisitInput }; result: Visit }
  'visits.finalize': { payload: IdPayload; result: Visit }
  'visits.delete': { payload: { id: number; reason: string }; result: { ok: true } }

  // Dental chart -------------------------------------------------------------------------------
  'chart.get': { payload: ChartGetPayload; result: DentalChartState }
  'chart.save': { payload: ChartSavePayload; result: DentalChartState }
  'chart.conditions': { payload: undefined; result: DentalCondition[] }
  'clinical.options': { payload: ClinicalOptionListPayload | undefined; result: ClinicalOption[] }
  'clinical.options.save': { payload: ClinicalOptionSavePayload; result: ClinicalOption }
  'clinical.options.deactivate': { payload: IdPayload; result: { ok: true } }

  // Prescriptions ------------------------------------------------------------------------------
  'prescriptions.list': {
    payload: PageQuery & { patientId?: number; from?: string; to?: string; status?: string }
    result: Paged<Prescription>
  }
  'prescriptions.get': { payload: IdPayload; result: Prescription }
  'prescriptions.create': { payload: PrescriptionInput; result: Prescription }
  'prescriptions.update': { payload: { id: number; input: PrescriptionInput }; result: Prescription }
  'prescriptions.void': { payload: PrescriptionVoidPayload; result: { ok: true } }

  // Referrals ----------------------------------------------------------------------------------
  'referrals.list': { payload: { patientId?: number | null; term?: string }; result: Referral[] }
  'referrals.create': { payload: ReferralInput; result: Referral }
  'referrals.updateStatus': { payload: ReferralStatusPayload; result: { ok: true } }

  // Appointments -------------------------------------------------------------------------------
  'appointments.list': { payload: AppointmentQuery; result: Paged<AppointmentSummary> }
  'appointments.get': { payload: IdPayload; result: AppointmentSummary }
  'appointments.create': { payload: AppointmentInput; result: AppointmentSummary }
  'appointments.update': { payload: { id: number; input: AppointmentInput }; result: AppointmentSummary }
  'appointments.setStatus': { payload: ChartStatusPayload; result: AppointmentSummary }
  'appointments.reschedule': { payload: ReschedulePayload; result: AppointmentSummary }
  'appointments.delete': { payload: { id: number; reason: string }; result: { ok: true } }

  // Queue --------------------------------------------------------------------------------------
  'queue.get': { payload: { date?: string } | undefined; result: QueueSnapshot }
  'queue.add': { payload: QueueAddPayload; result: QueueSnapshot }
  'queue.update': { payload: QueueUpdatePayload; result: QueueSnapshot }
  'queue.reorder': { payload: QueueReorderPayload; result: QueueSnapshot }

  // Treatments ---------------------------------------------------------------------------------
  'treatments.list': { payload: TreatmentListPayload; result: Paged<Treatment> }
  'treatments.save': { payload: TreatmentSavePayload; result: Treatment }
  'treatments.deactivate': { payload: IdPayload; result: { ok: true } }

  // Invoices -----------------------------------------------------------------------------------
  'invoices.list': { payload: InvoiceQuery; result: Paged<Invoice> }
  'invoices.get': { payload: IdPayload; result: Invoice }
  'invoices.create': { payload: InvoiceInput; result: Invoice }
  'invoices.update': { payload: { id: number; input: InvoiceInput }; result: Invoice }
  'invoices.void': { payload: VoidPayload; result: Invoice }
  'invoices.outstanding': { payload: { limit?: number } | undefined; result: OutstandingRow[] }
  'invoices.patientBalance': { payload: IdPayload; result: number }
  'invoices.byNumber': { payload: { invoiceNo: string }; result: Invoice | null }

  // Payments -----------------------------------------------------------------------------------
  'payments.list': { payload: PaymentQuery; result: Paged<Payment> }
  'payments.get': { payload: IdPayload; result: Payment }
  'payments.create': { payload: PaymentInput; result: Payment }
  'payments.void': { payload: VoidPayload; result: Payment }
  'payments.dashboard': { payload: PaymentDashboardPayload; result: PaymentDashboard }
  'payments.methods': { payload: { includeInactive?: boolean } | undefined; result: PaymentMethod[] }

  // Accounting ---------------------------------------------------------------------------------
  'accounting.summary': { payload: AccountingRangePayload; result: AccountingSummary }
  'accounting.revenue': {
    payload: AccountingRangePayload & { groupBy?: 'day' | 'month' }
    result: RevenueReportRow[]
  }
  'accounting.treatmentRevenue': { payload: AccountingRangePayload; result: TreatmentRevenueRow[] }
  'accounting.expenses.list': { payload: ExpenseQuery; result: Paged<Expense> }
  'accounting.expenses.create': { payload: ExpenseInput; result: Expense }
  'accounting.expenses.update': { payload: { id: number; input: ExpenseInput }; result: Expense }
  'accounting.expenses.void': { payload: VoidPayload; result: Expense }
  'accounting.categories': { payload: { includeInactive?: boolean } | undefined; result: ExpenseCategory[] }
  'accounting.categories.create': { payload: CategorySavePayload; result: ExpenseCategory }

  // Inventory ----------------------------------------------------------------------------------
  'inventory.list': { payload: InventoryQuery; result: Paged<InventoryItem> }
  'inventory.get': { payload: IdPayload; result: InventoryItem }
  'inventory.save': { payload: InventorySavePayload; result: InventoryItem }
  'inventory.stockIn': { payload: StockInInput; result: InventoryItem }
  'inventory.issue': { payload: StockIssueInput; result: InventoryItem }
  'inventory.batches': { payload: { itemId: number }; result: InventoryBatch[] }
  'inventory.transactions': { payload: InventoryTxnPayload; result: Paged<InventoryTransaction> }
  'inventory.suppliers': { payload: undefined; result: Supplier[] }
  'inventory.suppliers.save': { payload: SupplierSavePayload; result: Supplier }

  // Attachments --------------------------------------------------------------------------------
  'attachments.list': { payload: AttachmentListPayload; result: Paged<Attachment> }
  'attachments.add': { payload: AttachmentAddPayload; result: Attachment }
  'attachments.open': { payload: IdPayload; result: { ok: true } }
  'attachments.rename': { payload: AttachmentRenamePayload; result: Attachment }
  'attachments.delete': { payload: IdPayload; result: { ok: true } }
  'attachments.pick': { payload: { multiple?: boolean } | undefined; result: string[] }

  // Notifications ------------------------------------------------------------------------------
  'notifications.list': { payload: NotificationListPayload | undefined; result: Notification[] }
  'notifications.count': { payload: undefined; result: { unread: number } }
  'notifications.markRead': { payload: IdPayload; result: { ok: true } }
  'notifications.markAllRead': { payload: undefined; result: { ok: true } }
  'notifications.dismiss': { payload: IdPayload; result: { ok: true } }

  // Audit --------------------------------------------------------------------------------------
  'audit.list': { payload: AuditQuery & PageQuery; result: Paged<AuditEntry> }
  'audit.chain': { payload: undefined; result: AuditChainStatus }

  // People and permissions ---------------------------------------------------------------------
  'users.list': { payload: undefined; result: UserSummary[] }
  'users.create': { payload: UserSavePayload; result: UserSummary }
  'users.update': { payload: UserSavePayload & { id: number }; result: UserSummary }
  'roles.list': { payload: undefined; result: RoleSummary[] }
  'roles.create': { payload: RoleSavePayload; result: RoleSummary }
  'roles.update': { payload: RoleSavePayload & { id: number }; result: RoleSummary }
  'roles.delete': { payload: RoleDeletePayload; result: { ok: true } }
  'permissions.catalogue': {
    payload: { modules?: PermissionModule[] } | undefined
    result: PermissionCatalogEntry[]
  }
  'dentists.list': { payload: { includeInactive?: boolean } | undefined; result: Dentist[] }
  'dentists.save': { payload: DentistSavePayload; result: Dentist }
  'dentists.setActive': { payload: DentistActivePayload; result: Dentist }
  'dentists.signature': { payload: SignaturePayload; result: Dentist }
  'staff.list': { payload: undefined; result: StaffMember[] }
  'staff.save': { payload: StaffSavePayload; result: StaffMember }
  'staff.remove': { payload: IdPayload; result: { ok: true } }

  // Settings -----------------------------------------------------------------------------------
  'settings.snapshot': { payload: undefined; result: SettingsSnapshot }
  'settings.update': { payload: SettingsPatchPayload; result: SettingsSnapshot }
  'clinic.update': { payload: ClinicInput; result: ClinicProfile }
  'clinic.logo.save': { payload: ClinicLogoPayload; result: ClinicProfile }
  'clinic.logo.clear': { payload: undefined; result: ClinicProfile }

  // Backups ------------------------------------------------------------------------------------
  'backups.list': { payload: undefined; result: BackupRecord[] }
  'backups.create': { payload: BackupCreatePayload | undefined; result: BackupRecord }
  'backups.verify': { payload: BackupVerifyPayload; result: BackupInspection }
  'backups.delete': { payload: BackupDeletePayload; result: { ok: true } }
  'backups.restore': {
    payload: RestorePayload
    result: { restoredAt: string; preRestoreBackup: BackupRecord }
  }

  // Printing -----------------------------------------------------------------------------------
  'printers.list': { payload: undefined; result: PrinterInfo[] }
  'printers.profiles': { payload: undefined; result: PrinterProfile[] }
  'printers.save': { payload: PrinterSavePayload; result: PrinterProfile }
  'printers.delete': { payload: IdPayload; result: { ok: true } }
  'print.build': { payload: PrintBuildPayload; result: import('./printing/model').PrintDocument }
  'print.job': { payload: PrintOutPayload; result: import('./printing/model').PrintJobResult }
  'print.ready': { payload: PrintReadyPayload; result: import('./printing/model').PrintDocument }

  // Reports / exports / system ------------------------------------------------------------------
  'reports.data': { payload: ReportDataPayload; result: ReportDataResult }
  'reports.export': { payload: ReportExportPayload; result: ExportResult }
  'data.import': { payload: PatientImportPayload; result: PatientImportResult }
  'print.buildReport': {
    payload: ReportPrintResultPayload
    result: import('./printing/model').ReportDocument
  }
  'export.data': { payload: ExportPayload; result: ExportResult }
  'export.chooseFolder': { payload: ChooseFolderPayload | undefined; result: string | null }
  'system.integrity': { payload: IntegrityPayload | undefined; result: IntegrityReport }
  'system.about': { payload: undefined; result: AppInfoPayload }
  'system.dataCounts': { payload: undefined; result: Record<string, number> }
  'system.destructive': { payload: DestructivePayload; result: { affected: number; preBackup: BackupRecord } }
  'system.openPath': { payload: OpenPathPayload; result: { ok: true } }
  'diagnostics.logs': { payload: undefined; result: LogBundle }
  'diagnostics.exportLogs': { payload: { title?: string; suggestedName?: string }; result: string | null }
  'diagnostics.startWorker': {
    payload: { kind: 'integrity' | 'backup' | 'restore' | 'export' | 'print' | 'import' }
    result: { jobId: string; message: string }
  }
  'diagnostics.workerProgress': { payload: { jobId: string }; result: JobProgress | null }
  'data.revealDataFolder': { payload: undefined; result: { ok: true } }
  'data.openUserGuide': { payload: undefined; result: { ok: true } }
  'data.openBackupFolder': { payload: undefined; result: { ok: true } }
  'system.thirdPartyNotices': { payload: undefined; result: string }
  'system.runtimeInfo': { payload: undefined; result: RuntimeInfo }
  'system.openDialog': {
    payload:
      | {
          title?: string
          multiple?: boolean
          directory?: boolean
          filters?: { name: string; extensions: string[] }[]
        }
      | undefined
    result: string[]
  }
  'system.saveDialog': {
    payload: { title?: string; suggestedName?: string; filters?: { name: string; extensions: string[] }[] }
    result: string | null
  }
}

export type IpcChannel = keyof IpcChannelMap
export type IpcPayload<C extends IpcChannel> = IpcChannelMap[C]['payload']
export type IpcResultOf<C extends IpcChannel> = IpcChannelMap[C]['result']

// ---------------------------------------------------------------------------------------------
// Push events (main → renderer)
// ---------------------------------------------------------------------------------------------

export type AppEvent =
  | { type: 'session:changed'; payload: SessionSnapshot }
  | { type: 'job:progress'; payload: JobProgress }
  | { type: 'notifications:changed'; payload: { unread: number } }
  | { type: 'command'; payload: { command: string } }
  | { type: 'setup:changed'; payload: SetupStatus }

// ---------------------------------------------------------------------------------------------
// Preload bridge surface
// ---------------------------------------------------------------------------------------------

export interface DentivaApi {
  invoke<C extends IpcChannel>(channel: C, payload: IpcPayload<C>): Promise<IpcResult<IpcResultOf<C>>>
  subscribe(listener: (event: AppEvent) => void): () => void
  platform: string
}

declare global {
  interface Window {
    dentiva: DentivaApi
  }
}
