/**
 * Integration tests for the payment dashboard and the financial reports (AT-D03, AT-D08).
 *
 * Every figure is produced from real transaction rows: invoices, payments and expenses written through the
 * services, then read back through the report builders the reports screen and the printed report document
 * both use. The point of the suite is that a report can never invent a number the ledger does not contain.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildReportData } from '@main/services/reports'
import { addDaysIso, todayIso } from '@shared/date'
import { REPORT_CATALOGUE } from '@shared/constants'
import { parseCsv } from '@shared/csv'
import { reportDataSchema, reportExportSchema } from '@shared/validation'
import { completeSetup, createHarness, patientInput, type Harness } from './harness'

const activationCode = process.env.DENTIVA_ACTIVATION_CODE ?? ''
const password = 'Harness#Pass1'

let harness: Harness
let scratch = ''

/**
 * The activation gate is a fixed offline secret, so the whole suite needs `DENTIVA_ACTIVATION_CODE`.
 * Without it the tests are reported as skipped (CI refuses to run this job without the secret), never
 * silently "passing".
 */
const suite = activationCode.length > 0 ? describe : describe.skip

// The reports and the payment dashboard resolve "today" from the system clock, exactly like the running
// application, so the fixtures follow the same clock instead of assuming a date.
const today = todayIso()
const yesterday = addDaysIso(today, -1)

beforeEach(() => {
  if (activationCode.length === 0) return
  harness = createHarness()
  completeSetup(harness, { activationCode, password })
  scratch = mkdtempSync(join(tmpdir(), 'dentiva-reports-'))
})

afterEach(() => {
  harness?.dispose()
  if (scratch.length > 0) rmSync(scratch, { recursive: true, force: true })
})

/** One patient with one paid invoice, one partial invoice and one payment per method. */
function seedLedger(): { cashPoisha: number; bkashPoisha: number; invoicedPoisha: number } {
  const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Report Person' }))
  const cashPoisha = 300000
  const bkashPoisha = 200000

  const first = harness.services.billing.createInvoice({
    patientId: patient.id,
    visitId: null,
    invoiceDate: today,
    dueDate: null,
    notes: null,
    discountPoisha: 0,
    discountPercentX100: 0,
    taxPercentX100: 0,
    roundOffEnabled: false,
    items: [
      {
        itemType: 'service',
        treatmentId: null,
        description: 'Scaling and polishing',
        quantityMilli: 1000,
        unitPricePoisha: 500000,
        discountPoisha: 0
      }
    ]
  })

  harness.services.billing.createPayment({
    patientId: patient.id,
    invoiceId: first.id,
    kind: 'payment',
    methodCode: 'cash',
    amountPoisha: cashPoisha,
    receivedAt: `${today} 10:15`,
    referenceNo: null,
    notes: null
  })
  harness.services.billing.createPayment({
    patientId: patient.id,
    invoiceId: first.id,
    kind: 'payment',
    methodCode: 'bkash',
    amountPoisha: bkashPoisha,
    receivedAt: `${today} 11:30`,
    referenceNo: 'TRX-9911',
    notes: 'Sent by the patient’s brother'
  })

  const second = harness.services.billing.createInvoice({
    patientId: patient.id,
    visitId: null,
    invoiceDate: today,
    dueDate: null,
    notes: null,
    discountPoisha: 0,
    discountPercentX100: 0,
    taxPercentX100: 0,
    roundOffEnabled: false,
    items: [
      {
        itemType: 'service',
        treatmentId: null,
        description: 'Root canal treatment',
        quantityMilli: 1000,
        unitPricePoisha: 800000,
        discountPoisha: 0
      }
    ]
  })
  expect(second.status).toBe('unpaid')

  // A purchase so the inventory report has a real movement, and so the stock ledger is exercised too.
  const item = harness.services.billing.createInventoryItem({
    code: 'INV-COMP',
    name: 'Composite resin',
    category: 'Restorative',
    unit: 'pack',
    supplierId: null,
    quantityMilli: 0,
    minStockMilli: 5000,
    purchasePricePoisha: 450000,
    sellPricePoisha: null,
    location: null,
    isActive: true,
    notes: null
  })
  harness.services.billing.stockIn({
    itemId: item.id,
    batchNo: 'B-2026-09',
    expiryDate: '2027-09-30',
    quantityMilli: 10000,
    unitCostPoisha: 450000,
    purchaseDate: today,
    supplierId: null,
    reference: 'PO-4471',
    notes: null
  })

  harness.services.billing.createExpense({
    expenseDate: today,
    categoryId: harness.services.billing.expenseCategories()[0]!.id,
    amountPoisha: 120000,
    paidTo: 'Dental Supplies Ltd',
    description: 'Composite resin restock',
    methodCode: 'cash',
    referenceNo: null
  })

  return { cashPoisha, bkashPoisha, invoicedPoisha: 500000 + 800000 }
}

