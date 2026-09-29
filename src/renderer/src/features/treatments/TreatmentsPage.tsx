/**
 * Treatment catalogue: the priced procedures used by visits and invoices. Seeded with sensible dental
 * defaults and fully editable by the clinic; deactivation keeps history intact.
 */

import { useState } from 'react'
import { Pencil, Plus, Power } from 'lucide-react'
import type { Treatment, TreatmentInput } from '@shared/types'
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
  Select,
  Tabs,
  TextArea,
  TextInput
} from '../../components/ui'
import { useAction, usePagination, useQuery } from '../../lib/hooks'
import { amountInput, parseMoneyInput } from '../../lib/format'

const EMPTY: TreatmentInput = {
  code: null,
  name: '',
  nameBn: null,
  category: 'General',
  description: null,
  defaultFeePoisha: 0,
  durationMinutes: 30,
  isActive: true,
  isSystemDefault: false
}

export function TreatmentsPage() {
  const app = useApp()
  const [tab, setTab] = useState<'treatments' | 'lists' | 'conditions'>('treatments')
  const pagination = usePagination(25)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editing, setEditing] = useState<Treatment | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<TreatmentInput>(EMPTY)

  const list = useQuery(
    'treatments.list',
    {
      page: pagination.page,
      pageSize: pagination.pageSize,
      search: search.trim() || null,
      category: category || null,
      includeInactive
    },
    { deps: [pagination.page, pagination.pageSize, search, category, includeInactive] }
  )

  const categories = useQuery('clinical.options', { listCode: 'treatment_category' })
  const categoryOptions = (categories.data ?? []).map((option) => ({
    value: option.value,
    label: option.value
  }))

  const save = useAction(async (input: TreatmentInput & { id?: number }) => invoke('treatments.save', input))
  const deactivate = useAction(async (id: number) => invoke('treatments.deactivate', { id }))

  function openCreate(): void {
    setEditing(null)
    setForm({ ...EMPTY, category: category || categoryOptions[0]?.value || 'General' })
    setFormOpen(true)
  }

  function openEdit(treatment: Treatment): void {
    setEditing(treatment)
    setForm({
      code: treatment.code,
      name: treatment.name,
      nameBn: treatment.nameBn,
      category: treatment.category,
      description: treatment.description,
      defaultFeePoisha: treatment.defaultFeePoisha,
      durationMinutes: treatment.durationMinutes,
      isActive: treatment.isActive,
      isSystemDefault: treatment.isSystemDefault
    })
    setFormOpen(true)
  }

  async function submit(): Promise<void> {
    if (form.name.trim().length < 2) {
      app.toast({ tone: 'warning', title: 'Enter a treatment name' })
      return
    }
    const result = await save.run({ ...form, id: editing?.id })
    if (result.ok) {
      app.toast({ tone: 'success', title: editing ? 'Treatment updated' : 'Treatment added' })
      setFormOpen(false)
      list.reload()
    } else {
      app.toast({ tone: 'error', title: 'Could not save the treatment', detail: result.error })
    }
  }

  return (
    <>
      <PageHeader
        title="Treatment catalog"
        subtitle="Procedures, default fees and the clinical option lists used across the application"
        actions={
          tab === 'treatments' && app.hasPermission('treatments.manage') ? (
            <Button variant="primary" onClick={openCreate}>
              <Plus size={16} /> New treatment
            </Button>
          ) : null
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'treatments', label: 'Treatments' },
          { value: 'lists', label: 'Clinical lists' },
          { value: 'conditions', label: 'Chart conditions' }
        ]}
      />

      {tab === 'treatments' ? (
        <>
          <Card>
            <div className="toolbar">
              <div className="toolbar__grow">
                <TextInput
                  label="Search"
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Name, code or description"
                />
              </div>
              <Select
                label="Category"
                value={category}
                onValueChange={setCategory}
                options={categoryOptions}
                placeholder="All categories"
              />
              <label className="checkbox" style={{ marginTop: 18 }}>
                <input
                  type="checkbox"
                  checked={includeInactive}
                  onChange={(event) => setIncludeInactive(event.target.checked)}
                />
                Include inactive
              </label>
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
                    key: 'code',
                    header: 'Code',
                    render: (row: Treatment) => <span className="mono">{row.code ?? '—'}</span>
                  },
                  { key: 'name', header: 'Treatment', render: (row: Treatment) => row.name },
                  { key: 'category', header: 'Category', render: (row: Treatment) => row.category },
                  {
                    key: 'fee',
                    header: 'Default fee',
                    align: 'right',
                    render: (row: Treatment) => <Money poisha={row.defaultFeePoisha} />
                  },
                  {
                    key: 'duration',
                    header: 'Duration',
                    align: 'right',
                    render: (row: Treatment) =>
                      row.durationMinutes == null ? '—' : `${row.durationMinutes} min`
                  },
                  {
                    key: 'usage',
                    header: 'Used',
                    align: 'right',
                    render: (row: Treatment) => row.usageCount
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (row: Treatment) =>
                      row.isActive ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="warning">Inactive</Badge>
                      )
                  },
                  {
                    key: 'actions',
                    header: '',
                    render: (row: Treatment) =>
                      app.hasPermission('treatments.manage') ? (
                        <div className="toolbar" style={{ gap: 4 }}>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                            <Pencil size={14} /> Edit
                          </Button>
                          {row.isActive ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Deactivate (history is kept)"
                              onClick={async () => {
                                const result = await deactivate.run(row.id)
                                if (result.ok) {
                                  app.toast({ tone: 'success', title: `${row.name} deactivated` })
                                  list.reload()
                                } else {
                                  app.toast({
                                    tone: 'error',
                                    title: 'Could not deactivate',
                                    detail: result.error
                                  })
                                }
                              }}
                            >
                              <Power size={14} />
                            </Button>
                          ) : null}
                        </div>
                      ) : null
                  }
                ]}
                rows={list.data?.rows ?? []}
                rowKey={(row) => row.id}
                empty={
                  <EmptyState
                    title="No treatments match"
                    description="Adjust the filters or add a treatment to get started."
                    action={
                      app.hasPermission('treatments.manage') ? (
                        <Button variant="primary" onClick={openCreate}>
                          New treatment
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
        </>
      ) : null}

      {tab === 'lists' ? <ClinicalListsTab /> : null}
      {tab === 'conditions' ? <ChartConditionsTab /> : null}

      {formOpen ? (
        <Modal
          title={editing ? `Edit ${editing.name}` : 'New treatment'}
          size="md"
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button variant="primary" loading={save.pending} onClick={() => void submit()}>
                Save treatment
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
              label="Name in Bangla"
              value={form.nameBn ?? ''}
              onValueChange={(value) => setForm({ ...form, nameBn: value || null })}
            />
            <TextInput
              label="Code"
              value={form.code ?? ''}
              onValueChange={(value) => setForm({ ...form, code: value || null })}
              hint="Optional short code used on invoices and reports."
            />
            <Select
              label="Category"
              value={form.category}
              onValueChange={(value) => setForm({ ...form, category: value })}
              options={categoryOptions}
            />
            <MoneyInput
              label="Default fee"
              value={amountInput(form.defaultFeePoisha)}
              onValueChange={(value) => setForm({ ...form, defaultFeePoisha: parseMoneyInput(value) ?? 0 })}
            />
            <TextInput
              label="Typical duration (minutes)"
              value={form.durationMinutes == null ? '' : String(form.durationMinutes)}
              onValueChange={(value) =>
                setForm({ ...form, durationMinutes: value === '' ? null : Number(value.replace(/\D/g, '')) })
              }
            />
            <TextArea
              label="Description"
              rows={2}
              value={form.description ?? ''}
              onValueChange={(value) => setForm({ ...form, description: value || null })}
              full
            />
          </div>
          {editing ? (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              />
              Active (inactive treatments stay in history but cannot be selected)
            </label>
          ) : null}
        </Modal>
      ) : null}
    </>
  )
}

