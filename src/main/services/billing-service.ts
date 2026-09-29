/**
 * Billing, payments, accounting, inventory and attachment services.
 *
 * Money rule (ADR-0002): every amount is an integer number of poisha and every calculation goes through
 * `@shared/money`. Invoice totals are recomputed here, never taken from the renderer.
 */

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, resolve as resolvePath } from 'node:path'

import { addDaysIso, nowSql, todayIso } from '@shared/date'
import { AppError, conflict, notFound, validationError } from '@shared/errors'
import {
  add,
  clampMinZero,
  mulByQuantity,
  percentOf,
  resolveDiscount,
  roundToTaka,
  sub,
  sum
} from '@shared/money'
import { exportFileName, toCsv, toCsvRow, type CsvColumn } from '@shared/csv'
import { buildReportData, type ReportSources } from './reports'
import { ATTACHMENT_LIMITS, type ExportEntity, type InventoryTransactionType } from '@shared/constants'
import { containsPattern, formatSequence, sanitizeFileName } from '@shared/ids'
import type {
  AccountingSummary,
  Attachment,
  AttachmentQuery,
  Expense,
  ExpenseCategory,
  ExpenseInput,
  ExpenseQuery,
  ExportResult,
  InventoryBatch,
  InventoryItem,
  InventoryItemInput,
  InventoryQuery,
  InventoryTransaction,
  Invoice,
  InvoiceInput,
  InvoiceQuery,
  OutstandingRow,
  Paged,
  Payment,
  PaymentDashboard,
  PaymentInput,
  PaymentMethod,
  PaymentQuery,
  RevenueReportRow,
  StockInInput,
  StockIssueInput,
  Supplier,
  TreatmentRevenueRow
} from '@shared/types'
import { buildAttachmentRelativePath, resolveStoredPath, type DataLayout } from '../storage/paths'
import type { SqliteDatabase } from '../db/connection'
import type { AttachmentRepository, AuditRepository, PatientRepository } from '../db/repositories-clinical'
import type { CounterRepository, SettingsRepository } from '../db/repositories-core'
import type {
  ExpenseRepository,
  InventoryRepository,
  InvoiceRepository,
  PaymentRepository,
  SupplierRepository,
  TreatmentRepository
} from '../db/repositories-billing'
import type { SessionManager } from '../security/session'

export interface BillingServiceDeps {
  db: SqliteDatabase
  layout: DataLayout
  invoices: InvoiceRepository
  payments: PaymentRepository
  expenses: ExpenseRepository
  inventory: InventoryRepository
  suppliers: SupplierRepository
  treatments: TreatmentRepository
  attachments: AttachmentRepository
  patients: PatientRepository
  counters: CounterRepository
  settings: SettingsRepository
  audit: AuditRepository
  session: SessionManager
  appVersion: string
}

export class BillingService {
  constructor(private readonly deps: BillingServiceDeps) {}

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

  // -------------------------------------------------------------------------------------------
  // Invoices
  // -------------------------------------------------------------------------------------------

  listInvoices(query: InvoiceQuery): Paged<Invoice> {
    this.require('invoices.view')
    return this.deps.invoices.list(query)
  }

  getInvoice(id: number): Invoice {
    this.require('invoices.view')
    const invoice = this.deps.invoices.findById(id)
    if (!invoice) throw notFound('Invoice', id)
    return invoice
  }

  /** Recompute the invoice totals from the line items (the only place invoice money is decided). */
  private computeTotals(input: InvoiceInput): {
    lines: {
      itemType: InvoiceInput['items'][number]['itemType']
      treatmentId: number | null
      inventoryItemId: number | null
      description: string
      quantityMilli: number
      unitPricePoisha: number
      discountPoisha: number
      lineTotalPoisha: number
      note: string | null
    }[]
    subtotalPoisha: number
    discountPoisha: number
    taxPoisha: number
    roundOffPoisha: number
    totalPoisha: number
  } {
    if (!input.items || input.items.length === 0) {
      throw validationError('Add at least one item to the invoice.', [
        { field: 'items', message: 'An invoice needs at least one line item.' }
      ])
    }
    const problems: { field: string; message: string }[] = []
    const lines = input.items.map((item, index) => {
      if (item.quantityMilli <= 0) {
        problems.push({ field: `items.${index}.quantity`, message: 'Quantity must be greater than zero.' })
      }
      if (item.unitPricePoisha < 0) {
        problems.push({ field: `items.${index}.unitPrice`, message: 'Unit price cannot be negative.' })
      }
      if (item.discountPoisha < 0) {
        problems.push({ field: `items.${index}.discount`, message: 'Discount cannot be negative.' })
      }
      const gross = mulByQuantity(item.unitPricePoisha, item.quantityMilli)
      if (item.discountPoisha > gross) {
        problems.push({
          field: `items.${index}.discount`,
          message: 'Discount cannot exceed the line amount.'
        })
      }
      const lineTotalPoisha = clampMinZero(sub(gross, clampMinZero(item.discountPoisha)))
      return {
        itemType: item.itemType,
        treatmentId: item.treatmentId ?? null,
        inventoryItemId: item.inventoryItemId ?? null,
        description: item.description.trim() || 'Item',
        quantityMilli: item.quantityMilli,
        unitPricePoisha: item.unitPricePoisha,
        discountPoisha: clampMinZero(item.discountPoisha),
        lineTotalPoisha,
        note: item.note ?? null
      }
    })
    if (problems.length > 0) throw validationError('The invoice has invalid line items.', problems)

    const subtotalPoisha = sum(lines.map((line) => line.lineTotalPoisha))
    const resolvedDiscount = clampMinZero(
      resolveDiscount(
        subtotalPoisha,
        clampMinZero(input.discountPoisha),
        clampMinZero(input.discountPercentX100)
      )
    )
    if (resolvedDiscount > subtotalPoisha) {
      throw validationError('The discount cannot be larger than the subtotal.', [
        { field: 'discount', message: 'Discount exceeds subtotal.' }
      ])
    }
    const taxable = sub(subtotalPoisha, resolvedDiscount)
    const taxPoisha = clampMinZero(percentOf(taxable, clampMinZero(input.taxPercentX100)))
    const rawTotal = add(taxable, taxPoisha)
    const { rounded, roundOff } = input.roundOffEnabled
      ? roundToTaka(rawTotal)
      : { rounded: rawTotal, roundOff: 0 }

    return {
      lines,
      subtotalPoisha,
      discountPoisha: resolvedDiscount,
      taxPoisha,
      roundOffPoisha: roundOff,
      totalPoisha: rounded
    }
  }

