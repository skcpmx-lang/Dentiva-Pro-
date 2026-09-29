/**
 * Accounting.
 *
 * Invoiced revenue (what the clinic billed) and received cash (what actually came in) are kept strictly
 * apart — the specification calls this out explicitly, and the reports depend on it. Expenses are recorded
 * against categories and voided rather than deleted.
 */

import { useMemo, useState } from 'react'
import { Ban, Plus, RefreshCw } from 'lucide-react'
import type {
  AccountingSummary,
  Expense,
  ExpenseCategory,
  ExpenseInput,
  RevenueReportRow
} from '@shared/types'
import { invoke } from '../../lib/api'
import { useApp } from '../../app/state'
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  Money,
  MoneyInput,
  PageHeader,
  Pagination,
  SegmentedControl,
  Select,
  StatCard,
  Tabs,
  TextArea,
  TextInput,
  useConfirm
} from '../../components/ui'
import { useAction, usePagination, useQuery } from '../../lib/hooks'
import { amountInput, formatDate, money, parseMoneyInput, paymentKindLabel, todayIso } from '../../lib/format'
import { addDaysIso } from '@shared/date'

type Preset = 'today' | 'last7' | 'last30' | 'last90' | 'thisMonth' | 'thisYear' | 'custom' | 'all'

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: '7 days' },
  { value: 'last30', label: '30 days' },
  { value: 'last90', label: '90 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'thisYear', label: 'This year' },
  { value: 'custom', label: 'Custom' },
  { value: 'all', label: 'All' }
]

function rangeFor(
  preset: Preset,
  customFrom: string,
  customTo: string
): { from: string | null; to: string | null } {
  const today = todayIso()
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'last7':
      return { from: addDaysIso(today, -6), to: today }
    case 'last30':
      return { from: addDaysIso(today, -29), to: today }
    case 'last90':
      return { from: addDaysIso(today, -89), to: today }
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'thisYear':
      return { from: `${today.slice(0, 4)}-01-01`, to: today }
    case 'custom':
      return { from: customFrom || null, to: customTo || null }
    default:
      return { from: null, to: null }
  }
}

export function AccountingPage() {
  const [tab, setTab] = useState<'summary' | 'expenses' | 'categories'>('summary')
  const [preset, setPreset] = useState<Preset>('last30')
  const [customFrom, setCustomFrom] = useState(addDaysIso(todayIso(), -29))
  const [customTo, setCustomTo] = useState(todayIso())
  const [nonce, setNonce] = useState(0)

  const range = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo])

  return (
    <>
      <PageHeader
        title="Accounting"
        subtitle="Invoiced revenue, received cash, expenses and receivables"
        actions={
          <Button onClick={() => setNonce((value) => value + 1)}>
            <RefreshCw size={16} /> Recalculate
          </Button>
        }
      />

      <Card>
        <div className="toolbar">
          <div>
            <span className="field__label">Period</span>
            <SegmentedControl value={preset} onChange={setPreset} options={PRESETS} />
          </div>
          {preset === 'custom' ? (
            <>
              <TextInput label="From" type="date" value={customFrom} onValueChange={setCustomFrom} />
              <TextInput label="To" type="date" value={customTo} onValueChange={setCustomTo} />
            </>
          ) : null}
          <span className="field__hint">
            {range.from ?? 'beginning'} → {range.to ?? 'today'}
          </span>
        </div>
      </Card>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'summary', label: 'Summary' },
          { value: 'expenses', label: 'Expenses' },
          { value: 'categories', label: 'Expense categories' }
        ]}
      />

      {tab === 'summary' ? <SummaryTab range={range} nonce={nonce} /> : null}
      {tab === 'expenses' ? <ExpensesTab range={range} nonce={nonce} /> : null}
      {tab === 'categories' ? <CategoriesTab /> : null}
    </>
  )
}

