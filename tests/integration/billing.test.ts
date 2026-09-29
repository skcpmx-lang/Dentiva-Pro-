/**
 * Integration tests for billing, inventory and accounting.
 *
 * The money rules that a clinic cannot get wrong are verified here against the real database:
 * invoice totals are computed in integer poisha, a payment reduces the invoice balance exactly once,
 * voiding a payment puts the balance back, and the accounting summary keeps invoiced revenue separate
 * from cash actually received.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { completeSetup, createHarness, patientInput, type Harness } from './harness'

const activationCode = process.env.DENTIVA_ACTIVATION_CODE ?? ''

let harness: Harness
let patientId = 0

function invoiceInput(
  overrides: Record<string, unknown> = {}
): Parameters<Harness['services']['billing']['createInvoice']>[0] {
  return {
    patientId,
    invoiceDate: '2026-09-30',
    dueDate: null,
    discountPoisha: 0,
    discountPercentX100: 0,
    taxPercentX100: 0,
    roundOffEnabled: false,
    notes: null,
    items: [
      {
        itemType: 'treatment',
        treatmentId: null,
        description: 'Composite filling (46)',
        quantityMilli: 1000,
        unitPricePoisha: 350000,
        discountPoisha: 0,
        note: null
      }
    ],
    ...overrides
  } as never
}

/**
 * The activation gate is a fixed offline secret, so the whole suite needs `DENTIVA_ACTIVATION_CODE`.
 * Without it the tests are reported as skipped (CI refuses to run this job without the secret), never
 * silently "passing".
 */
const suite = activationCode.length > 0 ? describe : describe.skip

beforeAll(() => {
  if (activationCode.length === 0) return
  harness = createHarness()
  completeSetup(harness, { activationCode })
  patientId = harness.services.clinical.createPatient(patientInput({ fullName: 'Billing Person' })).id
})

afterAll(() => {
  harness.dispose()
})

suite('invoices', () => {
  it('computes line totals, discounts and the balance in integer poisha', () => {
    const invoice = harness.services.billing.createInvoice(
      invoiceInput({
        discountPoisha: 5000,
        items: [
          {
            itemType: 'treatment',
            treatmentId: null,
            description: 'Root canal',
            quantityMilli: 1000,
            unitPricePoisha: 500000,
            discountPoisha: 0,
            note: null
          },
          {
            itemType: 'product',
            treatmentId: null,
            description: 'Mouthwash',
            quantityMilli: 2000,
            unitPricePoisha: 25000,
            discountPoisha: 0,
            note: null
          }
        ]
      })
    )

    // 5000.00 + 2 × 250.00 = 5500.00, minus a 50.00 discount.
    expect(invoice.subtotalPoisha).toBe(550000)
    expect(invoice.discountPoisha).toBe(5000)
    expect(invoice.totalPoisha).toBe(545000)
    expect(invoice.paidPoisha).toBe(0)
    expect(invoice.balancePoisha).toBe(545000)
    expect(invoice.status).toBe('unpaid')
    expect(invoice.invoiceNo).toMatch(/^INV-\d+$/)
  })

  it('applies a percentage discount and rounds the invoice to whole taka when asked', () => {
    const invoice = harness.services.billing.createInvoice(
      invoiceInput({
        discountPercentX100: 1000, // 10 %
        roundOffEnabled: true,
        items: [
          {
            itemType: 'service',
            treatmentId: null,
            description: 'Scaling',
            quantityMilli: 1000,
            unitPricePoisha: 123455,
            discountPoisha: 0,
            note: null
          }
        ]
      })
    )
    expect(invoice.subtotalPoisha).toBe(123455)
    expect(invoice.discountPoisha).toBe(12346) // 10 % of 1234.55 = 123.455 → 123.46 (half-up)
    expect(invoice.totalPoisha).toBe(111100) // 123455 - 12346 = 111109, rounded to whole taka
    expect(invoice.totalPoisha % 100).toBe(0)
  })

  it('refuses an invoice without items', () => {
    expect(() => harness.services.billing.createInvoice(invoiceInput({ items: [] }))).toThrow()
  })

  it('voids an invoice without deleting it', () => {
    const invoice = harness.services.billing.createInvoice(invoiceInput())
    const voided = harness.services.billing.voidInvoice(invoice.id, 'Wrong patient selected')
    expect(voided.status).toBe('void')
    expect(voided.voidReason).toBe('Wrong patient selected')
    expect(harness.services.billing.getInvoice(invoice.id).status).toBe('void')
  })
})