  createInvoice(input: InvoiceInput): Invoice {
    this.require('invoices.create')
    const patient = this.deps.patients.findById(input.patientId)
    if (!patient) throw notFound('Patient', input.patientId)
    if (input.visitId != null) {
      const visit = this.deps.db.prepare('SELECT id FROM visits WHERE id = ?').get(input.visitId)
      if (!visit) {
        throw validationError('That visit no longer exists.', [
          { field: 'visitId', message: 'Unknown visit.' }
        ])
      }
    }
    const totals = this.computeTotals(input)
    const settings = this.deps.settings.get()

    const id = this.deps.db.transaction(() => {
      const invoiceNo = formatSequence(this.deps.counters.next('invoice_no'), {
        prefix: settings.invoicePrefix,
        padding: settings.invoicePadding
      })
      const invoiceId = this.deps.invoices.create({
        invoiceNo,
        patientId: input.patientId,
        visitId: input.visitId ?? null,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate ?? null,
        subtotalPoisha: totals.subtotalPoisha,
        discountPoisha: totals.discountPoisha,
        discountPercentX100: clampMinZero(input.discountPercentX100),
        taxPoisha: totals.taxPoisha,
        roundOffPoisha: totals.roundOffPoisha,
        totalPoisha: totals.totalPoisha,
        status: 'unpaid',
        notes: input.notes ?? null,
        items: totals.lines,
        actor: this.deps.session.username ?? 'system'
      })
      this.audit(
        'invoices.create',
        `Created invoice ${invoiceNo} for ${patient.code} (${patient.fullName})`,
        {
          entityType: 'invoice',
          entityId: invoiceId,
          after: { total: totals.totalPoisha, items: totals.lines.length }
        }
      )
      return invoiceId
    })()

    return this.deps.invoices.findById(id) as Invoice
  }

  updateInvoice(id: number, input: InvoiceInput): Invoice {
    this.require('invoices.edit')
    const existing = this.deps.invoices.findById(id)
    if (!existing) throw notFound('Invoice', id)
    if (existing.status === 'void') throw conflict('A voided invoice cannot be edited.')
    if (existing.payments.length > 0 && existing.totalPoisha !== existing.paidPoisha) {
      // Editing a partially paid invoice is allowed, but the change must not push the total below what was paid.
    }
    const totals = this.computeTotals(input)
    if (totals.totalPoisha < existing.paidPoisha) {
      throw conflict(
        'The new total is lower than the amount already received. Void the payments first or keep the total at least equal to what was paid.'
      )
    }
    this.deps.db.transaction(() => {
      this.deps.invoices.update(id, {
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate ?? null,
        subtotalPoisha: totals.subtotalPoisha,
        discountPoisha: totals.discountPoisha,
        discountPercentX100: clampMinZero(input.discountPercentX100),
        taxPoisha: totals.taxPoisha,
        roundOffPoisha: totals.roundOffPoisha,
        totalPoisha: totals.totalPoisha,
        status: existing.status,
        notes: input.notes ?? null,
        items: totals.lines,
        actor: this.deps.session.username ?? 'system'
      })
      this.audit('invoices.update', `Updated invoice ${existing.invoiceNo}`, {
        entityType: 'invoice',
        entityId: id,
        before: { total: existing.totalPoisha, items: existing.items.length },
        after: { total: totals.totalPoisha, items: totals.lines.length }
      })
    })()
    return this.deps.invoices.findById(id) as Invoice
  }

  voidInvoice(id: number, reason: string): Invoice {
    this.require('invoices.void')
    const invoice = this.deps.invoices.findById(id)
    if (!invoice) throw notFound('Invoice', id)
    if (invoice.status === 'void') throw conflict('This invoice is already void.')
    if (!reason || reason.trim().length < 4) {
      throw validationError('Enter a reason for voiding this invoice.', [
        { field: 'reason', message: 'A reason of at least 4 characters is required.' }
      ])
    }
    this.deps.db.transaction(() => {
      this.deps.invoices.voidInvoice(id, reason.trim(), this.deps.session.username ?? 'system')
      this.audit('invoices.void', `Voided invoice ${invoice.invoiceNo}: ${reason.trim()}`, {
        entityType: 'invoice',
        entityId: id,
        before: { status: invoice.status, total: invoice.totalPoisha, paid: invoice.paidPoisha },
        severity: 'critical'
      })
    })()
    return this.deps.invoices.findById(id) as Invoice
  }

  outstandingInvoices(): OutstandingRow[] {
    this.require('invoices.view')
    return this.deps.invoices.outstanding()
  }

  // -------------------------------------------------------------------------------------------
  // Payments
  // -------------------------------------------------------------------------------------------

  listPayments(query: PaymentQuery): Paged<Payment> {
    this.require('payments.view')
    return this.deps.payments.list(query)
  }

  paymentDashboard(query: PaymentQuery): PaymentDashboard {
    this.require('payments.view')
    return this.deps.payments.dashboard(query)
  }

  getPayment(id: number): Payment {
    this.require('payments.view')
    const payment = this.deps.payments.findById(id)
    if (!payment) throw notFound('Payment', id)
    return payment
  }

  paymentMethods(includeInactive = false): PaymentMethod[] {
    const rows = this.deps.db
      .prepare(
        `SELECT * FROM payment_methods ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY sort_order, name`
      )
      .all() as Record<string, string | number>[]
    return rows.map((row) => ({
      id: row.id as number,
      code: row.code as string,
      name: row.name as string,
      nameBn: (row.name_bn as string) ?? null,
      requiresReference: Number(row.requires_reference) === 1,
      isActive: Number(row.is_active) === 1,
      isSystemDefault: Number(row.is_system_default) === 1,
      sortOrder: row.sort_order as number
    }))
  }

  createPayment(input: PaymentInput): Payment {
    this.require('payments.create')
    const patient = this.deps.patients.findById(input.patientId)
    if (!patient) throw notFound('Patient', input.patientId)
    if (!Number.isInteger(input.amountPoisha) || input.amountPoisha <= 0) {
      throw validationError('Enter a payment amount greater than zero.', [
        { field: 'amount', message: 'Amount must be a positive number.' }
      ])
    }
    const method = this.deps.db
      .prepare('SELECT code, name, requires_reference, is_active FROM payment_methods WHERE code = ?')
      .get(input.methodCode) as
      { code: string; name: string; requires_reference: number; is_active: number } | undefined
    if (!method || method.is_active !== 1) {
      throw validationError('Choose a valid payment method.', [
        { field: 'methodCode', message: 'Unknown or inactive payment method.' }
      ])
    }
    if (method.requires_reference === 1 && (!input.referenceNo || input.referenceNo.trim().length < 3)) {
      throw validationError(`A reference number is required for ${method.name} payments.`, [
        { field: 'referenceNo', message: 'Reference number is required for this method.' }
      ])
    }
    let invoice: Invoice | null
    if (input.invoiceId != null) {
      invoice = this.deps.invoices.findById(input.invoiceId)
      if (!invoice) throw notFound('Invoice', input.invoiceId)
      if (invoice.patientId !== input.patientId) {
        throw validationError('That invoice belongs to a different patient.', [
          { field: 'invoiceId', message: 'Invoice does not belong to the selected patient.' }
        ])
      }
      if (invoice.status === 'void') throw conflict('Payments cannot be recorded against a voided invoice.')
    }
    const settings = this.deps.settings.get()
    const kind = input.kind ?? 'payment'

    const id = this.deps.db.transaction(() => {
      const receiptNo = formatSequence(this.deps.counters.next('receipt_no'), {
        prefix: settings.receiptPrefix,
        padding: settings.invoicePadding
      })
      const paymentId = this.deps.payments.create(
        receiptNo,
        { ...input, kind },
        this.deps.session.username ?? 'system'
      )
      if (input.invoiceId != null) this.deps.invoices.recalculatePaid(input.invoiceId)
      this.audit(
        'payments.create',
        `Recorded ${kind} ${receiptNo} of ${(input.amountPoisha / 100).toFixed(2)} for ${patient.code}`,
        {
          entityType: 'payment',
          entityId: paymentId,
          after: { method: method.name, invoiceId: input.invoiceId ?? null, amount: input.amountPoisha }
        }
      )
      return paymentId
    })()

    return this.deps.payments.findById(id) as Payment
  }

