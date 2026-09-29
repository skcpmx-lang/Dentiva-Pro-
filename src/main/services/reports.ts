/**
 * Report builders for the ten built-in reports. Every number is produced from the live database
 * (invoices, payments, expenses, inventory transactions) — nothing is estimated or simulated.
 *
 * The builders only need a slice of the container, which keeps them usable both from the router (with the
 * whole `Services` object) and from the billing service when a report is exported to CSV (with the
 * service itself standing in for `billing`).
 */

import { formatBDT } from '@shared/money'
import type { ReportDataResult } from '@shared/ipc'
import type { Services } from './container'

import { REPORT_KEYS, type ReportKey } from '@shared/constants'

/** Everything the report builders read: repositories, the database and two billing aggregates. */
export type ReportSources = Pick<Services, 'db' | 'invoices' | 'payments' | 'treatments' | 'expenses'> & {
  billing: Pick<Services['billing'], 'revenueReport' | 'accountingSummary'>
}

const money = (poisha: number): string => formatBDT(poisha, { symbol: false })

export function buildReportData(
  services: ReportSources,
  request: { report: string; from: string; to: string }
): ReportDataResult {
  const { from, to } = request
  const report = request.report as ReportKey

  switch (report) {
    case 'daily_income': {
      const rows = services.billing.revenueReport(from, to, 'day')
      return {
        title: 'Daily income report',
        columns: [
          { key: 'date', label: 'Date', align: 'left' },
          { key: 'invoices', label: 'Invoices', align: 'right' },
          { key: 'invoiced', label: 'Invoiced', align: 'right' },
          { key: 'collected', label: 'Collected', align: 'right' },
          { key: 'expenses', label: 'Expenses', align: 'right' },
          { key: 'net', label: 'Net cash flow', align: 'right' }
        ],
        rows: rows.map((row) => [
          row.date,
          String(row.invoiceCount),
          money(row.invoicedPoisha),
          money(row.collectedPoisha),
          money(row.expensesPoisha),
          money(row.netPoisha)
        ]),
        summaries: [
          {
            label: 'Total billed',
            value: money(rows.reduce((total, row) => total + row.invoicedPoisha, 0))
          },
          {
            label: 'Total collected',
            value: money(rows.reduce((total, row) => total + row.collectedPoisha, 0)),
            emphasis: true
          },
          {
            label: 'Total expenses',
            value: money(rows.reduce((total, row) => total + row.expensesPoisha, 0))
          }
        ],
        footNotes: ['Collected amounts are payments actually received; billed amounts are invoices raised.']
      }
    }
    case 'expense_summary': {
      const categories = services.expenses.byCategory(from, to)
      return {
        title: 'Expense summary',
        columns: [
          { key: 'category', label: 'Category', align: 'left' },
          { key: 'count', label: 'Entries', align: 'right' },
          { key: 'total', label: 'Amount', align: 'right' }
        ],
        rows: categories.map((row) => [row.categoryName, String(row.count), money(row.totalPoisha)]),
        summaries: [
          {
            label: 'Total expenses',
            value: money(categories.reduce((total, row) => total + row.totalPoisha, 0)),
            emphasis: true
          }
        ],
        footNotes: ['Voided expenses are excluded.']
      }
    }
    case 'net_cash_flow': {
      const summary = services.billing.accountingSummary(from, to)
      return {
        title: 'Net cash flow',
        columns: [
          { key: 'line', label: 'Line', align: 'left' },
          { key: 'amount', label: 'Amount', align: 'right' }
        ],
        rows: [
          ['Payments received (cash in)', money(summary.collectedPoisha)],
          ['Expenses paid (cash out)', money(summary.expensesPoisha)],
          ['Net cash flow', money(summary.netCashFlowPoisha)]
        ],
        summaries: [
          { label: 'Invoiced (billed) revenue', value: money(summary.invoiceRevenuePoisha) },
          { label: 'Received cash', value: money(summary.collectedPoisha) },
          { label: 'Net cash flow', value: money(summary.netCashFlowPoisha), emphasis: true },
          { label: 'Outstanding dues (all time)', value: money(summary.outstandingPoisha) }
        ],
        footNotes: [
          'Invoiced revenue and received cash are reported separately: an invoice raises revenue, a payment brings cash.'
        ]
      }
    }
    case 'outstanding_dues': {
      const rows = services.invoices.outstanding()
      return {
        title: 'Outstanding dues',
        columns: [
          { key: 'code', label: 'Patient code', align: 'left' },
          { key: 'name', label: 'Patient', align: 'left' },
          { key: 'phone', label: 'Phone', align: 'left' },
          { key: 'invoices', label: 'Invoices', align: 'right' },
          { key: 'oldest', label: 'Oldest invoice', align: 'left' },
          { key: 'balance', label: 'Balance', align: 'right' }
        ],
        rows: rows.map((row) => [
          row.patientCode,
          row.patientName,
          row.phone,
          String(row.invoiceCount),
          row.oldestInvoiceDate,
          money(row.outstandingPoisha)
        ]),
        summaries: [
          {
            label: 'Total outstanding',
            value: money(rows.reduce((total, row) => total + row.outstandingPoisha, 0)),
            emphasis: true
          },
          { label: 'Patients with dues', value: String(rows.length) }
        ],
        footNotes: ['This report is not limited by the selected date range; it shows the current position.']
      }
    }
    case 'payment_methods': {
      const byMethod = services.payments.methodBreakdown(from, to)
      return {
        title: 'Payments by method',
        columns: [
          { key: 'method', label: 'Method', align: 'left' },
          { key: 'count', label: 'Payments', align: 'right' },
          { key: 'total', label: 'Amount', align: 'right' }
        ],
        rows: byMethod.map((row) => [row.methodName, String(row.count), money(row.totalPoisha)]),
        summaries: [
          {
            label: 'Total received',
            value: money(byMethod.reduce((total, row) => total + row.totalPoisha, 0)),
            emphasis: true
          }
        ],
        footNotes: ['Refunds are subtracted from the matching method.']
      }
    }
    case 'treatment_revenue': {
      const rows = services.treatments.revenue(from, to)
      return {
        title: 'Revenue by treatment',
        columns: [
          { key: 'treatment', label: 'Treatment', align: 'left' },
          { key: 'category', label: 'Category', align: 'left' },
          { key: 'quantity', label: 'Quantity', align: 'right' },
          { key: 'revenue', label: 'Revenue', align: 'right' }
        ],
        rows: rows.map((row) => [
          row.treatmentName,
          row.category ?? '—',
          String(row.quantity),
          money(row.revenuePoisha)
        ]),
        summaries: [
          {
            label: 'Total treatment revenue',
            value: money(rows.reduce((total, row) => total + row.revenuePoisha, 0)),
            emphasis: true
          }
        ],
        footNotes: ['Based on invoice line items before invoice-level discounts and tax.']
      }
    }
    case 'invoice_summary': {
      const summary = services.billing.accountingSummary(from, to)
      const statuses = services.db
        .prepare(
          `SELECT status, COUNT(*) AS count, COALESCE(SUM(total_poisha), 0) AS total,
                  COALESCE(SUM(paid_poisha), 0) AS paid, COALESCE(SUM(balance_poisha), 0) AS balance
             FROM invoices WHERE invoice_date BETWEEN ? AND ?
            GROUP BY status ORDER BY status`
        )
        .all(from, to) as { status: string; count: number; total: number; paid: number; balance: number }[]
      return {
        title: 'Invoice summary',
        columns: [
          { key: 'status', label: 'Status', align: 'left' },
          { key: 'count', label: 'Invoices', align: 'right' },
          { key: 'total', label: 'Total', align: 'right' },
          { key: 'paid', label: 'Paid', align: 'right' },
          { key: 'balance', label: 'Balance', align: 'right' }
        ],
        rows: statuses.map((row) => [
          row.status.replace(/^\w/, (letter) => letter.toUpperCase()),
          String(row.count),
          money(row.total),
          money(row.paid),
          money(row.balance)
        ]),
        summaries: [
          { label: 'Invoiced (excluding void)', value: money(summary.invoiceRevenuePoisha), emphasis: true },
          { label: 'Received cash', value: money(summary.collectedPoisha) },
          { label: 'Outstanding dues (all time)', value: money(summary.outstandingPoisha) }
        ],
        footNotes: ['Voided invoices are listed but excluded from the totals.']
      }
    }
    case 'expense_categories': {
      const categories = services.expenses.byCategory(from, to)
      return {
        title: 'Expenses by category',
        columns: [
          { key: 'category', label: 'Category', align: 'left' },
          { key: 'count', label: 'Entries', align: 'right' },
          { key: 'total', label: 'Amount', align: 'right' }
        ],
        rows: categories.map((row) => [row.categoryName, String(row.count), money(row.totalPoisha)]),
        summaries: [
          {
            label: 'Total expenses',
            value: money(categories.reduce((total, row) => total + row.totalPoisha, 0)),
            emphasis: true
          }
        ],
        footNotes: []
      }
    }
    case 'inventory_purchases': {
      const rows = services.db
        .prepare(
          `SELECT t.at AS at, i.name AS item, t.quantity_milli AS quantity, t.unit_cost_poisha AS cost,
                  t.reason AS reference
             FROM inventory_transactions t JOIN inventory_items i ON i.id = t.item_id
            WHERE t.txn_type = 'purchase' AND date(t.at) BETWEEN ? AND ?
            ORDER BY t.at`
        )
        .all(from, to) as {
        at: string
        item: string
        quantity: number
        cost: number
        reference: string | null
      }[]
      const total = rows.reduce((sum, row) => sum + Math.round((row.quantity * row.cost) / 1000), 0)
      return {
        title: 'Inventory purchases',
        columns: [
          { key: 'at', label: 'Date', align: 'left' },
          { key: 'item', label: 'Item', align: 'left' },
          { key: 'quantity', label: 'Quantity', align: 'right' },
          { key: 'cost', label: 'Unit cost', align: 'right' },
          { key: 'lineTotal', label: 'Line total', align: 'right' },
          { key: 'reference', label: 'Reference', align: 'left' }
        ],
        rows: rows.map((row) => [
          row.at.slice(0, 10),
          row.item,
          (row.quantity / 1000).toFixed(3),
          money(row.cost),
          money(Math.round((row.quantity * row.cost) / 1000)),
          row.reference ?? '—'
        ]),
        summaries: [{ label: 'Total purchases', value: money(total), emphasis: true }],
        footNotes: ['Purchase costs are inventory movements; they are not part of the expenses ledger.']
      }
    }
    case 'period_summary': {
      // One page for the monthly review: every figure comes from the ledger rows in the chosen window.
      const summary = services.billing.accountingSummary(from, to)
      const days = services.billing.revenueReport(from, to, 'day')
      const invoices = days.reduce((total, row) => total + row.invoiceCount, 0)
      const busiest = [...days].sort((left, right) => right.collectedPoisha - left.collectedPoisha)[0] ?? null
      return {
        title: 'Period summary',
        columns: [
          { key: 'line', label: 'Line', align: 'left' },
          { key: 'value', label: 'Value', align: 'right' }
        ],
        rows: [
          ['Period', `${from} to ${to}`],
          ['Days with activity', String(days.length)],
          ['Invoices raised', String(invoices)],
          ['Invoiced (billed) revenue', money(summary.invoiceRevenuePoisha)],
          ['Received cash', money(summary.collectedPoisha)],
          ['Expenses paid', money(summary.expensesPoisha)],
          ['Net cash flow', money(summary.netCashFlowPoisha)],
          ['Outstanding dues (all time)', money(summary.outstandingPoisha)],
          [
            'Busiest day by collection',
            busiest ? `${busiest.date} · ${money(busiest.collectedPoisha)}` : 'No collections in this period'
          ]
        ],
        summaries: [
          { label: 'Received cash', value: money(summary.collectedPoisha), emphasis: true },
          { label: 'Net cash flow', value: money(summary.netCashFlowPoisha) },
          { label: 'Outstanding dues (all time)', value: money(summary.outstandingPoisha) }
        ],
        footNotes: [
          'Invoiced revenue is what was billed; received cash is what actually came in. Outstanding dues are shown for all time, not only this period.'
        ]
      }
    }
    default: {
      // Unreachable through the router (the payload schema only accepts catalogue keys), and loud if a
      // new key is added to the catalogue without a builder.
      const exhaustive: never = report
      throw new Error(`No report builder for "${String(exhaustive)}". Add it to buildReportData.`)
    }
  }
}

export { REPORT_KEYS }