suite('payment dashboard', () => {
  it('defaults to today and totals each method from the real payment rows', () => {
    const { cashPoisha, bkashPoisha } = seedLedger()

    const dashboard = harness.services.billing.paymentDashboard({ range: 'today' })
    expect(dashboard.rangeFrom).toBe(today)
    expect(dashboard.rangeTo).toBe(today)
    expect(dashboard.totalPoisha).toBe(cashPoisha + bkashPoisha)
    expect(dashboard.count).toBe(2)

    const cash = dashboard.byMethod.find((row) => row.methodCode === 'cash')
    const bkash = dashboard.byMethod.find((row) => row.methodCode === 'bkash')
    expect(cash).toMatchObject({ totalPoisha: cashPoisha, count: 1, methodName: 'Cash' })
    expect(bkash).toMatchObject({ totalPoisha: bkashPoisha, count: 1, methodName: 'bKash' })

    // Received cash is not the same number as invoiced revenue, and the dashboard exposes both.
    expect(dashboard.outstandingPoisha).toBeGreaterThan(0)
  })

  it('separates received cash from invoiced revenue and reconciles the outstanding balance', () => {
    const { invoicedPoisha, cashPoisha, bkashPoisha } = seedLedger()
    const received = cashPoisha + bkashPoisha

    const accounting = harness.services.billing.accountingSummary(today, today)
    expect(accounting.collectedPoisha).toBe(received)
    expect(accounting.invoiceRevenuePoisha).toBe(invoicedPoisha)
    expect(accounting.outstandingPoisha).toBe(invoicedPoisha - received)
    expect(accounting.expensesPoisha).toBe(120000)
    expect(accounting.netCashFlowPoisha).toBe(received - 120000)

    // Yesterday's window is empty because nothing was recorded then.
    const earlier = harness.services.billing.paymentDashboard({ range: 'custom', to: yesterday })
    expect(earlier.totalPoisha).toBe(0)
  })

  it('excludes a voided payment from every total and reopens the invoice balance', () => {
    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Void Person' }))
    const invoice = harness.services.billing.createInvoice({
      patientId: patient.id,
      visitId: null,
      invoiceDate: today,
      dueDate: null,
      notes: null,
      discountPoisha: 0,
      discountPercentX100: 0,
      taxPercentX100: 0,
      roundOffEnabled: false,
      items: [
        {
          itemType: 'service',
          treatmentId: null,
          description: 'Extraction',
          quantityMilli: 1000,
          unitPricePoisha: 250000,
          discountPoisha: 0
        }
      ]
    })
    const payment = harness.services.billing.createPayment({
      patientId: patient.id,
      invoiceId: invoice.id,
      kind: 'payment',
      methodCode: 'cash',
      amountPoisha: 250000,
      receivedAt: `${today} 12:00`,
      referenceNo: null,
      notes: null
    })
    expect(harness.services.billing.getInvoice(invoice.id).status).toBe('paid')
    expect(harness.services.billing.paymentDashboard({ range: 'today' }).totalPoisha).toBe(250000)

    harness.services.billing.voidPayment(payment.id, 'Recorded against the wrong invoice')
    expect(harness.services.billing.paymentDashboard({ range: 'today' }).totalPoisha).toBe(0)
    expect(harness.services.billing.getInvoice(invoice.id).status).toBe('unpaid')
    expect(harness.services.billing.getInvoice(invoice.id).balancePoisha).toBe(250000)
  })
})