  voidPayment(id: number, reason: string): Payment {
    this.require('payments.void')
    const payment = this.deps.payments.findById(id)
    if (!payment) throw notFound('Payment', id)
    if (payment.voidedAt) throw conflict('This payment is already void.')
    if (!reason || reason.trim().length < 4) {
      throw validationError('Enter a reason for voiding this payment.', [
        { field: 'reason', message: 'A reason of at least 4 characters is required.' }
      ])
    }
    this.deps.db.transaction(() => {
      this.deps.payments.voidPayment(id, reason.trim(), this.deps.session.username ?? 'system')
      if (payment.invoiceId != null) this.deps.invoices.recalculatePaid(payment.invoiceId)
      this.audit('payments.void', `Voided payment ${payment.receiptNo}: ${reason.trim()}`, {
        entityType: 'payment',
        entityId: id,
        before: { amount: payment.amountPoisha, invoiceId: payment.invoiceId },
        severity: 'critical'
      })
    })()
    return this.deps.payments.findById(id) as Payment
  }

  // -------------------------------------------------------------------------------------------
  // Accounting
  // -------------------------------------------------------------------------------------------

  accountingSummary(from: string | null, to: string | null): AccountingSummary {
    this.require('accounting.view')
    const rangeFrom = from ?? addDaysIso(todayIso(), -30)
    const rangeTo = to ?? todayIso()
    const invoiced = this.deps.db
      .prepare(
        `SELECT COALESCE(SUM(total_poisha), 0) AS value FROM invoices
          WHERE status <> 'void' AND invoice_date BETWEEN ? AND ?`
      )
      .get(rangeFrom, rangeTo) as { value: number }
    const collected = this.deps.payments.collectedBetween(rangeFrom, rangeTo)
    const expenses = this.deps.expenses.totalBetween(rangeFrom, rangeTo)
    return {
      from: from,
      to: to,
      invoiceRevenuePoisha: Number(invoiced.value),
      collectedPoisha: collected,
      expensesPoisha: expenses,
      netCashFlowPoisha: sub(collected, expenses),
      outstandingPoisha: this.deps.invoices.totalOutstanding(),
      byMethod: this.deps.payments.methodBreakdown(rangeFrom, rangeTo),
      byExpenseCategory: this.deps.expenses.byCategory(rangeFrom, rangeTo)
    }
  }

  revenueReport(from: string, to: string, groupBy: 'day' | 'month' = 'day'): RevenueReportRow[] {
    this.require('reports.financial.view')
    const bucket = groupBy === 'day' ? 'date(i.invoice_date)' : "strftime('%Y-%m', i.invoice_date)"
    const rows = this.deps.db
      .prepare(
        `SELECT ${bucket} AS bucket,
                COUNT(*) AS invoice_count,
                COALESCE(SUM(i.total_poisha), 0) AS invoiced
           FROM invoices i
          WHERE i.status <> 'void' AND i.invoice_date BETWEEN @from AND @to
          GROUP BY bucket
          ORDER BY bucket`
      )
      .all({ from, to }) as { bucket: string; invoice_count: number; invoiced: number }[]

    const collectedRows = this.deps.db
      .prepare(
        `SELECT ${groupBy === 'day' ? 'date(p.received_at)' : "strftime('%Y-%m', p.received_at)"} AS bucket,
                COALESCE(SUM(CASE WHEN p.kind = 'refund' THEN -p.amount_poisha ELSE p.amount_poisha END), 0) AS collected
           FROM payments p
          WHERE p.voided_at IS NULL AND date(p.received_at) BETWEEN @from AND @to
          GROUP BY bucket ORDER BY bucket`
      )
      .all({ from, to }) as { bucket: string; collected: number }[]

    const expenseRows = this.deps.db
      .prepare(
        `SELECT ${groupBy === 'day' ? 'date(e.expense_date)' : "strftime('%Y-%m', e.expense_date)"} AS bucket,
                COALESCE(SUM(e.amount_poisha), 0) AS expenses
           FROM expenses e
          WHERE e.voided_at IS NULL AND e.expense_date BETWEEN @from AND @to
          GROUP BY bucket ORDER BY bucket`
      )
      .all({ from, to }) as { bucket: string; expenses: number }[]

    const buckets = mapBuckets()
    for (const row of rows) {
      const entry = buckets.ensure(row.bucket)
      entry.invoiceCount = Number(row.invoice_count)
      entry.invoicedPoisha = Number(row.invoiced)
    }
    for (const row of collectedRows) buckets.ensure(row.bucket).collectedPoisha = Number(row.collected)
    for (const row of expenseRows) buckets.ensure(row.bucket).expensesPoisha = Number(row.expenses)

    return buckets.sorted().map((entry) => ({
      date: entry.bucket,
      invoiceCount: entry.invoiceCount,
      invoicedPoisha: entry.invoicedPoisha,
      collectedPoisha: entry.collectedPoisha,
      expensesPoisha: entry.expensesPoisha,
      netPoisha: sub(entry.collectedPoisha, entry.expensesPoisha)
    }))
  }

  treatmentRevenue(from: string, to: string): TreatmentRevenueRow[] {
    this.require('reports.financial.view')
    return this.deps.treatments.revenue(from, to)
  }

  // -------------------------------------------------------------------------------------------
  // Expenses
  // -------------------------------------------------------------------------------------------

  listExpenses(query: ExpenseQuery): Paged<Expense> {
    this.require('accounting.view')
    return this.deps.expenses.list(query)
  }

