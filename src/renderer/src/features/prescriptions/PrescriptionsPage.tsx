/**
 * Prescriptions: the writing surface for structured prescriptions (C/C, O/E, R/E, Advice) with the full
 * multi-medicine model — type, strength, dose, morning/noon/night, before/after food, duration, quantity
 * and conditional instructions such as "if pain occurs". Rows can be reordered, and printing goes through
 * the shared print pipeline (preview → printer or PDF).
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Ban, Copy, FileText, Plus, Printer, Save, Trash2 } from 'lucide-react'
import type { Dentist, Prescription, PrescriptionInput, PrescriptionItem, Visit } from '@shared/types'
import { invoke } from '../../lib/api'
import { useApp } from '../../app/state'
import {
  Badge,
  Button,
  Card,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pagination,
  Select,
  TextArea,
  TextInput,
  useConfirm
} from '../../components/ui'
import { useAction, usePagination, useQuery } from '../../lib/hooks'
import { formatDate, prescriptionStatusLabel, statusTone, todayIso } from '../../lib/format'

type Mode = 'list' | 'editor'

interface MedicineDraft {
  medicineName: string
  medicineType: string
  strength: string
  dose: string
  morning: string
  noon: string
  night: string
  timing: string
  durationValue: string
  durationUnit: string
  quantity: string
  instruction: string
  conditionalInstruction: string
  notes: string
}

const EMPTY_MEDICINE: MedicineDraft = {
  medicineName: '',
  medicineType: '',
  strength: '',
  dose: '',
  morning: '',
  noon: '',
  night: '',
  timing: '',
  durationValue: '',
  durationUnit: '',
  quantity: '',
  instruction: '',
  conditionalInstruction: '',
  notes: ''
}

function draftToItem(draft: MedicineDraft, index: number): Omit<PrescriptionItem, 'id'> {
  return {
    sortOrder: index,
    medicineName: draft.medicineName.trim(),
    medicineType: draft.medicineType.trim() || null,
    strength: draft.strength.trim() || null,
    dose: draft.dose.trim() || null,
    morning: draft.morning.trim() || null,
    noon: draft.noon.trim() || null,
    night: draft.night.trim() || null,
    timing: draft.timing.trim() || null,
    durationValue: draft.durationValue.trim() === '' ? null : Number(draft.durationValue.trim()),
    durationUnit: draft.durationUnit.trim() || null,
    quantity: draft.quantity.trim() || null,
    instruction: draft.instruction.trim() || null,
    conditionalInstruction: draft.conditionalInstruction.trim() || null,
    notes: draft.notes.trim() || null
  }
}

function itemToDraft(item: PrescriptionItem): MedicineDraft {
  return {
    medicineName: item.medicineName,
    medicineType: item.medicineType ?? '',
    strength: item.strength ?? '',
    dose: item.dose ?? '',
    morning: item.morning ?? '',
    noon: item.noon ?? '',
    night: item.night ?? '',
    timing: item.timing ?? '',
    durationValue: item.durationValue == null ? '' : String(item.durationValue),
    durationUnit: item.durationUnit ?? '',
    quantity: item.quantity ?? '',
    instruction: item.instruction ?? '',
    conditionalInstruction: item.conditionalInstruction ?? '',
    notes: item.notes ?? ''
  }
}

function linesOf(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function PrescriptionsPage() {
  const app = useApp()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const pagination = usePagination(20)
  const [mode, setMode] = useState<Mode>('list')
  const [patientFilter, setPatientFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('')
  const [detailId, setDetailId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [presetPatientId, setPresetPatientId] = useState<number | null>(null)
  const [presetVisitId, setPresetVisitId] = useState<number | null>(null)

  const list = useQuery(
    'prescriptions.list',
    {
      page: pagination.page,
      pageSize: pagination.pageSize,
      patientId: patientFilter ? Number(patientFilter) : undefined,
      from: from || undefined,
      to: to || undefined,
      status: status || undefined
    },
    { deps: [pagination.page, pagination.pageSize, patientFilter, from, to, status] }
  )

  const detail = useQuery(
    'prescriptions.get',
    { id: detailId ?? 0 },
    { enabled: detailId !== null, deps: [detailId] }
  )
  const print = useAction(async (id: number) =>
    invoke('print.job', { documentType: 'prescription', entityId: id, mode: 'preview' })
  )
  const voidAction = useAction(async (id: number, reason: string) =>
    invoke('prescriptions.void', { id, reason })
  )

  useEffect(() => {
    if (params.get('new') === '1' && app.hasPermission('prescriptions.create')) {
      const patientId = params.get('patientId')
      const visitId = params.get('visitId')
      setPresetPatientId(patientId ? Number(patientId) : null)
      setPresetVisitId(visitId ? Number(visitId) : null)
      setEditingId(null)
      setMode('editor')
      const next = new URLSearchParams(params)
      next.delete('new')
      next.delete('patientId')
      next.delete('visitId')
      setParams(next, { replace: true })
    }
  }, [params, setParams, app])

  if (mode === 'editor') {
    return (
      <PrescriptionEditor
        prescriptionId={editingId}
        presetPatientId={presetPatientId}
        presetVisitId={presetVisitId}
        onClose={(savedId) => {
          setMode('list')
          setEditingId(null)
          setPresetPatientId(null)
          setPresetVisitId(null)
          list.reload()
          if (savedId) setDetailId(savedId)
        }}
      />
    )
  }

  return (
    <>
      <PageHeader
        title="Prescriptions"
        subtitle="Structured prescriptions with print, reprint and PDF output"
        actions={
          app.hasPermission('prescriptions.create') ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditingId(null)
                setPresetPatientId(null)
                setPresetVisitId(null)
                setMode('editor')
              }}
            >
              <Plus size={16} /> New prescription
            </Button>
          ) : null
        }
      />

      <Card>
        <div className="toolbar">
          <div className="toolbar__grow">
            <PatientPicker
              label="Patient"
              value={patientFilter}
              onValueChange={setPatientFilter}
              placeholder="Any patient"
            />
          </div>
          <TextInput label="From" type="date" value={from} onValueChange={setFrom} />
          <TextInput label="To" type="date" value={to} onValueChange={setTo} />
          <Select
            label="Status"
            value={status}
            onValueChange={setStatus}
            options={[
              { value: 'draft', label: 'Draft' },
              { value: 'final', label: 'Final' },
              { value: 'void', label: 'Void' }
            ]}
            placeholder="All"
          />
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
                key: 'date',
                header: 'Date',
                render: (row: Prescription) => formatDate(row.prescriptionDate)
              },
              {
                key: 'patient',
                header: 'Patient',
                render: (row: Prescription) => (
                  <span>
                    {row.patientName}{' '}
                    <span className="mono" style={{ color: 'var(--ink-500)' }}>
                      {row.patientCode}
                    </span>
                  </span>
                )
              },
              { key: 'dentist', header: 'Dentist', render: (row: Prescription) => row.dentistName },
              { key: 'diagnosis', header: 'Diagnosis', render: (row: Prescription) => row.diagnosis ?? '—' },
              {
                key: 'medicines',
                header: 'Medicines',
                align: 'right',
                render: (row: Prescription) => row.items.length
              },
              {
                key: 'printed',
                header: 'Printed',
                align: 'right',
                render: (row: Prescription) => row.printedCount
              },
              {
                key: 'status',
                header: 'Status',
                render: (row: Prescription) => (
                  <div>
                    <Badge tone={statusTone(row.status)}>{prescriptionStatusLabel(row.status)}</Badge>
                    {row.status === 'void' && row.voidReason ? (
                      <p className="text-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                        {row.voidReason}
                      </p>
                    ) : null}
                  </div>
                )
              },
              {
                key: 'actions',
                header: '',
                render: (row: Prescription) => (
                  <div className="toolbar" style={{ gap: 4 }}>
                    <Button size="sm" variant="ghost" onClick={() => setDetailId(row.id)}>
                      Open
                    </Button>
                    {app.hasPermission('prescriptions.print') && row.status !== 'void' ? (
                      <Button
                        size="sm"
                        title="Preview and print"
                        onClick={async () => {
                          const result = await print.run(row.id)
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
                    {app.hasPermission('prescriptions.edit') && row.status !== 'void' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Edit"
                        onClick={() => {
                          setEditingId(row.id)
                          setPresetPatientId(row.patientId)
                          setPresetVisitId(row.visitId)
                          setMode('editor')
                        }}
                      >
                        <FileText size={14} />
                      </Button>
                    ) : null}
                    {app.hasPermission('prescriptions.delete') && row.status !== 'void' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Void"
                        onClick={() =>
                          confirm({
                            title: 'Void this prescription?',
                            message:
                              'A void prescription stays in the record for audit purposes but is clearly marked and cannot be printed as an active prescription.',
                            tone: 'danger',
                            confirmLabel: 'Void prescription',
                            typeToConfirm: 'VOID',
                            requirePassword: app.settings?.requirePasswordOnDestructive ?? true,
                            reasonLabel: 'Reason for voiding this prescription',
                            onConfirm: async ({ reason }) => {
                              const result = await voidAction.run(row.id, reason)
                              if (result.ok) {
                                app.toast({ tone: 'success', title: 'Prescription voided' })
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
                title="No prescriptions yet"
                description="Prescriptions written in this clinic appear here, with reprint and PDF options."
                action={
                  app.hasPermission('prescriptions.create') ? (
                    <Button variant="primary" onClick={() => setMode('editor')}>
                      Write a prescription
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
          title="Prescription"
          onClose={() => setDetailId(null)}
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
              {app.hasPermission('prescriptions.print') && detail.data?.status !== 'void' ? (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={async () => {
                    if (!detail.data) return
                    const result = await print.run(detail.data.id)
                    if (!result.ok)
                      app.toast({ tone: 'error', title: 'Could not open the preview', detail: result.error })
                  }}
                >
                  <Printer size={14} /> Print / PDF
                </Button>
              ) : null}
            </>
          }
        >
          {detail.loading ? (
            <LoadingState />
          ) : detail.error ? (
            <ErrorState message={detail.error} onRetry={detail.reload} />
          ) : detail.data ? (
            <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
              <dl className="detail-list">
                <dt>Patient</dt>
                <dd>
                  {detail.data.patientName} ({detail.data.patientCode})
                </dd>
                <dt>Date</dt>
                <dd>{formatDate(detail.data.prescriptionDate)}</dd>
                <dt>Dentist</dt>
                <dd>{detail.data.dentistName}</dd>
                <dt>Status</dt>
                <dd>
                  <Badge tone={statusTone(detail.data.status)}>
                    {prescriptionStatusLabel(detail.data.status)}
                  </Badge>{' '}
                  · printed {detail.data.printedCount} time(s)
                  {detail.data.status === 'void' && detail.data.voidedAt ? (
                    <>
                      {' '}
                      · voided {formatDate(detail.data.voidedAt.slice(0, 10))} (
                      {detail.data.voidReason ?? 'no reason given'})
                    </>
                  ) : null}
                </dd>
              </dl>
              <Section title="C/C — Chief complaints" lines={detail.data.chiefComplaints} />
              <Section title="O/E — On examination" lines={detail.data.onExamination} />
              <Section title="Diagnosis" lines={detail.data.diagnosis ? [detail.data.diagnosis] : []} />
              <Section title="Advice" lines={detail.data.advice} />
              {detail.data.followUpDate ? (
                <p>
                  <strong>Follow-up:</strong> {formatDate(detail.data.followUpDate)}
                </p>
              ) : null}
              <table className="data-table data-table--compact">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Medicine</th>
                    <th>Dose</th>
                    <th>M/N/Nt</th>
                    <th>Food</th>
                    <th>Duration</th>
                    <th>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.items.map((item, index) => (
                    <tr key={item.id}>
                      <td>{index + 1}</td>
                      <td>
                        {item.medicineName}
                        {item.strength ? ` ${item.strength}` : ''}
                        {item.conditionalInstruction ? (
                          <div className="field__hint">({item.conditionalInstruction})</div>
                        ) : null}
                      </td>
                      <td>{item.dose ?? '—'}</td>
                      <td>
                        {[item.morning, item.noon, item.night].map((value) => value ?? '-').join(' / ')}
                      </td>
                      <td>{item.timing ?? '—'}</td>
                      <td>
                        {item.durationValue == null
                          ? '—'
                          : `${item.durationValue} ${item.durationUnit ?? ''}`}
                      </td>
                      <td>{item.quantity ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Drawer>
      ) : null}
    </>
  )
}

function Section({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <div>
      <strong>{title}</strong>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </div>
  )
}

function PrescriptionEditor({
  prescriptionId,
  presetPatientId,
  presetVisitId,
  onClose
}: {
  prescriptionId: number | null
  presetPatientId: number | null
  presetVisitId: number | null
  onClose: (savedId: number | null) => void
}) {
  const app = useApp()
  const [patientId, setPatientId] = useState<number>(presetPatientId ?? 0)
  const [patientLabel, setPatientLabel] = useState('')
  const [patientTerm, setPatientTerm] = useState('')
  const [dentistId, setDentistId] = useState('')
  const [visitId, setVisitId] = useState<number | null>(presetVisitId)
  const [prescriptionDate, setPrescriptionDate] = useState(todayIso())
  const [complaints, setComplaints] = useState('')
  const [examination, setExamination] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [advice, setAdvice] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [notes, setNotes] = useState('')
  const [medicines, setMedicines] = useState<MedicineDraft[]>([{ ...EMPTY_MEDICINE }])
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<number | null>(prescriptionId)

  const patients = useQuery(
    'patients.lookup',
    { term: patientTerm, limit: 10 },
    { enabled: patientTerm.trim().length >= 2, deps: [patientTerm] }
  )
  const dentists = useQuery('dentists.list', { includeInactive: false })
  const existing = useQuery(
    'prescriptions.get',
    { id: prescriptionId ?? 0 },
    { enabled: prescriptionId !== null, deps: [prescriptionId] }
  )
  const patientVisits = useQuery(
    'visits.list',
    { patientId: patientId || 0, page: 1, pageSize: 20 },
    { enabled: patientId > 0, deps: [patientId] }
  )
  const medicineTypes = useQuery('clinical.options', { listCode: 'medicine_type' })
  const medicineTimings = useQuery('clinical.options', { listCode: 'medicine_timing' })
  const medicineInstructions = useQuery('clinical.options', { listCode: 'medicine_instruction' })
  const durationUnits = useQuery('clinical.options', { listCode: 'duration_unit' })
  const complaintsList = useQuery('clinical.options', { listCode: 'chief_complaint' })
  const examinationsList = useQuery('clinical.options', { listCode: 'examination' })
  const adviceList = useQuery('clinical.options', { listCode: 'advice' })
  const diagnosesList = useQuery('clinical.options', { listCode: 'diagnosis' })

  const save = useAction(async (input: PrescriptionInput) => invoke('prescriptions.create', input))
  const update = useAction(async (id: number, input: PrescriptionInput) =>
    invoke('prescriptions.update', { id, input })
  )
  const print = useAction(async (id: number, mode: 'preview' | 'pdf') =>
    invoke('print.job', { documentType: 'prescription', entityId: id, mode })
  )

  useEffect(() => {
    if (!existing.data) return
    setPatientId(existing.data.patientId)
    setPatientLabel(`${existing.data.patientName} (${existing.data.patientCode})`)
    setDentistId(String(existing.data.dentistId))
    setVisitId(existing.data.visitId)
    setPrescriptionDate(existing.data.prescriptionDate)
    setComplaints(existing.data.chiefComplaints.join('\n'))
    setExamination(existing.data.onExamination.join('\n'))
    setDiagnosis(existing.data.diagnosis ?? '')
    setAdvice(existing.data.advice.join('\n'))
    setFollowUpDate(existing.data.followUpDate ?? '')
    setNotes(existing.data.notes ?? '')
    setMedicines(
      existing.data.items.length > 0 ? existing.data.items.map(itemToDraft) : [{ ...EMPTY_MEDICINE }]
    )
  }, [existing.data])

  useEffect(() => {
    if (patients.data && patients.data.length === 1 && patientTerm.trim().length >= 2) {
      const patient = patients.data[0]
      setPatientId(patient.id)
      setPatientLabel(`${patient.fullName} (${patient.code})`)
    }
  }, [patients.data, patientTerm])

  const dirty = useMemo(
    () =>
      patientId > 0 ||
      medicines.some((medicine) => medicine.medicineName.trim().length > 0) ||
      complaints.trim().length > 0 ||
      examination.trim().length > 0,
    [patientId, medicines, complaints, examination]
  )

  const canWrite = app.hasPermission(prescriptionId ? 'prescriptions.edit' : 'prescriptions.create')

  async function persist(mode: 'draft' | 'final'): Promise<void> {
    if (!canWrite) return
    if (patientId <= 0) {
      setError('Choose the patient this prescription is for.')
      return
    }
    if (!dentistId) {
      setError('Choose the prescribing dentist.')
      return
    }
    const invalid = medicines.find(
      (medicine) => medicine.medicineName.trim().length === 0 && hasAnyMedicineField(medicine)
    )
    if (invalid) {
      setError('Every medicine row needs a medicine name (or remove the empty row).')
      return
    }
    const items = medicines
      .filter((medicine) => medicine.medicineName.trim().length > 0)
      .map((medicine, index) => draftToItem(medicine, index))

    const input: PrescriptionInput = {
      patientId,
      visitId,
      dentistId: Number(dentistId),
      prescriptionDate,
      chiefComplaints: linesOf(complaints),
      onExamination: linesOf(examination),
      diagnosis: diagnosis.trim() || null,
      advice: linesOf(advice),
      followUpDate: followUpDate || null,
      notes: notes.trim() || null,
      status: mode,
      items
    }

    setError(null)
    const result = savedId ? await update.run(savedId, input) : await save.run(input)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const record = result.value
    setSavedId(record.id)
    app.toast({
      tone: 'success',
      title: mode === 'final' ? 'Prescription finalised' : 'Draft saved',
      detail: mode === 'final' ? undefined : 'It stays editable until you finalise it.'
    })
    if (mode === 'final') {
      const printed = await print.run(record.id, 'preview')
      if (!printed.ok)
        app.toast({ tone: 'error', title: 'Could not open the preview', detail: printed.error })
    } else {
      onClose(record.id)
    }
  }

  function hasAnyMedicineField(draft: MedicineDraft): boolean {
    return Object.values(draft).some((value) => value.trim().length > 0)
  }

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction
    if (target < 0 || target >= medicines.length) return
    const next = [...medicines]
    const [row] = next.splice(index, 1)
    next.splice(target, 0, row as MedicineDraft)
    setMedicines(next)
  }

  return (
    <>
      <PageHeader
        title={savedId ? 'Edit prescription' : 'New prescription'}
        subtitle="C/C, O/E, R/E and advice, with a complete medicine table"
        actions={
          <>
            <Button onClick={() => onClose(savedId)}>Back to list</Button>
            {canWrite ? (
              <>
                <Button loading={save.pending || update.pending} onClick={() => void persist('draft')}>
                  <Save size={16} /> Save draft
                </Button>
                <Button variant="primary" loading={print.pending} onClick={() => void persist('final')}>
                  <Printer size={16} /> Finalise &amp; preview
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <Card title="Patient and visit">
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
              placeholder="Type at least 2 characters of the name, code or phone"
            />
            {patients.data && patients.data.length > 0 && patientId === 0 ? (
              <div className="card" style={{ maxHeight: 180, overflowY: 'auto' }}>
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
                      {patient.phone ? ` · ${patient.phone}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <Select
            label="Dentist"
            required
            value={dentistId}
            onValueChange={setDentistId}
            options={(dentists.data ?? []).map((dentist: Dentist) => ({
              value: String(dentist.id),
              label: dentist.fullName
            }))}
            placeholder="Choose the prescribing dentist"
          />
          <TextInput label="Date" type="date" value={prescriptionDate} onValueChange={setPrescriptionDate} />
          <Select
            label="Related visit"
            value={visitId ? String(visitId) : ''}
            onValueChange={(value) => setVisitId(value ? Number(value) : null)}
            options={(patientVisits.data?.rows ?? []).map((visit: Visit) => ({
              value: String(visit.id),
              label: `#${visit.visitNo} · ${formatDate(visit.visitDate)} · ${visit.dentistName}`
            }))}
            placeholder="Not linked"
            disabled={patientId === 0}
          />
        </div>
      </Card>

      <Card title="Clinical notes">
        <div className="form-grid form-grid--wide">
          <div>
            <TextArea
              label="C/C — Chief complaints (one per line)"
              rows={3}
              value={complaints}
              onValueChange={setComplaints}
              hint="Each line becomes a numbered point on the printed prescription."
            />
            <ClinicalSuggestions
              options={complaintsList.data ?? []}
              onPick={(value) => setComplaints((current) => (current ? `${current}\n${value}` : value))}
            />
          </div>
          <div>
            <TextArea
              label="O/E — On examination (one per line)"
              rows={3}
              value={examination}
              onValueChange={setExamination}
            />
            <ClinicalSuggestions
              options={examinationsList.data ?? []}
              onPick={(value) => setExamination((current) => (current ? `${current}\n${value}` : value))}
            />
          </div>
          <div>
            <TextArea label="R/E — Diagnosis" rows={3} value={diagnosis} onValueChange={setDiagnosis} />
            <ClinicalSuggestions
              options={diagnosesList.data ?? []}
              onPick={(value) => setDiagnosis((current) => (current ? `${current}\n${value}` : value))}
            />
          </div>
          <div>
            <TextArea label="Advice (one per line)" rows={3} value={advice} onValueChange={setAdvice} />
            <ClinicalSuggestions
              options={adviceList.data ?? []}
              onPick={(value) => setAdvice((current) => (current ? `${current}\n${value}` : value))}
            />
          </div>
          <TextInput
            label="Follow-up date"
            type="date"
            value={followUpDate}
            onValueChange={setFollowUpDate}
          />
          <TextArea
            label="Internal notes"
            rows={2}
            value={notes}
            onValueChange={setNotes}
            hint="Not printed on the prescription."
          />
        </div>
      </Card>

      <Card
        title="Rx — Medicines"
        actions={
          <Button size="sm" onClick={() => setMedicines([...medicines, { ...EMPTY_MEDICINE }])}>
            <Plus size={14} /> Add medicine
          </Button>
        }
      >
        {medicines.map((medicine, index) => (
          <div
            key={index}
            className="card"
            style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-2)' }}
          >
            <div className="toolbar" style={{ marginBottom: 'var(--space-2)' }}>
              <strong>Medicine {index + 1}</strong>
              <div className="toolbar__grow" />
              <Button
                size="sm"
                variant="ghost"
                title="Move up"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={14} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Move down"
                disabled={index === medicines.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={14} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Duplicate"
                onClick={() => {
                  const next = [...medicines]
                  next.splice(index + 1, 0, { ...medicine })
                  setMedicines(next)
                }}
              >
                <Copy size={14} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Remove"
                onClick={() => {
                  const next = medicines.filter((_, position) => position !== index)
                  setMedicines(next.length > 0 ? next : [{ ...EMPTY_MEDICINE }])
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
            <div className="form-grid form-grid--wide">
              <TextInput
                label="Medicine"
                required
                value={medicine.medicineName}
                onValueChange={(value) =>
                  setMedicines(
                    medicines.map((entry, position) =>
                      position === index ? { ...entry, medicineName: value } : entry
                    )
                  )
                }
              />
              <Select
                label="Type"
                value={medicine.medicineType}
                onValueChange={(value) =>
                  setMedicines(
                    medicines.map((entry, position) =>
                      position === index ? { ...entry, medicineType: value } : entry
                    )
                  )
                }
                options={(medicineTypes.data ?? []).map((option) => ({
                  value: option.value,
                  label: option.value
                }))}
                placeholder="Not specified"
              />
              <TextInput
                label="Strength"
                value={medicine.strength}
                onValueChange={(value) =>
                  setMedicines(
                    medicines.map((entry, position) =>
                      position === index ? { ...entry, strength: value } : entry
                    )
                  )
                }
                placeholder="500 mg"
              />
              <TextInput
                label="Dose"
                value={medicine.dose}
                onValueChange={(value) =>
                  setMedicines(
                    medicines.map((entry, position) =>
                      position === index ? { ...entry, dose: value } : entry
                    )
                  )
                }
                placeholder="1 tablet"
              />
              <TextInput
                label="Morning"
                value={medicine.morning}
                onValueChange={(value) =>
                  setMedicines(
                    medicines.map((entry, position) =>
                      position === index ? { ...entry, morning: value } : entry
                    )
                  )
                }
                placeholder="1"
              />
              <TextInput
                label="Noon"
                value={medicine.noon}
                onValueChange={(value) =>
                  setMedicines(
                    medicines.map((entry, position) =>
                      position === index ? { ...entry, noon: value } : entry
                    )
                  )
                }
                placeholder="—"
              />
              <TextInput
                label="Night"
                value={medicine.night}
                onValueChange={(value) =>
                  setMedicines(
                    medicines.map((entry, position) =>
                      position === index ? { ...entry, night: value } : entry
                    )
                  )
                }
                placeholder="1"
              />
              <Select
                label="Before / after food"
                value={medicine.timing}
                onValueChange={(value) =>
                  setMedicines(
                    medicines.map((entry, position) =>
                      position === index ? { ...entry, timing: value } : entry
                    )
                  )
                }
                options={(medicineTimings.data ?? []).map((option) => ({
                  value: option.value,
                  label: option.value
                }))}
                placeholder="Not specified"
              />
              <TextInput
                label="Duration"
                value={medicine.durationValue}
                onValueChange={(value) =>
                  setMedicines(
                    medicines.map((entry, position) =>
                      position === index ? { ...entry, durationValue: value.replace(/[^\d]/g, '') } : entry
                    )
                  )
                }
                placeholder="5"
              />
              <Select
                label="Duration unit"
                value={medicine.durationUnit}
                onValueChange={(value) =>
                  setMedicines(
                    medicines.map((entry, position) =>
                      position === index ? { ...entry, durationUnit: value } : entry
                    )
                  )
                }
                options={(durationUnits.data ?? []).map((option) => ({
                  value: option.value,
                  label: option.value
                }))}
                placeholder="—"
              />
              <TextInput
                label="Quantity"
                value={medicine.quantity}
                onValueChange={(value) =>
                  setMedicines(
                    medicines.map((entry, position) =>
                      position === index ? { ...entry, quantity: value } : entry
                    )
                  )
                }
                placeholder="10 tablets"
              />
              <TextInput
                label="Conditional instruction"
                value={medicine.conditionalInstruction}
                onValueChange={(value) =>
                  setMedicines(
                    medicines.map((entry, position) =>
                      position === index ? { ...entry, conditionalInstruction: value } : entry
                    )
                  )
                }
                placeholder="if pain occurs"
                hint="Printed under the medicine name, exactly as written."
                list="medicine-instruction-options"
              />
              <datalist id="medicine-instruction-options">
                {(medicineInstructions.data ?? []).map((option) => (
                  <option key={option.id} value={option.value} />
                ))}
              </datalist>
              <TextInput
                label="Instruction"
                value={medicine.instruction}
                onValueChange={(value) =>
                  setMedicines(
                    medicines.map((entry, position) =>
                      position === index ? { ...entry, instruction: value } : entry
                    )
                  )
                }
                placeholder="Take with plenty of water"
              />
              <TextArea
                label="Notes"
                rows={2}
                value={medicine.notes}
                onValueChange={(value) =>
                  setMedicines(
                    medicines.map((entry, position) =>
                      position === index ? { ...entry, notes: value } : entry
                    )
                  )
                }
              />
            </div>
          </div>
        ))}

        <p className="field__hint">
          Rows without a medicine name are ignored when saving. Use the arrows to change the printed order.
        </p>
      </Card>

      {savedId ? (
        <Card title="Print">
          <div className="toolbar">
            <Button onClick={() => void print.run(savedId, 'preview')}>
              <Printer size={16} /> Preview
            </Button>
            <Button onClick={() => void print.run(savedId, 'pdf')}>Save as PDF</Button>
            <span className="field__hint">
              Printing uses the paper and printer profiles configured in Settings → Printing. The signature
              area is left blank on the sheet.
            </span>
          </div>
        </Card>
      ) : null}

      {dirty ? null : (
        <p className="field__hint">
          Tip: choose the patient and dentist first, then add medicines. Nothing is saved until you press
          Save.
        </p>
      )}
    </>
  )
}

/** Quick-pick list of the clinical option values seeded in the database (editable in Settings). */
function ClinicalSuggestions({
  options,
  onPick
}: {
  options: { id: number; value: string }[]
  onPick: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (options.length === 0) return null
  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        className="button button--ghost button--sm"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide suggestions' : `Suggestions (${options.length})`}
      </button>
      {open ? (
        <div className="toolbar" style={{ flexWrap: 'wrap', marginTop: 4 }}>
          {options.slice(0, 24).map((option) => (
            <Button key={option.id} size="sm" onClick={() => onPick(option.value)}>
              {option.value}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Patient filter used by the prescription list. */
function PatientPicker({
  label,
  value,
  onValueChange,
  placeholder
}: {
  label: string
  value: string
  onValueChange: (value: string) => void
  placeholder: string
}) {
  const [term, setTerm] = useState('')
  const [selectedLabel, setSelectedLabel] = useState('')
  const lookup = useQuery(
    'patients.lookup',
    { term, limit: 8 },
    { enabled: term.trim().length >= 2, deps: [term] }
  )

  return (
    <div>
      <TextInput
        label={label}
        value={selectedLabel || term}
        onValueChange={(next) => {
          setTerm(next)
          setSelectedLabel('')
          if (value) onValueChange('')
        }}
        placeholder={placeholder ? `${placeholder} — type to search` : 'Type to search'}
      />
      {lookup.data && lookup.data.length > 0 && selectedLabel === '' ? (
        <div className="card" style={{ maxHeight: 160, overflowY: 'auto' }}>
          {lookup.data.map((patient) => (
            <button
              key={patient.id}
              type="button"
              className="nav-item"
              onClick={() => {
                onValueChange(String(patient.id))
                setSelectedLabel(`${patient.fullName} (${patient.code})`)
                setTerm('')
              }}
            >
              <span className="nav-item__label">
                {patient.fullName} · <span className="mono">{patient.code}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {value ? (
        <button
          type="button"
          className="button button--ghost button--sm"
          style={{ marginTop: 4 }}
          onClick={() => {
            onValueChange('')
            setSelectedLabel('')
          }}
        >
          Clear patient filter
        </button>
      ) : null}
    </div>
  )
}
