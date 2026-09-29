/**
 * Inventory: items, batches with expiry dates, stock in/out transactions, low-stock and expiry alerts and
 * suppliers. Stock history is immutable — corrections are new transactions, never edits.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Package, Plus, Save, Truck } from 'lucide-react'
import type { InventoryItem, InventoryItemInput, InventoryTransaction, Supplier } from '@shared/types'
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
  Select,
  StatCard,
  Tabs,
  TextArea,
  TextInput
} from '../../components/ui'
import { useAction, usePagination, useQuery } from '../../lib/hooks'
import {
  amountInput,
  formatDate,
  inventoryTypeLabel,
  money,
  parseMoneyInput,
  quantityMilliText,
  statusTone,
  todayIso
} from '../../lib/format'
import { INVENTORY_TRANSACTION_TYPE_LABELS, INVENTORY_UNITS, ITEM_CATEGORIES } from '@shared/constants'
import type { InventoryTransactionType } from '@shared/constants'

const EMPTY_ITEM: InventoryItemInput = {
  code: null,
  name: '',
  category: null,
  supplierId: null,
  unit: 'piece',
  quantityMilli: 0,
  minStockMilli: 0,
  purchasePricePoisha: 0,
  sellPricePoisha: null,
  location: null,
  isActive: true,
  notes: null
}

export function InventoryPage() {
  const app = useApp()
  const [tab, setTab] = useState<'items' | 'transactions' | 'suppliers'>('items')

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Stock levels, batches with expiry dates, suppliers and immutable movement history"
      />

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'items', label: 'Items & stock' },
          { value: 'transactions', label: 'Movement history' },
          { value: 'suppliers', label: 'Suppliers' }
        ]}
      />

      {tab === 'items' ? <ItemsTab /> : null}
      {tab === 'transactions' ? <TransactionsTab /> : null}
      {tab === 'suppliers' ? <SuppliersTab /> : null}

      {app.hasPermission('inventory.view') ? null : null}
    </>
  )
}

function ItemsTab() {
  const app = useApp()
  const pagination = usePagination(25)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [expiringWithin, setExpiringWithin] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<InventoryItem | null>(null)
  const [form, setForm] = useState<InventoryItemInput>(EMPTY_ITEM)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [stockInFor, setStockInFor] = useState<InventoryItem | null>(null)
  const [issueFor, setIssueFor] = useState<InventoryItem | null>(null)

  const suppliers = useQuery('inventory.suppliers', undefined)
  const list = useQuery(
    'inventory.list',
    {
      page: pagination.page,
      pageSize: pagination.pageSize,
      search: search.trim() || null,
      category: category || null,
      lowStockOnly,
      expiringWithinDays: expiringWithin ? Number(expiringWithin) : null,
      includeInactive
    },
    {
      deps: [
        pagination.page,
        pagination.pageSize,
        search,
        category,
        lowStockOnly,
        expiringWithin,
        includeInactive
      ]
    }
  )

  const save = useAction(async (input: InventoryItemInput & { id?: number }) =>
    invoke('inventory.save', input)
  )

  const lowStockCount = useMemo(
    () => (list.data?.rows ?? []).filter((item) => item.isLowStock).length,
    [list.data]
  )

  function openCreate(): void {
    setEditing(null)
    setForm(EMPTY_ITEM)
    setFormOpen(true)
  }

  function openEdit(item: InventoryItem): void {
    setEditing(item)
    setForm({
      code: item.code,
      name: item.name,
      category: item.category,
      supplierId: item.supplierId,
      unit: item.unit,
      quantityMilli: item.quantityMilli,
      minStockMilli: item.minStockMilli,
      purchasePricePoisha: item.purchasePricePoisha,
      sellPricePoisha: item.sellPricePoisha,
      location: item.location,
      isActive: item.isActive,
      notes: item.notes
    })
    setFormOpen(true)
  }

  return (
    <>
      <div className="grid grid--kpi">
        <StatCard
          label="Items"
          value={String(list.data?.total ?? 0)}
          hint="In the current filter"
          tone="brand"
        />
        <StatCard label="Low stock" value={String(lowStockCount)} hint="At or below the minimum level" />
        <StatCard
          label="Expiring soon"
          value={String(
            (list.data?.rows ?? []).filter((item) => item.earliestExpiry && item.earliestExpiry <= todayIso())
              .length
          )}
          hint="Batches already at or past expiry"
        />
        <StatCard
          label="Stock value"
          value={money(
            (list.data?.rows ?? []).reduce(
              (sum, item) => sum + Math.round((item.quantityMilli / 1000) * item.purchasePricePoisha),
              0
            )
          )}
          hint="At purchase price, current page"
        />
      </div>

      <Card>
        <div className="toolbar">
          <div className="toolbar__grow">
            <TextInput
              label="Search"
              value={search}
              onValueChange={setSearch}
              placeholder="Name, code, location"
            />
          </div>
          <Select
            label="Category"
            value={category}
            onValueChange={setCategory}
            options={ITEM_CATEGORIES.map((entry) => ({ value: entry, label: entry }))}
            placeholder="All"
          />
          <TextInput
            label="Expiring within (days)"
            value={expiringWithin}
            onValueChange={setExpiringWithin}
            placeholder="e.g. 60"
          />
          <div style={{ marginTop: 18 }}>
            <Checkbox label="Low stock only" checked={lowStockOnly} onCheckedChange={setLowStockOnly} />
          </div>
          <div style={{ marginTop: 18 }}>
            <Checkbox
              label="Include inactive"
              checked={includeInactive}
              onCheckedChange={setIncludeInactive}
            />
          </div>
          {app.hasPermission('inventory.manage') ? (
            <Button variant="primary" onClick={openCreate}>
              <Plus size={16} /> New item
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
              { key: 'name', header: 'Item', render: (row: InventoryItem) => row.name },
              { key: 'category', header: 'Category', render: (row) => row.category ?? '—' },
              {
                key: 'stock',
                header: 'In stock',
                align: 'right',
                render: (row) => `${quantityMilliText(row.quantityMilli)} ${row.unit}`
              },
              {
                key: 'min',
                header: 'Minimum',
                align: 'right',
                render: (row) => quantityMilliText(row.minStockMilli)
              },
              {
                key: 'expiry',
                header: 'Earliest expiry',
                render: (row) =>
                  row.earliestExpiry ? (
                    <span>
                      {formatDate(row.earliestExpiry)}{' '}
                      {row.earliestExpiry <= todayIso() ? <Badge tone="danger">Expired</Badge> : null}
                    </span>
                  ) : (
                    '—'
                  )
              },
              {
                key: 'price',
                header: 'Purchase price',
                align: 'right',
                render: (row) => <Money poisha={row.purchasePricePoisha} />
              },
              { key: 'supplier', header: 'Supplier', render: (row) => row.supplierName ?? '—' },
              {
                key: 'alerts',
                header: 'Alerts',
                render: (row) =>
                  row.isLowStock ? (
                    <Badge tone="warning">
                      <AlertTriangle size={12} /> Low stock
                    </Badge>
                  ) : (
                    <Badge tone="success">OK</Badge>
                  )
              },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <div className="toolbar" style={{ gap: 4 }}>
                    <Button size="sm" variant="ghost" onClick={() => setDetailId(row.id)}>
                      Open
                    </Button>
                    {app.hasPermission('inventory.manage') ? (
                      <Button size="sm" onClick={() => setStockInFor(row)} title="Record a purchase">
                        <ArrowDownToLine size={14} /> In
                      </Button>
                    ) : null}
                    {app.hasPermission('inventory.adjust') ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIssueFor(row)}
                        title="Issue or adjust stock"
                      >
                        <ArrowUpFromLine size={14} />
                      </Button>
                    ) : null}
                    {app.hasPermission('inventory.manage') ? (
                      <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                        Edit
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
                title="No items match"
                description="Add the consumables, medicines and materials your clinic uses."
                action={
                  app.hasPermission('inventory.manage') ? (
                    <Button variant="primary" onClick={openCreate}>
                      Add the first item
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
          title={editing ? `Edit ${editing.name}` : 'New inventory item'}
          size="md"
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={save.pending}
                onClick={async () => {
                  if (form.name.trim().length < 2) {
                    app.toast({ tone: 'warning', title: 'Enter an item name' })
                    return
                  }
                  const result = await save.run({ ...form, id: editing?.id })
                  if (result.ok) {
                    app.toast({ tone: 'success', title: editing ? 'Item updated' : 'Item added' })
                    setFormOpen(false)
                    list.reload()
                  } else {
                    app.toast({ tone: 'error', title: 'Could not save the item', detail: result.error })
                  }
                }}
              >
                <Save size={16} /> Save item
              </Button>
            </>
          }
        >
          <div className="form-grid form-grid--wide">
            <TextInput
              label="Name"
              required
              value={form.name}
              onValueChange={(value) => setForm({ ...form, name: value })}
            />
            <TextInput
              label="Code"
              value={form.code ?? ''}
              onValueChange={(value) => setForm({ ...form, code: value || null })}
            />
            <Select
              label="Category"
              value={form.category ?? ''}
              onValueChange={(value) => setForm({ ...form, category: value || null })}
              options={ITEM_CATEGORIES.map((entry) => ({ value: entry, label: entry }))}
              placeholder="Not set"
            />
            <Select
              label="Unit"
              value={form.unit}
              onValueChange={(value) => setForm({ ...form, unit: value })}
              options={INVENTORY_UNITS.map((unit) => ({ value: unit, label: unit }))}
            />
            <Select
              label="Supplier"
              value={form.supplierId ? String(form.supplierId) : ''}
              onValueChange={(value) => setForm({ ...form, supplierId: value ? Number(value) : null })}
              options={(suppliers.data ?? []).map((supplier: Supplier) => ({
                value: String(supplier.id),
                label: supplier.name
              }))}
              placeholder="Not set"
            />
            <MoneyInput
              label="Purchase price"
              value={amountInput(form.purchasePricePoisha)}
              onValueChange={(value) =>
                setForm({ ...form, purchasePricePoisha: parseMoneyInput(value) ?? 0 })
              }
            />
            <MoneyInput
              label="Selling price"
              value={form.sellPricePoisha == null ? '' : amountInput(form.sellPricePoisha)}
              onValueChange={(value) =>
                setForm({ ...form, sellPricePoisha: value === '' ? null : (parseMoneyInput(value) ?? null) })
              }
            />
            <TextInput
              label="Minimum stock"
              value={quantityMilliText(form.minStockMilli)}
              onValueChange={(value) =>
                setForm({
                  ...form,
                  minStockMilli: Math.round(Number(value.replace(/[^\d.]/g, '') || '0') * 1000)
                })
              }
              hint="Alerts appear when stock falls to this level."
            />
            <TextInput
              label="Storage location"
              value={form.location ?? ''}
              onValueChange={(value) => setForm({ ...form, location: value || null })}
            />
            <TextArea
              label="Notes"
              rows={2}
              value={form.notes ?? ''}
              onValueChange={(value) => setForm({ ...form, notes: value || null })}
              full
            />
          </div>
          {editing ? (
            <p className="field__hint">
              Current stock {quantityMilliText(editing.quantityMilli)} {editing.unit}. Stock levels change
              through stock-in and issue transactions so the movement history stays complete.
            </p>
          ) : (
            <p className="field__hint">
              Opening stock is recorded through “Stock in”, which creates the first batch and movement record.
            </p>
          )}
          {editing ? (
            <Checkbox
              label="Active"
              checked={form.isActive}
              onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
              hint="Inactive items stay in history but cannot be selected on new invoices."
            />
          ) : null}
        </Modal>
      ) : null}

      {detailId !== null ? <ItemDetail itemId={detailId} onClose={() => setDetailId(null)} /> : null}

      {stockInFor ? (
        <StockInModal
          item={stockInFor}
          onClose={() => setStockInFor(null)}
          onSaved={() => {
            setStockInFor(null)
            list.reload()
          }}
        />
      ) : null}

      {issueFor ? (
        <IssueModal
          item={issueFor}
          onClose={() => setIssueFor(null)}
          onSaved={() => {
            setIssueFor(null)
            list.reload()
          }}
        />
      ) : null}
    </>
  )
}

function ItemDetail({ itemId, onClose }: { itemId: number; onClose: () => void }) {
  const item = useQuery('inventory.get', { id: itemId }, { deps: [itemId] })
  const batches = useQuery('inventory.batches', { itemId }, { deps: [itemId] })
  const transactions = useQuery(
    'inventory.transactions',
    { itemId, page: 1, pageSize: 25 },
    { deps: [itemId] }
  )

  return (
    <Drawer title={item.data?.name ?? 'Inventory item'} onClose={onClose}>
      {item.loading ? (
        <LoadingState />
      ) : item.error ? (
        <ErrorState message={item.error} onRetry={item.reload} />
      ) : item.data ? (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <dl className="detail-list">
            <dt>Code</dt>
            <dd className="mono">{item.data.code ?? '—'}</dd>
            <dt>Category</dt>
            <dd>{item.data.category ?? '—'}</dd>
            <dt>In stock</dt>
            <dd>
              {quantityMilliText(item.data.quantityMilli)} {item.data.unit}
            </dd>
            <dt>Minimum</dt>
            <dd>{quantityMilliText(item.data.minStockMilli)}</dd>
            <dt>Purchase price</dt>
            <dd className="numeric">{money(item.data.purchasePricePoisha)}</dd>
            <dt>Selling price</dt>
            <dd className="numeric">
              {item.data.sellPricePoisha == null ? '—' : money(item.data.sellPricePoisha)}
            </dd>
            <dt>Supplier</dt>
            <dd>{item.data.supplierName ?? '—'}</dd>
            <dt>Location</dt>
            <dd>{item.data.location ?? '—'}</dd>
            <dt>Status</dt>
            <dd>
              {item.data.isActive ? (
                <Badge tone="success">Active</Badge>
              ) : (
                <Badge tone="warning">Inactive</Badge>
              )}
              {item.data.isLowStock ? <Badge tone="warning">Low stock</Badge> : null}
            </dd>
          </dl>

          <div>
            <h4>Batches</h4>
            {batches.data && batches.data.length > 0 ? (
              <table className="data-table data-table--compact">
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Expiry</th>
                    <th className="numeric">Remaining</th>
                    <th className="numeric">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.data.map((batch) => (
                    <tr key={batch.id}>
                      <td className="mono">{batch.batchNo ?? '—'}</td>
                      <td>
                        {batch.expiryDate ? formatDate(batch.expiryDate) : '—'}{' '}
                        {batch.isExpired ? <Badge tone="danger">Expired</Badge> : null}
                      </td>
                      <td className="numeric">
                        {quantityMilliText(batch.quantityRemainingMilli)} /{' '}
                        {quantityMilliText(batch.quantityInMilli)}
                      </td>
                      <td className="numeric">{money(batch.purchasePricePoisha)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="field__hint">No batches recorded yet.</p>
            )}
          </div>

          <div>
            <h4>Recent movements</h4>
            {transactions.data && transactions.data.rows.length > 0 ? (
              <table className="data-table data-table--compact">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th className="numeric">Quantity</th>
                    <th>By</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.data.rows.map((txn: InventoryTransaction) => (
                    <tr key={txn.id}>
                      <td>
                        {formatDate(txn.at.slice(0, 10))} {txn.at.slice(11, 16)}
                      </td>
                      <td>{inventoryTypeLabel(txn.txnType)}</td>
                      <td className="numeric">{quantityMilliText(txn.quantityMilli)}</td>
                      <td>{txn.userName ?? '—'}</td>
                      <td>{txn.reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="field__hint">No stock movements recorded yet.</p>
            )}
          </div>
        </div>
      ) : null}
    </Drawer>
  )
}

function StockInModal({
  item,
  onClose,
  onSaved
}: {
  item: InventoryItem
  onClose: () => void
  onSaved: () => void
}) {
  const app = useApp()
  const [quantity, setQuantity] = useState('')
  const [batchNo, setBatchNo] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [unitCost, setUnitCost] = useState(amountInput(item.purchasePricePoisha))
  const [purchaseDate, setPurchaseDate] = useState(todayIso())
  const [supplierId, setSupplierId] = useState(item.supplierId ? String(item.supplierId) : '')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const suppliers = useQuery('inventory.suppliers', undefined)
  const stockIn = useAction(
    async (payload: {
      itemId: number
      batchNo?: string | null
      expiryDate?: string | null
      quantityMilli: number
      unitCostPoisha: number
      purchaseDate: string
      supplierId?: number | null
      reference?: string | null
      notes?: string | null
    }) => invoke('inventory.stockIn', payload)
  )

  return (
    <Modal
      title={`Stock in — ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={stockIn.pending}
            onClick={async () => {
              const amount = Number(quantity.replace(/[^\d.]/g, ''))
              if (!amount || amount <= 0) {
                setError('Enter the quantity received.')
                return
              }
              const result = await stockIn.run({
                itemId: item.id,
                batchNo: batchNo.trim() || null,
                expiryDate: expiryDate || null,
                quantityMilli: Math.round(amount * 1000),
                unitCostPoisha: parseMoneyInput(unitCost) ?? 0,
                purchaseDate,
                supplierId: supplierId ? Number(supplierId) : null,
                reference: reference.trim() || null,
                notes: notes.trim() || null
              })
              if (result.ok) {
                app.toast({
                  tone: 'success',
                  title: 'Stock received',
                  detail: `${item.name}: now ${quantityMilliText(result.value.quantityMilli)} ${result.value.unit}`
                })
                onSaved()
              } else {
                setError(result.error)
              }
            }}
          >
            <ArrowDownToLine size={16} /> Record stock in
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
          label={`Quantity received (${item.unit})`}
          required
          value={quantity}
          onValueChange={(value) => setQuantity(value.replace(/[^\d.]/g, ''))}
        />
        <MoneyInput label="Unit cost" value={unitCost} onValueChange={setUnitCost} />
        <TextInput
          label="Batch number"
          value={batchNo}
          onValueChange={setBatchNo}
          hint="Printed on the packaging."
        />
        <TextInput label="Expiry date" type="date" value={expiryDate} onValueChange={setExpiryDate} />
        <TextInput label="Purchase date" type="date" value={purchaseDate} onValueChange={setPurchaseDate} />
        <Select
          label="Supplier"
          value={supplierId}
          onValueChange={setSupplierId}
          options={(suppliers.data ?? []).map((supplier: Supplier) => ({
            value: String(supplier.id),
            label: supplier.name
          }))}
          placeholder="Not set"
        />
        <TextInput label="Invoice / reference" value={reference} onValueChange={setReference} />
        <TextArea label="Notes" rows={2} value={notes} onValueChange={setNotes} full />
      </div>
      <p className="field__hint">
        Stock in creates a new batch and an immutable movement record. Expiry dates drive the alerts on the
        dashboard.
      </p>
    </Modal>
  )
}

function IssueModal({
  item,
  onClose,
  onSaved
}: {
  item: InventoryItem
  onClose: () => void
  onSaved: () => void
}) {
  const app = useApp()
  const [quantity, setQuantity] = useState('')
  const [txnType, setTxnType] =
    useState<
      Extract<InventoryTransactionType, 'usage' | 'adjustment_out' | 'wastage' | 'return' | 'expired'>
    >('usage')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const batches = useQuery('inventory.batches', { itemId: item.id }, { deps: [item.id] })
  const issue = useAction(
    async (payload: {
      itemId: number
      quantityMilli: number
      txnType: 'usage' | 'adjustment_out' | 'wastage' | 'return' | 'expired'
      reason?: string | null
    }) => invoke('inventory.issue', payload)
  )

  const issueTypes: { value: typeof txnType; label: string }[] = [
    { value: 'usage', label: INVENTORY_TRANSACTION_TYPE_LABELS.usage },
    { value: 'adjustment_out', label: INVENTORY_TRANSACTION_TYPE_LABELS.adjustment_out },
    { value: 'wastage', label: INVENTORY_TRANSACTION_TYPE_LABELS.wastage },
    { value: 'return', label: INVENTORY_TRANSACTION_TYPE_LABELS.return },
    { value: 'expired', label: INVENTORY_TRANSACTION_TYPE_LABELS.expired }
  ]

  return (
    <Modal
      title={`Stock out — ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={issue.pending}
            onClick={async () => {
              const amount = Number(quantity.replace(/[^\d.]/g, ''))
              if (!amount || amount <= 0) {
                setError('Enter the quantity.')
                return
              }
              const result = await issue.run({
                itemId: item.id,
                quantityMilli: Math.round(amount * 1000),
                txnType,
                reason: reason.trim() || null
              })
              if (result.ok) {
                app.toast({
                  tone: 'success',
                  title: 'Stock updated',
                  detail: `Now ${quantityMilliText(result.value.quantityMilli)} ${item.unit}`
                })
                onSaved()
              } else {
                setError(result.error)
              }
            }}
          >
            <ArrowUpFromLine size={16} /> Record movement
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
          label="Type"
          value={txnType}
          onValueChange={(value) => setTxnType(value as typeof txnType)}
          options={issueTypes}
        />
        <TextInput
          label={`Quantity (${item.unit})`}
          required
          value={quantity}
          onValueChange={(value) => setQuantity(value.replace(/[^\d.]/g, ''))}
        />
        <TextInput label="Reason" value={reason} onValueChange={setReason} full />
      </div>
      <p className="field__hint">
        In stock: {quantityMilliText(item.quantityMilli)} {item.unit} across {batches.data?.length ?? 0}{' '}
        batch(es). The earliest expiring batch is consumed first.
      </p>
    </Modal>
  )
}

function TransactionsTab() {
  const app = useApp()
  const pagination = usePagination(50)
  const [itemId, setItemId] = useState('')
  const [txnType, setTxnType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [exporting, setExporting] = useState(false)

  const items = useQuery('inventory.list', { page: 1, pageSize: 200, includeInactive: true })
  const list = useQuery(
    'inventory.transactions',
    {
      page: pagination.page,
      pageSize: pagination.pageSize,
      itemId: itemId ? Number(itemId) : undefined,
      txnType: (txnType || undefined) as InventoryTransaction['txnType'] | undefined,
      from: from || undefined,
      to: to || undefined
    },
    { deps: [pagination.page, pagination.pageSize, itemId, txnType, from, to] }
  )

  async function exportMovements(): Promise<void> {
    if (!app.hasPermission('inventory.export')) {
      app.toast({
        tone: 'warning',
        title: 'Export not allowed',
        detail: 'Your role cannot export inventory data.'
      })
      return
    }
    setExporting(true)
    try {
      const folder = await invoke('export.chooseFolder', { title: 'Choose a folder for the export' })
      if (!folder) return
      const result = await invoke('export.data', {
        entity: 'inventory_movements',
        format: 'csv',
        from: from || null,
        to: to || null,
        targetFolder: folder
      })
      app.toast({
        tone: 'success',
        title: `Exported ${result.rowCount} movement(s)`,
        detail: result.filePath
      })
    } catch (cause) {
      app.toast({
        tone: 'error',
        title: 'Export failed',
        detail: cause instanceof Error ? cause.message : String(cause)
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Card>
        <div className="toolbar">
          <Select
            label="Item"
            value={itemId}
            onValueChange={(value) => {
              setItemId(value)
              pagination.reset()
            }}
            options={(items.data?.rows ?? []).map((item) => ({ value: String(item.id), label: item.name }))}
            placeholder="All items"
          />
          <Select
            label="Movement type"
            value={txnType}
            onValueChange={(value) => {
              setTxnType(value)
              pagination.reset()
            }}
            options={(Object.keys(INVENTORY_TRANSACTION_TYPE_LABELS) as InventoryTransactionType[]).map(
              (type) => ({
                value: type,
                label: INVENTORY_TRANSACTION_TYPE_LABELS[type]
              })
            )}
            placeholder="All types"
          />
          <TextInput label="From" type="date" value={from} onValueChange={setFrom} />
          <TextInput label="To" type="date" value={to} onValueChange={setTo} />
          <Button loading={exporting} onClick={() => void exportMovements()}>
            Export CSV
          </Button>
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
                key: 'at',
                header: 'When',
                render: (row: InventoryTransaction) =>
                  `${formatDate(row.at.slice(0, 10))} ${row.at.slice(11, 16)}`
              },
              { key: 'item', header: 'Item', render: (row) => row.itemName },
              {
                key: 'type',
                header: 'Type',
                render: (row) => (
                  <Badge tone={statusTone(row.txnType)}>{inventoryTypeLabel(row.txnType)}</Badge>
                )
              },
              {
                key: 'qty',
                header: 'Quantity',
                align: 'right',
                render: (row) => (row.quantityMilli >= 0 ? '+' : '') + quantityMilliText(row.quantityMilli)
              },
              {
                key: 'cost',
                header: 'Unit cost',
                align: 'right',
                render: (row) => (row.unitCostPoisha ? money(row.unitCostPoisha) : '—')
              },
              { key: 'reference', header: 'Reference', render: (row) => row.referenceType ?? '—' },
              { key: 'user', header: 'By', render: (row) => row.userName ?? '—' },
              { key: 'reason', header: 'Reason', render: (row) => row.reason ?? '—' }
            ]}
            rows={list.data?.rows ?? []}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="No stock movements"
                description="Every stock-in, usage and adjustment is listed here."
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
    </>
  )
}

function SuppliersTab() {
  const app = useApp()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [form, setForm] = useState<Omit<Supplier, 'id'>>({
    name: '',
    contactPerson: null,
    phone: null,
    email: null,
    address: null,
    notes: null,
    isActive: true
  })

  const list = useQuery('inventory.suppliers', undefined)
  const save = useAction(async (payload: Omit<Supplier, 'id'> & { id?: number }) =>
    invoke('inventory.suppliers.save', payload)
  )

  const canManage = app.hasPermission('inventory.manage')

  return (
    <Card
      title="Suppliers"
      flush
      actions={
        canManage ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setForm({
                name: '',
                contactPerson: null,
                phone: null,
                email: null,
                address: null,
                notes: null,
                isActive: true
              })
              setFormOpen(true)
            }}
          >
            <Plus size={14} /> New supplier
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
              key: 'name',
              header: 'Supplier',
              render: (row: Supplier) => (
                <span>
                  <Package size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  {row.name}
                </span>
              )
            },
            { key: 'contact', header: 'Contact', render: (row) => row.contactPerson ?? '—' },
            { key: 'phone', header: 'Phone', render: (row) => row.phone ?? '—' },
            { key: 'email', header: 'Email', render: (row) => row.email ?? '—' },
            {
              key: 'status',
              header: 'Status',
              render: (row) =>
                row.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Inactive</Badge>
            },
            {
              key: 'actions',
              header: '',
              render: (row: Supplier) =>
                canManage ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(row)
                      setForm({
                        name: row.name,
                        contactPerson: row.contactPerson,
                        phone: row.phone,
                        email: row.email,
                        address: row.address,
                        notes: row.notes,
                        isActive: row.isActive
                      })
                      setFormOpen(true)
                    }}
                  >
                    Edit
                  </Button>
                ) : null
            }
          ]}
          rows={list.data ?? []}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              title="No suppliers yet"
              description="Record who you buy materials from so stock entries can reference them."
              action={canManage ? <Button onClick={() => setFormOpen(true)}>Add supplier</Button> : null}
            />
          }
        />
      )}

      {formOpen ? (
        <Modal
          title={editing ? `Edit ${editing.name}` : 'New supplier'}
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={save.pending}
                onClick={async () => {
                  if (form.name.trim().length < 2) {
                    app.toast({ tone: 'warning', title: 'Enter the supplier name' })
                    return
                  }
                  const result = await save.run({ ...form, id: editing?.id })
                  if (result.ok) {
                    app.toast({ tone: 'success', title: 'Supplier saved' })
                    setFormOpen(false)
                    list.reload()
                  } else {
                    app.toast({ tone: 'error', title: 'Could not save', detail: result.error })
                  }
                }}
              >
                Save supplier
              </Button>
            </>
          }
        >
          <div className="form-grid form-grid--wide">
            <TextInput
              label="Name"
              required
              value={form.name}
              onValueChange={(value) => setForm({ ...form, name: value })}
            />
            <TextInput
              label="Contact person"
              value={form.contactPerson ?? ''}
              onValueChange={(value) => setForm({ ...form, contactPerson: value || null })}
            />
            <TextInput
              label="Phone"
              value={form.phone ?? ''}
              onValueChange={(value) => setForm({ ...form, phone: value || null })}
            />
            <TextInput
              label="Email"
              value={form.email ?? ''}
              onValueChange={(value) => setForm({ ...form, email: value || null })}
            />
            <TextInput
              label="Address"
              value={form.address ?? ''}
              onValueChange={(value) => setForm({ ...form, address: value || null })}
              full
            />
            <TextArea
              label="Notes"
              rows={2}
              value={form.notes ?? ''}
              onValueChange={(value) => setForm({ ...form, notes: value || null })}
              full
            />
          </div>
          <Checkbox
            label="Active"
            checked={form.isActive}
            onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
          />
        </Modal>
      ) : null}

      <div className="card__footer">
        <Truck size={12} style={{ verticalAlign: 'middle' }} /> Suppliers are referenced by stock-in records
        for reporting and warranty questions.
      </div>
    </Card>
  )
}