  expenseCategories(includeInactive = false): ExpenseCategory[] {
    this.require('accounting.view')
    const rows = this.deps.db
      .prepare(
        `SELECT * FROM expense_categories ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY name`
      )
      .all() as Record<string, string | number>[]
    return rows.map((row) => ({
      id: row.id as number,
      code: row.code as string,
      name: row.name as string,
      nameBn: (row.name_bn as string) ?? null,
      isActive: Number(row.is_active) === 1,
      isSystemDefault: Number(row.is_system_default) === 1
    }))
  }

  createExpenseCategory(input: { code: string; name: string; nameBn?: string | null }): ExpenseCategory {
    this.require('accounting.manage')
    const code = input.code
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_')
    if (!code || input.name.trim().length < 2) {
      throw validationError('Enter a category name.', [{ field: 'name', message: 'Name is too short.' }])
    }
    if (this.deps.db.prepare('SELECT id FROM expense_categories WHERE code = ?').get(code)) {
      throw conflict('An expense category with this code already exists.')
    }
    const result = this.deps.db
      .prepare(
        `INSERT INTO expense_categories (code, name, name_bn, is_active, is_system_default, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, ?, ?)`
      )
      .run(code, input.name.trim(), input.nameBn ?? null, nowSql(), nowSql())
    this.audit('accounting.category_create', `Created expense category ${input.name.trim()}`, {
      entityType: 'expense_category',
      entityId: Number(result.lastInsertRowid)
    })
    return this.expenseCategories(true).find((category) => category.code === code) as ExpenseCategory
  }

  /** Create or update an expense category (the settings screen edits both in one dialog). */
  saveExpenseCategory(input: {
    id?: number
    code: string
    name: string
    nameBn?: string | null
  }): ExpenseCategory {
    this.require('accounting.manage')
    if (input.id) {
      const existing = this.deps.db
        .prepare('SELECT id, name FROM expense_categories WHERE id = ?')
        .get(input.id) as { id: number; name: string } | undefined
      if (!existing) throw notFound('Expense category', input.id)
      if (input.name.trim().length < 2) {
        throw validationError('Enter a category name.', [{ field: 'name', message: 'Name is too short.' }])
      }
      this.deps.db
        .prepare('UPDATE expense_categories SET name = ?, name_bn = ?, updated_at = ? WHERE id = ?')
        .run(input.name.trim(), input.nameBn ?? null, nowSql(), input.id)
      this.audit('accounting.category_update', `Updated expense category "${input.name.trim()}"`, {
        entityType: 'expense_category',
        entityId: input.id,
        before: { name: existing.name },
        after: { name: input.name.trim() }
      })
      return this.expenseCategories(true).find((category) => category.id === input.id) as ExpenseCategory
    }
    return this.createExpenseCategory({ code: input.code, name: input.name, nameBn: input.nameBn ?? null })
  }

  /** Create or update an invoice; the invoice list and the editor share one entry point. */
  saveInvoice(input: InvoiceInput & { id?: number }): Invoice {
    const { id, ...rest } = input
    return id ? this.updateInvoice(id, rest) : this.createInvoice(rest)
  }

  /** Create or update a stock item; used by the inventory editor. */
  saveInventoryItem(input: InventoryItemInput & { id?: number }): InventoryItem {
    const { id, ...rest } = input
    return id ? this.updateInventoryItem(id, rest) : this.createInventoryItem(rest)
  }

  /** Look up an invoice by its printed number (used by the barcode/serial search box). */
  findInvoiceByNumber(invoiceNo: string): Invoice | null {
    this.require('invoices.view')
    return this.deps.invoices.findByNumber(invoiceNo.trim())
  }

  createExpense(input: ExpenseInput): Expense {
    this.require('accounting.manage')
    if (!Number.isInteger(input.amountPoisha) || input.amountPoisha <= 0) {
      throw validationError('Enter an amount greater than zero.', [
        { field: 'amount', message: 'Amount must be a positive number.' }
      ])
    }
    const category = this.deps.db
      .prepare('SELECT id, name FROM expense_categories WHERE id = ? AND is_active = 1')
      .get(input.categoryId) as { id: number; name: string } | undefined
    if (!category) {
      throw validationError('Choose a valid expense category.', [
        { field: 'categoryId', message: 'Unknown category.' }
      ])
    }
    const method = this.deps.db
      .prepare('SELECT code FROM payment_methods WHERE code = ? AND is_active = 1')
      .get(input.methodCode)
    if (!method) {
      throw validationError('Choose a valid payment method.', [
        { field: 'methodCode', message: 'Unknown method.' }
      ])
    }
    const settings = this.deps.settings.get()
    const id = this.deps.db.transaction(() => {
      const expenseNo = formatSequence(this.deps.counters.next('expense_no'), {
        prefix: settings.expensePrefix,
        padding: settings.invoicePadding
      })
      const expenseId = this.deps.expenses.create(expenseNo, input, this.deps.session.username ?? 'system')
      this.audit(
        'accounting.expense_create',
        `Recorded expense ${expenseNo} of ${(input.amountPoisha / 100).toFixed(2)} (${category.name})`,
        {
          entityType: 'expense',
          entityId: expenseId,
          after: { amount: input.amountPoisha, categoryId: input.categoryId }
        }
      )
      return expenseId
    })()
    return this.deps.expenses.findById(id) as Expense
  }

  updateExpense(id: number, input: ExpenseInput): Expense {
    this.require('accounting.manage')
    const existing = this.deps.expenses.findById(id)
    if (!existing) throw notFound('Expense', id)
    if (existing.voidedAt) throw conflict('A voided expense cannot be edited.')
    if (!Number.isInteger(input.amountPoisha) || input.amountPoisha <= 0) {
      throw validationError('Enter an amount greater than zero.', [
        { field: 'amount', message: 'Amount must be a positive number.' }
      ])
    }
    this.deps.expenses.update(id, input, this.deps.session.username ?? 'system')
    this.audit('accounting.expense_update', `Updated expense ${existing.expenseNo}`, {
      entityType: 'expense',
      entityId: id,
      before: { amount: existing.amountPoisha },
      after: { amount: input.amountPoisha }
    })
    return this.deps.expenses.findById(id) as Expense
  }

  voidExpense(id: number, reason: string): Expense {
    this.require('accounting.manage')
    const existing = this.deps.expenses.findById(id)
    if (!existing) throw notFound('Expense', id)
    if (existing.voidedAt) throw conflict('This expense is already void.')
    if (!reason || reason.trim().length < 4) {
      throw validationError('Enter a reason for voiding this expense.', [
        { field: 'reason', message: 'A reason of at least 4 characters is required.' }
      ])
    }
    this.deps.expenses.voidExpense(id, reason.trim(), this.deps.session.username ?? 'system')
    this.audit('accounting.expense_void', `Voided expense ${existing.expenseNo}: ${reason.trim()}`, {
      entityType: 'expense',
      entityId: id,
      before: { amount: existing.amountPoisha },
      severity: 'critical'
    })
    return this.deps.expenses.findById(id) as Expense
  }

