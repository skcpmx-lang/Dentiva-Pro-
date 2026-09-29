/**
 * Channel registry: the declarative table that binds every IPC channel to a permission, a payload schema
 * and a handler that calls the business services.
 *
 * A channel that is missing here simply cannot be called — the router refuses unknown channels and writes
 * an audit entry. This is also the only place that decides which permission a feature needs, which keeps
 * the RBAC specification and the implementation in one-to-one correspondence.
 */

import type { ZodType } from 'zod'
import type { IpcChannel, IpcChannelMap, IpcPayload } from '@shared/ipc'
import type { PermissionCode } from '@shared/permissions'
import type { JobProgress, PrinterInfo, PrinterProfile } from '@shared/types'
import type { PrintDocument, PrintJobResult, ReportDocument } from '@shared/printing/model'
import { AppError, notFound, validationError } from '@shared/errors'
import {
  accountingRangeSchema,
  appointmentInputSchema,
  appointmentQuerySchema,
  appointmentStatusSchema,
  attachmentAddSchema,
  attachmentDeleteSchema,
  attachmentListSchema,
  attachmentPickSchema,
  attachmentRenameSchema,
  auditQuerySchema,
  backupCreateSchema,
  backupDeleteSchema,
  backupVerifySchema,
  batchListSchema,
  categoryInputSchema,
  changePasswordSchema,
  chartGetSchema,
  chartSaveSchema,
  chooseFolderSchema,
  clinicInputSchema,
  clinicLogoSchema,
  clinicalOptionListSchema,
  clinicalOptionSaveSchema,
  dashboardGetSchema,
  dentistActiveSchema,
  dentistInputSchema,
  destructiveRequestSchema,
  emptySchema,
  expenseInputSchema,
  expenseQuerySchema,
  exportDataSchema,
  globalSearchSchema,
  idPayloadSchema,
  idWithReasonSchema,
  includeInactiveSchema,
  integritySchema,
  inventoryItemInputSchema,
  inventoryQuerySchema,
  inventoryTransactionsSchema,
  invoiceInputSchema,
  invoiceNumberSchema,
  invoiceQuerySchema,
  loginSchema,
  notificationListSchema,
  openDialogSchema,
  openPathSchema,
  outstandingSchema,
  patientArchiveSchema,
  patientRestoreSchema,
  patientListSchema,
  patientLookupSchema,
  patientInputSchema,
  patientNoteSchema,
  patientTimelineSchema,
  paymentInputSchema,
  paymentQuerySchema,
  permissionCatalogueSchema,
  prescriptionInputSchema,
  prescriptionListSchema,
  prescriptionVoidSchema,
  printBuildSchema,
  printJobSchema,
  printReadySchema,
  printerDeleteSchema,
  printerSaveSchema,
  queueAddSchema,
  queueGetSchema,
  queueReorderSchema,
  queueUpdateSchema,
  referralInputSchema,
  referralListSchema,
  referralStatusSchema,
  reportDataSchema,
  reportPrintSchema,
  rescheduleSchema,
  restoreRequestSchema,
  revenueQuerySchema,
  roleSaveSchema,
  saveDialogSchema,
  settingsPatchSchema,
  setupActivateSchema,
  setupInputSchema,
  signatureSchema,
  staffInputSchema,
  startWorkerSchema,
  stockInSchema,
  stockIssueSchema,
  supplierSaveSchema,
  treatmentDeactivateSchema,
  treatmentListSchema,
  treatmentSaveSchema,
  unlockSchema,
  unorderedIdSchema,
  updateWithInputSchema,
  userSaveSchema,
  visitInputSchema,
  visitListSchema,
  windowStateSchema,
  workerProgressSchema
} from '@shared/validation'
import { buildReportData } from '../services/reports'
import type { Services } from '../services/container'
import type { SessionManager } from '../security/session'
import type { LogBundle, RuntimeInfo } from '@shared/ipc'

/**
 * Actions that only the main process can perform: windows, dialogs, file system, printing.
 * The service layer stays free of Electron so it remains unit-testable.
 */
export interface RegistryHost {
  /** Current setup status (used by the wizard before a session exists). */
  setupStatus(): ReturnType<Services['setup']['status']>
  /** Default data folder shown by the wizard. */
  defaultDataRoot(): string
  listPrinters(): Promise<PrinterInfo[]>
  /** Build the print document for an entity; used for preview, printing and PDF. */
  buildDocument(payload: IpcPayload<'print.build'>): PrintDocument
  /** Render, print or export to PDF. */
  print(payload: IpcPayload<'print.job'>): Promise<PrintJobResult>
  /** The print window asks for the document that belongs to its job id. */
  documentForJob(jobId: string): PrintDocument | null
  saveWindowState(state: IpcPayload<'app.windowState'>): void
  pickFiles(input: IpcPayload<'system.openDialog'>): Promise<string[]>
  pickFolder(input: IpcPayload<'export.chooseFolder'>): Promise<string | null>
  pickSavePath(input: IpcPayload<'system.saveDialog'>): Promise<string | null>
  openPath(target: string): Promise<void>
  /** Copy a finished backup folder to a location the user picked. Returns the new path. */
  copyBackupTo(folderPath: string, destinationParent: string): string
  /** Rebuild the service container after restore swapped the database file. */
  rebuildContainer(): void
  /** End the session because a restore replaced the user table. */
  setTerminalUnauthenticated(): void
  /** Diagnostics surfaces. */
  recentLogs(): LogBundle
  exportLogs(input: IpcPayload<'diagnostics.exportLogs'>): Promise<string | null>
  dataRoot(): string
  userGuidePath(): string
  thirdPartyNotices(): string
  runtimeInfo(): RuntimeInfo
  /** Long jobs run in the background and report through `job:progress` events. */
  startWorker(
    kind: IpcPayload<'diagnostics.startWorker'>['kind']
  ): Promise<{ jobId: string; message: string }>
  workerProgress(jobId: string): JobProgress | null
}