suite('payments', () => {
  it('records a partial payment, then settles the invoice', () => {
    const invoice = harness.services.billing.createInvoice(invoiceInput())
    const first = harness.services.billing.createPayment({
      patientId,
      invoiceId: invoice.id,
      amountPoisha: 200000,
      methodCode: 'cash',
      receivedAt: '2026-09-30 10:30:00'
    })
    expect(first.receiptNo).toMatch(/^RCP-\d+$/)

    const partial = harness.services.billing.getInvoice(invoice.id)
    expect(partial.paidPoisha).toBe(200000)
    expect(partial.balancePoisha).toBe(150000)
    expect(partial.status).toBe('partial')

    harness.services.billing.createPayment({
      patientId,
      invoiceId: invoice.id,
      amountPoisha: 150000,
      methodCode: 'bkash',
      referenceNo: 'TRX123456',
      receivedAt: '2026-09-30 11:00:00'
    })

    const settled = harness.services.billing.getInvoice(invoice.id)
    expect(settled.balancePoisha).toBe(0)
    expect(settled.status).toBe('paid')
  })

  it('requires a reference number for methods that need one', () => {
    const invoice = harness.services.billing.createInvoice(invoiceInput())
    expect(() =>
      harness.services.billing.createPayment({
        patientId,
        invoiceId: invoice.id,
        amountPoisha: 10000,
        methodCode: 'bkash',
        receivedAt: '2026-09-30 12:00:00'
      })
    ).toThrow()
  })

  it('refuses a payment that does not belong to the invoice patient', () => {
    const otherPatient = harness.services.clinical.createPatient(
      patientInput({ fullName: 'Someone Else', phone: '+8801755555555' })
    )
    const invoice = harness.services.billing.createInvoice(invoiceInput())
    expect(() =>
      harness.services.billing.createPayment({
        patientId: otherPatient.id,
        invoiceId: invoice.id,
        amountPoisha: 1000,
        methodCode: 'cash',
        receivedAt: '2026-09-30 12:05:00'
      })
    ).toThrow()
  })

  it('reopens the balance when a payment is voided', () => {
    const invoice = harness.services.billing.createInvoice(invoiceInput())
    const payment = harness.services.billing.createPayment({
      patientId,
      invoiceId: invoice.id,
      amountPoisha: invoice.totalPoisha,
      methodCode: 'cash',
      receivedAt: '2026-09-30 13:00:00'
    })
    expect(harness.services.billing.getInvoice(invoice.id).status).toBe('paid')

    harness.services.billing.voidPayment(payment.id, 'Cheque bounced')
    const reopened = harness.services.billing.getInvoice(invoice.id)
    expect(reopened.balancePoisha).toBe(invoice.totalPoisha)
    expect(reopened.status).toBe('unpaid')
  })

  it('keeps unallocated advances on the patient account', () => {
    const person = harness.services.clinical.createPatient(
      patientInput({ fullName: 'Advance Payer', phone: '+8801766666666' })
    )
    harness.services.billing.createPayment({
      patientId: person.id,
      amountPoisha: 100000,
      methodCode: 'cash',
      receivedAt: '2026-09-30 14:00:00'
    })
    // An advance is money held on the account: the ledger goes negative, and the invoice form shows it
    // as credit instead of asking for money the clinic already has.
    expect(harness.services.billing.patientBalance(person.id)).toBe(-100000)
    const personInvoice = harness.services.billing.createInvoice(invoiceInput({ patientId: person.id }))
    expect(harness.services.billing.patientBalance(person.id)).toBe(personInvoice.totalPoisha - 100000)
  })
})