  // -------------------------------------------------------------------------------------------
  // Inventory
  // -------------------------------------------------------------------------------------------

  listInventory(query: InventoryQuery): Paged<InventoryItem> {
    this.require('inventory.view')
    return this.deps.inventory.list(query)
  }

  getInventoryItem(id: number): InventoryItem {
    this.require('inventory.view')
    const item = this.deps.inventory.findById(id)
    if (!item) throw notFound('Inventory item', id)
    return item
  }

  createInventoryItem(input: InventoryItemInput): InventoryItem {
    this.require('inventory.manage')
    if (input.name.trim().length < 2) {
      throw validationError('Enter an item name.', [{ field: 'name', message: 'Name is too short.' }])
    }
    if (input.minStockMilli < 0 || input.quantityMilli < 0) {
      throw validationError('Stock quantities cannot be negative.', [
        { field: 'quantityMilli', message: 'Quantity cannot be negative.' }
      ])
    }
    const id = this.deps.inventory.create(input, this.deps.session.username ?? 'system')
    this.audit('inventory.create', `Added inventory item "${input.name.trim()}"`, {
      entityType: 'inventory_item',
      entityId: id,
      after: { name: input.name.trim(), unit: input.unit }
    })
    return this.deps.inventory.findById(id) as InventoryItem
  }

  updateInventoryItem(id: number, input: InventoryItemInput): InventoryItem {
    this.require('inventory.manage')
    const existing = this.deps.inventory.findById(id)
    if (!existing) throw notFound('Inventory item', id)
    this.deps.inventory.update(id, input, this.deps.session.username ?? 'system')
    this.audit('inventory.update', `Updated inventory item "${input.name.trim()}"`, {
      entityType: 'inventory_item',
      entityId: id,
      before: { name: existing.name, minStock: existing.minStockMilli },
      after: { name: input.name.trim(), minStock: input.minStockMilli }
    })
    return this.deps.inventory.findById(id) as InventoryItem
  }

  stockIn(input: StockInInput): { item: InventoryItem; batchId: number; transactionId: number } {
    this.require('inventory.manage')
    const item = this.deps.inventory.findById(input.itemId)
    if (!item) throw notFound('Inventory item', input.itemId)
    if (input.quantityMilli <= 0) {
      throw validationError('Enter a quantity greater than zero.', [
        { field: 'quantityMilli', message: 'Quantity must be positive.' }
      ])
    }
    const result = this.deps.inventory.stockIn(input, this.deps.session.username ?? 'system')
    this.audit(
      'inventory.stock_in',
      `Received ${(input.quantityMilli / 1000).toFixed(3)} ${item.unit} of ${item.name}`,
      {
        entityType: 'inventory_item',
        entityId: input.itemId,
        after: { batchId: result.batchId, quantityMilli: input.quantityMilli, unitCost: input.unitCostPoisha }
      }
    )
    return { item: this.deps.inventory.findById(input.itemId) as InventoryItem, ...result }
  }

  issueStock(input: StockIssueInput): InventoryItem {
    this.require('inventory.adjust')
    const item = this.deps.inventory.findById(input.itemId)
    if (!item) throw notFound('Inventory item', input.itemId)
    if (input.quantityMilli <= 0) {
      throw validationError('Enter a quantity greater than zero.', [
        { field: 'quantityMilli', message: 'Quantity must be positive.' }
      ])
    }
    const settings = this.deps.settings.get()
    if (input.batchId) {
      const batch = this.deps.inventory.batches(input.itemId).find((entry) => entry.id === input.batchId)
      if (!batch)
        throw validationError('Choose a valid batch.', [{ field: 'batchId', message: 'Unknown batch.' }])
      if (batch.isExpired && !settings.inventoryAllowExpiredIssue) {
        throw conflict(
          'This batch has expired. Enable "allow issuing expired stock" in settings to override.'
        )
      }
    }
    this.deps.inventory.issue(input, this.deps.session.username ?? 'system')
    this.audit(
      'inventory.issue',
      `Recorded ${input.txnType} of ${(input.quantityMilli / 1000).toFixed(3)} ${item.unit} for ${item.name}`,
      {
        entityType: 'inventory_item',
        entityId: input.itemId,
        before: { quantityMilli: item.quantityMilli },
        after: { quantityMilli: item.quantityMilli - input.quantityMilli, reason: input.reason ?? null },
        severity: input.txnType === 'wastage' ? 'warning' : 'info'
      }
    )
    return this.deps.inventory.findById(input.itemId) as InventoryItem
  }

  inventoryBatches(itemId: number): InventoryBatch[] {
    this.require('inventory.view')
    return this.deps.inventory.batches(itemId)
  }

  inventoryTransactions(query: {
    itemId?: number
    txnType?: InventoryTransactionType
    from?: string
    to?: string
    page?: number
    pageSize?: number
  }): Paged<InventoryTransaction> {
    this.require('inventory.view')
    return this.deps.inventory.transactions(query)
  }

  suppliers(): Supplier[] {
    this.require('inventory.view')
    return this.deps.suppliers.list()
  }

  createSupplier(input: Omit<Supplier, 'id'>, id?: number): Supplier {
    this.require('inventory.manage')
    if (input.name.trim().length < 2) {
      throw validationError('Enter a supplier name.', [{ field: 'name', message: 'Name is too short.' }])
    }
    const supplierId = id
      ? (this.deps.suppliers.update(id, input), id)
      : this.deps.suppliers.create(input, this.deps.session.username ?? 'system')
    this.audit(
      id ? 'inventory.supplier_update' : 'inventory.supplier_create',
      `Saved supplier "${input.name.trim()}"`,
      {
        entityType: 'supplier',
        entityId: supplierId
      }
    )
    return this.deps.suppliers.list(true).find((supplier) => supplier.id === supplierId) as Supplier
  }

  // -------------------------------------------------------------------------------------------
  // Attachments
  // -------------------------------------------------------------------------------------------

  private assertAttachmentAllowed(sourcePath: string): { sizeBytes: number; extension: string } {
    if (!isAbsolute(sourcePath)) {
      throw validationError('The selected file path is not valid.', [
        { field: 'sourcePath', message: 'An absolute path is required.' }
      ])
    }
    if (!existsSync(sourcePath)) throw notFound('Selected file')
    const stats = statSync(sourcePath)
    if (!stats.isFile()) {
      throw validationError('Only files can be attached.', [{ field: 'sourcePath', message: 'Not a file.' }])
    }
    if (stats.size === 0) {
      throw validationError('The selected file is empty.', [{ field: 'sourcePath', message: 'Empty file.' }])
    }
    if (stats.size > ATTACHMENT_LIMITS.maxSizeBytes) {
      throw validationError(
        `The file is larger than ${Math.round(ATTACHMENT_LIMITS.maxSizeBytes / (1024 * 1024))} MB.`,
        [{ field: 'sourcePath', message: 'File exceeds the attachment size limit.' }]
      )
    }
    const extension = extname(sourcePath).toLowerCase()
    if (!(ATTACHMENT_LIMITS.allowedExtensions as readonly string[]).includes(extension)) {
      throw validationError(`Files of type "${extension || 'unknown'}" cannot be attached.`, [
        { field: 'sourcePath', message: `Allowed types: ${ATTACHMENT_LIMITS.allowedExtensions.join(', ')}` }
      ])
    }
    return { sizeBytes: stats.size, extension }
  }

