/**
 * Repositories — treatment catalogue, invoices, payments, inventory and accounting.
 * Financial arithmetic happens in the services using the integer-poisha `Money` module.
 */

import { nowEpochMs, nowSql } from '@shared/date'
import { containsPattern } from '@shared/ids'
import type {
  AccountingSummary,
  Expense,
  ExpenseInput,
  ExpenseQuery,
  InventoryBatch,
  InventoryItem,
  InventoryItemInput,
  InventoryQuery,
  InventoryTransaction,
  Invoice,
  InvoiceQuery,
  OutstandingRow,
  Paged,
  Payment,
  PaymentDashboard,
  PaymentInput,
  PaymentQuery,
  StockInInput,
  StockIssueInput,
  Supplier,
  Treatment,
  TreatmentInput,
  TreatmentRevenueRow
} from '@shared/types'
import type { InventoryTransactionType } from '@shared/constants'
import type { SqliteDatabase } from './connection'

const NOW = (): string => nowSql()

// ---------------------------------------------------------------------------------------------
// Treatment catalogue
// ---------------------------------------------------------------------------------------------

export class TreatmentRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(
    query: {
      search?: string | null
      category?: string | null
      includeInactive?: boolean
      page?: number
      pageSize?: number
    } = {}
  ): Paged<Treatment> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 100
    const where: string[] = []
    const params: Record<string, unknown> = { limit: pageSize, offset: (page - 1) * pageSize }
    if (!query.includeInactive) where.push('t.is_active = 1')
    if (query.category) {
      where.push('t.category = @category')
      params.category = query.category
    }
    if (query.search?.trim()) {
      where.push(
        `(t.name LIKE @search ESCAPE '\\' OR t.code LIKE @search ESCAPE '\\' OR t.name_bn LIKE @search ESCAPE '\\')`
      )
      params.search = containsPattern(query.search.trim())
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number(
      (
        this.db.prepare(`SELECT COUNT(*) AS count FROM treatment_catalog t ${whereSql}`).get(params) as {
          count: number
        }
      ).count
    )
    const rows = this.db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM invoice_items ii WHERE ii.treatment_id = t.id) AS usage_count
           FROM treatment_catalog t ${whereSql}
          ORDER BY t.is_active DESC, t.category, t.name COLLATE NOCASE
          LIMIT @limit OFFSET @offset`
      )
      .all(params) as Record<string, string | number | null>[]
    return { rows: rows.map(mapTreatment), total, page, pageSize }
  }

  allActive(): Treatment[] {
    return this.list({ includeInactive: false, pageSize: 1000 }).rows
  }

  findById(id: number): Treatment | null {
    const row = this.db
      .prepare('SELECT t.*, 0 AS usage_count FROM treatment_catalog t WHERE t.id = ?')
      .get(id) as Record<string, string | number | null> | undefined
    return row ? mapTreatment(row) : null
  }

  create(input: TreatmentInput, actor: string): number {
    const result = this.db
      .prepare(
        `INSERT INTO treatment_catalog (code, name, name_bn, category, description, default_fee_poisha, duration_minutes,
                                        is_active, is_system_default, created_at, created_by, updated_at, updated_by)
         VALUES (@code, @name, @nameBn, @category, @description, @defaultFeePoisha, @durationMinutes, @isActive, 0,
                 @createdAt, @createdBy, @updatedAt, @updatedBy)`
      )
      .run({
        code: input.code || null,
        name: input.name,
        nameBn: input.nameBn ?? null,
        category: input.category,
        description: input.description ?? null,
        defaultFeePoisha: input.defaultFeePoisha,
        durationMinutes: input.durationMinutes ?? null,
        isActive: input.isActive === false ? 0 : 1,
        createdAt: NOW(),
        createdBy: actor,
        updatedAt: NOW(),
        updatedBy: actor
      })
    return Number(result.lastInsertRowid)
  }

  update(id: number, input: TreatmentInput, actor: string): void {
    this.db
      .prepare(
        `UPDATE treatment_catalog SET code = @code, name = @name, name_bn = @nameBn, category = @category,
                description = @description, default_fee_poisha = @defaultFeePoisha, duration_minutes = @durationMinutes,
                is_active = @isActive, updated_at = @updatedAt, updated_by = @updatedBy WHERE id = @id`
      )
      .run({
        id,
        code: input.code || null,
        name: input.name,
        nameBn: input.nameBn ?? null,
        category: input.category,
        description: input.description ?? null,
        defaultFeePoisha: input.defaultFeePoisha,
        durationMinutes: input.durationMinutes ?? null,
        isActive: input.isActive === false ? 0 : 1,
        updatedAt: NOW(),
        updatedBy: actor
      })
  }

  deactivate(id: number, actor: string): void {
    this.db
      .prepare('UPDATE treatment_catalog SET is_active = 0, updated_at = ?, updated_by = ? WHERE id = ?')
      .run(NOW(), actor, id)
  }

  usageCount(id: number): number {
    return Number(
      (
        this.db.prepare('SELECT COUNT(*) AS count FROM invoice_items WHERE treatment_id = ?').get(id) as {
          count: number
        }
      ).count
    )
  }

  revenue(from: string, to: string): TreatmentRevenueRow[] {
    const rows = this.db
      .prepare(
        `SELECT ii.treatment_id, COALESCE(t.name, ii.description) AS treatment_name, t.category,
                SUM(ii.quantity_milli) / 1000.0 AS quantity, SUM(ii.line_total_poisha) AS revenue
           FROM invoice_items ii
           JOIN invoices i ON i.id = ii.invoice_id
           LEFT JOIN treatment_catalog t ON t.id = ii.treatment_id
          WHERE i.status <> 'void' AND i.invoice_date BETWEEN ? AND ?
          GROUP BY ii.treatment_id, treatment_name
          ORDER BY revenue DESC`
      )
      .all(from, to) as Record<string, string | number | null>[]
    return rows.map((row) => ({
      treatmentId: (row.treatment_id as number | null) ?? null,
      treatmentName: row.treatment_name as string,
      category: (row.category as string) ?? null,
      quantity: Math.round(Number(row.quantity)),
      revenuePoisha: Number(row.revenue)
    }))
  }
}

function mapTreatment(row: Record<string, string | number | null>): Treatment {
  return {
    id: row.id as number,
    code: (row.code as string) ?? null,
    name: row.name as string,
    nameBn: (row.name_bn as string) ?? null,
    category: row.category as string,
    description: (row.description as string) ?? null,
    defaultFeePoisha: Number(row.default_fee_poisha),
    durationMinutes: (row.duration_minutes as number | null) ?? null,
    isActive: Number(row.is_active) === 1,
    isSystemDefault: Number(row.is_system_default) === 1,
    usageCount: Number(row.usage_count ?? 0),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

// ---------------------------------------------------------------------------------------------
// Invoices and payments
// ---------------------------------------------------------------------------------------------

export class InvoiceRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(query: InvoiceQuery): Paged<Invoice> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 25
    const where: string[] = []
    const params: Record<string, unknown> = { limit: pageSize, offset: (page - 1) * pageSize }
    if (query.patientId) {
      where.push('i.patient_id = @patientId')
      params.patientId = query.patientId
    }
    if (query.status) {
      where.push('i.status = @status')
      params.status = query.status
    }
    if (query.from) {
      where.push('i.invoice_date >= @from')
      params.from = query.from
    }
    if (query.to) {
      where.push('i.invoice_date <= @to')
      params.to = query.to
    }
    if (query.search?.trim()) {
      where.push(
        `(i.invoice_no LIKE @search ESCAPE '\\' OR p.full_name LIKE @search ESCAPE '\\' OR p.code LIKE @search ESCAPE '\\')`
      )
      params.search = containsPattern(query.search.trim())
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number(
      (
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM invoices i JOIN patients p ON p.id = i.patient_id ${whereSql}`
          )
          .get(params) as { count: number }
      ).count
    )
    const rows = this.db
      .prepare(
        `SELECT i.*, p.code AS patient_code, p.full_name AS patient_name, p.address AS patient_address, p.phone AS patient_phone
           FROM invoices i JOIN patients p ON p.id = i.patient_id
           ${whereSql} ORDER BY i.invoice_date DESC, i.id DESC LIMIT @limit OFFSET @offset`
      )
      .all(params) as Record<string, unknown>[]
    return { rows: rows.map((row) => this.mapInvoice(row, false)), total, page, pageSize }
  }

  findById(id: number): Invoice | null {
    const row = this.db
      .prepare(
        `SELECT i.*, p.code AS patient_code, p.full_name AS patient_name, p.address AS patient_address, p.phone AS patient_phone
           FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined
    return row ? this.mapInvoice(row, true) : null
  }

  findByNumber(invoiceNo: string): Invoice | null {
    const row = this.db
      .prepare(
        `SELECT i.*, p.code AS patient_code, p.full_name AS patient_name, p.address AS patient_address, p.phone AS patient_phone
           FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.invoice_no = ?`
      )
      .get(invoiceNo) as Record<string, unknown> | undefined
    return row ? this.mapInvoice(row, true) : null
  }

  private mapInvoice(row: Record<string, unknown>, withChildren: boolean): Invoice {
    const id = row.id as number
    return {
      id,
      invoiceNo: row.invoice_no as string,
      patientId: row.patient_id as number,
      patientCode: (row.patient_code as string) ?? '',
      patientName: (row.patient_name as string) ?? '',
      patientAddress: (row.patient_address as string) ?? null,
      patientPhone: (row.patient_phone as string) ?? null,
      visitId: (row.visit_id as number | null) ?? null,
      invoiceDate: row.invoice_date as string,
      dueDate: (row.due_date as string) ?? null,
      subtotalPoisha: row.subtotal_poisha as number,
      discountPoisha: row.discount_poisha as number,
      discountPercentX100: row.discount_percent_x100 as number,
      taxPoisha: row.tax_poisha as number,
      roundOffPoisha: row.round_off_poisha as number,
      totalPoisha: row.total_poisha as number,
      paidPoisha: row.paid_poisha as number,
      balancePoisha: row.balance_poisha as number,
      status: row.status as Invoice['status'],
      notes: (row.notes as string) ?? null,
      voidedAt: (row.voided_at as string) ?? null,
      voidReason: (row.void_reason as string) ?? null,
      items: withChildren ? this.items(id) : [],
      payments: withChildren ? this.paymentsForInvoice(id) : [],
      createdAt: row.created_at as string,
      createdBy: (row.created_by as string) ?? null,
      updatedAt: row.updated_at as string,
      updatedBy: (row.updated_by as string) ?? null
    }
  }

  items(invoiceId: number): Invoice['items'] {
    const rows = this.db
      .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id')
      .all(invoiceId) as Record<string, string | number | null>[]
    return rows.map((row) => ({
      id: row.id as number,
      sortOrder: row.sort_order as number,
      itemType: row.item_type as Invoice['items'][number]['itemType'],
      treatmentId: (row.treatment_id as number | null) ?? null,
      inventoryItemId: (row.inventory_item_id as number | null) ?? null,
      description: row.description as string,
      quantityMilli: Number(row.quantity_milli),
      unitPricePoisha: Number(row.unit_price_poisha),
      discountPoisha: Number(row.discount_poisha),
      lineTotalPoisha: Number(row.line_total_poisha),
      note: (row.note as string) ?? null
    }))
  }

  paymentsForInvoice(invoiceId: number): Payment[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, m.name AS method_name, pat.code AS patient_code, pat.full_name AS patient_name, i.invoice_no
           FROM payments p
           JOIN payment_methods m ON m.code = p.method_code
           JOIN patients pat ON pat.id = p.patient_id
           LEFT JOIN invoices i ON i.id = p.invoice_id
          WHERE p.invoice_id = ? ORDER BY p.received_at ASC, p.id ASC`
      )
      .all(invoiceId) as Record<string, string | number | null>[]
    return rows.map(mapPayment)
  }

  create(input: {
    invoiceNo: string
    patientId: number
    visitId: number | null
    invoiceDate: string
    dueDate: string | null
    subtotalPoisha: number
    discountPoisha: number
    discountPercentX100: number
    taxPoisha: number
    roundOffPoisha: number
    totalPoisha: number
    status: Invoice['status']
    notes: string | null
    items: {
      itemType: Invoice['items'][number]['itemType']
      treatmentId: number | null
      inventoryItemId: number | null
      description: string
      quantityMilli: number
      unitPricePoisha: number
      discountPoisha: number
      lineTotalPoisha: number
      note: string | null
    }[]
    actor: string
  }): number {
    const run = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO invoices (invoice_no, patient_id, visit_id, invoice_date, due_date, subtotal_poisha,
                                 discount_poisha, discount_percent_x100, tax_poisha, round_off_poisha, total_poisha,
                                 paid_poisha, status, notes, created_at, created_by, updated_at, updated_by)
           VALUES (@invoiceNo, @patientId, @visitId, @invoiceDate, @dueDate, @subtotalPoisha, @discountPoisha,
                   @discountPercentX100, @taxPoisha, @roundOffPoisha, @totalPoisha, 0, @status, @notes,
                   @createdAt, @createdBy, @updatedAt, @updatedBy)`
        )
        .run({
          invoiceNo: input.invoiceNo,
          patientId: input.patientId,
          visitId: input.visitId,
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate,
          subtotalPoisha: input.subtotalPoisha,
          discountPoisha: input.discountPoisha,
          discountPercentX100: input.discountPercentX100,
          taxPoisha: input.taxPoisha,
          roundOffPoisha: input.roundOffPoisha,
          totalPoisha: input.totalPoisha,
          status: input.status,
          notes: input.notes,
          createdAt: NOW(),
          createdBy: input.actor,
          updatedAt: NOW(),
          updatedBy: input.actor
        })
      const invoiceId = Number(result.lastInsertRowid)
      this.replaceItems(invoiceId, input.items)
      return invoiceId
    })
    return run()
  }

  update(
    id: number,
    input: {
      invoiceDate: string
      dueDate: string | null
      subtotalPoisha: number
      discountPoisha: number
      discountPercentX100: number
      taxPoisha: number
      roundOffPoisha: number
      totalPoisha: number
      status: Invoice['status']
      notes: string | null
      items: Parameters<InvoiceRepository['create']>[0]['items']
      actor: string
    }
  ): void {
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE invoices SET invoice_date = @invoiceDate, due_date = @dueDate, subtotal_poisha = @subtotalPoisha,
                  discount_poisha = @discountPoisha, discount_percent_x100 = @discountPercentX100, tax_poisha = @taxPoisha,
                  round_off_poisha = @roundOffPoisha, total_poisha = @totalPoisha, status = @status, notes = @notes,
                  updated_at = @updatedAt, updated_by = @updatedBy WHERE id = @id`
        )
        .run({
          id,
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate,
          subtotalPoisha: input.subtotalPoisha,
          discountPoisha: input.discountPoisha,
          discountPercentX100: input.discountPercentX100,
          taxPoisha: input.taxPoisha,
          roundOffPoisha: input.roundOffPoisha,
          totalPoisha: input.totalPoisha,
          status: input.status,
          notes: input.notes,
          updatedAt: NOW(),
          updatedBy: input.actor
        })
      this.replaceItems(id, input.items)
      this.recalculatePaid(id)
    })
    run()
  }

  private replaceItems(invoiceId: number, items: Parameters<InvoiceRepository['create']>[0]['items']): void {
    this.db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId)
    const insert = this.db.prepare(
      `INSERT INTO invoice_items (invoice_id, sort_order, item_type, treatment_id, inventory_item_id, description,
                                  quantity_milli, unit_price_poisha, discount_poisha, line_total_poisha, note)
       VALUES (@invoiceId, @sortOrder, @itemType, @treatmentId, @inventoryItemId, @description, @quantityMilli,
               @unitPricePoisha, @discountPoisha, @lineTotalPoisha, @note)`
    )
    items.forEach((item, index) => {
      insert.run({
        invoiceId,
        sortOrder: index,
        itemType: item.itemType,
        treatmentId: item.treatmentId,
        inventoryItemId: item.inventoryItemId,
        description: item.description,
        quantityMilli: item.quantityMilli,
        unitPricePoisha: item.unitPricePoisha,
        discountPoisha: item.discountPoisha,
        lineTotalPoisha: item.lineTotalPoisha,
        note: item.note
      })
    })
  }

  /** Recompute paid_poisha and status from the payment rows (single source of truth). */
  recalculatePaid(invoiceId: number): void {
    const row = this.db.prepare('SELECT total_poisha, status FROM invoices WHERE id = ?').get(invoiceId) as
      { total_poisha: number; status: string } | undefined
    if (!row) return
    const paid = Number(
      (
        this.db
          .prepare(
            `SELECT COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount_poisha ELSE amount_poisha END), 0) AS value
               FROM payments WHERE invoice_id = ? AND voided_at IS NULL`
          )
          .get(invoiceId) as { value: number }
      ).value
    )
    const safePaid = Math.max(0, paid)
    let status: Invoice['status']
    if (row.status === 'void') status = 'void'
    else if (safePaid === 0) status = 'unpaid'
    else if (safePaid < row.total_poisha) status = 'partial'
    else if (safePaid === row.total_poisha) status = 'paid'
    else status = 'overpaid'

    this.db
      .prepare('UPDATE invoices SET paid_poisha = ?, status = ? WHERE id = ?')
      .run(safePaid, status, invoiceId)
  }

  voidInvoice(id: number, reason: string, actor: string): void {
    this.db
      .prepare(
        `UPDATE invoices SET status = 'void', voided_at = ?, voided_by = ?, void_reason = ?,
                updated_at = ?, updated_by = ? WHERE id = ?`
      )
      .run(NOW(), actor, reason, NOW(), actor, id)
  }

  outstanding(): OutstandingRow[] {
    const rows = this.db
      .prepare(
        `SELECT p.id AS patient_id, p.code AS patient_code, p.full_name AS patient_name, p.phone,
                COUNT(i.id) AS invoice_count, SUM(i.balance_poisha) AS outstanding,
                MIN(i.invoice_date) AS oldest_invoice,
                (SELECT MAX(received_at) FROM payments pay WHERE pay.patient_id = p.id AND pay.voided_at IS NULL) AS last_payment
           FROM invoices i JOIN patients p ON p.id = i.patient_id
          WHERE i.status <> 'void' AND i.balance_poisha > 0 AND p.deleted_at IS NULL
          GROUP BY p.id HAVING outstanding > 0
          ORDER BY outstanding DESC`
      )
      .all() as Record<string, string | number | null>[]
    return rows.map((row) => ({
      patientId: row.patient_id as number,
      patientCode: row.patient_code as string,
      patientName: row.patient_name as string,
      phone: (row.phone as string) ?? '',
      invoiceCount: Number(row.invoice_count),
      outstandingPoisha: Number(row.outstanding),
      oldestInvoiceDate: row.oldest_invoice as string,
      lastPaymentDate: (row.last_payment as string) ?? null
    }))
  }

  totalOutstanding(): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(balance_poisha), 0) AS value FROM invoices WHERE status <> 'void' AND balance_poisha > 0`
      )
      .get() as { value: number }
    return Number(row.value)
  }

  summaryForDate(date: string): { invoiced: number; collected: number; invoiceCount: number } {
    const invoiced = this.db
      .prepare(
        `SELECT COALESCE(SUM(total_poisha), 0) AS value, COUNT(*) AS count FROM invoices
          WHERE invoice_date = ? AND status <> 'void'`
      )
      .get(date) as { value: number; count: number }
    return { invoiced: Number(invoiced.value), collected: 0, invoiceCount: Number(invoiced.count) }
  }

  countAll(): number {
    return Number(
      (this.db.prepare('SELECT COUNT(*) AS count FROM invoices').get() as { count: number }).count
    )
  }
}

export class PaymentRepository {
  constructor(private readonly db: SqliteDatabase) {}

  private buildWhere(query: PaymentQuery): { whereSql: string; params: Record<string, unknown> } {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    const today = nowSql().slice(0, 10)
    const range = query.range ?? 'today'
    if (range === 'custom') {
      if (query.from) {
        where.push('p.received_at >= @from')
        params.from = `${query.from} 00:00:00`
      }
      if (query.to) {
        where.push('p.received_at <= @to')
        params.to = `${query.to} 23:59:59`
      }
    } else if (range !== 'all') {
      const days =
        range === 'today'
          ? 0
          : range === 'last7'
            ? 6
            : range === 'last30'
              ? 29
              : range === 'last90'
                ? 89
                : 364
      const date = new Date()
      date.setDate(date.getDate() - days)
      const from = date.toISOString().slice(0, 10)
      where.push('p.received_at >= @from AND p.received_at <= @to')
      params.from = `${from} 00:00:00`
      params.to = `${today} 23:59:59`
    }
    if (query.methodCode) {
      where.push('p.method_code = @methodCode')
      params.methodCode = query.methodCode
    }
    if (query.patientId) {
      where.push('p.patient_id = @patientId')
      params.patientId = query.patientId
    }
    if (query.search?.trim()) {
      where.push(
        `(p.receipt_no LIKE @search ESCAPE '\\' OR pat.full_name LIKE @search ESCAPE '\\' OR pat.code LIKE @search ESCAPE '\\' OR p.reference_no LIKE @search ESCAPE '\\')`
      )
      params.search = containsPattern(query.search.trim())
    }
    return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params }
  }

  list(query: PaymentQuery): Paged<Payment> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 25
    const { whereSql, params } = this.buildWhere(query)
    const total = Number(
      (
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM payments p JOIN patients pat ON pat.id = p.patient_id ${whereSql}`
          )
          .get(params) as { count: number }
      ).count
    )
    const rows = this.db
      .prepare(
        `SELECT p.*, m.name AS method_name, pat.code AS patient_code, pat.full_name AS patient_name, i.invoice_no
           FROM payments p
           JOIN payment_methods m ON m.code = p.method_code
           JOIN patients pat ON pat.id = p.patient_id
           LEFT JOIN invoices i ON i.id = p.invoice_id
           ${whereSql}
          ORDER BY p.received_at DESC, p.id DESC LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as Record<
      string,
      string | number | null
    >[]
    return { rows: rows.map(mapPayment), total, page, pageSize }
  }

  findById(id: number): Payment | null {
    const row = this.db
      .prepare(
        `SELECT p.*, m.name AS method_name, pat.code AS patient_code, pat.full_name AS patient_name, i.invoice_no
           FROM payments p
           JOIN payment_methods m ON m.code = p.method_code
           JOIN patients pat ON pat.id = p.patient_id
           LEFT JOIN invoices i ON i.id = p.invoice_id
          WHERE p.id = ?`
      )
      .get(id) as Record<string, string | number | null> | undefined
    return row ? mapPayment(row) : null
  }

  create(receiptNo: string, input: PaymentInput, actor: string): number {
    const result = this.db
      .prepare(
        `INSERT INTO payments (receipt_no, patient_id, invoice_id, kind, amount_poisha, method_code, reference_no,
                               received_at, received_at_epoch_ms, received_by, notes, created_at, created_by)
         VALUES (@receiptNo, @patientId, @invoiceId, @kind, @amountPoisha, @methodCode, @referenceNo, @receivedAt,
                 @receivedAtEpochMs, @receivedBy, @notes, @createdAt, @createdBy)`
      )
      .run({
        receiptNo,
        patientId: input.patientId,
        invoiceId: input.invoiceId ?? null,
        kind: input.kind ?? 'payment',
        amountPoisha: input.amountPoisha,
        methodCode: input.methodCode,
        referenceNo: input.referenceNo ?? null,
        receivedAt: input.receivedAt.length > 16 ? input.receivedAt : `${input.receivedAt}:00`,
        receivedAtEpochMs: nowEpochMs(),
        receivedBy: actor,
        notes: input.notes ?? null,
        createdAt: NOW(),
        createdBy: actor
      })
    return Number(result.lastInsertRowid)
  }

  voidPayment(id: number, reason: string, actor: string): void {
    this.db
      .prepare(`UPDATE payments SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?`)
      .run(NOW(), actor, reason, id)
  }

  dashboard(query: PaymentQuery): PaymentDashboard {
    const page = this.list(query)
    const { whereSql, params } = this.buildWhere(query)
    const totals = this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN p.kind = 'refund' THEN -p.amount_poisha ELSE p.amount_poisha END), 0) AS total,
                COUNT(*) AS count
           FROM payments p JOIN patients pat ON pat.id = p.patient_id
           ${whereSql === '' ? 'WHERE p.voided_at IS NULL' : `${whereSql} AND p.voided_at IS NULL`}`
      )
      .get(params) as { total: number; count: number }
    const byMethod = this.db
      .prepare(
        `SELECT p.method_code, m.name AS method_name,
                COALESCE(SUM(CASE WHEN p.kind = 'refund' THEN -p.amount_poisha ELSE p.amount_poisha END), 0) AS total,
                COUNT(*) AS count
           FROM payments p JOIN payment_methods m ON m.code = p.method_code JOIN patients pat ON pat.id = p.patient_id
           ${whereSql === '' ? 'WHERE p.voided_at IS NULL' : `${whereSql} AND p.voided_at IS NULL`}
          GROUP BY p.method_code ORDER BY total DESC`
      )
      .all(params) as Record<string, string | number>[]

    const outstanding = this.db
      .prepare(`SELECT COALESCE(SUM(balance_poisha), 0) AS value FROM invoices WHERE status <> 'void'`)
      .get() as { value: number }

    const range = query.range ?? 'today'
    const resolved = new Date()
    if (range !== 'all' && range !== 'custom') {
      const days =
        range === 'today'
          ? 0
          : range === 'last7'
            ? 6
            : range === 'last30'
              ? 29
              : range === 'last90'
                ? 89
                : 364
      resolved.setDate(resolved.getDate() - days)
    }

    return {
      rangeFrom:
        range === 'all'
          ? null
          : range === 'custom'
            ? (query.from ?? null)
            : resolved.toISOString().slice(0, 10),
      rangeTo: range === 'all' ? null : range === 'custom' ? (query.to ?? null) : nowSql().slice(0, 10),
      totalPoisha: Number(totals.total),
      byMethod: byMethod.map((row) => ({
        methodCode: row.method_code as string,
        methodName: row.method_name as string,
        totalPoisha: Number(row.total),
        count: Number(row.count)
      })),
      outstandingPoisha: Number(outstanding.value),
      payments: page.rows,
      count: page.total
    }
  }

  collectedBetween(from: string, to: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount_poisha ELSE amount_poisha END), 0) AS value
           FROM payments WHERE voided_at IS NULL AND date(received_at) BETWEEN ? AND ?`
      )
      .get(from, to) as { value: number }
    return Number(row.value)
  }

  methodBreakdown(
    from: string,
    to: string
  ): { methodCode: string; methodName: string; totalPoisha: number; count: number }[] {
    const rows = this.db
      .prepare(
        `SELECT p.method_code, m.name AS method_name,
                COALESCE(SUM(CASE WHEN p.kind = 'refund' THEN -p.amount_poisha ELSE p.amount_poisha END), 0) AS total,
                COUNT(*) AS count
           FROM payments p JOIN payment_methods m ON m.code = p.method_code
          WHERE p.voided_at IS NULL AND date(p.received_at) BETWEEN ? AND ?
          GROUP BY p.method_code ORDER BY total DESC`
      )
      .all(from, to) as Record<string, string | number>[]
    return rows.map((row) => ({
      methodCode: row.method_code as string,
      methodName: row.method_name as string,
      totalPoisha: Number(row.total),
      count: Number(row.count)
    }))
  }

  countAll(): number {
    return Number(
      (this.db.prepare('SELECT COUNT(*) AS count FROM payments').get() as { count: number }).count
    )
  }
}

function mapPayment(row: Record<string, string | number | null>): Payment {
  return {
    id: row.id as number,
    receiptNo: row.receipt_no as string,
    patientId: row.patient_id as number,
    patientCode: (row.patient_code as string) ?? '',
    patientName: (row.patient_name as string) ?? '',
    invoiceId: (row.invoice_id as number | null) ?? null,
    invoiceNo: (row.invoice_no as string) ?? null,
    kind: row.kind as Payment['kind'],
    amountPoisha: Number(row.amount_poisha),
    methodCode: row.method_code as string,
    methodName: (row.method_name as string) ?? (row.method_code as string),
    referenceNo: (row.reference_no as string) ?? null,
    receivedAt: row.received_at as string,
    receivedBy: (row.received_by as string) ?? null,
    notes: (row.notes as string) ?? null,
    voidedAt: (row.voided_at as string) ?? null,
    voidReason: (row.void_reason as string) ?? null
  }
}

// ---------------------------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------------------------

export class InventoryRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(query: InventoryQuery): Paged<InventoryItem> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 25
    const where: string[] = []
    const params: Record<string, unknown> = { limit: pageSize, offset: (page - 1) * pageSize }
    if (!query.includeInactive) where.push('i.is_active = 1')
    if (query.category) {
      where.push('i.category = @category')
      params.category = query.category
    }
    if (query.search?.trim()) {
      where.push(
        `(i.name LIKE @search ESCAPE '\\' OR i.code LIKE @search ESCAPE '\\' OR i.location LIKE @search ESCAPE '\\')`
      )
      params.search = containsPattern(query.search.trim())
    }
    if (query.lowStockOnly) where.push('i.quantity_milli <= i.min_stock_milli')
    if (query.expiringWithinDays != null) {
      where.push(`EXISTS (SELECT 1 FROM inventory_batches b WHERE b.item_id = i.id AND b.quantity_remaining_milli > 0
                           AND b.expiry_date IS NOT NULL AND date(b.expiry_date) <= date('now','localtime', @expiryModifier))`)
      params.expiryModifier = `+${query.expiringWithinDays} days`
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number(
      (
        this.db.prepare(`SELECT COUNT(*) AS count FROM inventory_items i ${whereSql}`).get(params) as {
          count: number
        }
      ).count
    )
    const rows = this.db
      .prepare(
        `SELECT i.*, s.name AS supplier_name,
                (SELECT MIN(b.expiry_date) FROM inventory_batches b WHERE b.item_id = i.id AND b.quantity_remaining_milli > 0
                   AND b.expiry_date IS NOT NULL) AS earliest_expiry
           FROM inventory_items i LEFT JOIN suppliers s ON s.id = i.supplier_id
           ${whereSql}
          ORDER BY i.name COLLATE NOCASE LIMIT @limit OFFSET @offset`
      )
      .all(params) as Record<string, string | number | null>[]
    return { rows: rows.map(mapInventoryItem), total, page, pageSize }
  }

  findById(id: number): InventoryItem | null {
    const row = this.db
      .prepare(
        `SELECT i.*, s.name AS supplier_name,
                (SELECT MIN(b.expiry_date) FROM inventory_batches b WHERE b.item_id = i.id AND b.quantity_remaining_milli > 0
                   AND b.expiry_date IS NOT NULL) AS earliest_expiry
           FROM inventory_items i LEFT JOIN suppliers s ON s.id = i.supplier_id WHERE i.id = ?`
      )
      .get(id) as Record<string, string | number | null> | undefined
    return row ? mapInventoryItem(row) : null
  }

  create(input: InventoryItemInput, actor: string): number {
    const run = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO inventory_items (code, name, category, supplier_id, unit, quantity_milli, min_stock_milli,
                                        purchase_price_poisha, sell_price_poisha, location, is_active, notes,
                                        created_at, created_by, updated_at, updated_by)
           VALUES (@code, @name, @category, @supplierId, @unit, 0, @minStockMilli, @purchasePricePoisha,
                   @sellPricePoisha, @location, @isActive, @notes, @createdAt, @createdBy, @updatedAt, @updatedBy)`
        )
        .run({
          code: input.code || null,
          name: input.name,
          category: input.category ?? null,
          supplierId: input.supplierId ?? null,
          unit: input.unit,
          minStockMilli: input.minStockMilli ?? 0,
          purchasePricePoisha: input.purchasePricePoisha ?? 0,
          sellPricePoisha: input.sellPricePoisha ?? null,
          location: input.location ?? null,
          isActive: input.isActive === false ? 0 : 1,
          notes: input.notes ?? null,
          createdAt: NOW(),
          createdBy: actor,
          updatedAt: NOW(),
          updatedBy: actor
        })
      const itemId = Number(result.lastInsertRowid)
      if ((input.quantityMilli ?? 0) > 0) {
        // Opening stock is recorded through the ledger so quantity always equals the ledger sum.
        this.insertTransaction({
          itemId,
          batchId: null,
          txnType: 'opening',
          quantityMilli: input.quantityMilli,
          unitCostPoisha: input.purchasePricePoisha ?? 0,
          reason: 'Opening stock',
          referenceType: null,
          referenceId: null,
          actor,
          notes: null
        })
        this.db
          .prepare('UPDATE inventory_items SET quantity_milli = quantity_milli + ? WHERE id = ?')
          .run(input.quantityMilli, itemId)
      }
      return itemId
    })
    return run()
  }

  update(id: number, input: InventoryItemInput, actor: string): void {
    this.db
      .prepare(
        `UPDATE inventory_items SET code = @code, name = @name, category = @category, supplier_id = @supplierId,
                unit = @unit, min_stock_milli = @minStockMilli, purchase_price_poisha = @purchasePricePoisha,
                sell_price_poisha = @sellPricePoisha, location = @location, is_active = @isActive, notes = @notes,
                updated_at = @updatedAt, updated_by = @updatedBy WHERE id = @id`
      )
      .run({
        id,
        code: input.code || null,
        name: input.name,
        category: input.category ?? null,
        supplierId: input.supplierId ?? null,
        unit: input.unit,
        minStockMilli: input.minStockMilli ?? 0,
        purchasePricePoisha: input.purchasePricePoisha ?? 0,
        sellPricePoisha: input.sellPricePoisha ?? null,
        location: input.location ?? null,
        isActive: input.isActive === false ? 0 : 1,
        notes: input.notes ?? null,
        updatedAt: NOW(),
        updatedBy: actor
      })
  }

  private insertTransaction(input: {
    itemId: number
    batchId: number | null
    txnType: InventoryTransactionType
    quantityMilli: number
    unitCostPoisha: number
    reason: string | null
    referenceType: string | null
    referenceId: number | null
    actor: string
    notes: string | null
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO inventory_transactions (item_id, batch_id, txn_type, quantity_milli, unit_cost_poisha, reason,
                                            reference_type, reference_id, at, at_epoch_ms, user_name, notes)
         VALUES (@itemId, @batchId, @txnType, @quantityMilli, @unitCostPoisha, @reason, @referenceType, @referenceId,
                 @at, @atEpochMs, @actor, @notes)`
      )
      .run({
        itemId: input.itemId,
        batchId: input.batchId,
        txnType: input.txnType,
        quantityMilli: input.quantityMilli,
        unitCostPoisha: input.unitCostPoisha,
        reason: input.reason,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        at: NOW(),
        atEpochMs: nowEpochMs(),
        actor: input.actor,
        notes: input.notes
      })
    return Number(result.lastInsertRowid)
  }

  stockIn(input: StockInInput, actor: string): { batchId: number; transactionId: number } {
    const run = this.db.transaction(() => {
      const batch = this.db
        .prepare(
          `INSERT INTO inventory_batches (item_id, batch_no, expiry_date, quantity_in_milli, quantity_remaining_milli,
                                          purchase_price_poisha, purchase_date, supplier_id, reference_no, created_at, created_by)
           VALUES (@itemId, @batchNo, @expiryDate, @quantityMilli, @quantityMilli, @unitCostPoisha, @purchaseDate,
                   @supplierId, @reference, @createdAt, @createdBy)`
        )
        .run({
          itemId: input.itemId,
          batchNo: input.batchNo ?? null,
          expiryDate: input.expiryDate ?? null,
          quantityMilli: input.quantityMilli,
          unitCostPoisha: input.unitCostPoisha,
          purchaseDate: input.purchaseDate,
          supplierId: input.supplierId ?? null,
          reference: input.reference ?? null,
          createdAt: NOW(),
          createdBy: actor
        })
      const batchId = Number(batch.lastInsertRowid)
      const transactionId = this.insertTransaction({
        itemId: input.itemId,
        batchId,
        txnType: 'purchase',
        quantityMilli: input.quantityMilli,
        unitCostPoisha: input.unitCostPoisha,
        reason: input.reference ?? 'Stock purchase',
        referenceType: 'purchase',
        referenceId: batchId,
        actor,
        notes: input.notes ?? null
      })
      this.db
        .prepare(
          `UPDATE inventory_items SET quantity_milli = quantity_milli + @quantity,
                  purchase_price_poisha = CASE WHEN @cost > 0 THEN @cost ELSE purchase_price_poisha END,
                  updated_at = @now, updated_by = @actor WHERE id = @itemId`
        )
        .run({
          quantity: input.quantityMilli,
          cost: input.unitCostPoisha,
          now: NOW(),
          actor,
          itemId: input.itemId
        })
      return { batchId, transactionId }
    })
    return run()
  }

  issue(input: StockIssueInput, actor: string): number {
    const run = this.db.transaction(() => {
      const item = this.db
        .prepare('SELECT quantity_milli FROM inventory_items WHERE id = ?')
        .get(input.itemId) as { quantity_milli: number } | undefined
      if (!item) throw new Error('Inventory item not found')
      if (input.quantityMilli > item.quantity_milli) {
        throw new Error('Not enough stock available for this transaction')
      }
      const signed =
        input.txnType === 'adjustment_out' ||
        input.txnType === 'wastage' ||
        input.txnType === 'usage' ||
        input.txnType === 'return' ||
        input.txnType === 'expired'
          ? -input.quantityMilli
          : input.quantityMilli
      const transactionId = this.insertTransaction({
        itemId: input.itemId,
        batchId: input.batchId ?? null,
        txnType: input.txnType,
        quantityMilli: signed,
        unitCostPoisha: 0,
        reason: input.reason ?? null,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        actor,
        notes: input.notes ?? null
      })
      this.db
        .prepare(
          'UPDATE inventory_items SET quantity_milli = quantity_milli + ?, updated_at = ?, updated_by = ? WHERE id = ?'
        )
        .run(signed, NOW(), actor, input.itemId)
      if (input.batchId) {
        this.db
          .prepare(
            'UPDATE inventory_batches SET quantity_remaining_milli = MAX(0, quantity_remaining_milli - ?) WHERE id = ?'
          )
          .run(input.quantityMilli, input.batchId)
      }
      return transactionId
    })
    return run()
  }

  batches(itemId: number): InventoryBatch[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM inventory_batches WHERE item_id = ? ORDER BY expiry_date IS NULL, expiry_date, id'
      )
      .all(itemId) as Record<string, string | number | null>[]
    const today = nowSql().slice(0, 10)
    return rows.map((row) => ({
      id: row.id as number,
      itemId: row.item_id as number,
      batchNo: (row.batch_no as string) ?? null,
      expiryDate: (row.expiry_date as string) ?? null,
      quantityInMilli: Number(row.quantity_in_milli),
      quantityRemainingMilli: Number(row.quantity_remaining_milli),
      purchasePricePoisha: Number(row.purchase_price_poisha),
      purchaseDate: row.purchase_date as string,
      supplierId: (row.supplier_id as number | null) ?? null,
      isExpired: row.expiry_date != null && (row.expiry_date as string) < today
    }))
  }

  transactions(query: {
    itemId?: number
    txnType?: string
    from?: string
    to?: string
    page?: number
    pageSize?: number
  }): Paged<InventoryTransaction> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 50
    const where: string[] = []
    const params: Record<string, unknown> = { limit: pageSize, offset: (page - 1) * pageSize }
    if (query.itemId) {
      where.push('t.item_id = @itemId')
      params.itemId = query.itemId
    }
    if (query.txnType) {
      where.push('t.txn_type = @txnType')
      params.txnType = query.txnType
    }
    if (query.from) {
      where.push('date(t.at) >= date(@from)')
      params.from = query.from
    }
    if (query.to) {
      where.push('date(t.at) <= date(@to)')
      params.to = query.to
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number(
      (
        this.db.prepare(`SELECT COUNT(*) AS count FROM inventory_transactions t ${whereSql}`).get(params) as {
          count: number
        }
      ).count
    )
    const rows = this.db
      .prepare(
        `SELECT t.*, i.name AS item_name FROM inventory_transactions t
           JOIN inventory_items i ON i.id = t.item_id
           ${whereSql} ORDER BY t.at_epoch_ms DESC, t.id DESC LIMIT @limit OFFSET @offset`
      )
      .all(params) as Record<string, string | number | null>[]
    return {
      rows: rows.map((row) => ({
        id: row.id as number,
        itemId: row.item_id as number,
        itemName: (row.item_name as string) ?? '',
        batchId: (row.batch_id as number | null) ?? null,
        txnType: row.txn_type as InventoryTransactionType,
        quantityMilli: Number(row.quantity_milli),
        unitCostPoisha: Number(row.unit_cost_poisha),
        reason: (row.reason as string) ?? null,
        referenceType: (row.reference_type as string) ?? null,
        referenceId: (row.reference_id as number | null) ?? null,
        at: row.at as string,
        userName: (row.user_name as string) ?? null,
        notes: (row.notes as string) ?? null
      })),
      total,
      page,
      pageSize
    }
  }

  lowStock(limit = 20): InventoryItem[] {
    return this.list({ lowStockOnly: true, includeInactive: false, pageSize: limit }).rows
  }

  expiring(
    withinDays: number,
    limit = 20
  ): {
    itemId: number
    itemName: string
    batchNo: string | null
    expiryDate: string
    quantityMilli: number
  }[] {
    const rows = this.db
      .prepare(
        `SELECT b.item_id, i.name AS item_name, b.batch_no, b.expiry_date, b.quantity_remaining_milli
           FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
          WHERE b.quantity_remaining_milli > 0 AND b.expiry_date IS NOT NULL
            AND date(b.expiry_date) <= date('now','localtime', ?)
          ORDER BY b.expiry_date ASC LIMIT ?`
      )
      .all(`+${withinDays} days`, limit) as Record<string, string | number | null>[]
    return rows.map((row) => ({
      itemId: row.item_id as number,
      itemName: row.item_name as string,
      batchNo: (row.batch_no as string) ?? null,
      expiryDate: row.expiry_date as string,
      quantityMilli: Number(row.quantity_remaining_milli)
    }))
  }

  expiredCount(): number {
    return Number(
      (
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM inventory_batches b
              WHERE b.quantity_remaining_milli > 0 AND b.expiry_date IS NOT NULL AND date(b.expiry_date) < date('now','localtime')`
          )
          .get() as { count: number }
      ).count
    )
  }

  purchaseTotalBetween(from: string, to: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(quantity_milli * unit_cost_poisha / 1000.0), 0) AS value
           FROM inventory_transactions WHERE txn_type = 'purchase' AND date(at) BETWEEN ? AND ?`
      )
      .get(from, to) as { value: number }
    return Math.round(Number(row.value))
  }
}

function mapInventoryItem(row: Record<string, string | number | null>): InventoryItem {
  const quantity = Number(row.quantity_milli)
  const minStock = Number(row.min_stock_milli)
  return {
    id: row.id as number,
    code: (row.code as string) ?? null,
    name: row.name as string,
    category: (row.category as string) ?? null,
    supplierId: (row.supplier_id as number | null) ?? null,
    supplierName: (row.supplier_name as string) ?? null,
    unit: row.unit as string,
    quantityMilli: quantity,
    minStockMilli: minStock,
    purchasePricePoisha: Number(row.purchase_price_poisha),
    sellPricePoisha: (row.sell_price_poisha as number | null) ?? null,
    location: (row.location as string) ?? null,
    isActive: Number(row.is_active) === 1,
    notes: (row.notes as string) ?? null,
    earliestExpiry: (row.earliest_expiry as string) ?? null,
    isLowStock: quantity <= minStock,
    updatedAt: row.updated_at as string
  }
}

export class SupplierRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(includeInactive = false): Supplier[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM suppliers ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY name COLLATE NOCASE`
      )
      .all() as Record<string, string | number | null>[]
    return rows.map((row) => ({
      id: row.id as number,
      name: row.name as string,
      contactPerson: (row.contact_person as string) ?? null,
      phone: (row.phone as string) ?? null,
      email: (row.email as string) ?? null,
      address: (row.address as string) ?? null,
      notes: (row.notes as string) ?? null,
      isActive: Number(row.is_active) === 1
    }))
  }

  create(input: Omit<Supplier, 'id'>, actor: string): number {
    void actor
    const result = this.db
      .prepare(
        `INSERT INTO suppliers (name, contact_person, phone, email, address, notes, is_active, created_at, updated_at)
         VALUES (@name, @contactPerson, @phone, @email, @address, @notes, @isActive, @createdAt, @updatedAt)`
      )
      .run({ ...input, isActive: input.isActive === false ? 0 : 1, createdAt: NOW(), updatedAt: NOW() })
    return Number(result.lastInsertRowid)
  }

  update(id: number, input: Omit<Supplier, 'id'>): void {
    this.db
      .prepare(
        `UPDATE suppliers SET name = @name, contact_person = @contactPerson, phone = @phone, email = @email,
                address = @address, notes = @notes, is_active = @isActive, updated_at = @updatedAt WHERE id = @id`
      )
      .run({ ...input, id, isActive: input.isActive === false ? 0 : 1, updatedAt: NOW() })
  }
}