suite('accounting summary', () => {
  it('separates invoiced revenue from cash actually received', () => {
    const summary = harness.services.billing.accountingSummary('2026-09-01', '2026-09-30')
    expect(summary.invoiceRevenuePoisha).toBeGreaterThan(0)
    expect(summary.collectedPoisha).toBeGreaterThan(0)
    // Both numbers exist and are independent: money can be invoiced without being collected.
    expect(summary.outstandingPoisha).toBeGreaterThanOrEqual(0)
    expect(summary.netCashFlowPoisha).toBe(summary.collectedPoisha - summary.expensesPoisha)
    expect(summary.byMethod.some((row) => row.methodCode === 'cash')).toBe(true)
  })

  it('records expenses against a category and includes them in the cash flow', () => {
    const categories = harness.services.billing.expenseCategories()
    const category = categories[0]
    expect(category).toBeDefined()

    harness.services.billing.createExpense({
      categoryId: category!.id,
      expenseDate: '2026-09-30',
      amountPoisha: 250000,
      methodCode: 'cash',
      paidTo: 'Dental supplies',
      referenceNo: null,
      description: 'Dental supplies restock'
    })

    const summary = harness.services.billing.accountingSummary('2026-09-01', '2026-09-30')
    expect(summary.expensesPoisha).toBeGreaterThanOrEqual(250000)
    expect(summary.byExpenseCategory.some((row) => row.categoryId === category!.id)).toBe(true)
  })
})

suite('inventory', () => {
  it('adds stock in a batch, issues it and keeps an immutable ledger', () => {
    const item = harness.services.billing.createInventoryItem({
      code: 'GLV-M',
      name: 'Examination gloves (M)',
      category: 'Consumables',
      supplierId: null,
      unit: 'box',
      quantityMilli: 0,
      minStockMilli: 5000,
      purchasePricePoisha: 45000,
      sellPricePoisha: null,
      location: null,
      isActive: true,
      notes: null
    })

    const received = harness.services.billing.stockIn({
      itemId: item.id,
      batchNo: 'B-2026-09',
      expiryDate: '2028-09-30',
      quantityMilli: 10000,
      unitCostPoisha: 45000,
      purchaseDate: '2026-09-30'
    })
    expect(received.item.quantityMilli).toBe(10000)
    expect(received.batchId).toBeGreaterThan(0)

    const batches = harness.services.billing.inventoryBatches(item.id)
    expect(batches).toHaveLength(1)
    expect(batches[0]?.expiryDate).toBe('2028-09-30')
    expect(batches[0]?.quantityInMilli).toBe(10000)

    const issued = harness.services.billing.issueStock({
      itemId: item.id,
      quantityMilli: 4000,
      txnType: 'usage',
      reason: 'Used in the surgery today'
    })
    expect(issued.quantityMilli).toBe(6000)

    const transactions = harness.services.billing.inventoryTransactions({
      page: 1,
      pageSize: 50,
      itemId: item.id
    })
    expect(transactions.total).toBe(2)
    expect(transactions.rows.some((row) => row.txnType === 'purchase')).toBe(true)
    expect(transactions.rows.some((row) => row.txnType === 'usage')).toBe(true)
  })

  it('flags low stock and refuses to issue more than exists', () => {
    const item = harness.services.billing.createInventoryItem({
      code: 'FILL-01',
      name: 'Composite resin',
      category: 'Materials',
      supplierId: null,
      unit: 'syringe',
      quantityMilli: 0,
      minStockMilli: 5000,
      purchasePricePoisha: 120000,
      sellPricePoisha: 180000,
      location: 'Cabinet 2',
      isActive: true,
      notes: null
    })

    harness.services.billing.stockIn({
      itemId: item.id,
      quantityMilli: 3000,
      unitCostPoisha: 120000,
      purchaseDate: '2026-09-30'
    })

    const low = harness.services.billing.getInventoryItem(item.id)
    expect(low.quantityMilli).toBe(3000)
    expect(low.isLowStock).toBe(true)

    expect(() =>
      harness.services.billing.issueStock({ itemId: item.id, quantityMilli: 5000, txnType: 'usage' })
    ).toThrow()
  })
})
