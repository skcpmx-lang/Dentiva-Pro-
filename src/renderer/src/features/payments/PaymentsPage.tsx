/**
 * Payments dashboard.
 *
 * Defaults to today (as required), with 7/30/90-day and custom ranges. The three numbers that matter are
 * kept separate: money invoiced, money actually received, and what is still outstanding.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ban, Download, Plus, Printer } from 'lucide-react'
import type { Invoice, Payment, PaymentInput, PaymentMethod, PaymentQuery } from '@shared/types'
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
  TextArea,
  TextInput,
  useConfirm
} from '../../components/ui'
import { useAction, usePagination, useQuery } from '../../lib/hooks'
import { amountInput, formatDate, money, paymentKindLabel, parseMoneyInput, todayIso } from '../../lib/format'
import type { PaymentKind } from '@shared/constants'
import { PAYMENT_KINDS, PAYMENT_KIND_LABELS } from '@shared/constants'

type Preset = 'today' | 'last7' | 'last30' | 'last90' | 'custom' | 'all'

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: '7 days' },
  { value: 'last30', label: '30 days' },
  { value: 'last90', label: '90 days' },
  { value: 'custom', label: 'Custom' },
  { value: 'all', label: 'All' }
]

export function PaymentsPage() {
  const app = useApp()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const pagination = usePagination(25)
  const [range, setRange] = useState<Preset>('today')
  const [from, setFrom] = useState(todayIso())
  const [to, setTo] = useState(todayIso())
  const [methodCode, setMethodCode] = useState('')
  const [search, setSearch] = useState('')
  const [takeOpen, setTakeOpen] = useState(false)
  const [detail, setDetail] = useState<Payment | null>(null)

  const query: PaymentQuery = {
    page: pagination.page,
    pageSize: pagination.pageSize,
    range: range,
    from: range === 'custom' ? from : null,
    to: range === 'custom' ? to : null,
    methodCode: methodCode || null,
    search: search.trim() || null
  }

  const payments = useQuery('payments.list', query, { deps: [JSON.stringify(query)] })
  const dashboard = useQuery('payments.dashboard', query, { deps: [JSON.stringify(query)] })
  const methods = useQuery('payments.methods', { includeInactive: false })
  const outstanding = useQuery('invoices.outstanding', { limit: 20 })

  const printPayment = useAction(async (payment: Payment) => {
    if (!payment.invoiceId) return null
    return invoke('print.job', { documentType: 'invoice', entityId: payment.invoiceId, mode: 'preview' })
  })
  const voidPayment = useAction(async (id: number, reason: string) => invoke('payments.void', { id, reason }))

  async function exportPayments(): Promise<void> {
    if (!app.hasPermission('data.export')) {
      app.toast({ tone: 'warning', title: 'Export not allowed', detail: 'Your role cannot export data.' })
      return
    }
    try {
      const folder = await invoke('export.chooseFolder', { title: 'Choose a folder for the export' })
      if (!folder) return
      const result = await invoke('export.data', {
        entity: 'payments',
        format: 'csv',
        from: range === 'custom' ? from : null,
        to: range === 'custom' ? to : null,
        targetFolder: folder
      })
      app.toast({ tone: 'success', title: `Exported ${result.rowCount} payment(s)`, detail: result.filePath })
    } catch (cause) {
      app.toast({
        tone: 'error',
        title: 'Export failed',
        detail: cause instanceof Error ? cause.message : String(cause)
      })
    }
  }

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Money actually received — cash, bKash, Nagad, Rocket, Upay, card and bank"
        actions={
          <>
            <Button onClick={() => void exportPayments()}>
              <Download size={16} /> Export
            </Button>
            {app.hasPermission('payments.create') ? (
              <Button variant="primary" onClick={() => setTakeOpen(true)}>
                <Plus size={16} /> Receive payment
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <div className="toolbar">
          <div>
            <span className="field__label">Period</span>
            <SegmentedControl
              value={range}
              onChange={(value) => {
                setRange(value)
                pagination.reset()
              }}
              options={PRESETS}
            />
          </div>
          {range === 'custom' ? (
            <>
              <TextInput label="From" type="date" value={from} onValueChange={setFrom} />
              <TextInput label="To" type="date" value={to} onValueChange={setTo} />
            </>
          ) : null}
          <Select
            label="Method"
            value={methodCode}
            onValueChange={(value) => {
              setMethodCode(value)
              pagination.reset()
            }}
            options={(methods.data ?? []).map((method) => ({ value: method.code, label: method.name }))}
            placeholder="All methods"
          />
          <div className="toolbar__grow">
            <TextInput
              label="Search"
              value={search}
              onValueChange={(value) => {
                setSearch(value)
                pagination.reset()
              }}
              placeholder="Receipt number, patient, reference"
            />
          </div>
        </div>
      </Card>

      <div className="grid grid--kpi">
        <StatCard
          label={range === 'today' ? 'Received today' : 'Received in period'}
          value={money(dashboard.data?.totalPoisha ?? 0)}
          hint={`${dashboard.data?.count ?? 0} receipt(s)`}
          tone="brand"
        />
        <StatCard
          label="Outstanding"
          value={money(dashboard.data?.outstandingPoisha ?? 0)}
          hint="All unpaid invoice balances"
        />
        {dashboard.data?.byMethod.slice(0, 4).map((method) => (
          <StatCard
            key={method.methodCode}
            label={method.methodName}
            value={money(method.totalPoisha)}
            hint={`${method.count} receipt(s)`}
          />
        ))}
      </div>

      <div className="grid grid--2">
        <Card title="Receipts" flush>
          {payments.loading ? (
            <LoadingState />
          ) : payments.error ? (
            <ErrorState message={payments.error} onRetry={payments.reload} />
          ) : (
            <DataTable
              columns={[
                {
                  key: 'receipt',
                  header: 'Receipt',
                  render: (row: Payment) => <span className="mono">{row.receiptNo}</span>
                },
                {
                  key: 'date',
                  header: 'Date',
                  render: (row: Payment) => formatDate(row.receivedAt.slice(0, 10))
                },
                {
                  key: 'patient',
                  header: 'Patient',
                  render: (row: Payment) => (
                    <span>
                      {row.patientName}{' '}
                      <span className="mono" style={{ color: 'var(--ink-500)' }}>
                        {row.patientCode}
                      </span>
                    </span>
                  )
                },
                { key: 'invoice', header: 'Invoice', render: (row: Payment) => row.invoiceNo ?? '—' },
                { key: 'method', header: 'Method', render: (row: Payment) => row.methodName },
                { key: 'kind', header: 'Kind', render: (row: Payment) => paymentKindLabel(row.kind) },
                {
                  key: 'amount',
                  header: 'Amount',
                  align: 'right',
                  render: (row: Payment) => <Money poisha={row.amountPoisha} />
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (row: Payment) =>
                    row.voidedAt ? <Badge tone="danger">Void</Badge> : <Badge tone="success">Cleared</Badge>
                },
                {
                  key: 'actions',
                  header: '',
                  render: (row: Payment) => (
                    <div className="toolbar" style={{ gap: 4 }}>
                      <Button size="sm" variant="ghost" onClick={() => setDetail(row)}>
                        Open
                      </Button>
                      {row.invoiceId && app.hasPermission('invoices.print') ? (
                        <Button
                          size="sm"
                          title="Open the invoice preview"
                          onClick={async () => {
                            const result = await printPayment.run(row)
                            if (result && !result.ok)
                              app.toast({
                                tone: 'error',
                                title: 'Could not open the preview',
                                detail: result.error
                              })
                          }}
                        >
                          <Printer size={14} />
                        </Button>
                      ) : null}
                      {app.hasPermission('payments.void') && !row.voidedAt ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Void receipt"
                          onClick={() =>
                            confirm({
                              title: 'Void this receipt?',
                              message: `Receipt ${row.receiptNo} (${money(row.amountPoisha)}) will be marked void. The invoice balance increases again and the action is recorded in the audit log.`,
                              tone: 'danger',
                              confirmLabel: 'Void receipt',
                              typeToConfirm: 'VOID',
                              requirePassword: app.settings?.requirePasswordOnDestructive ?? true,
                              onConfirm: async () => {
                                const result = await voidPayment.run(row.id, 'Voided from the payments list')
                                if (result.ok) {
                                  app.toast({ tone: 'success', title: 'Receipt voided' })
                                  payments.reload()
                                  dashboard.reload()
                                  outstanding.reload()
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
              rows={payments.data?.rows ?? []}
              rowKey={(row) => row.id}
              empty={
                <EmptyState
                  title="No payments in this period"
                  description="Change the period or record a payment when you take money at the desk."
                  action={
                    app.hasPermission('payments.create') ? (
                      <Button variant="primary" onClick={() => setTakeOpen(true)}>
                        Receive payment
                      </Button>
                    ) : null
                  }
                />
              }
              footer={
                payments.data ? (
                  <Pagination
                    page={pagination.page}
                    pageSize={pagination.pageSize}
                    total={payments.data.total}
                    onPageChange={pagination.setPage}
                    onPageSizeChange={pagination.setPageSize}
                  />
                ) : null
              }
            />
          )}
        </Card>

        <Card title="Outstanding dues" flush>
          {outstanding.loading ? (
            <LoadingState />
          ) : outstanding.error ? (
            <ErrorState message={outstanding.error} onRetry={outstanding.reload} />
          ) : (
            <DataTable
              columns={[
                {
                  key: 'code',
                  header: 'Patient',
                  render: (row) => `${row.patientName} (${row.patientCode})`
                },
                { key: 'phone', header: 'Phone', render: (row) => row.phone },
                { key: 'invoices', header: 'Invoices', align: 'right', render: (row) => row.invoiceCount },
                { key: 'since', header: 'Oldest', render: (row) => formatDate(row.oldestInvoiceDate) },
                {
                  key: 'due',
                  header: 'Outstanding',
                  align: 'right',
                  render: (row) => <Money poisha={row.outstandingPoisha} />
                }
              ]}
              rows={outstanding.data ?? []}
              rowKey={(row) => row.patientId}
              onRowClick={(row) => navigate(`/patients/${row.patientId}`)}
              empty={<EmptyState title="No outstanding dues" description="Every invoice is fully paid." />}
              compact
            />
          )}
        </Card>
      </div>

      {takeOpen ? (
        <TakePaymentModal
          onClose={() => setTakeOpen(false)}
          onSaved={() => {
            setTakeOpen(false)
            payments.reload()
            dashboard.reload()
            outstanding.reload()
          }}
        />
      ) : null}

      {detail ? (
        <Modal title={`Receipt ${detail.receiptNo}`} onClose={() => setDetail(null)}>
          <dl className="detail-list">
            <dt>Patient</dt>
            <dd>
              {detail.patientName} ({detail.patientCode})
            </dd>
            <dt>Invoice</dt>
            <dd>{detail.invoiceNo ?? 'Not linked to an invoice (advance)'}</dd>
            <dt>Amount</dt>
            <dd className="numeric">{money(detail.amountPoisha)}</dd>
            <dt>Method</dt>
            <dd>
              {detail.methodName}
              {detail.referenceNo ? ` · ${detail.referenceNo}` : ''}
            </dd>
            <dt>Received</dt>
            <dd>{formatDate(detail.receivedAt.slice(0, 10))}</dd>
            <dt>Received by</dt>
            <dd>{detail.receivedBy ?? '—'}</dd>
            <dt>Status</dt>
            <dd>
              <Badge tone={detail.voidedAt ? 'danger' : 'success'}>
                {detail.voidedAt ? 'Void' : 'Cleared'}
              </Badge>
              {detail.voidReason ? ` · ${detail.voidReason}` : ''}
            </dd>
            <dt>Notes</dt>
            <dd>{detail.notes ?? '—'}</dd>
          </dl>
        </Modal>
      ) : null}
    </>
  )
}

/** Records a payment from the desk, optionally against an unpaid invoice of the chosen patient. */
function TakePaymentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const app = useApp()
  const [patientId, setPatientId] = useState(0)
  const [patientLabel, setPatientLabel] = useState('')
  const [patientTerm, setPatientTerm] = useState('')
  const [invoiceId, setInvoiceId] = useState<number | null>(null)
  const [methodCode, setMethodCode] = useState('cash')
  const [kind, setKind] = useState<PaymentKind>('payment')
  const [amount, setAmount] = useState('0.00')
  const [reference, setReference] = useState('')
  const [receivedAt, setReceivedAt] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const patients = useQuery(
    'patients.lookup',
    { term: patientTerm, limit: 8 },
    { enabled: patientTerm.trim().length >= 2, deps: [patientTerm] }
  )
  const methods = useQuery('payments.methods', { includeInactive: false })
  const invoices = useQuery(
    'invoices.list',
    { patientId, page: 1, pageSize: 50 },
    { enabled: patientId > 0, deps: [patientId] }
  )
  const create = useAction(async (payload: PaymentInput) => invoke('payments.create', payload))

  const methodList: PaymentMethod[] = methods.data ?? []
  const selected = methodList.find((method) => method.code === methodCode)
  const unpaid: Invoice[] = (invoices.data?.rows ?? []).filter(
    (invoice) => invoice.balancePoisha > 0 && !invoice.voidedAt
  )

  return (
    <Modal
      title="Receive payment"
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={create.pending}
            onClick={async () => {
              const parsed = parseMoneyInput(amount)
              if (patientId <= 0) {
                setError('Choose the patient.')
                return
              }
              if (parsed == null || parsed <= 0) {
                setError('Enter the amount received.')
                return
              }
              if (selected?.requiresReference && reference.trim().length === 0) {
                setError(`${selected.name} payments need a reference number.`)
                return
              }
              const result = await create.run({
                patientId,
                invoiceId,
                kind,
                amountPoisha: parsed,
                methodCode,
                referenceNo: reference.trim() || null,
                receivedAt,
                notes: notes.trim() || null
              })
              if (result.ok) {
                app.toast({
                  tone: 'success',
                  title: `Receipt ${result.value.receiptNo} issued`,
                  detail: `${money(result.value.amountPoisha)} · ${result.value.methodName}`
                })
                onSaved()
              } else {
                setError(result.error)
              }
            }}
          >
            Save receipt
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
        <div>
          <TextInput
            label="Patient"
            required
            value={patientLabel || patientTerm}
            onValueChange={(value) => {
              setPatientTerm(value)
              setPatientLabel('')
              setPatientId(0)
              setInvoiceId(null)
            }}
            placeholder="Type at least 2 characters"
          />
          {patients.data && patients.data.length > 0 && patientId === 0 ? (
            <div className="card" style={{ maxHeight: 160, overflowY: 'auto' }}>
              {patients.data.map((patient) => (
                <button
                  key={patient.id}
                  type="button"
                  className="nav-item"
                  onClick={() => {
                    setPatientId(patient.id)
                    setPatientLabel(`${patient.fullName} (${patient.code})`)
                    setPatientTerm('')
                  }}
                >
                  <span className="nav-item__label">
                    {patient.fullName} · <span className="mono">{patient.code}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <Select
          label="Against invoice"
          value={invoiceId ? String(invoiceId) : ''}
          onValueChange={(value) => {
            setInvoiceId(value ? Number(value) : null)
            const invoice = unpaid.find((entry) => String(entry.id) === value)
            if (invoice) setAmount(amountInput(invoice.balancePoisha))
          }}
          options={unpaid.map((invoice) => ({
            value: String(invoice.id),
            label: `${invoice.invoiceNo} · due ${money(invoice.balancePoisha)}`
          }))}
          placeholder="Advance / no invoice"
          disabled={patientId === 0}
        />
        <Select
          label="Kind"
          value={kind}
          onValueChange={(value) => setKind(value as PaymentKind)}
          options={PAYMENT_KINDS.map((entry) => ({ value: entry, label: PAYMENT_KIND_LABELS[entry] }))}
        />
        <MoneyInput label="Amount" required value={amount} onValueChange={setAmount} />
        <Select
          label="Method"
          required
          value={methodCode}
          onValueChange={setMethodCode}
          options={methodList.map((method) => ({
            value: method.code,
            label: method.nameBn ? `${method.name} (${method.nameBn})` : method.name
          }))}
        />
        <TextInput
          label="Reference"
          value={reference}
          onValueChange={setReference}
          required={selected?.requiresReference ?? false}
        />
        <TextInput label="Received on" type="date" value={receivedAt} onValueChange={setReceivedAt} />
        <TextArea label="Notes" rows={2} value={notes} onValueChange={setNotes} full />
      </div>
      {unpaid.length > 0 ? (
        <p className="field__hint">
          This patient has {unpaid.length} unpaid invoice(s) totalling{' '}
          {money(unpaid.reduce((sum, invoice) => sum + invoice.balancePoisha, 0))}.
        </p>
      ) : null}
      <p className="field__hint">
        Invoiced revenue and received cash are tracked separately in Accounting, so the reports never confuse
        the two.
      </p>
    </Modal>
  )
}