function SummaryTab({ range, nonce }: { range: { from: string | null; to: string | null }; nonce: number }) {
  const summary = useQuery('accounting.summary', range, { deps: [range.from, range.to, nonce] })
  const revenue = useQuery(
    'accounting.revenue',
    { ...range, groupBy: 'day' },
    { deps: [range.from, range.to, nonce] }
  )
  const treatmentRevenue = useQuery('accounting.treatmentRevenue', range, {
    deps: [range.from, range.to, nonce]
  })

  if (summary.loading) return <LoadingState label="Calculating from your transactions…" />
  if (summary.error) return <ErrorState message={summary.error} onRetry={summary.reload} />
  const data: AccountingSummary | null = summary.data
  if (!data) return <EmptyState title="Nothing to report yet" />

  return (
    <>
      <div className="grid grid--kpi">
        <StatCard
          label="Invoiced"
          value={money(data.invoiceRevenuePoisha)}
          hint="Value of bills raised in this period"
          tone="brand"
        />
        <StatCard
          label="Received"
          value={money(data.collectedPoisha)}
          hint="Cash, bKash, Nagad, card and bank receipts"
        />
        <StatCard
          label="Expenses"
          value={money(data.expensesPoisha)}
          hint="Recorded expenses in this period"
        />
        <StatCard
          label="Net cash flow"
          value={money(data.netCashFlowPoisha)}
          hint="Received minus expenses (cash basis)"
        />
        <StatCard
          label="Outstanding"
          value={money(data.outstandingPoisha)}
          hint="Unpaid invoice balances, all time"
        />
      </div>

      <div className="grid grid--2">
        <Card title="Daily figures" flush>
          <DataTable
            columns={[
              { key: 'date', header: 'Date', render: (row: RevenueReportRow) => formatDate(row.date) },
              { key: 'invoices', header: 'Invoices', align: 'right', render: (row) => row.invoiceCount },
              {
                key: 'invoiced',
                header: 'Invoiced',
                align: 'right',
                render: (row) => <Money poisha={row.invoicedPoisha} />
              },
              {
                key: 'collected',
                header: 'Received',
                align: 'right',
                render: (row) => <Money poisha={row.collectedPoisha} />
              },
              {
                key: 'expenses',
                header: 'Expenses',
                align: 'right',
                render: (row) => <Money poisha={row.expensesPoisha} />
              },
              { key: 'net', header: 'Net', align: 'right', render: (row) => <Money poisha={row.netPoisha} /> }
            ]}
            rows={revenue.data ?? []}
            rowKey={(row) => row.date}
            empty={
              <EmptyState
                title="No transactions in this period"
                description="Choose a wider period to see figures."
              />
            }
            compact
          />
        </Card>

        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Card title="Received by method" flush>
            <DataTable
              columns={[
                { key: 'method', header: 'Method', render: (row) => row.methodName },
                { key: 'count', header: 'Receipts', align: 'right', render: (row) => row.count },
                {
                  key: 'total',
                  header: 'Amount',
                  align: 'right',
                  render: (row) => <Money poisha={row.totalPoisha} />
                }
              ]}
              rows={data.byMethod}
              rowKey={(row) => row.methodCode}
              empty={<EmptyState title="No receipts in this period" />}
              compact
            />
          </Card>

          <Card title="Expenses by category" flush>
            <DataTable
              columns={[
                { key: 'category', header: 'Category', render: (row) => row.categoryName },
                { key: 'count', header: 'Entries', align: 'right', render: (row) => row.count },
                {
                  key: 'total',
                  header: 'Amount',
                  align: 'right',
                  render: (row) => <Money poisha={row.totalPoisha} />
                }
              ]}
              rows={data.byExpenseCategory}
              rowKey={(row) => row.categoryId}
              empty={<EmptyState title="No expenses in this period" />}
              compact
            />
          </Card>
        </div>
      </div>

      <Card title="Revenue by treatment" flush>
        <DataTable
          columns={[
            { key: 'name', header: 'Treatment', render: (row) => row.treatmentName },
            { key: 'category', header: 'Category', render: (row) => row.category ?? '—' },
            { key: 'quantity', header: 'Times billed', align: 'right', render: (row) => row.quantity },
            {
              key: 'revenue',
              header: 'Revenue',
              align: 'right',
              render: (row) => <Money poisha={row.revenuePoisha} />
            }
          ]}
          rows={treatmentRevenue.data ?? []}
          rowKey={(row) => `${row.treatmentId ?? 'custom'}-${row.treatmentName}`}
          empty={<EmptyState title="No treatment revenue in this period" />}
          compact
        />
      </Card>
    </>
  )
}