  listAttachments(query: AttachmentQuery): Paged<Attachment> {
    this.require('patients.attachments.view')
    return this.deps.attachments.list(query)
  }

  attachFile(input: {
    patientId: number
    visitId?: number | null
    title?: string | null
    category?: string | null
    notes?: string | null
    sourcePath: string
  }): Attachment {
    this.require('patients.attachments.manage')
    const patient = this.deps.patients.findById(input.patientId)
    if (!patient) throw notFound('Patient', input.patientId)
    const { sizeBytes } = this.assertAttachmentAllowed(input.sourcePath)
    if (input.visitId != null) {
      const visit = this.deps.db.prepare('SELECT patient_id FROM visits WHERE id = ?').get(input.visitId) as
        { patient_id: number } | undefined
      if (!visit || visit.patient_id !== input.patientId) {
        throw validationError('That visit does not belong to this patient.', [
          { field: 'visitId', message: 'Visit mismatch.' }
        ])
      }
    }

    const relativePath = buildAttachmentRelativePath(patient.code, basename(input.sourcePath))
    const target = resolveStoredPath(this.deps.layout, relativePath)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(input.sourcePath, target)
    const digest = createHash('sha256').update(readFileSync(target)).digest('hex')

    const id = this.deps.attachments.create({
      patientId: input.patientId,
      visitId: input.visitId ?? null,
      entityType: 'patient',
      entityId: input.patientId,
      originalName: sanitizeFileName(basename(input.sourcePath), 'attachment'),
      storedPath: relativePath,
      mimeType: null,
      sizeBytes,
      sha256: digest,
      title: input.title ?? null,
      category: input.category ?? null,
      notes: input.notes ?? null,
      uploadedBy: this.deps.session.username ?? 'system'
    })
    this.audit('attachments.upload', `Attached "${basename(input.sourcePath)}" to ${patient.code}`, {
      entityType: 'attachment',
      entityId: id,
      after: { sizeBytes, sha256: digest }
    })
    return this.deps.attachments.findById(id) as Attachment
  }

  attachmentPath(id: number): string {
    this.require('patients.attachments.view')
    const attachment = this.deps.attachments.findById(id)
    if (!attachment) throw notFound('Attachment', id)
    const absolute = resolveStoredPath(this.deps.layout, attachment.storedPath)
    if (!existsSync(absolute)) {
      throw new AppError('NOT_FOUND', 'The attachment file is missing from the data folder.')
    }
    return absolute
  }

  renameAttachment(id: number, title: string): Attachment {
    this.require('patients.attachments.manage')
    const attachment = this.deps.attachments.findById(id)
    if (!attachment) throw notFound('Attachment', id)
    this.deps.attachments.rename(id, title.trim())
    this.audit('attachments.rename', `Renamed attachment #${id} to "${title.trim()}"`, {
      entityType: 'attachment',
      entityId: id,
      before: { title: attachment.title }
    })
    return this.deps.attachments.findById(id) as Attachment
  }

  deleteAttachment(id: number): void {
    this.require('patients.attachments.manage')
    const attachment = this.deps.attachments.findById(id)
    if (!attachment) throw notFound('Attachment', id)
    const absolute = resolveStoredPath(this.deps.layout, attachment.storedPath)
    const run = this.deps.db.transaction(() => {
      this.deps.attachments.softDelete(id, this.deps.session.username ?? 'system')
      if (existsSync(absolute)) {
        const trashTarget = resolvePath(
          this.deps.layout.trashDir,
          `${new Date().toISOString().slice(0, 10)}-${basename(absolute)}`
        )
        mkdirSync(this.deps.layout.trashDir, { recursive: true })
        try {
          renameSync(absolute, trashTarget)
        } catch {
          // The record is deleted even if the file cannot move (for example when it is open in another program);
          // the orphaned file stays inside the data folder and is reported by the integrity check.
        }
      }
      this.audit('attachments.delete', `Deleted attachment "${attachment.originalName}"`, {
        entityType: 'attachment',
        entityId: id,
        before: { storedPath: attachment.storedPath, sha256: attachment.sha256 },
        severity: 'warning'
      })
    })
    run()
  }

  // -------------------------------------------------------------------------------------------
  // Exports
  // -------------------------------------------------------------------------------------------

  exportData(request: {
    entity: ExportEntity
    format: 'csv' | 'json'
    from?: string | null
    to?: string | null
    targetFolder: string
  }): ExportResult {
    const permission =
      request.entity === 'audit'
        ? 'audit.export'
        : request.entity === 'patients'
          ? 'patients.export'
          : request.entity === 'invoices' || request.entity === 'payments'
            ? 'reports.financial.export'
            : request.entity === 'expenses'
              ? 'accounting.export'
              : request.entity === 'inventory' || request.entity === 'inventory_movements'
                ? 'inventory.export'
                : 'data.export'
    this.require(permission)

    const from = request.from ?? '1900-01-01'
    const to = request.to ?? '2999-12-31'
    const { title, rows } = this.collectExportRows(request.entity, from, to)
    const folder = request.targetFolder
    if (!isAbsolute(folder)) {
      throw validationError('Choose a folder to export into.', [
        { field: 'targetFolder', message: 'An absolute folder path is required.' }
      ])
    }
    mkdirSync(folder, { recursive: true })

    const stamp = nowSql().replace(' ', '_').replace(/:/g, '-')
    const fileName = exportFileName(`dentiva-${request.entity}`, stamp, request.format)
    const target = resolvePath(folder, fileName)

    let bytes: number
    if (request.format === 'json') {
      const payload = JSON.stringify(
        { entity: request.entity, from, to, exportedAt: nowSql(), rows },
        null,
        2
      )
      writeFileSync(target, payload, 'utf8')
      bytes = Buffer.byteLength(payload, 'utf8')
    } else {
      const columns: CsvColumn<Record<string, unknown>>[] = Object.keys(rows[0] ?? { value: null }).map(
        (key) => ({
          key,
          label: key,
          value: (row) => {
            const cell = row[key]
            if (cell == null) return ''
            if (typeof cell === 'object') return JSON.stringify(cell)
            return cell as string | number
          }
        })
      )
      const csv = `${toCsv(rows as Record<string, unknown>[], columns, { bom: true })}\n`
      writeFileSync(target, csv, 'utf8')
      bytes = Buffer.byteLength(csv, 'utf8')
    }

    this.audit('data.export', `Exported ${rows.length} ${request.entity} records to ${fileName}`, {
      entityType: 'export',
      entityId: null,
      after: { entity: request.entity, format: request.format, rows: rows.length, title }
    })
    return { filePath: target, rowCount: rows.length, bytes }
  }