suite('financial reports', () => {
  /** Report cells are formatted with thousands separators; compare the digits, not the grouping. */
  const plain = (value: string): string => value.replace(/,/g, '')
  const money = (poisha: number): string => plain((poisha / 100).toFixed(2))

  it('builds every report from the ledger rows, with totals that match the payments and expenses', () => {
    const { cashPoisha, bkashPoisha, invoicedPoisha } = seedLedger()
    const received = cashPoisha + bkashPoisha

    const daily = buildReportData(harness.services, { report: 'daily_income', from: today, to: today })
    expect(daily.title).toMatch(/daily income/i)
    expect(daily.rows).toHaveLength(1)
    expect(daily.rows[0]?.[0]).toBe(today)
    const collected = daily.summaries.find((entry) => entry.label === 'Total collected')
    expect(plain(collected?.value ?? '')).toContain(money(received))
    const billed = daily.summaries.find((entry) => entry.label === 'Total billed')
    expect(plain(billed?.value ?? '')).toContain(money(invoicedPoisha))

    const methods = buildReportData(harness.services, { report: 'payment_methods', from: today, to: today })
    const methodText = methods.rows.map((row) => row.join(' ')).join(' | ')
    expect(methodText).toContain('Cash')
    expect(methodText).toContain('bKash')

    const expenses = buildReportData(harness.services, { report: 'expense_summary', from: today, to: today })
    expect(expenses.rows.length).toBeGreaterThan(0)
    expect(plain(expenses.rows.map((row) => row.join(' ')).join(' | '))).toContain(money(120000))

    const categories = buildReportData(harness.services, {
      report: 'expense_categories',
      from: today,
      to: today
    })
    expect(categories.rows.length).toBeGreaterThan(0)

    const outstanding = buildReportData(harness.services, {
      report: 'outstanding_dues',
      from: today,
      to: today
    })
    expect(outstanding.rows.length).toBeGreaterThan(0)

    const invoiceSummary = buildReportData(harness.services, {
      report: 'invoice_summary',
      from: today,
      to: today
    })
    expect(invoiceSummary.rows.length).toBeGreaterThan(0)

    const netCash = buildReportData(harness.services, { report: 'net_cash_flow', from: today, to: today })
    expect(netCash.rows.map((row) => row[0])).toEqual([
      'Payments received (cash in)',
      'Expenses paid (cash out)',
      'Net cash flow'
    ])
    // Net cash flow is what was received minus what was spent, never the invoiced amount.
    expect(plain(String(netCash.rows[0]?.[1]))).toContain(money(received))
    expect(plain(String(netCash.rows[1]?.[1]))).toContain(money(120000))
    expect(plain(String(netCash.rows[2]?.[1]))).toContain(money(received - 120000))
    // The invoiced figure is reported separately so revenue can never be mistaken for cash.
    const invoicedLine = netCash.summaries.find((entry) => entry.label === 'Invoiced (billed) revenue')
    expect(plain(invoicedLine?.value ?? '')).toContain(money(invoicedPoisha))

    const treatments = buildReportData(harness.services, {
      report: 'treatment_revenue',
      from: today,
      to: today
    })
    const treatmentText = treatments.rows.map((row) => row.join(' ')).join(' | ')
    expect(treatmentText).toMatch(/Scaling and polishing|Root canal treatment/)

    const purchases = buildReportData(harness.services, {
      report: 'inventory_purchases',
      from: today,
      to: today
    })
    expect(purchases.title).toMatch(/purchase/i)
    expect(Array.isArray(purchases.rows)).toBe(true)
  })

  it('implements every report the catalogue offers, and refuses a key that is not in it', () => {
    seedLedger()
    for (const definition of REPORT_CATALOGUE) {
      const report = buildReportData(harness.services, { report: definition.key, from: today, to: today })
      expect(report.title.length, `${definition.key} has no title`).toBeGreaterThan(0)
      expect(report.columns.length, `${definition.key} has no columns`).toBeGreaterThan(0)
      expect(report.rows.length, `${definition.key} produced no rows`).toBeGreaterThan(0)
    }

    // The payload schema accepts only catalogue keys, so a typo can never reach the builder.
    expect(reportDataSchema.safeParse({ report: 'monthly_gossip', from: today, to: today }).success).toBe(
      false
    )
    for (const definition of REPORT_CATALOGUE) {
      expect(
        reportDataSchema.safeParse({ report: definition.key, from: today, to: today }).success,
        definition.key
      ).toBe(true)
    }
  })

  it('summarises a period on one page without inventing figures', () => {
    const { cashPoisha, bkashPoisha, invoicedPoisha } = seedLedger()
    const received = cashPoisha + bkashPoisha

    const period = buildReportData(harness.services, { report: 'period_summary', from: today, to: today })
    const value = (line: string): string =>
      plain(String(period.rows.find((row) => row[0] === line)?.[1] ?? ''))
    expect(value('Invoices raised')).toBe('2')
    expect(value('Invoiced (billed) revenue')).toContain(money(invoicedPoisha))
    expect(value('Received cash')).toContain(money(received))
    expect(value('Expenses paid')).toContain(money(120000))
    expect(value('Net cash flow')).toContain(money(received - 120000))
    expect(value('Busiest day by collection')).toContain(today)
    expect(plain(period.summaries.find((entry) => entry.label === 'Received cash')?.value ?? '')).toContain(
      money(received)
    )
  })

  it('returns an empty, well-formed report for a window with no transactions', () => {
    const empty = buildReportData(harness.services, {
      report: 'daily_income',
      from: '2026-01-01',
      to: '2026-01-02'
    })
    expect(empty.rows).toEqual([])
    expect(empty.columns.length).toBeGreaterThan(0)
    // A total of zero is still a real, formatted total rather than a blank cell.
    expect(empty.summaries.every((entry) => entry.value.length > 0)).toBe(true)
  })

  it('refuses the financial reports without the financial permission', () => {
    const role = harness.services.auth.listRoles().find((entry) => entry.code === 'assistant')!
    harness.services.auth.createUser(
      {
        username: 'reports.assistant',
        displayName: 'Report Assistant',
        roleId: role.id,
        isActive: true,
        mustChangePassword: false,
        overrides: []
      },
      password
    )
    harness.services.auth.logout()
    harness.services.auth.login('reports.assistant', password)

    expect(harness.services.session.hasPermission('reports.financial.view')).toBe(false)
    expect(() => harness.services.billing.revenueReport(today, today)).toThrow(/permission/i)
    expect(() => harness.services.billing.accountingSummary(today, today)).toThrow(/permission/i)
    expect(() =>
      buildReportData(harness.services, { report: 'daily_income', from: today, to: today })
    ).toThrow(/permission/i)
  })
})

