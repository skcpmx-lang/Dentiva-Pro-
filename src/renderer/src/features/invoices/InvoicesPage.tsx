/**
 * Invoices: billing built from treatments and inventory items, with real totals computed by the main
 * process (never in the browser), payment capture against an invoice, voiding with a reason, and the
 * invoice/thermal print output.
 *
 * Money is handled as integer poisha end to end; the inputs keep a text buffer only while typing.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Ban, Plus, Printer, Save, Trash2 } from 'lucide-react'
import type { Invoice, InvoiceInput, InvoiceItemInput, PaymentMethod } from '@shared/types'
import { invoke } from '../../lib/api'
import { useApp } from '../../app/state'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Drawer,
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
  TextArea,
  TextInput,
  useConfirm
} from '../../components/ui'
import { useAction, usePagination, useQuery } from '../../lib/hooks'
import {
  amountInput,
  formatDate,
  invoiceStatusLabel,
  money,
  parseMoneyInput,
  paymentKindLabel,
  statusTone,
  todayIso
} from '../../lib/format'
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS } from '@shared/constants'
import type { InvoiceStatus } from '@shared/constants'

type RangePreset = 'today' | 'last7' | 'last30' | 'last90' | 'custom' | 'all'

interface ItemDraft {
  itemType: 'treatment' | 'product' | 'service' | 'other'
  treatmentId: number | null
  inventoryItemId: number | null
  description: string
  quantity: string
  unitPrice: string
  discount: string
  note: string
}

const EMPTY_ITEM: ItemDraft = {
  itemType: 'treatment',
  treatmentId: null,
  inventoryItemId: null,
  description: '',
  quantity: '1',
  unitPrice: '0.00',
  discount: '0.00',
  note: ''
}

export function InvoicesPage() {
  const app = useApp()
  const navigate = useNavigate()
  const params = useParams<{ id?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const confirm = useConfirm()
  const pagination = usePagination(25)

  const [status, setStatus] = useState<'' | InvoiceStatus>('')
  const [range, setRange] = useState<RangePreset>('all')
  const [from, setFrom] = useState(todayIso())
  const [to, setTo] = useState(todayIso())
  const [patientFilter, setPatientFilter] = useState<number | null>(null)
  const [patientLabel, setPatientLabel] = useState('')
  const [patientTerm, setPatientTerm] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [detailId, setDetailId] = useState<number | null>(params.id ? Number(params.id) : null)
  const [paymentFor, setPaymentFor] = useState<Invoice | null>(null)

  const list = useQuery(
    'invoices.list',
    {
      page: pagination.page,
      pageSize: pagination.pageSize,
      status: status || null,
      from: range === 'custom' ? from : null,
      to: range === 'custom' ? to : null,
      patientId: patientFilter
    },
    { deps: [pagination.page, pagination.pageSize, status, range, from, to, patientFilter] }
  )

  const detail = useQuery(
    'invoices.get',
    { id: detailId ?? 0 },
    { enabled: detailId !== null, deps: [detailId] }
  )
  const print = useAction(async (id: number, mode: 'preview' | 'print' | 'pdf') =>
    invoke('print.job', { documentType: 'invoice', entityId: id, mode })
  )
  const voidInvoice = useAction(async (id: number, reason: string) => invoke('invoices.void', { id, reason }))

  useEffect(() => {
    if (searchParams.get('new') === '1' && app.hasPermission('invoices.create')) {
      const patientId = searchParams.get('patientId')
      setEditingId(null)
      setPatientFilter(patientId ? Number(patientId) : null)
      setPatientLabel('')
      setEditorOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      next.delete('patientId')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams, app])

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Billing, dues and printed receipts"
        actions={
          app.hasPermission('invoices.create') ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditingId(null)
                setPatientLabel('')
                setPatientFilter(null)
                setEditorOpen(true)
              }}
            >
              <Plus size={16} /> New invoice
            </Button>
          ) : null
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
              options={[
                { value: 'all', label: 'All' },
                { value: 'today', label: 'Today' },
                { value: 'last7', label: '7 days' },
                { value: 'last30', label: '30 days' },
                { value: 'last90', label: '90 days' },
                { value: 'custom', label: 'Custom' }
              ]}
            />
          </div>
          {range === 'custom' ? (
            <>
              <TextInput label="From" type="date" value={from} onValueChange={setFrom} />
              <TextInput label="To" type="date" value={to} onValueChange={setTo} />
            </>
          ) : null}
          <Select
            label="Status"
            value={status}
            onValueChange={(value) => {
              setStatus(value as '' | InvoiceStatus)
              pagination.reset()
            }}
            options={INVOICE_STATUSES.map((entry) => ({ value: entry, label: INVOICE_STATUS_LABELS[entry] }))}
            placeholder="All statuses"
          />
          <div className="toolbar__grow">
            <TextInput
              label="Patient"
              value={patientLabel || patientTerm}
              onValueChange={(value) => {
                setPatientTerm(value)
                setPatientLabel('')
                setPatientFilter(null)
              }}
              placeholder="Any patient — type to search"
            />
          </div>
        </div>
        {patientTerm.trim().length >= 2 && patientFilter === null ? (
          <PatientResults
            term={patientTerm}
            onPick={(id, label) => {
              setPatientFilter(id)
              setPatientLabel(label)
              setPatientTerm('')
              pagination.reset()
            }}
          />
        ) : null}
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
                header: 'Invoice',
                render: (row: Invoice) => <span className="mono">{row.invoiceNo}</span>
              },
              { key: 'date', header: 'Date', render: (row: Invoice) => formatDate(row.invoiceDate) },
              {
                key: 'patient',
                header: 'Patient',
                render: (row: Invoice) => (
                  <span>
                    {row.patientName}{' '}
                    <span className="mono" style={{ color: 'var(--ink-500)' }}>
                      {row.patientCode}
                    </span>
                  </span>
                )
              },
              { key: 'items', header: 'Items', align: 'right', render: (row: Invoice) => row.items.length },
              {
                key: 'total',
                header: 'Total',
                align: 'right',
                render: (row: Invoice) => <Money poisha={row.totalPoisha} />
              },
              {
                key: 'paid',
                header: 'Paid',
                align: 'right',
                render: (row: Invoice) => <Money poisha={row.paidPoisha} />
              },
              {
                key: 'due',
                header: 'Due',
                align: 'right',
                render: (row: Invoice) =>
                  row.balancePoisha > 0 ? (
                    <Money poisha={row.balancePoisha} />
                  ) : (
                    <Badge tone="success">Settled</Badge>
                  )
              },
              {
                key: 'status',
                header: 'Status',
                render: (row: Invoice) => (
                  <Badge tone={statusTone(row.status)}>{invoiceStatusLabel(row.status)}</Badge>
                )
              },
              {
                key: 'actions',
                header: '',
                render: (row: Invoice) => (
                  <div className="toolbar" style={{ gap: 4 }}>
                    <Button size="sm" variant="ghost" onClick={() => setDetailId(row.id)}>
                      Open
                    </Button>
                    {app.hasPermission('payments.create') && row.balancePoisha > 0 && !row.voidedAt ? (
                      <Button size="sm" onClick={() => setPaymentFor(row)}>
                        Receive payment
                      </Button>
                    ) : null}
                    {app.hasPermission('invoices.print') ? (
                      <Button
                        size="sm"
                        title="Preview and print"
                        onClick={async () => {
                          const result = await print.run(row.id, 'preview')
                          if (!result.ok)
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
                    {app.hasPermission('invoices.edit') && !row.voidedAt ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(row.id)
                          setPatientFilter(row.patientId)
                          setPatientLabel(`${row.patientName} (${row.patientCode})`)
                          setEditorOpen(true)
                        }}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {app.hasPermission('invoices.void') && !row.voidedAt ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Void invoice"
                        onClick={() =>
                          confirm({
                            title: 'Void this invoice?',
                            message: `${row.invoiceNo} will be marked void. It stays in the books for audit purposes and prints with a VOID watermark; payments already received are not deleted.`,
                            tone: 'danger',
                            confirmLabel: 'Void invoice',
                            typeToConfirm: 'VOID',
                            requirePassword: app.settings?.requirePasswordOnDestructive ?? true,
                            onConfirm: async () => {
                              const result = await voidInvoice.run(row.id, 'Voided from the invoice list')
                              if (result.ok) {
                                app.toast({ tone: 'success', title: 'Invoice voided' })
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
                title="No invoices yet"
                description="Bill treatments and products here; dues and receipts are tracked automatically."
                action={
                  app.hasPermission('invoices.create') ? (
                    <Button variant="primary" onClick={() => setEditorOpen(true)}>
                      Create the first invoice
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

      {detailId !== null ? (
        <Drawer
          title="Invoice"
          onClose={() => {
            setDetailId(null)
            if (params.id) navigate('/invoices')
          }}
          footer={
            <>
              <Button
                size="sm"
                onClick={() => {
                  if (detail.data) navigate(`/patients/${detail.data.patientId}`)
                }}
              >
                Open patient
              </Button>
              {app.hasPermission('invoices.print') && detail.data ? (
                <>
                  <Button size="sm" onClick={() => void print.run(detail.data!.id, 'preview')}>
                    <Printer size={14} /> Preview
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => void print.run(detail.data!.id, 'pdf')}>
                    Save as PDF
                  </Button>
                </>
              ) : null}
            </>
          }
        >
          {detail.loading ? (
            <LoadingState />
          ) : detail.error ? (
            <ErrorState message={detail.error} onRetry={detail.reload} />
          ) : detail.data ? (
            <InvoiceDetail
              invoice={detail.data}
              onPay={() => setPaymentFor(detail.data as Invoice)}
              onChanged={() => {
                detail.reload()
                list.reload()
              }}
            />
          ) : null}
        </Drawer>
      ) : null}

      {editorOpen ? (
        <InvoiceEditor
          invoiceId={editingId}
          initialPatientId={patientFilter}
          onClose={() => {
            setEditorOpen(false)
            setEditingId(null)
            list.reload()
          }}
        />
      ) : null}

      {paymentFor ? (
        <PaymentModal
          invoice={paymentFor}
          onClose={() => setPaymentFor(null)}
          onSaved={() => {
            setPaymentFor(null)
            list.reload()
            if (detailId !== null) detail.reload()
          }}
        />
      ) : null}
    </>
  )
}

function PatientResults({ term, onPick }: { term: string; onPick: (id: number, label: string) => void }) {
  const lookup = useQuery('patients.lookup', { term, limit: 8 }, { deps: [term] })
  if (!lookup.data || lookup.data.length === 0) return null
  return (
    <div className="card" style={{ marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
      {lookup.data.map((patient) => (
        <button
          key={patient.id}
          type="button"
          className="nav-item"
          onClick={() => onPick(patient.id, `${patient.fullName} (${patient.code})`)}
        >
          <span className="nav-item__label">
            {patient.fullName} · <span className="mono">{patient.code}</span>
            {patient.phone ? ` · ${patient.phone}` : ''}
          </span>
        </button>
      ))}
    </div>
  )
}

function InvoiceDetail({
  invoice,
  onPay,
  onChanged
}: {
  invoice: Invoice
  onPay: () => void
  onChanged: () => void
}) {
  const app = useApp()
  const confirm = useConfirm()
  const voidPayment = useAction(async (id: number, reason: string) => invoke('payments.void', { id, reason }))

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <dl className="detail-list">
        <dt>Invoice</dt>
        <dd className="mono">{invoice.invoiceNo}</dd>
        <dt>Patient</dt>
        <dd>
          {invoice.patientName} ({invoice.patientCode})
        </dd>
        <dt>Date</dt>
        <dd>
          {formatDate(invoice.invoiceDate)}
          {invoice.dueDate ? ` · due ${formatDate(invoice.dueDate)}` : ''}
        </dd>
        <dt>Status</dt>
        <dd>
          <Badge tone={statusTone(invoice.status)}>{invoiceStatusLabel(invoice.status)}</Badge>
          {invoice.voidedAt
            ? ` · voided ${formatDate(invoice.voidedAt.slice(0, 10))} (${invoice.voidReason ?? 'no reason given'})`
            : ''}
        </dd>
      </dl>

      <table className="data-table data-table--compact">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th className="numeric">Qty</th>
            <th className="numeric">Unit</th>
            <th className="numeric">Discount</th>
            <th className="numeric">Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id}>
              <td>{item.sortOrder + 1}</td>
              <td>
                {item.description}
                {item.note ? <div className="field__hint">{item.note}</div> : null}
              </td>
              <td className="numeric">{(item.quantityMilli / 1000).toFixed(2)}</td>
              <td className="numeric">{money(item.unitPricePoisha)}</td>
              <td className="numeric">{money(item.discountPoisha)}</td>
              <td className="numeric">{money(item.lineTotalPoisha)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="totals">
        <div className="totals__row">
          <span>Subtotal</span>
          <span className="numeric">{money(invoice.subtotalPoisha)}</span>
        </div>
        <div className="totals__row">
          <span>Discount</span>
          <span className="numeric">− {money(invoice.discountPoisha)}</span>
        </div>
        <div className="totals__row">
          <span>Tax</span>
          <span className="numeric">{money(invoice.taxPoisha)}</span>
        </div>
        {invoice.roundOffPoisha !== 0 ? (
          <div className="totals__row">
            <span>Round off</span>
            <span className="numeric">{money(invoice.roundOffPoisha)}</span>
          </div>
        ) : null}
        <div className="totals__row totals__row--grand">
          <span>Total</span>
          <span className="numeric">{money(invoice.totalPoisha)}</span>
        </div>
        <div className="totals__row">
          <span>Paid</span>
          <span className="numeric">{money(invoice.paidPoisha)}</span>
        </div>
        <div className="totals__row">
          <span>Balance</span>
          <span className="numeric">{money(invoice.balancePoisha)}</span>
        </div>
      </div>

      <div>
        <h4>Payments</h4>
        {invoice.payments.length === 0 ? (
          <p className="field__hint">No payments received against this invoice yet.</p>
        ) : (
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Date</th>
                <th>Method</th>
                <th>Kind</th>
                <th className="numeric">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoice.payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="mono">{payment.receiptNo}</td>
                  <td>{formatDate(payment.receivedAt.slice(0, 10))}</td>
                  <td>{payment.methodName}</td>
                  <td>{paymentKindLabel(payment.kind)}</td>
                  <td className="numeric">{money(payment.amountPoisha)}</td>
                  <td>
                    {payment.voidedAt ? (
                      <Badge tone="danger">Void</Badge>
                    ) : app.hasPermission('payments.void') ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          confirm({
                            title: 'Void this payment?',
                            message: `${payment.receiptNo} for ${money(payment.amountPoisha)} will be marked void. The receipt stays in the audit trail and the invoice balance increases again.`,
                            tone: 'danger',
                            confirmLabel: 'Void payment',
                            typeToConfirm: 'VOID',
                            requirePassword: app.settings?.requirePasswordOnDestructive ?? true,
                            onConfirm: async () => {
                              const result = await voidPayment.run(
                                payment.id,
                                'Voided from the invoice screen'
                              )
                              if (result.ok) {
                                app.toast({ tone: 'success', title: 'Payment voided' })
                                onChanged()
                              } else throw new Error(result.error)
                            }
                          })
                        }
                      >
                        Void
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {app.hasPermission('payments.create') && invoice.balancePoisha > 0 && !invoice.voidedAt ? (
        <Button variant="primary" onClick={onPay}>
          Receive payment
        </Button>
      ) : null}
    </div>
  )
}

function PaymentModal({
  invoice,
  onClose,
  onSaved
}: {
  invoice: Invoice
  onClose: () => void
  onSaved: () => void
}) {
  const app = useApp()
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [methodCode, setMethodCode] = useState('cash')
  const [amount, setAmount] = useState(amountInput(invoice.balancePoisha))
  const [reference, setReference] = useState('')
  const [receivedAt, setReceivedAt] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    invoke('payments.methods', { includeInactive: false })
      .then((list) => {
        setMethods(list)
        const preferred = list.find((entry) => entry.isSystemDefault && entry.code === 'cash') ?? list[0]
        if (preferred) setMethodCode(preferred.code)
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  const create = useAction(
    async (payload: {
      patientId: number
      invoiceId: number | null
      amountPoisha: number
      methodCode: string
      referenceNo: string | null
      receivedAt: string
      notes: string | null
    }) => invoke('payments.create', payload)
  )

  const selected = methods.find((entry) => entry.code === methodCode)

  return (
    <Modal
      title={`Receive payment — ${invoice.invoiceNo}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={create.pending}
            onClick={async () => {
              const parsed = parseMoneyInput(amount)
              if (parsed == null || parsed <= 0) {
                setError('Enter the amount received.')
                return
              }
              if (selected?.requiresReference && reference.trim().length === 0) {
                setError(`${selected.name} payments need a reference number (transaction ID).`)
                return
              }
              const result = await create.run({
                patientId: invoice.patientId,
                invoiceId: invoice.id,
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
                  detail: money(result.value.amountPoisha)
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
        <MoneyInput label="Amount received" required value={amount} onValueChange={setAmount} />
        <Select
          label="Method"
          required
          value={methodCode}
          onValueChange={setMethodCode}
          options={methods.map((method) => ({ value: method.code, label: method.name }))}
        />
        <TextInput
          label="Reference"
          value={reference}
          onValueChange={setReference}
          required={selected?.requiresReference ?? false}
          hint={selected?.requiresReference ? 'Transaction ID / cheque number' : 'Optional'}
        />
        <TextInput label="Received on" type="date" value={receivedAt} onValueChange={setReceivedAt} />
        <TextArea label="Notes" rows={2} value={notes} onValueChange={setNotes} full />
      </div>
      <p className="field__hint">
        Invoice balance before this receipt: {money(invoice.balancePoisha)}. Overpayment is allowed and is
        recorded as an advance.
      </p>
    </Modal>
  )
}

function InvoiceEditor({
  invoiceId,
  initialPatientId,
  onClose
}: {
  invoiceId: number | null
  initialPatientId: number | null
  onClose: () => void
}) {
  const app = useApp()
  const [patientId, setPatientId] = useState<number>(initialPatientId ?? 0)
  const [patientLabel, setPatientLabel] = useState('')
  const [patientTerm, setPatientTerm] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(todayIso())
  const [dueDate, setDueDate] = useState('')
  const [discount, setDiscount] = useState('0.00')
  const [taxPercent, setTaxPercent] = useState('0')
  const [roundOff, setRoundOff] = useState(false)
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<ItemDraft[]>([{ ...EMPTY_ITEM }])
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<number | null>(invoiceId)

  const patients = useQuery(
    'patients.lookup',
    { term: patientTerm, limit: 8 },
    { enabled: patientTerm.trim().length >= 2, deps: [patientTerm] }
  )
  const treatments = useQuery('treatments.list', { page: 1, pageSize: 200, includeInactive: false })
  const inventory = useQuery('inventory.list', { page: 1, pageSize: 200, includeInactive: false })
  const existing = useQuery(
    'invoices.get',
    { id: invoiceId ?? 0 },
    { enabled: invoiceId !== null, deps: [invoiceId] }
  )

  const balance = useQuery(
    'invoices.patientBalance',
    { id: patientId },
    { enabled: patientId > 0, deps: [patientId, savedId] }
  )

  const create = useAction(async (input: InvoiceInput) => invoke('invoices.create', input))
  const update = useAction(async (id: number, input: InvoiceInput) =>
    invoke('invoices.update', { id, input })
  )

  useEffect(() => {
    if (!existing.data) return
    setPatientId(existing.data.patientId)
    setPatientLabel(`${existing.data.patientName} (${existing.data.patientCode})`)
    setInvoiceDate(existing.data.invoiceDate)
    setDueDate(existing.data.dueDate ?? '')
    setDiscount(amountInput(existing.data.discountPoisha))
    setTaxPercent(
      (
        (existing.data.taxPoisha / Math.max(1, existing.data.subtotalPoisha - existing.data.discountPoisha)) *
        100
      ).toFixed(2)
    )
    setRoundOff(existing.data.roundOffPoisha !== 0)
    setNotes(existing.data.notes ?? '')
    setItems(
      existing.data.items.map((item) => ({
        itemType: item.itemType,
        treatmentId: item.treatmentId,
        inventoryItemId: item.inventoryItemId,
        description: item.description,
        quantity: String(item.quantityMilli / 1000),
        unitPrice: amountInput(item.unitPricePoisha),
        discount: amountInput(item.discountPoisha),
        note: item.note ?? ''
      }))
    )
  }, [existing.data])

  useEffect(() => {
    if (!existing.data && patientId > 0 && patientLabel === '') {
      invoke('patients.get', { id: patientId })
        .then((patient) => setPatientLabel(`${patient.fullName} (${patient.code})`))
        .catch(() => undefined)
    }
  }, [existing.data, patientId, patientLabel])

  const canWrite = app.hasPermission(invoiceId ? 'invoices.edit' : 'invoices.create')

  const preview = useMemo(() => {
    const lines = items.map((item) => {
      const quantity = Number(item.quantity || '0')
      const unit = parseMoneyInput(item.unitPrice) ?? 0
      const lineDiscount = parseMoneyInput(item.discount) ?? 0
      const gross = Math.round(quantity * unit)
      return { gross, discount: lineDiscount, total: Math.max(0, gross - lineDiscount) }
    })
    const subtotal = lines.reduce((sum, line) => sum + line.gross, 0)
    const lineDiscounts = lines.reduce((sum, line) => sum + line.discount, 0)
    const invoiceDiscount = parseMoneyInput(discount) ?? 0
    const afterDiscount = Math.max(0, subtotal - lineDiscounts - invoiceDiscount)
    const tax = Math.round(afterDiscount * (Number(taxPercent || '0') / 100))
    const total = afterDiscount + tax
    return { subtotal, discount: lineDiscounts + invoiceDiscount, tax, total }
  }, [items, discount, taxPercent])

  function patchItem(index: number, changes: Partial<ItemDraft>): void {
    setItems((current) =>
      current.map((item, position) => (position === index ? { ...item, ...changes } : item))
    )
  }

  async function submit(): Promise<void> {
    if (patientId <= 0) {
      setError('Choose the patient being billed.')
      return
    }
    const payloadItems: InvoiceItemInput[] = items
      .filter((item) => item.description.trim().length > 0)
      .map((item) => ({
        itemType: item.itemType,
        treatmentId: item.treatmentId,
        inventoryItemId: item.inventoryItemId,
        description: item.description.trim(),
        quantityMilli: Math.round(Number(item.quantity || '0') * 1000),
        unitPricePoisha: parseMoneyInput(item.unitPrice) ?? 0,
        discountPoisha: parseMoneyInput(item.discount) ?? 0,
        note: item.note.trim() || null
      }))

    if (payloadItems.length === 0) {
      setError('Add at least one line item.')
      return
    }

    const input: InvoiceInput = {
      patientId,
      invoiceDate,
      dueDate: dueDate || null,
      discountPoisha: parseMoneyInput(discount) ?? 0,
      discountPercentX100: 0,
      taxPercentX100: Math.round(Number(taxPercent || '0') * 100),
      roundOffEnabled: roundOff,
      notes: notes.trim() || null,
      items: payloadItems
    }

    setError(null)
    const result = savedId ? await update.run(savedId, input) : await create.run(input)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSavedId(result.value.id)
    app.toast({
      tone: 'success',
      title: `Invoice ${result.value.invoiceNo} saved`,
      detail: money(result.value.totalPoisha)
    })
    onClose()
  }

  return (
    <Modal
      title={savedId ? 'Edit invoice' : 'New invoice'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {canWrite ? (
            <Button
              variant="primary"
              loading={create.pending || update.pending}
              onClick={() => void submit()}
            >
              <Save size={16} /> Save invoice
            </Button>
          ) : null}
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
          {patientId > 0 && balance.data !== null && !balance.loading ? (
            balance.data > 0 ? (
              <p className="hint">
                Outstanding balance: <strong>{money(balance.data)}</strong>
              </p>
            ) : balance.data < 0 ? (
              <p className="hint">
                Advance held on this account: <strong>{money(-balance.data)}</strong> — record it as a payment
                against this invoice instead of taking the money again.
              </p>
            ) : (
              <p className="hint">No outstanding balance on this account.</p>
            )
          ) : null}
        </div>
        <TextInput label="Invoice date" type="date" value={invoiceDate} onValueChange={setInvoiceDate} />
        <TextInput label="Due date" type="date" value={dueDate} onValueChange={setDueDate} />
        <MoneyInput label="Invoice discount" value={discount} onValueChange={setDiscount} />
        <TextInput label="Tax %" value={taxPercent} onValueChange={setTaxPercent} />
        <div>
          <span className="field__label">Round off</span>
          <Checkbox
            label="Round the total to the nearest taka"
            checked={roundOff}
            onCheckedChange={setRoundOff}
            hint="The rounded difference is stored and printed explicitly."
          />
        </div>
        <TextArea label="Notes" rows={2} value={notes} onValueChange={setNotes} full />
      </div>

      <h4 style={{ marginTop: 'var(--space-4)' }}>Line items</h4>
      {items.map((item, index) => (
        <div
          key={index}
          className="card"
          style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-2)' }}
        >
          <div className="toolbar" style={{ marginBottom: 'var(--space-2)' }}>
            <strong>Item {index + 1}</strong>
            <div className="toolbar__grow" />
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setItems(
                  items.length > 1 ? items.filter((_, position) => position !== index) : [{ ...EMPTY_ITEM }]
                )
              }
            >
              <Trash2 size={14} /> Remove
            </Button>
          </div>
          <div className="form-grid form-grid--wide">
            <Select
              label="From catalogue"
              value={
                item.treatmentId
                  ? `t:${item.treatmentId}`
                  : item.inventoryItemId
                    ? `i:${item.inventoryItemId}`
                    : ''
              }
              onValueChange={(value) => {
                if (value.startsWith('t:')) {
                  const treatment = (treatments.data?.rows ?? []).find(
                    (entry) => String(entry.id) === value.slice(2)
                  )
                  if (treatment) {
                    patchItem(index, {
                      itemType: 'treatment',
                      treatmentId: treatment.id,
                      inventoryItemId: null,
                      description: treatment.name,
                      unitPrice: amountInput(treatment.defaultFeePoisha)
                    })
                  }
                } else if (value.startsWith('i:')) {
                  const stock = (inventory.data?.rows ?? []).find(
                    (entry) => String(entry.id) === value.slice(2)
                  )
                  if (stock) {
                    patchItem(index, {
                      itemType: 'product',
                      treatmentId: null,
                      inventoryItemId: stock.id,
                      description: stock.name,
                      unitPrice: amountInput(stock.sellPricePoisha ?? stock.purchasePricePoisha)
                    })
                  }
                } else {
                  patchItem(index, { itemType: 'other', treatmentId: null, inventoryItemId: null })
                }
              }}
              options={[
                ...(treatments.data?.rows ?? []).map((treatment) => ({
                  value: `t:${treatment.id}`,
                  label: `${treatment.name} — ${money(treatment.defaultFeePoisha)}`
                })),
                ...(inventory.data?.rows ?? []).map((stock) => ({
                  value: `i:${stock.id}`,
                  label: `${stock.name} (stock) — ${money(stock.sellPricePoisha ?? stock.purchasePricePoisha)}`
                }))
              ]}
              placeholder="Custom line"
            />
            <TextInput
              label="Description"
              required
              value={item.description}
              onValueChange={(value) => patchItem(index, { description: value })}
            />
            <TextInput
              label="Quantity"
              value={item.quantity}
              onValueChange={(value) => patchItem(index, { quantity: value.replace(/[^\d.]/g, '') })}
            />
            <MoneyInput
              label="Unit price"
              value={item.unitPrice}
              onValueChange={(value) => patchItem(index, { unitPrice: value })}
            />
            <MoneyInput
              label="Line discount"
              value={item.discount}
              onValueChange={(value) => patchItem(index, { discount: value })}
            />
            <TextInput
              label="Note"
              value={item.note}
              onValueChange={(value) => patchItem(index, { note: value })}
            />
          </div>
        </div>
      ))}
      <Button onClick={() => setItems([...items, { ...EMPTY_ITEM }])}>
        <Plus size={16} /> Add line
      </Button>

      <div className="totals" style={{ marginTop: 'var(--space-4)' }}>
        <div className="totals__row">
          <span>Subtotal (before discounts)</span>
          <span className="numeric">{money(preview.subtotal)}</span>
        </div>
        <div className="totals__row">
          <span>Discount</span>
          <span className="numeric">− {money(preview.discount)}</span>
        </div>
        <div className="totals__row">
          <span>Tax</span>
          <span className="numeric">{money(preview.tax)}</span>
        </div>
        <div className="totals__row totals__row--grand">
          <span>Total</span>
          <span className="numeric">{money(preview.total + (roundOff ? 0 : 0))}</span>
        </div>
      </div>
      <p className="field__hint">
        The figures above are an estimate for your review. The saved invoice is calculated by the application
        itself and returned with its final totals.
      </p>
    </Modal>
  )
}