  /**
   * Report export (master §61): renders the same figures the Reports screen shows — one builder, so the
   * exported CSV and the screen can never disagree — with the report's own column headers, its summary
   * block and its foot notes appended, under the `reports.financial.export` permission.
   */
  exportReport(request: { report: string; from: string; to: string; targetFolder: string }): ExportResult {
    this.require('reports.financial.export')

    const folder = request.targetFolder
    if (!isAbsolute(folder)) {
      throw validationError('Choose a folder to export into.', [
        { field: 'targetFolder', message: 'An absolute folder path is required.' }
      ])
    }

    const sources: ReportSources = {
      db: this.deps.db,
      invoices: this.deps.invoices,
      payments: this.deps.payments,
      treatments: this.deps.treatments,
      expenses: this.deps.expenses,
      billing: this
    }
    const data = buildReportData(sources, {
      report: request.report,
      from: request.from,
      to: request.to
    })

    mkdirSync(folder, { recursive: true })
    const stamp = nowSql().replace(' ', '_').replace(/:/g, '-')
    const fileName = exportFileName(`dentiva-report-${request.report}`, stamp, 'csv')
    const target = resolvePath(folder, fileName)

    // Header row from the report's own columns, then the rows, then the summaries so a reader sees the
    // totals of exactly what the screen showed.
    const lines = [toCsvRow(data.columns.map((column) => column.label))]
    for (const row of data.rows) lines.push(toCsvRow(row as (string | number)[]))
    if (data.summaries.length > 0) {
      lines.push('')
      lines.push(toCsvRow(['Summary', 'Amount']))
      for (const entry of data.summaries) lines.push(toCsvRow([entry.label, entry.value]))
    }
    if (data.footNotes.length > 0) {
      lines.push('')
      for (const note of data.footNotes) lines.push(toCsvRow([note]))
    }
    const csv = `\uFEFF${lines.join('\r\n')}\r\n`
    writeFileSync(target, csv, 'utf8')
    const bytes = Buffer.byteLength(csv, 'utf8')

    this.audit('data.export', `Exported ${data.title} (${request.from} to ${request.to}) to ${fileName}`, {
      entityType: 'export',
      entityId: null,
      after: {
        report: request.report,
        format: 'csv',
        rows: data.rows.length,
        from: request.from,
        to: request.to
      }
    })
    return { filePath: target, rowCount: data.rows.length, bytes }
  }

  private collectExportRows(
    entity: ExportEntity,
    from: string,
    to: string
  ): { title: string; rows: Record<string, unknown>[] } {
    const db = this.deps.db
    switch (entity) {
      case 'patients':
        return {
          title: 'Patients',
          rows: db
            .prepare(
              `SELECT code AS "Patient Code", full_name AS "Name", full_name_bn AS "Name (Bangla)", gender AS "Gender",
                      date_of_birth AS "Date of Birth", age_years AS "Age", phone AS "Phone", phone_alt AS "Alternate Phone",
                      address AS "Address", city AS "City", created_at AS "Registered At"
                 FROM patients WHERE deleted_at IS NULL AND date(created_at) BETWEEN ? AND ? ORDER BY id`
            )
            .all(from, to) as Record<string, unknown>[]
        }
      case 'invoices':
        return {
          title: 'Invoices',
          rows: db
            .prepare(
              `SELECT i.invoice_no AS "Invoice No", i.invoice_date AS "Date", p.code AS "Patient Code",
                      p.full_name AS "Patient", i.subtotal_poisha AS "Subtotal (poisha)", i.discount_poisha AS "Discount (poisha)",
                      i.tax_poisha AS "Tax (poisha)", i.total_poisha AS "Total (poisha)", i.paid_poisha AS "Paid (poisha)",
                      i.balance_poisha AS "Balance (poisha)", i.status AS "Status"
                 FROM invoices i JOIN patients p ON p.id = i.patient_id
                WHERE i.invoice_date BETWEEN ? AND ? ORDER BY i.invoice_date, i.id`
            )
            .all(from, to) as Record<string, unknown>[]
        }
      case 'payments':
        return {
          title: 'Payments',
          rows: db
            .prepare(
              `SELECT p.receipt_no AS "Receipt No", p.received_at AS "Received At", pat.code AS "Patient Code",
                      pat.full_name AS "Patient", p.kind AS "Kind", p.amount_poisha AS "Amount (poisha)",
                      m.name AS "Method", p.reference_no AS "Reference", i.invoice_no AS "Invoice No",
                      p.voided_at AS "Voided At"
                 FROM payments p JOIN patients pat ON pat.id = p.patient_id
                 JOIN payment_methods m ON m.code = p.method_code
                 LEFT JOIN invoices i ON i.id = p.invoice_id
                WHERE date(p.received_at) BETWEEN ? AND ? ORDER BY p.received_at`
            )
            .all(from, to) as Record<string, unknown>[]
        }
      case 'expenses':
        return {
          title: 'Expenses',
          rows: db
            .prepare(
              `SELECT e.expense_no AS "Expense No", e.expense_date AS "Date", c.name AS "Category",
                      e.amount_poisha AS "Amount (poisha)", m.name AS "Method", e.paid_to AS "Paid To",
                      e.reference_no AS "Reference", e.description AS "Description", e.voided_at AS "Voided At"
                 FROM expenses e JOIN expense_categories c ON c.id = e.category_id
                 JOIN payment_methods m ON m.code = e.method_code
                WHERE e.expense_date BETWEEN ? AND ? ORDER BY e.expense_date`
            )
            .all(from, to) as Record<string, unknown>[]
        }
      case 'inventory':
        return {
          title: 'Inventory',
          rows: db
            .prepare(
              `SELECT i.code AS "Code", i.name AS "Item", i.category AS "Category", i.unit AS "Unit",
                      i.quantity_milli AS "Quantity (milli)", i.min_stock_milli AS "Minimum (milli)",
                      i.purchase_price_poisha AS "Purchase Price (poisha)", i.sell_price_poisha AS "Sell Price (poisha)",
                      s.name AS "Supplier", i.location AS "Location", i.is_active AS "Active"
                 FROM inventory_items i LEFT JOIN suppliers s ON s.id = i.supplier_id ORDER BY i.name`
            )
            .all() as Record<string, unknown>[]
        }
      case 'inventory_movements':
        // The movements ledger the inventory screen shows, filtered by the same date range.
        return {
          title: 'Inventory movements',
          rows: db
            .prepare(
              `SELECT t.at AS "At", i.code AS "Item Code", i.name AS "Item", t.txn_type AS "Type",
                      t.quantity_milli AS "Quantity (milli)", t.unit_cost_poisha AS "Unit Cost (poisha)",
                      b.batch_no AS "Batch", b.expiry_date AS "Expiry", t.reference_type AS "Reference Type",
                      t.reference_id AS "Reference Id", t.reason AS "Reason", t.user_name AS "Recorded By"
                 FROM inventory_transactions t JOIN inventory_items i ON i.id = t.item_id
                 LEFT JOIN inventory_batches b ON b.id = t.batch_id
                WHERE date(t.at) BETWEEN ? AND ? ORDER BY t.at, t.id`
            )
            .all(from, to) as Record<string, unknown>[]
        }
      case 'appointments':
        return {
          title: 'Appointments',
          rows: db
            .prepare(
              `SELECT a.appointment_date AS "Date", a.start_time AS "Start", a.end_time AS "End", p.code AS "Patient Code",
                      p.full_name AS "Patient", d.full_name AS "Dentist", a.status AS "Status", a.reason AS "Reason"
                 FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN dentists d ON d.id = a.dentist_id
                WHERE a.deleted_at IS NULL AND a.appointment_date BETWEEN ? AND ? ORDER BY a.appointment_date, a.start_time`
            )
            .all(from, to) as Record<string, unknown>[]
        }
      case 'visits':
        return {
          title: 'Visits',
          rows: db
            .prepare(
              `SELECT v.visit_date AS "Date", v.visit_time AS "Time", p.code AS "Patient Code", p.full_name AS "Patient",
                      d.full_name AS "Dentist", v.chief_complaint AS "Chief Complaint", v.diagnosis AS "Diagnosis",
                      v.treatment_summary AS "Treatment", v.status AS "Status"
                 FROM visits v JOIN patients p ON p.id = v.patient_id JOIN dentists d ON d.id = v.dentist_id
                WHERE v.deleted_at IS NULL AND v.visit_date BETWEEN ? AND ? ORDER BY v.visit_date, v.id`
            )
            .all(from, to) as Record<string, unknown>[]
        }
      case 'prescriptions':
        return {
          title: 'Prescriptions',
          rows: db
            .prepare(
              `SELECT r.prescription_date AS "Date", p.code AS "Patient Code", p.full_name AS "Patient",
                      d.full_name AS "Dentist", r.diagnosis AS "Diagnosis",
                      (SELECT GROUP_CONCAT(pi.medicine_name, ', ') FROM prescription_items pi WHERE pi.prescription_id = r.id) AS "Medicines",
                      r.status AS "Status"
                 FROM prescriptions r JOIN patients p ON p.id = r.patient_id JOIN dentists d ON d.id = r.dentist_id
                WHERE r.prescription_date BETWEEN ? AND ? ORDER BY r.prescription_date`
            )
            .all(from, to) as Record<string, unknown>[]
        }
      case 'staff':
        return {
          title: 'Staff',
          rows: db
            .prepare(
              `SELECT name AS "Name", position AS "Position", department AS "Department", phone AS "Phone",
                      status AS "Status", joining_date AS "Joining Date", salary_poisha AS "Salary (poisha)"
                 FROM staff ORDER BY name`
            )
            .all() as Record<string, unknown>[]
        }
      case 'audit':
        return {
          title: 'Audit log',
          rows: db
            .prepare(
              `SELECT at AS "At", actor_username AS "User", action AS "Action", entity_type AS "Entity",
                      entity_id AS "Entity Id", summary AS "Summary", severity AS "Severity", hash AS "Hash"
                 FROM audit_log WHERE date(at) BETWEEN ? AND ? ORDER BY id`
            )
            .all(from, to) as Record<string, unknown>[]
        }
      default:
        throw validationError('Unsupported export entity.', [
          { field: 'entity', message: `Cannot export "${entity}".` }
        ])
    }
  }