suite('report export', () => {
  /** Money cells keep the screen's formatting (two decimals, thousands separators) inside the CSV. */
  const amount = (poisha: number): string =>
    (poisha / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  it('writes the report the screen shows to CSV — same headers, same figures, plus the summaries', () => {
    const { cashPoisha, bkashPoisha } = seedLedger()
    const onScreen = buildReportData(harness.services, {
      report: 'payment_methods',
      from: today,
      to: today
    })

    const result = harness.services.billing.exportReport({
      report: 'payment_methods',
      from: today,
      to: today,
      targetFolder: scratch
    })

    expect(existsSync(result.filePath)).toBe(true)
    expect(result.rowCount).toBe(onScreen.rows.length)

    const rows = parseCsv(readFileSync(result.filePath, 'utf8'))
    // The file starts with a UTF-8 BOM, so the first label still matches after trimming.
    expect(rows[0]).toEqual(onScreen.columns.map((column) => column.label))
    const cashRow = rows.find((row) => row[0] === 'Cash')
    expect(cashRow?.[1]).toBe('1')
    expect(cashRow?.[2]).toBe(amount(cashPoisha))
    expect(rows.some((row) => row[0] === 'bKash' && row[2] === amount(bkashPoisha))).toBe(true)

    // Every number in the file is the number the builder produced — the export has no second code path.
    const screenTotals = onScreen.rows.map((row) => String(row[2]))
    const fileTotals = rows.slice(1, onScreen.rows.length + 1).map((row) => row[2] ?? '')
    expect(fileTotals).toEqual(screenTotals)

    // Summary block: the totals of exactly what the screen showed.
    expect(rows.some((row) => row[0] === 'Summary' && row[1] === 'Amount')).toBe(true)
    for (const entry of onScreen.summaries) {
      expect(rows.some((row) => row[0] === entry.label && row[1] === entry.value)).toBe(true)
    }

    // The export is an audited act, like every other write.
    const audit = harness.services.admin.listAudit({ page: 1, pageSize: 20 })
    expect(
      audit.rows.some((row) => row.action === 'data.export' && row.summary.includes('Payments by method'))
    ).toBe(true)
  })

  it('refuses the export without the financial export permission and refuses unknown report keys', () => {
    const role = harness.services.auth.listRoles().find((entry) => entry.code === 'assistant')!
    harness.services.auth.createUser(
      {
        username: 'reports.exporter',
        displayName: 'Report Exporter',
        roleId: role.id,
        isActive: true,
        mustChangePassword: false,
        overrides: []
      },
      password
    )
    harness.services.auth.logout()
    harness.services.auth.login('reports.exporter', password)

    expect(() =>
      harness.services.billing.exportReport({
        report: 'payment_methods',
        from: today,
        to: today,
        targetFolder: scratch
      })
    ).toThrow(/permission/i)

    // A report key outside the catalogue never reaches a builder.
    expect(
      reportExportSchema.safeParse({
        report: 'monthly_gossip',
        from: today,
        to: today,
        targetFolder: scratch
      }).success
    ).toBe(false)
    expect(
      reportExportSchema.safeParse({
        report: 'payment_methods',
        from: today,
        to: today,
        targetFolder: scratch
      }).success
    ).toBe(true)
  })
})
