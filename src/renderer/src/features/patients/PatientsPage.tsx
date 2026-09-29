/**
 * Patient register: newest first by default, with preset and custom date ranges, search, pagination and
 * the registration/editing form. Every filter is applied in SQL (never in the browser), so 10 000+
 * patients stay fast.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Archive, FileDown, Plus, RefreshCw, Search, UserPlus } from 'lucide-react'
import type { Patient, PatientInput, PatientSummary } from '@shared/types'
import type { Gender } from '@shared/constants'
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
  PageHeader,
  Pagination,
  SegmentedControl,
  Select,
  TextArea,
  TextInput,
  useConfirm
} from '../../components/ui'
import { useAction, usePagination, useQuery } from '../../lib/hooks'
import { formatDate, patientAgeText, todayIso } from '../../lib/format'
import { GENDER_LABELS } from '@shared/constants'

type RangePreset = 'today' | 'last7' | 'last30' | 'last90' | 'lastYear' | 'custom' | 'all'

const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'last7', label: '7 days' },
  { value: 'last30', label: '30 days' },
  { value: 'last90', label: '90 days' },
  { value: 'lastYear', label: '1 year' },
  { value: 'custom', label: 'Custom' }
]

const GENDER_OPTIONS = (Object.keys(GENDER_LABELS) as Gender[]).map((value) => ({
  value,
  label: GENDER_LABELS[value]
}))

const EMPTY_PATIENT: PatientInput = {
  fullName: '',
  fullNameBn: null,
  dateOfBirth: null,
  ageYears: null,
  gender: null,
  bloodGroup: null,
  phone: '',
  phoneAlt: null,
  email: null,
  address: null,
  addressBn: null,
  city: null,
  occupation: null,
  maritalStatus: null,
  nationalId: null,
  guardianName: null,
  emergencyName: null,
  emergencyPhone: null,
  relationship: null,
  referralSource: null,
  chiefComplaint: null,
  medicalHistory: null,
  dentalHistory: null,
  allergies: null,
  currentMedications: null,
  notes: null,
  isActive: true
}

export function PatientForm({
  initial,
  onSaved,
  onCancel
}: {
  initial: { id: number; input: PatientInput } | null
  onSaved: (patient: Patient) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<PatientInput>(initial?.input ?? EMPTY_PATIENT)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ field: string; message: string }[]>([])

  const save = useAction(async (input: PatientInput) => {
    if (initial) return invoke('patients.update', { id: initial.id, input })
    return invoke('patients.create', input)
  })

  function patch(changes: Partial<PatientInput>): void {
    setForm((current) => ({ ...current, ...changes }))
  }

  async function submit(): Promise<void> {
    setError(null)
    setFieldErrors([])
    if (form.fullName.trim().length < 3) {
      setError('Enter the patient’s full name.')
      return
    }
    if (form.phone.trim().length < 6) {
      setError('Enter a contact phone number — it is used for reminders and search.')
      return
    }
    const result = await save.run(form)
    if (result.ok) {
      onSaved(result.value)
    } else {
      setError(result.error)
      setFieldErrors(
        result.error
          .split(';')
          .filter((entry) => entry.includes(':'))
          .map((entry) => {
            const [field, ...rest] = entry.split(':')
            return { field: (field ?? '').trim(), message: rest.join(':').trim() }
          })
      )
    }
  }

  const fieldError = (field: keyof PatientInput): string | null =>
    fieldErrors.find((issue) => issue.field === field)?.message ?? null

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <h4>Identity</h4>
      <div className="form-grid form-grid--wide">
        <TextInput
          label="Full name"
          required
          value={form.fullName}
          onValueChange={(value) => patch({ fullName: value })}
          error={fieldError('fullName')}
        />
        <TextInput
          label="Name in Bangla"
          value={form.fullNameBn ?? ''}
          onValueChange={(value) => patch({ fullNameBn: value || null })}
          hint="Optional, printed on prescriptions."
        />
        <TextInput
          label="Date of birth"
          type="date"
          value={form.dateOfBirth ?? ''}
          onValueChange={(value) => patch({ dateOfBirth: value || null })}
        />
        <TextInput
          label="Age (if date of birth is unknown)"
          value={form.ageYears == null ? '' : String(form.ageYears)}
          onValueChange={(value) =>
            patch({ ageYears: value === '' ? null : Number(value.replace(/\D/g, '')) })
          }
        />
        <Select
          label="Gender"
          value={form.gender ?? ''}
          onValueChange={(value) => patch({ gender: (value || null) as Gender | null })}
          options={GENDER_OPTIONS}
          placeholder="Not recorded"
        />
        <TextInput
          label="Blood group"
          value={form.bloodGroup ?? ''}
          onValueChange={(value) => patch({ bloodGroup: value || null })}
        />
      </div>

      <h4>Contact</h4>
      <div className="form-grid form-grid--wide">
        <TextInput
          label="Phone"
          required
          value={form.phone}
          onValueChange={(value) => patch({ phone: value })}
          error={fieldError('phone')}
        />
        <TextInput
          label="Alternative phone"
          value={form.phoneAlt ?? ''}
          onValueChange={(value) => patch({ phoneAlt: value || null })}
        />
        <TextInput
          label="Email"
          value={form.email ?? ''}
          onValueChange={(value) => patch({ email: value || null })}
        />
        <TextInput
          label="City"
          value={form.city ?? ''}
          onValueChange={(value) => patch({ city: value || null })}
        />
        <TextInput
          label="Address"
          value={form.address ?? ''}
          onValueChange={(value) => patch({ address: value || null })}
          full
        />
        <TextInput
          label="Address in Bangla"
          value={form.addressBn ?? ''}
          onValueChange={(value) => patch({ addressBn: value || null })}
          full
        />
        <TextInput
          label="Occupation"
          value={form.occupation ?? ''}
          onValueChange={(value) => patch({ occupation: value || null })}
        />
        <TextInput
          label="Marital status"
          value={form.maritalStatus ?? ''}
          onValueChange={(value) => patch({ maritalStatus: value || null })}
        />
        <TextInput
          label="National ID / passport"
          value={form.nationalId ?? ''}
          onValueChange={(value) => patch({ nationalId: value || null })}
        />
      </div>

      <h4>Emergency contact and referral</h4>
      <div className="form-grid form-grid--wide">
        <TextInput
          label="Guardian name"
          value={form.guardianName ?? ''}
          onValueChange={(value) => patch({ guardianName: value || null })}
        />
        <TextInput
          label="Emergency contact"
          value={form.emergencyName ?? ''}
          onValueChange={(value) => patch({ emergencyName: value || null })}
        />
        <TextInput
          label="Emergency phone"
          value={form.emergencyPhone ?? ''}
          onValueChange={(value) => patch({ emergencyPhone: value || null })}
        />
        <TextInput
          label="Relationship"
          value={form.relationship ?? ''}
          onValueChange={(value) => patch({ relationship: value || null })}
        />
        <TextInput
          label="Referral source"
          value={form.referralSource ?? ''}
          onValueChange={(value) => patch({ referralSource: value || null })}
          hint="How the patient heard about the clinic."
        />
      </div>

      <h4>Clinical background</h4>
      <div className="form-grid form-grid--wide">
        <TextInput
          label="Main complaint"
          value={form.chiefComplaint ?? ''}
          onValueChange={(value) => patch({ chiefComplaint: value || null })}
          full
        />
        <TextArea
          label="Medical history"
          rows={2}
          value={form.medicalHistory ?? ''}
          onValueChange={(value) => patch({ medicalHistory: value || null })}
        />
        <TextArea
          label="Dental history"
          rows={2}
          value={form.dentalHistory ?? ''}
          onValueChange={(value) => patch({ dentalHistory: value || null })}
        />
        <TextArea
          label="Allergies"
          rows={2}
          value={form.allergies ?? ''}
          onValueChange={(value) => patch({ allergies: value || null })}
          hint="Shown prominently in the patient header."
        />
        <TextArea
          label="Current medications"
          rows={2}
          value={form.currentMedications ?? ''}
          onValueChange={(value) => patch({ currentMedications: value || null })}
        />
        <TextArea
          label="Notes"
          rows={2}
          value={form.notes ?? ''}
          onValueChange={(value) => patch({ notes: value || null })}
          full
        />
      </div>

      <div className="toolbar">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={() => void submit()} loading={save.pending}>
          {initial ? 'Save changes' : 'Register patient'}
        </Button>
      </div>
    </div>
  )
}

export function PatientsPage() {
  const app = useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const confirm = useConfirm()
  const pagination = usePagination(25)
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<RangePreset>('all')
  const [customFrom, setCustomFrom] = useState(todayIso())
  const [customTo, setCustomTo] = useState(todayIso())
  const [gender, setGender] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<{ id: number; input: PatientInput } | null>(null)
  const [editingSummary, setEditingSummary] = useState<PatientSummary | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const query = useMemo(
    () => ({
      page: pagination.page,
      pageSize: pagination.pageSize,
      search: search.trim() || null,
      range,
      from: range === 'custom' ? customFrom : undefined,
      to: range === 'custom' ? customTo : undefined,
      includeArchived: showArchived
    }),
    [pagination.page, pagination.pageSize, search, range, customFrom, customTo, showArchived]
  )

  const list = useQuery('patients.list', query, {
    deps: [JSON.stringify(query)]
  })

  const archive = useAction(async (id: number) => invoke('patients.archive', { id }))
  const loadPatient = useAction(async (id: number) => invoke('patients.get', { id }))

  useEffect(() => {
    if (params.get('new') === '1' && app.hasPermission('patients.create')) {
      setEditing(null)
      setEditingSummary(null)
      setFormOpen(true)
      params.delete('new')
      setParams(params, { replace: true })
    }
  }, [params, setParams, app])

  async function startEdit(row: PatientSummary): Promise<void> {
    const loaded = await loadPatient.run(row.id)
    if (!loaded.ok) return
    const patient = loaded.value
    setEditingSummary(row)
    setEditing({
      id: patient.id,
      input: {
        fullName: patient.fullName,
        fullNameBn: patient.fullNameBn,
        dateOfBirth: patient.dateOfBirth,
        ageYears: patient.ageYears,
        gender: patient.gender,
        bloodGroup: patient.bloodGroup,
        phone: patient.phone,
        phoneAlt: patient.phoneAlt,
        email: patient.email,
        address: patient.address,
        addressBn: patient.addressBn,
        city: patient.city,
        occupation: patient.occupation,
        maritalStatus: patient.maritalStatus,
        nationalId: patient.nationalId,
        guardianName: patient.guardianName,
        emergencyName: patient.emergencyName,
        emergencyPhone: patient.emergencyPhone,
        relationship: patient.relationship,
        referralSource: patient.referralSource,
        chiefComplaint: patient.chiefComplaint,
        medicalHistory: patient.medicalHistory,
        dentalHistory: patient.dentalHistory,
        allergies: patient.allergies,
        currentMedications: patient.currentMedications,
        notes: patient.notes,
        isActive: patient.isActive
      }
    })
    setFormOpen(true)
  }

  async function exportList(): Promise<void> {
    if (!app.hasPermission('data.export')) {
      app.toast({ tone: 'warning', title: 'Export not allowed', detail: 'Your role cannot export data.' })
      return
    }
    const folder = await invoke('export.chooseFolder', {
      title: 'Choose a folder for the export',
      suggestedName: 'Dentiva Pro export'
    })
    if (!folder) return
    try {
      const result = await invoke('export.data', { entity: 'patients', format: 'csv', targetFolder: folder })
      app.toast({ tone: 'success', title: `Exported ${result.rowCount} patient(s)`, detail: result.filePath })
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
        title="Patients"
        subtitle="Newest registrations first · search by name, code, phone or complaint"
        actions={
          <>
            <Button onClick={() => list.reload()}>
              <RefreshCw size={16} /> Refresh
            </Button>
            {app.hasPermission('data.export') ? (
              <Button onClick={() => void exportList()}>
                <FileDown size={16} /> Export CSV
              </Button>
            ) : null}
            {app.hasPermission('patients.create') ? (
              <Button
                variant="primary"
                onClick={() => {
                  setEditing(null)
                  setEditingSummary(null)
                  setFormOpen(true)
                }}
              >
                <UserPlus size={16} /> New patient
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <div className="toolbar" style={{ marginBottom: 'var(--space-3)' }}>
          <div className="toolbar__grow">
            <TextInput
              label="Search"
              value={search}
              onValueChange={(value) => {
                setSearch(value)
                pagination.reset()
              }}
              placeholder="Name, patient code, phone, complaint…"
            />
          </div>
          <Select
            label="Gender"
            value={gender}
            onValueChange={(value) => {
              setGender(value)
              pagination.reset()
            }}
            options={GENDER_OPTIONS}
            placeholder="Any"
          />
          <div>
            <span className="field__label">Registered</span>
            <SegmentedControl
              value={range}
              onChange={(value) => {
                setRange(value)
                pagination.reset()
              }}
              options={RANGE_OPTIONS}
            />
          </div>
          {range === 'custom' ? (
            <>
              <TextInput label="From" type="date" value={customFrom} onValueChange={setCustomFrom} />
              <TextInput label="To" type="date" value={customTo} onValueChange={setCustomTo} />
            </>
          ) : null}
          <label className="checkbox" style={{ marginTop: 18 }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Include archived
          </label>
        </div>
      </Card>

      <Card flush>
        {list.loading ? (
          <LoadingState label="Loading patients…" />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : (
          <DataTable
            columns={[
              {
                key: 'code',
                header: 'Patient ID',
                width: '120px',
                render: (row) => <span className="mono">{row.code}</span>
              },
              {
                key: 'name',
                header: 'Name',
                render: (row) => (
                  <span>
                    <strong>{row.fullName}</strong>
                    {row.fullNameBn ? (
                      <span
                        lang="bn"
                        style={{ display: 'block', color: 'var(--ink-500)', fontSize: 'var(--text-xs)' }}
                      >
                        {row.fullNameBn}
                      </span>
                    ) : null}
                  </span>
                )
              },
              {
                key: 'age',
                header: 'Age / sex',
                render: (row) => `${patientAgeText(row)}${row.gender ? ` · ${row.gender}` : ''}`
              },
              { key: 'phone', header: 'Phone', render: (row) => row.phone },
              {
                key: 'registered',
                header: 'Registered',
                render: (row) => formatDate(row.createdAt.slice(0, 10))
              },
              {
                key: 'lastVisit',
                header: 'Last visit',
                render: (row) => (row.lastVisitDate ? formatDate(row.lastVisitDate) : '—')
              },
              {
                key: 'due',
                header: 'Due',
                align: 'right',
                render: (row) =>
                  row.outstandingPoisha > 0 ? (
                    <Money poisha={row.outstandingPoisha} />
                  ) : (
                    <Badge tone="success">Clear</Badge>
                  )
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) =>
                  row.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Archived</Badge>
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) => (
                  <div className="toolbar" style={{ gap: 4 }}>
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/patients/${row.id}`)}>
                      Open
                    </Button>
                    {app.hasPermission('patients.edit') ? (
                      <Button size="sm" variant="ghost" onClick={() => void startEdit(row)}>
                        Edit
                      </Button>
                    ) : null}
                    {app.hasPermission('patients.delete') && row.isActive ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Archive patient"
                        onClick={() =>
                          confirm({
                            title: 'Archive this patient?',
                            message: `${row.fullName} (${row.code}) will be hidden from the active register. Clinical and financial history is kept and can be restored later.`,
                            confirmLabel: 'Archive patient',
                            tone: 'danger',
                            onConfirm: async () => {
                              const result = await archive.run(row.id)
                              if (result.ok) {
                                app.toast({ tone: 'success', title: 'Patient archived' })
                                list.reload()
                              } else {
                                app.toast({ tone: 'error', title: 'Could not archive', detail: result.error })
                              }
                            }
                          })
                        }
                      >
                        <Archive size={14} />
                      </Button>
                    ) : null}
                  </div>
                )
              }
            ]}
            rows={list.data?.rows ?? []}
            rowKey={(row) => row.id}
            onRowClick={(row) => navigate(`/patients/${row.id}`)}
            empty={
              <EmptyState
                title={search.trim() ? 'No patients match this search' : 'No patients yet'}
                description={
                  search.trim()
                    ? 'Try a different name, code or phone number.'
                    : 'Register the first patient to begin.'
                }
                action={
                  app.hasPermission('patients.create') ? (
                    <Button variant="primary" onClick={() => setFormOpen(true)}>
                      <Plus size={16} /> Register patient
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

      <p className="field__hint">
        <Search size={12} style={{ verticalAlign: 'middle' }} /> Tip: press Ctrl+K anywhere to search
        patients, invoices and prescriptions at once.
      </p>

      {formOpen ? (
        <Modal
          title={editing ? `Edit ${editingSummary?.fullName ?? 'patient'}` : 'Register a new patient'}
          size="lg"
          onClose={() => {
            setFormOpen(false)
            setEditing(null)
          }}
        >
          <PatientForm
            initial={editing}
            onCancel={() => {
              setFormOpen(false)
              setEditing(null)
            }}
            onSaved={(patient) => {
              app.toast({
                tone: 'success',
                title: editing ? 'Patient updated' : `Patient ${patient.code} registered`
              })
              setFormOpen(false)
              setEditing(null)
              list.reload()
              if (!editing) navigate(`/patients/${patient.id}`)
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}