const LIST_CODES: { code: string; label: string }[] = [
  { code: 'chief_complaint', label: 'Chief complaints' },
  { code: 'examination', label: 'Examination findings' },
  { code: 'diagnosis', label: 'Diagnoses' },
  { code: 'advice', label: 'Advice' },
  { code: 'medicine_type', label: 'Medicine types' },
  { code: 'medicine_timing', label: 'Medicine timing (before/after food)' },
  { code: 'medicine_instruction', label: 'Medicine instructions' },
  { code: 'duration_unit', label: 'Duration units' },
  { code: 'appointment_type', label: 'Appointment types' },
  { code: 'treatment_category', label: 'Treatment categories' },
  { code: 'referral_reason', label: 'Referral reasons' }
]

function ClinicalListsTab() {
  const app = useApp()
  const [listCode, setListCode] = useState(LIST_CODES[0]?.code ?? 'chief_complaint')
  const [newValue, setNewValue] = useState('')
  const [newValueBn, setNewValueBn] = useState('')
  const [editing, setEditing] = useState<{ id: number; value: string; valueBn: string } | null>(null)

  const options = useQuery('clinical.options', { listCode, includeInactive: true }, { deps: [listCode] })
  const save = useAction(
    async (payload: {
      id?: number
      listCode: string
      value: string
      valueBn?: string | null
      isActive?: boolean
    }) => invoke('clinical.options.save', payload)
  )
  const deactivate = useAction(async (id: number) => invoke('clinical.options.deactivate', { id }))

  const canManage = app.hasPermission('treatments.manage')

  async function add(): Promise<void> {
    if (newValue.trim().length === 0) return
    const result = await save.run({ listCode, value: newValue.trim(), valueBn: newValueBn.trim() || null })
    if (result.ok) {
      setNewValue('')
      setNewValueBn('')
      options.reload()
    } else {
      app.toast({ tone: 'error', title: 'Could not add the entry', detail: result.error })
    }
  }

  return (
    <Card
      title="Clinical option lists"
      actions={
        <Select
          label="List"
          value={listCode}
          onValueChange={setListCode}
          options={LIST_CODES.map((entry) => ({ value: entry.code, label: entry.label }))}
        />
      }
    >
      <p className="field__hint">
        These lists power the suggestion buttons while writing prescriptions, recording visits and booking
        appointments. Entries are stored in your database and can be renamed; built-in entries cannot be
        deleted.
      </p>

      {options.loading ? (
        <LoadingState />
      ) : options.error ? (
        <ErrorState message={options.error} onRetry={options.reload} />
      ) : (
        <div className="table-wrapper">
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Value</th>
                <th>Bangla</th>
                <th>Source</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(options.data ?? []).map((option) => (
                <tr key={option.id}>
                  <td>
                    {editing?.id === option.id ? (
                      <TextInput
                        label=""
                        value={editing.value}
                        onValueChange={(value) => setEditing({ ...editing, value })}
                      />
                    ) : (
                      option.value
                    )}
                  </td>
                  <td>
                    {editing?.id === option.id ? (
                      <TextInput
                        label=""
                        value={editing.valueBn}
                        onValueChange={(value) => setEditing({ ...editing, valueBn: value })}
                      />
                    ) : (
                      <span lang="bn">{option.valueBn ?? '—'}</span>
                    )}
                  </td>
                  <td>
                    {option.isSystemDefault ? <Badge tone="info">Built-in</Badge> : <Badge>Custom</Badge>}
                  </td>
                  <td>
                    {option.isActive ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="warning">Inactive</Badge>
                    )}
                  </td>
                  <td>
                    {canManage ? (
                      <div className="toolbar" style={{ gap: 4 }}>
                        {editing?.id === option.id ? (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={async () => {
                                const result = await save.run({
                                  id: option.id,
                                  listCode: option.listCode,
                                  value: editing.value,
                                  valueBn: editing.valueBn || null,
                                  isActive: option.isActive
                                })
                                if (result.ok) {
                                  setEditing(null)
                                  options.reload()
                                } else {
                                  app.toast({ tone: 'error', title: 'Could not save', detail: result.error })
                                }
                              }}
                            >
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setEditing({
                                  id: option.id,
                                  value: option.value,
                                  valueBn: option.valueBn ?? ''
                                })
                              }
                            >
                              <Pencil size={14} /> Rename
                            </Button>
                            {option.isActive ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                  const result = await deactivate.run(option.id)
                                  if (result.ok) options.reload()
                                  else
                                    app.toast({
                                      tone: 'error',
                                      title: 'Could not deactivate',
                                      detail: result.error
                                    })
                                }}
                              >
                                <Power size={14} />
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                onClick={async () => {
                                  const result = await save.run({
                                    id: option.id,
                                    listCode: option.listCode,
                                    value: option.value,
                                    valueBn: option.valueBn,
                                    isActive: true
                                  })
                                  if (result.ok) options.reload()
                                  else
                                    app.toast({
                                      tone: 'error',
                                      title: 'Could not restore',
                                      detail: result.error
                                    })
                                }}
                              >
                                Restore
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage ? (
        <div className="toolbar" style={{ marginTop: 'var(--space-3)' }}>
          <div className="toolbar__grow">
            <TextInput label="New entry" value={newValue} onValueChange={setNewValue} />
          </div>
          <TextInput label="In Bangla (optional)" value={newValueBn} onValueChange={setNewValueBn} />
          <Button variant="primary" onClick={() => void add()} loading={save.pending}>
            <Plus size={16} /> Add
          </Button>
        </div>
      ) : null}
    </Card>
  )
}

function ChartConditionsTab() {
  const conditions = useQuery('chart.conditions', undefined)
  if (conditions.loading) return <LoadingState />
  if (conditions.error) return <ErrorState message={conditions.error} onRetry={conditions.reload} />
  return (
    <Card title="Chart conditions" flush>
      <DataTable
        columns={[
          { key: 'code', header: 'Code', render: (row) => <span className="mono">{row.code}</span> },
          {
            key: 'name',
            header: 'Condition',
            render: (row) => (
              <span className="tooth-legend__item">
                <span className="tooth-legend__swatch" style={{ background: row.color }} aria-hidden="true" />
                {row.name}
              </span>
            )
          },
          { key: 'category', header: 'Category', render: (row) => row.category },
          { key: 'appliesTo', header: 'Applies to', render: (row) => row.appliesTo },
          {
            key: 'status',
            header: 'Status',
            render: (row) =>
              row.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Inactive</Badge>
          }
        ]}
        rows={conditions.data ?? []}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            title="No conditions configured"
            description="Chart conditions are seeded on first run."
          />
        }
      />
      <div className="card__footer">
        Condition colours are used on the dental chart and in its legend. Currently{' '}
        {conditions.data?.length ?? 0} condition(s) are available for charting.
      </div>
    </Card>
  )
}