// ---------------------------------------------------------------------------------------------
// Accounting
// ---------------------------------------------------------------------------------------------

export class ExpenseRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(query: ExpenseQuery): Paged<Expense> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 25
    const where: string[] = []
    const params: Record<string, unknown> = { limit: pageSize, offset: (page - 1) * pageSize }
    if (query.from) {
      where.push('e.expense_date >= @from')
      params.from = query.from
    }
    if (query.to) {
      where.push('e.expense_date <= @to')
      params.to = query.to
    }
    if (query.categoryId) {
      where.push('e.category_id = @categoryId')
      params.categoryId = query.categoryId
    }
    if (query.search?.trim()) {
      where.push(
        `(e.description LIKE @search ESCAPE '\\' OR e.expense_no LIKE @search ESCAPE '\\' OR e.paid_to LIKE @search ESCAPE '\\')`
      )
      params.search = containsPattern(query.search.trim())
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number(
      (
        this.db.prepare(`SELECT COUNT(*) AS count FROM expenses e ${whereSql}`).get(params) as {
          count: number
        }
      ).count
    )
    const rows = this.db
      .prepare(
        `SELECT e.*, c.name AS category_name, m.name AS method_name
           FROM expenses e JOIN expense_categories c ON c.id = e.category_id
           JOIN payment_methods m ON m.code = e.method_code
           ${whereSql} ORDER BY e.expense_date DESC, e.id DESC LIMIT @limit OFFSET @offset`
      )
      .all(params) as Record<string, string | number | null>[]
    return { rows: rows.map(mapExpense), total, page, pageSize }
  }

  findById(id: number): Expense | null {
    const row = this.db
      .prepare(
        `SELECT e.*, c.name AS category_name, m.name AS method_name
           FROM expenses e JOIN expense_categories c ON c.id = e.category_id
           JOIN payment_methods m ON m.code = e.method_code WHERE e.id = ?`
      )
      .get(id) as Record<string, string | number | null> | undefined
    return row ? mapExpense(row) : null
  }

  create(expenseNo: string, input: ExpenseInput, actor: string): number {
    const result = this.db
      .prepare(
        `INSERT INTO expenses (expense_no, category_id, expense_date, amount_poisha, method_code, paid_to,
                               reference_no, description, created_at, created_by, updated_at, updated_by)
         VALUES (@expenseNo, @categoryId, @expenseDate, @amountPoisha, @methodCode, @paidTo, @referenceNo,
                 @description, @createdAt, @createdBy, @updatedAt, @updatedBy)`
      )
      .run({
        expenseNo,
        categoryId: input.categoryId,
        expenseDate: input.expenseDate,
        amountPoisha: input.amountPoisha,
        methodCode: input.methodCode,
        paidTo: input.paidTo ?? null,
        referenceNo: input.referenceNo ?? null,
        description: input.description,
        createdAt: NOW(),
        createdBy: actor,
        updatedAt: NOW(),
        updatedBy: actor
      })
    return Number(result.lastInsertRowid)
  }

  update(id: number, input: ExpenseInput, actor: string): void {
    this.db
      .prepare(
        `UPDATE expenses SET category_id = @categoryId, expense_date = @expenseDate, amount_poisha = @amountPoisha,
                method_code = @methodCode, paid_to = @paidTo, reference_no = @referenceNo, description = @description,
                updated_at = @updatedAt, updated_by = @updatedBy WHERE id = @id`
      )
      .run({
        id,
        categoryId: input.categoryId,
        expenseDate: input.expenseDate,
        amountPoisha: input.amountPoisha,
        methodCode: input.methodCode,
        paidTo: input.paidTo ?? null,
        referenceNo: input.referenceNo ?? null,
        description: input.description,
        updatedAt: NOW(),
        updatedBy: actor
      })
  }

  voidExpense(id: number, reason: string, actor: string): void {
    this.db
      .prepare(
        `UPDATE expenses SET voided_at = ?, voided_by = ?, void_reason = ?, updated_at = ?, updated_by = ? WHERE id = ?`
      )
      .run(NOW(), actor, reason, NOW(), actor, id)
  }

  totalBetween(from: string, to: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount_poisha), 0) AS value FROM expenses
          WHERE voided_at IS NULL AND expense_date BETWEEN ? AND ?`
      )
      .get(from, to) as { value: number }
    return Number(row.value)
  }

  byCategory(from: string, to: string): AccountingSummary['byExpenseCategory'] {
    const rows = this.db
      .prepare(
        `SELECT c.id AS category_id, c.name AS category_name, COALESCE(SUM(e.amount_poisha), 0) AS total, COUNT(*) AS count
           FROM expenses e JOIN expense_categories c ON c.id = e.category_id
          WHERE e.voided_at IS NULL AND e.expense_date BETWEEN ? AND ?
          GROUP BY c.id ORDER BY total DESC`
      )
      .all(from, to) as Record<string, string | number>[]
    return rows.map((row) => ({
      categoryId: row.category_id as number,
      categoryName: row.category_name as string,
      totalPoisha: Number(row.total),
      count: Number(row.count)
    }))
  }

  countAll(): number {
    return Number(
      (this.db.prepare('SELECT COUNT(*) AS count FROM expenses').get() as { count: number }).count
    )
  }
}

function mapExpense(row: Record<string, string | number | null>): Expense {
  return {
    id: row.id as number,
    expenseNo: row.expense_no as string,
    categoryId: row.category_id as number,
    categoryName: (row.category_name as string) ?? '',
    expenseDate: row.expense_date as string,
    amountPoisha: Number(row.amount_poisha),
    methodCode: row.method_code as string,
    methodName: (row.method_name as string) ?? (row.method_code as string),
    paidTo: (row.paid_to as string) ?? null,
    referenceNo: (row.reference_no as string) ?? null,
    description: row.description as string,
    createdAt: row.created_at as string,
    createdBy: (row.created_by as string) ?? null,
    voidedAt: (row.voided_at as string) ?? null,
    voidReason: (row.void_reason as string) ?? null
  }
}