function ExpensesTab({ range, nonce }: { range: { from: string | null; to: string | null }; nonce: number }) {
  const app = useApp()
  const confirm = useConfirm()
  const pagination = usePagination(25)
  const [categoryId, setCategoryId] = useState('')
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [form, setForm] = useState<{
    categoryId: string
    expenseDate: string
    amount: string
    methodCode: string
    paidTo: string
    referenceNo: string
    description: string
  }>({
    categoryId: '',
    expenseDate: todayIso(),
    amount: '0.00',
    methodCode: 'cash',
    paidTo: '',
    referenceNo: '',
    description: ''
  })
  const [error, setError] = useState<string | null>(null)

  const categories = useQuery('accounting.categories', { includeInactive: false })
  const methods = useQuery('payments.methods', { includeInactive: false })
  const list = useQuery(
    'accounting.expenses.list',
    {
      page: pagination.page,
      pageSize: pagination.pageSize,
      from: range.from,
      to: range.to,
      categoryId: categoryId ? Number(categoryId) : null,
      search: search.trim() || null
    },
    { deps: [pagination.page, pagination.pageSize, range.from, range.to, categoryId, search, nonce] }
  )

  const save = useAction(async (input: ExpenseInput & { id?: number }) =>
    input.id
      ? invoke('accounting.expenses.update', { id: input.id, input })
      : invoke('accounting.expenses.create', input)
  )
  const voidExpense = useAction(async (id: number, reason: string) =>
    invoke('accounting.expenses.void', { id, reason })
  )

  function openCreate(): void {
    setEditing(null)
    setForm({
      categoryId: categories.data?.[0] ? String(categories.data[0].id) : '',
      expenseDate: todayIso(),
      amount: '0.00',
      methodCode: 'cash',
      paidTo: '',
      referenceNo: '',
      description: ''
    })
    setError(null)
    setFormOpen(true)
  }

  async function submit(): Promise<void> {
    const amount = parseMoneyInput(form.amount) ?? 0
    if (!form.categoryId) {
      setError('Choose an expense category.')
      return
    }
    if (amount <= 0) {
      setError('Enter the amount paid.')
      return
    }
    if (form.description.trim().length < 3) {
      setError('Describe what the payment was for.')
      return
    }
    const result = await save.run({
      id: editing?.id,
      categoryId: Number(form.categoryId),
      expenseDate: form.expenseDate,
      amountPoisha: amount,
      methodCode: form.methodCode,
      paidTo: form.paidTo.trim() || null,
      referenceNo: form.referenceNo.trim() || null,
      description: form.description.trim()
    })
    if (result.ok) {
      app.toast({ tone: 'success', title: editing ? 'Expense updated' : 'Expense recorded' })
      setFormOpen(false)
      list.reload()
    } else {
      setError(result.error)
    }
  }

  return (
    <>
      <Card>
        <div className="toolbar">
          <Select
            label="Category"
            value={categoryId}
            onValueChange={(value) => {
              setCategoryId(value)
              pagination.reset()
            }}
            options={(categories.data ?? []).map((category: ExpenseCategory) => ({
              value: String(category.id),
              label: category.name
            }))}
            placeholder="All categories"
          />
          <div className="toolbar__grow">
            <TextInput
              label="Search"
              value={search}
              onValueChange={(value) => {
                setSearch(value)
                pagination.reset()
              }}
              placeholder="Description, payee, reference"
            />
          </div>
          {app.hasPermission('accounting.manage') ? (
            <Button variant="primary" onClick={openCreate}>
              <Plus size={16} /> Record expense
            </Button>
          ) : null}
        </div>
      </Card>

      <Card flush>
        {list.loading ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : (
          <DataTable
            columns={[
              {
                key: 'no',
                header: 'Entry',
                render: (row: Expense) => <span className="mono">{row.expenseNo}</span>
              },
              { key: 'date', header: 'Date', render: (row) => formatDate(row.expenseDate) },
              { key: 'category', header: 'Category', render: (row) => row.categoryName },
              { key: 'description', header: 'Description', render: (row) => row.description },
              { key: 'paidTo', header: 'Paid to', render: (row) => row.paidTo ?? '—' },
              { key: 'method', header: 'Method', render: (row) => row.methodName },
              {
                key: 'amount',
                header: 'Amount',
                align: 'right',
                render: (row) => <Money poisha={row.amountPoisha} />
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) =>
                  row.voidedAt ? <Badge tone="danger">Void</Badge> : <Badge tone="success">Posted</Badge>
              },
              {
                key: 'actions',
                header: '',
                render: (row: Expense) => (
                  <div className="toolbar" style={{ gap: 4 }}>
                    {app.hasPermission('accounting.manage') && !row.voidedAt ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(row)
                          setForm({
                            categoryId: String(row.categoryId),
                            expenseDate: row.expenseDate,
                            amount: amountInput(row.amountPoisha),
                            methodCode: row.methodCode,
                            paidTo: row.paidTo ?? '',
                            referenceNo: row.referenceNo ?? '',
                            description: row.description
                          })
                          setError(null)
                          setFormOpen(true)
                        }}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {app.hasPermission('accounting.manage') && !row.voidedAt ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Void expense"
                        onClick={() =>
                          confirm({
                            title: 'Void this expense?',
                            message: `${row.expenseNo} for ${money(row.amountPoisha)} will be marked void. The entry stays in the books for audit purposes and is excluded from the totals.`,
                            tone: 'danger',
                            confirmLabel: 'Void expense',
                            typeToConfirm: 'VOID',
                            requirePassword: app.settings?.requirePasswordOnDestructive ?? true,
                            onConfirm: async () => {
                              const result = await voidExpense.run(
                                row.id,
                                'Voided from the accounting screen'
                              )
                              if (result.ok) {
                                app.toast({ tone: 'success', title: 'Expense voided' })
                                list.reload()
                              } else throw new Error(result.error)
                            }
                          })
                        }
                      >
                        <Ban size={14} />
                      </Button>
                    ) : null}
                  </div>
                )
              }
            ]}
            rows={list.data?.rows ?? []}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="No expenses in this period"
                description="Record rent, salaries, materials and lab bills here."
                action={
                  app.hasPermission('accounting.manage') ? (
                    <Button variant="primary" onClick={openCreate}>
                      Record an expense
                    </Button>
                  ) : null
                }
              />
            }
            footer={
              list.data ? (
                <Pagination
                  page={pagination.page}
                  pageSize={pagination.pageSize}
                  total={list.data.total}
                  onPageChange={pagination.setPage}
                  onPageSizeChange={pagination.setPageSize}
                />
              ) : null
            }
          />
        )}
      </Card>

      {formOpen ? (
        <Modal
          title={editing ? `Edit expense ${editing.expenseNo}` : 'Record an expense'}
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button variant="primary" loading={save.pending} onClick={() => void submit()}>
                Save expense
              </Button>
            </>
          }
        >
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-grid form-grid--wide">
            <Select
              label="Category"
              required
              value={form.categoryId}
              onValueChange={(value) => setForm({ ...form, categoryId: value })}
              options={(categories.data ?? []).map((category) => ({
                value: String(category.id),
                label: category.name
              }))}
              placeholder="Choose a category"
            />
            <TextInput
              label="Date"
              type="date"
              value={form.expenseDate}
              onValueChange={(value) => setForm({ ...form, expenseDate: value })}
            />
            <MoneyInput
              label="Amount"
              required
              value={form.amount}
              onValueChange={(value) => setForm({ ...form, amount: value })}
            />
            <Select
              label="Paid by"
              value={form.methodCode}
              onValueChange={(value) => setForm({ ...form, methodCode: value })}
              options={(methods.data ?? []).map((method) => ({ value: method.code, label: method.name }))}
            />
            <TextInput
              label="Paid to"
              value={form.paidTo}
              onValueChange={(value) => setForm({ ...form, paidTo: value })}
            />
            <TextInput
              label="Reference"
              value={form.referenceNo}
              onValueChange={(value) => setForm({ ...form, referenceNo: value })}
            />
            <TextArea
              label="Description"
              required
              rows={2}
              value={form.description}
              onValueChange={(value) => setForm({ ...form, description: value })}
              full
            />
          </div>
        </Modal>
      ) : null}
    </>
  )
}