export interface HandlerContext {
  services: Services
  session: SessionManager
  host: RegistryHost
  setTerminalUnauthenticated: () => void
}

export interface ChannelHandler<TPayload = unknown, TResult = unknown> {
  /** Permission required before the handler runs, or `null` for public channels (sign-in, setup). */
  permission: PermissionCode | null
  /** Payload validation; `null` means the channel takes no payload at all. */
  schema: ZodType | null
  /** Refuse the call unless the session is usable. Defaults to true. */
  requiresSession?: boolean
  handler: (ctx: HandlerContext, payload: TPayload) => TResult | Promise<TResult>
}

export type Registry = {
  [C in IpcChannel]: ChannelHandler<IpcPayload<C>, IpcChannelMap[C]['result']>
}

function requireValue<T>(value: T | null | undefined, field: string, message: string): T {
  if (value === null || value === undefined) {
    throw validationError(message, [{ field, message }])
  }
  return value
}

export function createRegistry(): Registry {
  return {
    // -----------------------------------------------------------------------------------------
    // Application and session
    // -----------------------------------------------------------------------------------------
    'app.ready': {
      permission: null,
      schema: emptySchema,
      requiresSession: false,
      handler: () => ({ ok: true as const })
    },
    'app.bootstrap': {
      permission: null,
      schema: emptySchema,
      requiresSession: false,
      handler: (ctx) => ctx.services.admin.aboutInfo()
    },
    'app.windowState': {
      permission: null,
      schema: windowStateSchema,
      requiresSession: false,
      handler: (ctx, payload) => {
        ctx.host.saveWindowState(payload)
        return { ok: true as const }
      }
    },
    'auth.status': {
      permission: null,
      schema: emptySchema,
      requiresSession: false,
      handler: (ctx) => ctx.session.snapshot()
    },
    'auth.login': {
      permission: null,
      schema: loginSchema,
      requiresSession: false,
      handler: (ctx, payload) => ctx.services.auth.login(payload.username, payload.password)
    },
    'auth.logout': {
      permission: null,
      schema: emptySchema,
      requiresSession: false,
      handler: (ctx) => {
        ctx.services.auth.logout()
        return { ok: true as const }
      }
    },
    'auth.lock': {
      permission: null,
      schema: emptySchema,
      requiresSession: false,
      handler: (ctx) => {
        ctx.session.lock('manual')
        return { ok: true as const }
      }
    },
    'auth.unlock': {
      permission: null,
      schema: unlockSchema,
      requiresSession: false,
      handler: (ctx, payload) => ctx.services.auth.unlock(payload.password)
    },
    'auth.touch': {
      permission: null,
      schema: emptySchema,
      requiresSession: false,
      handler: (ctx) => {
        ctx.session.touch()
        return { ok: true as const }
      }
    },
    'auth.changePassword': {
      permission: null,
      schema: changePasswordSchema,
      handler: (ctx, payload) => {
        ctx.services.auth.changeOwnPassword(payload.currentPassword, payload.newPassword)
        return { ok: true as const }
      }
    },
    'session.snapshot': {
      permission: null,
      schema: emptySchema,
      requiresSession: false,
      handler: (ctx) => ctx.session.snapshot()
    },

    // -----------------------------------------------------------------------------------------
    // Setup and activation
    // -----------------------------------------------------------------------------------------
    'setup.status': {
      permission: null,
      schema: emptySchema,
      requiresSession: false,
      handler: (ctx) => ctx.host.setupStatus()
    },
    'setup.activate': {
      permission: null,
      schema: setupActivateSchema,
      requiresSession: false,
      handler: (ctx, payload) => ctx.services.setup.activate(payload.code)
    },
    'setup.complete': {
      permission: null,
      schema: setupInputSchema,
      requiresSession: false,
      handler: (ctx, payload) => ctx.services.setup.complete(payload)
    },

    // -----------------------------------------------------------------------------------------
    // Dashboard and search
    // -----------------------------------------------------------------------------------------
    'dashboard.get': {
      permission: 'dashboard.view',
      schema: dashboardGetSchema,
      handler: (ctx) => ctx.services.clinical.getDashboard()
    },
    'search.global': {
      permission: null,
      schema: globalSearchSchema,
      handler: (ctx, payload) =>
        ctx.services.clinical.globalSearch(payload.term, payload.entityTypes, payload.limit ?? 20)
    },

    // -----------------------------------------------------------------------------------------
    // Patients
    // -----------------------------------------------------------------------------------------
    'patients.list': {
      permission: 'patients.view',
      schema: patientListSchema,
      handler: (ctx, payload) => ctx.services.clinical.listPatients(payload as never)
    },
    'patients.get': {
      permission: 'patients.view',
      schema: idPayloadSchema,
      handler: (ctx, payload) => ctx.services.clinical.getPatient(payload.id)
    },
    'patients.profile': {
      permission: 'patients.view',
      schema: idPayloadSchema,
      handler: (ctx, payload) => ctx.services.clinical.getPatientProfile(payload.id)
    },
    'patients.create': {
      permission: 'patients.create',
      schema: patientInputSchema,
      handler: (ctx, payload) => ctx.services.clinical.createPatient(payload)
    },
    'patients.update': {
      permission: 'patients.edit',
      schema: updateWithInputSchema(patientInputSchema),
      handler: (ctx, payload) => ctx.services.clinical.updatePatient(payload.id, payload.input)
    },
    'patients.archive': {
      permission: 'patients.delete',
      schema: patientArchiveSchema,
      handler: (ctx, payload) => {
        ctx.services.clinical.archivePatient(payload.id)
        return { ok: true as const }
      }
    },
    'patients.restore': {
      permission: 'patients.delete',
      schema: patientRestoreSchema,
      handler: (ctx, payload) => {
        ctx.services.clinical.restorePatient(payload.id)
        return { ok: true as const }
      }
    },
    'patients.timeline': {
      permission: 'patients.view',
      schema: patientTimelineSchema,
      handler: (ctx, payload) => ctx.services.clinical.patientTimeline(payload.patientId)
    },
    'patients.addNote': {
      permission: 'patients.edit',
      schema: patientNoteSchema,
      handler: (ctx, payload) => {
        ctx.services.clinical.addPatientNote(payload.patientId, payload.note)
        return { ok: true as const }
      }
    },
    'patients.financialSummary': {
      permission: 'patients.view',
      schema: idPayloadSchema,
      handler: (ctx, payload) => ctx.services.patients.financialSummary(payload.id)
    },
    'patients.lookup': {
      permission: null,
      schema: patientLookupSchema,
      handler: (ctx, payload) =>
        ctx.services.billing.searchPatientsForBilling(payload.term, payload.limit ?? 12)
    },

    // -----------------------------------------------------------------------------------------
    // Visits
    // -----------------------------------------------------------------------------------------
    'visits.list': {
      permission: 'visits.view',
      schema: visitListSchema,
      handler: (ctx, payload) => ctx.services.clinical.listVisits(payload as never)
    },
    'visits.get': {
      permission: 'visits.view',
      schema: idPayloadSchema,
      handler: (ctx, payload) => ctx.services.clinical.getVisit(payload.id)
    },
    'visits.create': {
      permission: 'visits.create',
      schema: visitInputSchema,
      handler: (ctx, payload) => ctx.services.clinical.createVisit(payload)
    },
    'visits.update': {
      permission: 'visits.edit',
      schema: updateWithInputSchema(visitInputSchema),
      handler: (ctx, payload) => ctx.services.clinical.updateVisit(payload.id, payload.input)
    },
    'visits.finalize': {
      permission: 'visits.finalize',
      schema: idPayloadSchema,
      handler: (ctx, payload) => ctx.services.clinical.finalizeVisit(payload.id)
    },
    'visits.delete': {
      permission: 'visits.delete',
      schema: idWithReasonSchema,
      handler: (ctx, payload) => {
        ctx.services.clinical.deleteVisit(payload.id)
        return { ok: true as const }
      }
    },

    // -----------------------------------------------------------------------------------------
    // Dental chart
    // -----------------------------------------------------------------------------------------
    'chart.get': {
      permission: 'chart.view',
      schema: chartGetSchema,
      handler: (ctx, payload) => ctx.services.clinical.getChart(payload.patientId, payload.visitId ?? null)
    },
    'chart.save': {
      permission: 'chart.edit',
      schema: chartSaveSchema,
      handler: (ctx, payload) =>
        ctx.services.clinical.saveChart(payload.patientId, payload.entries, payload.visitId ?? null)
    },
    'chart.conditions': {
      permission: 'chart.view',
      schema: emptySchema,
      handler: (ctx) => ctx.services.clinical.listConditions()
    },
    'clinical.options': {
      permission: 'visits.view',
      schema: clinicalOptionListSchema,
      handler: (ctx, payload) => {
        const options = ctx.services.clinical.clinicalOptions(payload?.listCode)
        return payload?.includeInactive ? options : options.filter((option) => option.isActive)
      }
    },
    'clinical.options.save': {
      permission: 'treatments.manage',
      schema: clinicalOptionSaveSchema,
      handler: (ctx, payload) => ctx.services.clinical.saveClinicalOption(payload)
    },
    'clinical.options.deactivate': {
      permission: 'treatments.manage',
      schema: idPayloadSchema,
      handler: (ctx, payload) => {
        ctx.services.clinical.deactivateClinicalOption(payload.id)
        return { ok: true as const }
      }
    },

    // -----------------------------------------------------------------------------------------
    // Prescriptions
    // -----------------------------------------------------------------------------------------
    'prescriptions.list': {
      permission: 'prescriptions.view',
      schema: prescriptionListSchema,
      handler: (ctx, payload) => ctx.services.clinical.listPrescriptions(payload as never)
    },
    'prescriptions.get': {
      permission: 'prescriptions.view',
      schema: idPayloadSchema,
      handler: (ctx, payload) => ctx.services.clinical.getPrescription(payload.id)
    },
    'prescriptions.create': {
      permission: 'prescriptions.create',
      schema: prescriptionInputSchema,
      handler: (ctx, payload) => ctx.services.clinical.createPrescription(payload)
    },
    'prescriptions.update': {
      permission: 'prescriptions.edit',
      schema: updateWithInputSchema(prescriptionInputSchema),
      handler: (ctx, payload) => ctx.services.clinical.updatePrescription(payload.id, payload.input)
    },
    'prescriptions.void': {
      permission: 'prescriptions.delete',
      schema: prescriptionVoidSchema,
      handler: (ctx, payload) => {
        ctx.services.clinical.voidPrescription(payload.id, payload.reason)
        return { ok: true as const }
      }
    },

    // -----------------------------------------------------------------------------------------
    // Referrals
    // -----------------------------------------------------------------------------------------
    'referrals.list': {
      permission: 'visits.view',
      schema: referralListSchema,
      handler: (ctx, payload) => {
        const patientId = requireValue(payload.patientId, 'patientId', 'Choose a patient first.')
        return ctx.services.clinical.listReferrals(patientId)
      }
    },
    'referrals.create': {
      permission: 'visits.create',
      schema: referralInputSchema,
      handler: (ctx, payload) => ctx.services.clinical.createReferral(payload)
    },
    'referrals.updateStatus': {
      permission: 'visits.edit',
      schema: referralStatusSchema,
      handler: (ctx, payload) => {
        ctx.services.clinical.updateReferralStatus(payload.id, payload.status, payload.outcome ?? null)
        return { ok: true as const }
      }
    },

    // -----------------------------------------------------------------------------------------
    // Appointments and queue
    // -----------------------------------------------------------------------------------------
    'appointments.list': {
      permission: 'appointments.view',
      schema: appointmentQuerySchema,
      handler: (ctx, payload) => ctx.services.clinical.listAppointments(payload as never)
    },
    'appointments.get': {
      permission: 'appointments.view',
      schema: idPayloadSchema,
      handler: (ctx, payload) => ctx.services.clinical.getAppointment(payload.id)
    },
    'appointments.create': {
      permission: 'appointments.create',
      schema: appointmentInputSchema,
      handler: (ctx, payload) => ctx.services.clinical.createAppointment(payload)
    },
    'appointments.update': {
      permission: 'appointments.edit',
      schema: updateWithInputSchema(appointmentInputSchema),
      handler: (ctx, payload) => ctx.services.clinical.updateAppointment(payload.id, payload.input)
    },
    'appointments.setStatus': {
      permission: 'appointments.edit',
      schema: appointmentStatusSchema,
      handler: (ctx, payload) =>
        ctx.services.clinical.setAppointmentStatus(payload.id, payload.status, payload.reason ?? null)
    },
    'appointments.reschedule': {
      permission: 'appointments.edit',
      schema: rescheduleSchema,
      handler: (ctx, payload) =>
        ctx.services.clinical.rescheduleAppointment(payload.id, {
          appointmentDate: payload.appointmentDate,
          startTime: payload.startTime,
          reason: payload.reason ?? null
        })
    },
    'appointments.delete': {
      permission: 'appointments.delete',
      schema: idWithReasonSchema,
      handler: (ctx, payload) => {
        ctx.services.clinical.deleteAppointment(payload.id)
        return { ok: true as const }
      }
    },
    'queue.get': {
      permission: 'queue.view',
      schema: queueGetSchema,
      handler: (ctx, payload) => ctx.services.clinical.getQueue(payload?.date)
    },
    'queue.add': {
      permission: 'queue.manage',
      schema: queueAddSchema,
      handler: (ctx, payload) => ctx.services.clinical.addToQueue(payload)
    },
    'queue.update': {
      permission: 'queue.manage',
      schema: queueUpdateSchema,
      handler: (ctx, payload) =>
        ctx.services.clinical.updateQueueEntry(payload.id, {
          status: payload.status,
          priority: payload.priority,
          dentistId: payload.dentistId,
          notes: payload.notes
        })
    },
    'queue.reorder': {
      permission: 'queue.reorder',
      schema: queueReorderSchema,
      handler: (ctx, payload) => ctx.services.clinical.reorderQueue(payload.queueDate, payload.orderedIds)
    },

    // -----------------------------------------------------------------------------------------
    // Treatment catalogue
    // -----------------------------------------------------------------------------------------
    'treatments.list': {
      permission: 'treatments.view',
      schema: treatmentListSchema,
      handler: (ctx, payload) => ctx.services.clinical.listTreatments(payload)
    },
    'treatments.save': {
      permission: 'treatments.manage',
      schema: treatmentSaveSchema,
      handler: (ctx, payload) => ctx.services.clinical.saveTreatment(payload)
    },
    'treatments.deactivate': {
      permission: 'treatments.manage',
      schema: treatmentDeactivateSchema,
      handler: (ctx, payload) => {
        ctx.services.clinical.deactivateTreatment(payload.id)
        return { ok: true as const }
      }
    },

    // -----------------------------------------------------------------------------------------
    // Invoices and payments
    // -----------------------------------------------------------------------------------------
    'invoices.list': {
      permission: 'invoices.view',
      schema: invoiceQuerySchema,
      handler: (ctx, payload) => ctx.services.billing.listInvoices(payload as never)
    },
    'invoices.get': {
      permission: 'invoices.view',
      schema: idPayloadSchema,
      handler: (ctx, payload) => ctx.services.billing.getInvoice(payload.id)
    },
    'invoices.create': {
      permission: 'invoices.create',
      schema: invoiceInputSchema,
      handler: (ctx, payload) => ctx.services.billing.createInvoice(payload)
    },
    'invoices.update': {
      permission: 'invoices.edit',
      schema: updateWithInputSchema(invoiceInputSchema),
      handler: (ctx, payload) => ctx.services.billing.updateInvoice(payload.id, payload.input)
    },
    'invoices.void': {
      permission: 'invoices.void',
      schema: idWithReasonSchema,
      handler: (ctx, payload) => ctx.services.billing.voidInvoice(payload.id, payload.reason)
    },
    'invoices.outstanding': {
      permission: 'invoices.view',
      schema: outstandingSchema,
      handler: (ctx, payload) => {
        const rows = ctx.services.billing.outstandingInvoices()
        return payload?.limit ? rows.slice(0, payload.limit) : rows
      }
    },
    'invoices.patientBalance': {
      permission: 'invoices.view',
      schema: idPayloadSchema,
      handler: (ctx, payload) => ctx.services.billing.patientBalance(payload.id)
    },
    'invoices.byNumber': {
      permission: 'invoices.view',
      schema: invoiceNumberSchema,
      handler: (ctx, payload) => ctx.services.billing.findInvoiceByNumber(payload.invoiceNo)
    },
    'payments.list': {
      permission: 'payments.view',
      schema: paymentQuerySchema,
      handler: (ctx, payload) => ctx.services.billing.listPayments(payload as never)
    },
    'payments.get': {
      permission: 'payments.view',
      schema: idPayloadSchema,
      handler: (ctx, payload) => ctx.services.billing.getPayment(payload.id)
    },
    'payments.create': {
      permission: 'payments.create',
      schema: paymentInputSchema,
      handler: (ctx, payload) => ctx.services.billing.createPayment(payload)
    },
    'payments.void': {
      permission: 'payments.void',
      schema: idWithReasonSchema,
      handler: (ctx, payload) => ctx.services.billing.voidPayment(payload.id, payload.reason)
    },
    'payments.dashboard': {
      permission: 'payments.view',
      schema: paymentQuerySchema,
      handler: (ctx, payload) => ctx.services.billing.paymentDashboard(payload as never)
    },
    'payments.methods': {
      permission: null,
      schema: includeInactiveSchema,
      handler: (ctx, payload) => ctx.services.billing.paymentMethods(payload?.includeInactive ?? false)
    },

    // -----------------------------------------------------------------------------------------
    // Accounting
    // -----------------------------------------------------------------------------------------
    'accounting.summary': {
      permission: 'accounting.view',
      schema: accountingRangeSchema,
      handler: (ctx, payload) => ctx.services.billing.accountingSummary(payload.from, payload.to)
    },
    'accounting.revenue': {
      permission: 'reports.financial.view',
      schema: revenueQuerySchema,
      handler: (ctx, payload) =>
        ctx.services.billing.revenueReport(payload.from ?? '', payload.to ?? '', payload.groupBy ?? 'day')
    },
    'accounting.treatmentRevenue': {
      permission: 'reports.financial.view',
      schema: accountingRangeSchema,
      handler: (ctx, payload) => ctx.services.billing.treatmentRevenue(payload.from ?? '', payload.to ?? '')
    },
    'accounting.expenses.list': {
      permission: 'accounting.view',
      schema: expenseQuerySchema,
      handler: (ctx, payload) => ctx.services.billing.listExpenses(payload as never)
    },
    'accounting.expenses.create': {
      permission: 'accounting.manage',
      schema: expenseInputSchema,
      handler: (ctx, payload) => ctx.services.billing.createExpense(payload)
    },
    'accounting.expenses.update': {
      permission: 'accounting.manage',
      schema: updateWithInputSchema(expenseInputSchema),
      handler: (ctx, payload) => ctx.services.billing.updateExpense(payload.id, payload.input)
    },
    'accounting.expenses.void': {
      permission: 'accounting.manage',
      schema: idWithReasonSchema,
      handler: (ctx, payload) => ctx.services.billing.voidExpense(payload.id, payload.reason)
    },
    'accounting.categories': {
      permission: null,
      schema: includeInactiveSchema,
      handler: (ctx, payload) => ctx.services.billing.expenseCategories(payload?.includeInactive ?? false)
    },
    'accounting.categories.create': {
      permission: 'accounting.manage',
      schema: categoryInputSchema,
      handler: (ctx, payload) => ctx.services.billing.saveExpenseCategory(payload)
    },

    // -----------------------------------------------------------------------------------------
    // Inventory
    // -----------------------------------------------------------------------------------------
    'inventory.list': {
      permission: 'inventory.view',
      schema: inventoryQuerySchema,
      handler: (ctx, payload) => ctx.services.billing.listInventory(payload as never)
    },
    'inventory.get': {
      permission: 'inventory.view',
      schema: idPayloadSchema,
      handler: (ctx, payload) => ctx.services.billing.getInventoryItem(payload.id)
    },
    'inventory.save': {
      permission: 'inventory.manage',
      schema: inventoryItemInputSchema,
      handler: (ctx, payload) => ctx.services.billing.saveInventoryItem(payload)
    },
    'inventory.stockIn': {
      permission: 'inventory.manage',
      schema: stockInSchema,
      handler: (ctx, payload) => ctx.services.billing.stockIn(payload).item
    },
    'inventory.issue': {
      permission: 'inventory.adjust',
      schema: stockIssueSchema,
      handler: (ctx, payload) => ctx.services.billing.issueStock(payload)
    },
    'inventory.batches': {
      permission: 'inventory.view',
      schema: batchListSchema,
      handler: (ctx, payload) => ctx.services.billing.inventoryBatches(payload.itemId)
    },
    'inventory.transactions': {
      permission: 'inventory.view',
      schema: inventoryTransactionsSchema,
      handler: (ctx, payload) => ctx.services.billing.inventoryTransactions(payload)
    },
    'inventory.suppliers': {
      permission: 'inventory.view',
      schema: emptySchema,
      handler: (ctx) => ctx.services.billing.suppliers()
    },
    'inventory.suppliers.save': {
      permission: 'inventory.manage',
      schema: supplierSaveSchema,
      handler: (ctx, payload) => {
        const { id, ...input } = payload
        return ctx.services.billing.createSupplier(input, id)
      }
    },

    // -----------------------------------------------------------------------------------------
    // Attachments
    // -----------------------------------------------------------------------------------------
    'attachments.list': {
      permission: 'patients.attachments.view',
      schema: attachmentListSchema,
      handler: (ctx, payload) => ctx.services.billing.listAttachments(payload as never)
    },
    'attachments.add': {
      permission: 'patients.attachments.manage',
      schema: attachmentAddSchema,
      handler: (ctx, payload) => ctx.services.billing.attachFile(payload)
    },
    'attachments.open': {
      permission: 'patients.attachments.view',
      schema: idPayloadSchema,
      handler: async (ctx, payload) => {
        const target = ctx.services.billing.attachmentPath(payload.id)
        await ctx.host.openPath(target)
        return { ok: true as const }
      }
    },
    'attachments.rename': {
      permission: 'patients.attachments.manage',
      schema: attachmentRenameSchema,
      handler: (ctx, payload) => ctx.services.billing.renameAttachment(payload.id, payload.title)
    },
    'attachments.delete': {
      permission: 'patients.attachments.manage',
      schema: attachmentDeleteSchema,
      handler: (ctx, payload) => {
        ctx.services.billing.deleteAttachment(payload.id)
        return { ok: true as const }
      }
    },
    'attachments.pick': {
      permission: 'patients.attachments.manage',
      schema: attachmentPickSchema,
      handler: (ctx, payload) =>
        ctx.host.pickFiles({
          title: 'Choose a file to attach',
          multiple: payload?.multiple ?? false,
          filters: [
            { name: 'Documents and images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'doc', 'docx'] }
          ]
        })
    },

    // -----------------------------------------------------------------------------------------
    // Notifications
    // -----------------------------------------------------------------------------------------
    'notifications.list': {
      permission: 'notifications.view',
      schema: notificationListSchema,
      handler: (ctx, payload) =>
        ctx.services.clinical.listNotifications(payload?.onlyUnread ?? false, payload?.limit ?? 50)
    },
    'notifications.count': {
      permission: null,
      schema: emptySchema,
      handler: (ctx) => ({ unread: ctx.services.clinical.notificationCount() })
    },
    'notifications.markRead': {
      permission: 'notifications.view',
      schema: idPayloadSchema,
      handler: (ctx, payload) => {
        ctx.services.clinical.markNotificationRead(payload.id)
        return { ok: true as const }
      }
    },
    'notifications.markAllRead': {
      permission: 'notifications.view',
      schema: emptySchema,
      handler: (ctx) => {
        ctx.services.clinical.markAllNotificationsRead()
        return { ok: true as const }
      }
    },
    'notifications.dismiss': {
      permission: 'notifications.manage',
      schema: idPayloadSchema,
      handler: (ctx, payload) => {
        ctx.services.clinical.dismissNotification(payload.id)
        return { ok: true as const }
      }
    },

    // -----------------------------------------------------------------------------------------
    // Audit and system
    // -----------------------------------------------------------------------------------------
    'audit.list': {
      permission: 'audit.view',
      schema: auditQuerySchema,
      handler: (ctx, payload) => ctx.services.admin.listAudit(payload as never)
    },
    'audit.chain': {
      permission: 'audit.view',
      schema: emptySchema,
      handler: (ctx) => ctx.services.admin.auditChainStatus()
    },
    'system.integrity': {
      permission: 'settings.view',
      schema: integritySchema,
      handler: (ctx, payload) => ctx.services.admin.runIntegrity(payload?.deep ?? false)
    },
    'system.about': {
      permission: null,
      schema: emptySchema,
      requiresSession: false,
      handler: (ctx) => ctx.services.admin.aboutInfo()
    },
    'system.dataCounts': {
      permission: 'settings.view',
      schema: emptySchema,
      handler: (ctx) => ctx.services.billing.datasetCounts()
    },
    'system.destructive': {
      permission: 'data.destructive',
      schema: destructiveRequestSchema,
      handler: async (ctx, payload) => {
        const result = await ctx.services.admin.runDestructive(payload)
        return { affected: result.affected, preBackup: result.preBackup }
      }
    },
    'system.openPath': {
      permission: null,
      schema: openPathSchema,
      handler: async (ctx, payload) => {
        await ctx.host.openPath(payload.path)
        return { ok: true as const }
      }
    },
    'system.openDialog': {
      permission: null,
      schema: openDialogSchema,
      handler: (ctx, payload) => ctx.host.pickFiles(payload)
    },
    'system.saveDialog': {
      permission: null,
      schema: saveDialogSchema,
      handler: (ctx, payload) => ctx.host.pickSavePath(payload)
    },

    // -----------------------------------------------------------------------------------------
    // Settings, people and permissions
    // -----------------------------------------------------------------------------------------
    'settings.snapshot': {
      permission: 'settings.view',
      schema: emptySchema,
      handler: (ctx) => ctx.services.admin.settingsSnapshot()
    },
    'settings.update': {
      permission: 'settings.manage',
      schema: settingsPatchSchema,
      handler: (ctx, payload) => ctx.services.admin.updateSettings(payload.patch as never)
    },
    'clinic.update': {
      permission: 'settings.manage',
      schema: clinicInputSchema,
      handler: (ctx, payload) => ctx.services.admin.updateClinic(payload)
    },
    'clinic.logo.save': {
      permission: 'settings.manage',
      schema: clinicLogoSchema,
      handler: (ctx, payload) => ctx.services.admin.saveClinicLogo(payload.sourcePath)
    },
    'clinic.logo.clear': {
      permission: 'settings.manage',
      schema: emptySchema,
      handler: (ctx) => ctx.services.admin.clearClinicLogo()
    },
    'users.list': {
      permission: 'users.view',
      schema: emptySchema,
      handler: (ctx) => ctx.services.auth.listUsers()
    },
    'users.create': {
      permission: 'users.manage',
      schema: userSaveSchema,
      handler: (ctx, payload) => {
        const password = requireValue(payload.password, 'password', 'Enter a password for the new user.')
        return ctx.services.auth.createUser(payload, password)
      }
    },
    'users.update': {
      permission: 'users.manage',
      schema: userSaveSchema,
      handler: (ctx, payload) => {
        const id = requireValue(payload.id, 'id', 'Choose the user to update.')
        return ctx.services.auth.updateUser(id, payload, payload.password)
      }
    },
    'roles.list': {
      permission: 'users.view',
      schema: emptySchema,
      handler: (ctx) => ctx.services.auth.listRoles()
    },
    'roles.create': {
      permission: 'roles.manage',
      schema: roleSaveSchema,
      handler: (ctx, payload) =>
        ctx.services.auth.createRole({
          code: payload.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 40),
          name: payload.name,
          description: payload.description ?? null,
          permissions: payload.permissions
        })
    },
    'roles.update': {
      permission: 'roles.manage',
      schema: roleSaveSchema,
      handler: (ctx, payload) => {
        const id = requireValue(payload.id, 'id', 'Choose the role to update.')
        return ctx.services.auth.updateRole(id, {
          name: payload.name,
          description: payload.description ?? null,
          permissions: payload.permissions
        })
      }
    },
    'roles.delete': {
      permission: 'roles.manage',
      schema: unorderedIdSchema,
      handler: (ctx, payload) => {
        ctx.services.auth.deleteRole(payload.id)
        return { ok: true as const }
      }
    },
    'permissions.catalogue': {
      permission: 'users.view',
      schema: permissionCatalogueSchema,
      handler: (ctx, payload) => {
        const entries = ctx.services.permissions.catalogue()
        const modules = payload?.modules
        return modules && modules.length > 0
          ? entries.filter((entry) => modules.includes(entry.module))
          : entries
      }
    },
    'dentists.list': {
      permission: 'staff.view',
      schema: includeInactiveSchema,
      handler: (ctx, payload) => ctx.services.admin.listDentists(payload?.includeInactive ?? true)
    },
    'dentists.save': {
      permission: 'staff.manage',
      schema: dentistInputSchema,
      handler: (ctx, payload) => {
        const { id, ...input } = payload
        return ctx.services.admin.saveDentist(input, id)
      }
    },
    'dentists.setActive': {
      permission: 'staff.manage',
      schema: dentistActiveSchema,
      handler: (ctx, payload) => ctx.services.admin.setDentistActive(payload.id, payload.isActive)
    },
    'dentists.signature': {
      permission: 'staff.manage',
      schema: signatureSchema,
      handler: (ctx, payload) => ctx.services.admin.saveDentistSignature(payload.id, payload.sourcePath)
    },
    'staff.list': {
      permission: 'staff.view',
      schema: emptySchema,
      handler: (ctx) => ctx.services.admin.listStaff()
    },
    'staff.save': {
      permission: 'staff.manage',
      schema: staffInputSchema,
      handler: (ctx, payload) => {
        const { id, ...input } = payload
        return ctx.services.admin.saveStaff(input, id)
      }
    },
    'staff.remove': {
      permission: 'staff.manage',
      schema: unorderedIdSchema,
      handler: (ctx, payload) => {
        ctx.services.admin.removeStaff(payload.id)
        return { ok: true as const }
      }
    },

    // -----------------------------------------------------------------------------------------
    // Backups and restore
    // -----------------------------------------------------------------------------------------
    'backups.list': {
      permission: 'backup.create',
      schema: emptySchema,
      handler: (ctx) => ctx.services.admin.listBackups()
    },
    'backups.create': {
      permission: 'backup.create',
      schema: backupCreateSchema,
      handler: async (ctx, payload) => {
        const record = await ctx.services.admin.createBackup('manual', {
          includeAttachments: payload?.includeAttachments ?? true,
          notes: payload?.notes ?? null
        })
        if (payload?.targetFolder) {
          ctx.host.copyBackupTo(record.path, payload.targetFolder)
        }
        return record
      }
    },
    'backups.verify': {
      permission: 'backup.restore',
      schema: backupVerifySchema,
      handler: (ctx, payload) => ctx.services.admin.verifyBackup(payload.folderPath)
    },
    'backups.delete': {
      permission: 'backup.create',
      schema: backupDeleteSchema,
      handler: (ctx, payload) => {
        ctx.services.admin.deleteBackup(payload.id, payload.deleteFiles ?? false)
        return { ok: true as const }
      }
    },
    'backups.restore': {
      permission: 'backup.restore',
      schema: restoreRequestSchema,
      handler: async (ctx, payload) => {
        const result = await ctx.services.admin.restoreBackup(payload)
        ctx.host.rebuildContainer()
        ctx.setTerminalUnauthenticated()
        return result
      }
    },

    // -----------------------------------------------------------------------------------------
    // Printing
    // -----------------------------------------------------------------------------------------
    'printers.list': {
      permission: 'printers.manage',
      schema: emptySchema,
      handler: (ctx) => ctx.host.listPrinters()
    },
    'printers.profiles': {
      permission: null,
      schema: emptySchema,
      handler: (ctx) => ctx.services.admin.printerProfiles()
    },
    'printers.save': {
      permission: 'printers.manage',
      schema: printerSaveSchema,
      handler: (ctx, payload) =>
        ctx.services.admin.savePrinterProfile({ ...(payload as PrinterProfile), id: payload.id ?? 0 })
    },
    'printers.delete': {
      permission: 'printers.manage',
      schema: printerDeleteSchema,
      handler: (ctx, payload) => {
        ctx.services.admin.deletePrinterProfile(payload.id)
        return { ok: true as const }
      }
    },
    'print.build': {
      permission: null,
      schema: printBuildSchema,
      handler: (ctx, payload) => ctx.host.buildDocument(payload)
    },
    'print.buildReport': {
      permission: 'reports.financial.view',
      schema: reportPrintSchema,
      handler: (ctx, payload): ReportDocument => ctx.services.admin.buildReportPrint(payload)
    },
    'print.job': {
      permission: null,
      schema: printJobSchema,
      handler: (ctx, payload) => ctx.host.print(payload)
    },
    'print.ready': {
      permission: null,
      schema: printReadySchema,
      requiresSession: false,
      handler: (ctx, payload) => {
        const document = ctx.host.documentForJob(payload.jobId)
        if (!document) throw notFound('Print job', payload.jobId)
        return document
      }
    },

    // -----------------------------------------------------------------------------------------
    // Reports, exports and diagnostics
    // -----------------------------------------------------------------------------------------
    'reports.data': {
      permission: 'reports.financial.view',
      schema: reportDataSchema,
      handler: (ctx, payload) =>
        buildReportData(ctx.services, { report: payload.report, from: payload.from, to: payload.to })
    },
    'export.data': {
      permission: 'data.export',
      schema: exportDataSchema,
      handler: (ctx, payload) => ctx.services.billing.exportData(payload as never)
    },
    'export.chooseFolder': {
      permission: null,
      schema: chooseFolderSchema,
      handler: (ctx, payload) => ctx.host.pickFolder(payload)
    },
    'diagnostics.logs': {
      permission: 'settings.view',
      schema: emptySchema,
      handler: (ctx) => ctx.host.recentLogs()
    },
    'diagnostics.exportLogs': {
      permission: 'settings.view',
      schema: saveDialogSchema,
      handler: (ctx, payload) => ctx.host.exportLogs(payload)
    },
    'diagnostics.startWorker': {
      permission: 'settings.view',
      schema: startWorkerSchema,
      handler: (ctx, payload) => ctx.host.startWorker(payload.kind)
    },
    'diagnostics.workerProgress': {
      permission: null,
      schema: workerProgressSchema,
      requiresSession: false,
      handler: (ctx, payload) => ctx.host.workerProgress(payload.jobId)
    },
    'data.revealDataFolder': {
      permission: null,
      schema: emptySchema,
      handler: async (ctx) => {
        await ctx.host.openPath(ctx.host.dataRoot())
        return { ok: true as const }
      }
    },
    'data.openUserGuide': {
      permission: null,
      schema: emptySchema,
      handler: async (ctx) => {
        const guide = ctx.host.userGuidePath()
        try {
          await ctx.host.openPath(guide)
        } catch (error) {
          if (error instanceof AppError) throw error
          throw notFound('User guide')
        }
        return { ok: true as const }
      }
    },
    'data.openBackupFolder': {
      permission: null,
      schema: emptySchema,
      handler: async (ctx) => {
        await ctx.host.openPath(ctx.services.admin.backupFolderPath())
        return { ok: true as const }
      }
    },
    'system.thirdPartyNotices': {
      permission: null,
      schema: emptySchema,
      handler: (ctx) => ctx.host.thirdPartyNotices()
    },
    'system.runtimeInfo': {
      permission: null,
      schema: emptySchema,
      handler: (ctx) => ctx.host.runtimeInfo()
    }
  } satisfies Registry
}