  /** Row count helper used by the data-management screens. */
  datasetCounts(): Record<string, number> {
    this.require('settings.view')
    const count = (table: string): number =>
      Number(
        (this.deps.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
      )
    return {
      patients: count('patients'),
      visits: count('visits'),
      appointments: count('appointments'),
      prescriptions: count('prescriptions'),
      invoices: count('invoices'),
      payments: count('payments'),
      expenses: count('expenses'),
      inventoryItems: count('inventory_items'),
      attachments: count('attachments'),
      auditEntries: count('audit_log')
    }
  }

  /** Search used by the invoices screen when picking a patient. */
  searchPatientsForBilling(
    term: string,
    limit = 12
  ): { id: number; code: string; fullName: string; phone: string }[] {
    this.require('patients.view')
    if (term.trim().length === 0) return []
    return this.deps.db
      .prepare(
        `SELECT id, code, full_name AS fullName, phone FROM patients
          WHERE deleted_at IS NULL AND (code LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')
          ORDER BY created_at DESC LIMIT ?`
      )
      .all(
        containsPattern(term.trim()),
        containsPattern(term.trim()),
        containsPattern(term.trim()),
        limit
      ) as {
      id: number
      code: string
      fullName: string
      phone: string
    }[]
  }

  /**
   * Net ledger position of one patient (shown by the invoice form while billing).
   *
   * Everything invoiced that was not voided, minus every payment received, including advances and
   * part-payments that are not linked to an invoice. The result matches `PatientFinancialSummary`
   * so the profile and the invoice form can never disagree: positive is money owed to the clinic,
   * negative is an advance the clinic is holding for the patient.
   */
  patientBalance(patientId: number): number {
    this.require('invoices.view')
    const row = this.deps.db
      .prepare(
        `SELECT
           (SELECT COALESCE(SUM(total_poisha), 0) FROM invoices
             WHERE patient_id = @id AND status <> 'void')
           - (SELECT COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount_poisha ELSE amount_poisha END), 0)
                FROM payments WHERE patient_id = @id AND voided_at IS NULL) AS value`
      )
      .get({ id: patientId }) as { value: number }
    return Number(row.value)
  }
}

/** Small helper that keeps the report buckets in a stable order. */
function mapBuckets(): {
  ensure: (key: string) => {
    bucket: string
    invoiceCount: number
    invoicedPoisha: number
    collectedPoisha: number
    expensesPoisha: number
  }
  sorted: () => {
    bucket: string
    invoiceCount: number
    invoicedPoisha: number
    collectedPoisha: number
    expensesPoisha: number
  }[]
} {
  const map = new Map<
    string,
    {
      bucket: string
      invoiceCount: number
      invoicedPoisha: number
      collectedPoisha: number
      expensesPoisha: number
    }
  >()
  return {
    ensure: (key) => {
      let entry = map.get(key)
      if (!entry) {
        entry = { bucket: key, invoiceCount: 0, invoicedPoisha: 0, collectedPoisha: 0, expensesPoisha: 0 }
        map.set(key, entry)
      }
      return entry
    },
    sorted: () => [...map.values()].sort((a, b) => a.bucket.localeCompare(b.bucket))
  }
}