function CategoriesTab() {
  const app = useApp()
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ code: '', name: '', nameBn: '' })
  const [error, setError] = useState<string | null>(null)

  const list = useQuery('accounting.categories', { includeInactive: true })
  const save = useAction(
    async (payload: { id?: number; code: string; name: string; nameBn?: string | null }) =>
      invoke('accounting.categories.create', payload)
  )

  const canManage = app.hasPermission('accounting.manage')

  return (
    <Card
      title="Expense categories"
      flush
      actions={
        canManage ? (
          <Button
            size="sm"
            onClick={() => {
              setForm({ code: '', name: '', nameBn: '' })
              setError(null)
              setFormOpen(true)
            }}
          >
            <Plus size={14} /> New category
          </Button>
        ) : null
      }
    >
      {list.loading ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : (
        <DataTable
          columns={[
            {
              key: 'code',
              header: 'Code',
              render: (row: ExpenseCategory) => <span className="mono">{row.code}</span>
            },
            { key: 'name', header: 'Category', render: (row) => row.name },
            { key: 'nameBn', header: 'Bangla', render: (row) => <span lang="bn">{row.nameBn ?? '—'}</span> },
            {
              key: 'source',
              header: 'Source',
              render: (row) =>
                row.isSystemDefault ? <Badge tone="info">Built-in</Badge> : <Badge>Custom</Badge>
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) =>
                row.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Inactive</Badge>
            }
          ]}
          rows={list.data ?? []}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              title="No expense categories"
              description="Categories are seeded on first run and can be extended."
            />
          }
        />
      )}

      {formOpen ? (
        <Modal
          title="New expense category"
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={save.pending}
                onClick={async () => {
                  if (form.name.trim().length < 2) {
                    setError('Enter the category name.')
                    return
                  }
                  const code =
                    form.code.trim() ||
                    form.name
                      .trim()
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '_')
                      .slice(0, 40)
                  const result = await save.run({
                    code,
                    name: form.name.trim(),
                    nameBn: form.nameBn.trim() || null
                  })
                  if (result.ok) {
                    app.toast({ tone: 'success', title: 'Category added' })
                    setFormOpen(false)
                    list.reload()
                  } else {
                    setError(result.error)
                  }
                }}
              >
                Save category
              </Button>
            </>
          }
        >
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-grid form-grid--wide">
            <TextInput
              label="Name"
              required
              value={form.name}
              onValueChange={(value) => setForm({ ...form, name: value })}
            />
            <TextInput
              label="Code"
              value={form.code}
              onValueChange={(value) => setForm({ ...form, code: value })}
              hint="Optional; generated from the name when empty."
            />
            <TextInput
              label="Name in Bangla"
              value={form.nameBn}
              onValueChange={(value) => setForm({ ...form, nameBn: value })}
            />
          </div>
        </Modal>
      ) : null}

      <div className="card__footer">
        {paymentKindLabel('payment')} entries and refunds are recorded against receipts, never mixed with
        expenses.
      </div>
    </Card>
  )
}
