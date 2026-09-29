/**
 * Patient record: everything about one patient in one place.
 *
 * Tabs: overview, dental chart, timeline, visits, prescriptions, invoices, payments, referrals and
 * attachments. Every tab loads its own data from the database, so opening a patient on a slow machine
 * stays responsive.
 */

import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FileUp, FolderOpen, Paperclip, Plus, Printer, Trash2 } from 'lucide-react'
import type {
  Attachment,
  Invoice,
  Patient,
  PatientInput,
  Prescription,
  Referral,
  ReferralInput,
  Visit,
  VisitInput
} from '@shared/types'
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
  ProgressBar,
  Select,
  Tabs,
  TextArea,
  TextInput,
  useConfirm
} from '../../components/ui'
import { useAction, usePagination, useQuery } from '../../lib/hooks'
import {
  amountInput,
  filesize,
  formatDate,
  formatTime12h,
  invoiceStatusLabel,
  money,
  parseMoneyInput,
  patientAgeText,
  prescriptionStatusLabel,
  referralStatusLabel,
  statusTone,
  todayIso,
  visitStatusLabel
} from '../../lib/format'
import { PERMANENT_TEETH, PRIMARY_TEETH, toothShortLabel } from '@shared/dental'
import { PatientForm } from './PatientsPage'
import { DentalChart } from './DentalChart'

type Tab =
  | 'overview'
  | 'chart'
  | 'timeline'
  | 'visits'
  | 'prescriptions'
  | 'invoices'
  | 'payments'
  | 'referrals'
  | 'attachments'

const TAB_OPTIONS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'chart', label: 'Dental chart' },
  { value: 'timeline', label: 'Timeline' },
  { value: 'visits', label: 'Visits' },
  { value: 'prescriptions', label: 'Prescriptions' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'payments', label: 'Payments' },
  { value: 'referrals', label: 'Referrals' },
  { value: 'attachments', label: 'Attachments' }
]

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const patientId = Number(id ?? 0)
  const app = useApp()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')
  const [editOpen, setEditOpen] = useState(false)

  const profile = useQuery(
    'patients.profile',
    { id: patientId },
    { enabled: patientId > 0, deps: [patientId] }
  )

  if (!patientId) return <ErrorState message="No patient was selected." />
  if (profile.loading) return <LoadingState label="Loading the patient record…" />
  if (profile.error) return <ErrorState message={profile.error} onRetry={profile.reload} />
  if (!profile.data)
    return <EmptyState title="Patient not found" description="The record may have been removed." />

  const { patient, financial, counts, lastVisit, upcomingAppointments } = profile.data

  const editInput: PatientInput = {
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

  return (
    <>
      <PageHeader
        title={patient.fullName}
        subtitle={`${patient.code} · ${patientAgeText(patient)}${patient.gender ? ` · ${patient.gender}` : ''} · ${patient.phone}`}
        actions={
          <>
            <Button onClick={() => navigate('/patients')}>Back to list</Button>
            {app.hasPermission('patients.edit') ? (
              <Button onClick={() => setEditOpen(true)}>Edit record</Button>
            ) : null}
            {app.hasPermission('visits.create') ? (
              <Button variant="primary" onClick={() => navigate(`/patients/${patientId}?new-visit=1`)}>
                <Plus size={16} /> New visit
              </Button>
            ) : null}
          </>
        }
      />

      {patient.allergies ? (
        <Card>
          <div className="toolbar">
            <Badge tone="danger">Allergies</Badge>
            <span>{patient.allergies}</span>
          </div>
        </Card>
      ) : null}

      <div className="grid grid--4">
        <Card title="Balance">
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }} className="numeric">
            {money(financial?.balancePoisha ?? 0)}
          </div>
          <p className="field__hint">
            Invoiced {money(financial?.totalInvoicedPoisha ?? 0)} · paid{' '}
            {money(financial?.totalPaidPoisha ?? 0)}
          </p>
          {(financial?.balancePoisha ?? 0) > 0 ? (
            <ProgressBar
              value={financial?.totalPaidPoisha ?? 0}
              max={Math.max(1, financial?.totalInvoicedPoisha ?? 1)}
              label="Collected against invoiced"
            />
          ) : null}
        </Card>
        <Card title="Visits">
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>{counts.visits}</div>
          <p className="field__hint">
            {lastVisit
              ? `Last: ${formatDate(lastVisit.visitDate)}${lastVisit.diagnosis ? ` · ${lastVisit.diagnosis}` : ''}`
              : 'No visits recorded'}
          </p>
        </Card>
        <Card title="Prescriptions & invoices">
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>
            {counts.prescriptions} / {counts.invoices}
          </div>
          <p className="field__hint">Payments received: {counts.payments}</p>
        </Card>
        <Card title="Upcoming">
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>{upcomingAppointments.length}</div>
          <p className="field__hint">
            {upcomingAppointments[0]
              ? `Next: ${formatDate(upcomingAppointments[0].appointmentDate)} ${formatTime12h(upcomingAppointments[0].startTime)}`
              : 'No appointments booked'}
          </p>
        </Card>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={TAB_OPTIONS.map((option) => ({ ...option, count: countFor(option.value, counts) }))}
      />

      {tab === 'overview' ? <OverviewTab patient={patient} /> : null}
      {tab === 'chart' ? <DentalChart patientId={patientId} /> : null}
      {tab === 'timeline' ? <TimelineTab patientId={patientId} /> : null}
      {tab === 'visits' ? <VisitsTab patientId={patientId} onChanged={profile.reload} /> : null}
      {tab === 'prescriptions' ? <PrescriptionsTab patientId={patientId} /> : null}
      {tab === 'invoices' ? <InvoicesTab patientId={patientId} /> : null}
      {tab === 'payments' ? <PaymentsTab patientId={patientId} /> : null}
      {tab === 'referrals' ? <ReferralsTab patientId={patientId} /> : null}
      {tab === 'attachments' ? <AttachmentsTab patientId={patientId} /> : null}

      {editOpen ? (
        <Modal title="Edit patient" size="lg" onClose={() => setEditOpen(false)}>
          <PatientForm
            initial={{ id: patient.id, input: editInput }}
            onCancel={() => setEditOpen(false)}
            onSaved={() => {
              setEditOpen(false)
              app.toast({ tone: 'success', title: 'Patient updated' })
              profile.reload()
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}

function countFor(
  tab: string,
  counts: {
    visits: number
    appointments: number
    prescriptions: number
    invoices: number
    payments: number
    attachments: number
    referrals: number
  }
): number | undefined {
  switch (tab) {
    case 'visits':
      return counts.visits
    case 'prescriptions':
      return counts.prescriptions
    case 'invoices':
      return counts.invoices
    case 'payments':
      return counts.payments
    case 'referrals':
      return counts.referrals
    case 'attachments':
      return counts.attachments
    default:
      return undefined
  }
}

function OverviewTab({ patient }: { patient: Patient }) {
  const rows: { label: string; value: string }[] = [
    { label: 'Patient ID', value: patient.code },
    { label: 'Name in Bangla', value: patient.fullNameBn ?? '—' },
    { label: 'Date of birth', value: patient.dateOfBirth ? formatDate(patient.dateOfBirth) : '—' },
    { label: 'Gender', value: patient.gender ?? '—' },
    { label: 'Blood group', value: patient.bloodGroup ?? '—' },
    { label: 'Phone', value: patient.phone },
    { label: 'Alternative phone', value: patient.phoneAlt ?? '—' },
    { label: 'Email', value: patient.email ?? '—' },
    { label: 'Address', value: [patient.address, patient.city].filter(Boolean).join(', ') || '—' },
    { label: 'Address in Bangla', value: patient.addressBn ?? '—' },
    { label: 'Occupation', value: patient.occupation ?? '—' },
    { label: 'Marital status', value: patient.maritalStatus ?? '—' },
    { label: 'National ID', value: patient.nationalId ?? '—' },
    { label: 'Guardian', value: patient.guardianName ?? '—' },
    {
      label: 'Emergency contact',
      value: [patient.emergencyName, patient.emergencyPhone].filter(Boolean).join(' · ') || '—'
    },
    { label: 'Relationship', value: patient.relationship ?? '—' },
    { label: 'Referral source', value: patient.referralSource ?? '—' },
    { label: 'Registered', value: formatDate(patient.createdAt.slice(0, 10)) },
    { label: 'Registered by', value: patient.createdBy ?? '—' }
  ]
  const narrative: { label: string; value: string | null }[] = [
    { label: 'Main complaint', value: patient.chiefComplaint },
    { label: 'Medical history', value: patient.medicalHistory },
    { label: 'Dental history', value: patient.dentalHistory },
    { label: 'Allergies', value: patient.allergies },
    { label: 'Current medications', value: patient.currentMedications },
    { label: 'Notes', value: patient.notes }
  ]

  return (
    <div className="grid grid--2">
      <Card title="Patient details">
        <dl className="detail-list">
          {rows.map((row) => (
            <div key={row.label} style={{ display: 'contents' }}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title="Clinical background">
        {narrative.map((entry) => (
          <div key={entry.label} style={{ marginBottom: 'var(--space-3)' }}>
            <strong>{entry.label}</strong>
            <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{entry.value || '—'}</p>
          </div>
        ))}
      </Card>
    </div>
  )
}

function TimelineTab({ patientId }: { patientId: number }) {
  const timeline = useQuery('patients.timeline', { patientId }, { deps: [patientId] })
  if (timeline.loading) return <LoadingState />
  if (timeline.error) return <ErrorState message={timeline.error} onRetry={timeline.reload} />
  if (!timeline.data || timeline.data.length === 0) {
    return (
      <EmptyState
        title="No history yet"
        description="Visits, prescriptions, invoices and payments appear here in order."
      />
    )
  }
  return (
    <Card title="History">
      <div className="timeline">
        {timeline.data.map((entry) => (
          <div key={entry.id} className={`timeline-item timeline-item--${entry.type}`}>
            <span className="timeline-item__time">
              {formatDate(entry.at.slice(0, 10))} {entry.at.length > 10 ? entry.at.slice(11, 16) : ''}
            </span>
            <span className="timeline-item__title">{entry.title}</span>
            {entry.summary ? <span className="timeline-item__summary">{entry.summary}</span> : null}
            {entry.amountPoisha != null ? (
              <span className="timeline-item__summary numeric">{money(entry.amountPoisha)}</span>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  )
}

function VisitsTab({ patientId, onChanged }: { patientId: number; onChanged: () => void }) {
  const app = useApp()
  const pagination = usePagination(10)
  const [formOpen, setFormOpen] = useState(false)
  const [selected, setSelected] = useState<Visit | null>(null)
  const [dentistId, setDentistId] = useState('')
  const [visitDate, setVisitDate] = useState(todayIso())
  const [visitTime, setVisitTime] = useState('10:00')
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [examination, setExamination] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [advice, setAdvice] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [treatmentRows, setTreatmentRows] = useState<
    { treatmentId: number | null; treatmentName: string; teeth: string; fee: string; note: string }[]
  >([])
  const [error, setError] = useState<string | null>(null)

  const list = useQuery(
    'visits.list',
    { patientId, page: pagination.page, pageSize: pagination.pageSize },
    { deps: [patientId, pagination.page, pagination.pageSize] }
  )
  const dentists = useQuery('dentists.list', { includeInactive: false })
  const treatments = useQuery('treatments.list', { page: 1, pageSize: 200, includeInactive: false })

  const navigate = useNavigate()
  const save = useAction(async (input: VisitInput) => invoke('visits.create', input))
  const finalize = useAction(async (id: number) => invoke('visits.finalize', { id }))

  async function submit(): Promise<void> {
    if (!dentistId) {
      setError('Choose the dentist who performed the visit.')
      return
    }
    const items = treatmentRows
      .filter((row) => row.treatmentName.trim().length > 0)
      .map((row) => ({
        treatmentId: row.treatmentId,
        treatmentName: row.treatmentName.trim(),
        teeth: row.teeth
          .split(',')
          .map((tooth) => tooth.trim())
          .filter(Boolean),
        feePoisha: parseMoneyInput(row.fee) ?? 0,
        note: row.note.trim() || null
      }))

    const result = await save.run({
      patientId,
      visitDate,
      visitTime,
      dentistId: Number(dentistId),
      chiefComplaint: chiefComplaint.trim() || null,
      examination: examination.trim() || null,
      diagnosis: diagnosis.trim() || null,
      advice: advice.trim() || null,
      followUpDate: followUpDate || null,
      treatments: items
    })
    if (result.ok) {
      app.toast({ tone: 'success', title: `Visit #${result.value.visitNo} recorded` })
      setFormOpen(false)
      setTreatmentRows([])
      setChiefComplaint('')
      setExamination('')
      setDiagnosis('')
      setAdvice('')
      list.reload()
      onChanged()
    } else {
      setError(result.error)
    }
  }

  return (
    <Card
      title="Visits"
      flush
      actions={
        app.hasPermission('visits.create') ? (
          <Button
            size="sm"
            onClick={() => {
              setError(null)
              setFormOpen(true)
              if (!dentistId && dentists.data?.[0]) setDentistId(String(dentists.data[0].id))
            }}
          >
            <Plus size={14} /> New visit
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
            { key: 'no', header: 'Visit', render: (row) => `#${row.visitNo}` },
            {
              key: 'date',
              header: 'Date',
              render: (row) => `${formatDate(row.visitDate)} ${formatTime12h(row.visitTime)}`
            },
            { key: 'dentist', header: 'Dentist', render: (row) => row.dentistName },
            { key: 'diagnosis', header: 'Diagnosis', render: (row) => row.diagnosis ?? '—' },
            {
              key: 'treatments',
              header: 'Treatments',
              render: (row) =>
                row.treatments.length > 0 ? row.treatments.map((item) => item.treatmentName).join(', ') : '—'
            },
            {
              key: 'status',
              header: 'Status',
              render: (row: Visit) => (
                <Badge tone={row.status === 'final' ? 'success' : statusTone(row.status)}>
                  {visitStatusLabel(row.status)}
                </Badge>
              )
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (row) => (
                <div className="toolbar" style={{ gap: 4 }}>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(row)}>
                    Open
                  </Button>
                  {app.hasPermission('visits.edit') && row.status !== 'final' ? (
                    <Button
                      size="sm"
                      onClick={async () => {
                        const result = await finalize.run(row.id)
                        if (result.ok) {
                          app.toast({ tone: 'success', title: 'Visit finalised' })
                          list.reload()
                        } else {
                          app.toast({ tone: 'error', title: 'Could not finalise', detail: result.error })
                        }
                      }}
                    >
                      Finalise
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
              title="No visits yet"
              description="Record the first visit to start the clinical history."
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

      {selected ? (
        <Drawer
          title={`Visit #${selected.visitNo}`}
          onClose={() => setSelected(null)}
          footer={
            app.hasPermission('invoices.create') ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setSelected(null)
                  navigate(`/invoices?new=1&patientId=${selected.patientId}`)
                }}
              >
                Create invoice
              </Button>
            ) : null
          }
        >
          <dl className="detail-list">
            <dt>Date</dt>
            <dd>
              {formatDate(selected.visitDate)} {formatTime12h(selected.visitTime)}
            </dd>
            <dt>Dentist</dt>
            <dd>{selected.dentistName}</dd>
            <dt>Chief complaint</dt>
            <dd>{selected.chiefComplaint ?? '—'}</dd>
            <dt>Examination</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{selected.examination ?? '—'}</dd>
            <dt>Diagnosis</dt>
            <dd>{selected.diagnosis ?? '—'}</dd>
            <dt>Advice</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{selected.advice ?? '—'}</dd>
            <dt>Follow-up</dt>
            <dd>{selected.followUpDate ? formatDate(selected.followUpDate) : '—'}</dd>
            <dt>Treatments</dt>
            <dd>
              {selected.treatments.length === 0
                ? '—'
                : selected.treatments.map((item) => (
                    <div key={item.id}>
                      {item.treatmentName}
                      {item.teeth.length > 0 ? ` · teeth ${item.teeth.join(', ')}` : ''} ·{' '}
                      {money(item.feePoisha)}
                    </div>
                  ))}
            </dd>
            <dt>Status</dt>
            <dd>{visitStatusLabel(selected.status)}</dd>
          </dl>
        </Drawer>
      ) : null}

      {formOpen ? (
        <Modal
          title="Record a visit"
          size="lg"
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button variant="primary" loading={save.pending} onClick={() => void submit()}>
                Save visit
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
            <TextInput label="Date" type="date" value={visitDate} onValueChange={setVisitDate} />
            <TextInput label="Time" type="time" value={visitTime} onValueChange={setVisitTime} />
            <Select
              label="Dentist"
              value={dentistId}
              onValueChange={setDentistId}
              options={(dentists.data ?? []).map((dentist) => ({
                value: String(dentist.id),
                label: dentist.fullName
              }))}
              placeholder="Choose a dentist"
            />
            <TextInput label="Chief complaint" value={chiefComplaint} onValueChange={setChiefComplaint} />
            <TextArea label="Examination (O/E)" rows={3} value={examination} onValueChange={setExamination} />
            <TextArea label="Diagnosis" rows={3} value={diagnosis} onValueChange={setDiagnosis} />
            <TextArea label="Advice" rows={3} value={advice} onValueChange={setAdvice} />
            <TextInput
              label="Follow-up date"
              type="date"
              value={followUpDate}
              onValueChange={setFollowUpDate}
            />
          </div>

          <h4 style={{ marginTop: 'var(--space-4)' }}>Treatments performed</h4>
          {treatmentRows.map((row, index) => (
            <div
              key={index}
              className="card"
              style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-2)' }}
            >
              <div className="form-grid form-grid--wide">
                <Select
                  label="Treatment"
                  value={row.treatmentId ? String(row.treatmentId) : ''}
                  onValueChange={(value) => {
                    const treatment = (treatments.data?.rows ?? []).find((item) => String(item.id) === value)
                    setTreatmentRows(
                      treatmentRows.map((entry, position) =>
                        position === index
                          ? {
                              ...entry,
                              treatmentId: treatment ? treatment.id : null,
                              treatmentName: treatment ? treatment.name : entry.treatmentName,
                              fee: treatment ? amountInput(treatment.defaultFeePoisha) : entry.fee
                            }
                          : entry
                      )
                    )
                  }}
                  options={(treatments.data?.rows ?? []).map((treatment) => ({
                    value: String(treatment.id),
                    label: `${treatment.name} — ${money(treatment.defaultFeePoisha)}`
                  }))}
                  placeholder="Custom treatment"
                />
                <TextInput
                  label="Name"
                  value={row.treatmentName}
                  onValueChange={(value) =>
                    setTreatmentRows(
                      treatmentRows.map((entry, position) =>
                        position === index ? { ...entry, treatmentName: value } : entry
                      )
                    )
                  }
                />
                <TextInput
                  label="Teeth (FDI, comma separated)"
                  value={row.teeth}
                  onValueChange={(value) =>
                    setTreatmentRows(
                      treatmentRows.map((entry, position) =>
                        position === index ? { ...entry, teeth: value } : entry
                      )
                    )
                  }
                />
                <MoneyInput
                  label="Fee"
                  value={row.fee}
                  onValueChange={(value) =>
                    setTreatmentRows(
                      treatmentRows.map((entry, position) =>
                        position === index ? { ...entry, fee: value } : entry
                      )
                    )
                  }
                />
                <TextInput
                  label="Note"
                  value={row.note}
                  onValueChange={(value) =>
                    setTreatmentRows(
                      treatmentRows.map((entry, position) =>
                        position === index ? { ...entry, note: value } : entry
                      )
                    )
                  }
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTreatmentRows(treatmentRows.filter((_, position) => position !== index))}
              >
                <Trash2 size={14} /> Remove
              </Button>
            </div>
          ))}
          <Button
            onClick={() =>
              setTreatmentRows([
                ...treatmentRows,
                { treatmentId: null, treatmentName: '', teeth: '', fee: '', note: '' }
              ])
            }
          >
            <Plus size={16} /> Add treatment
          </Button>
        </Modal>
      ) : null}
    </Card>
  )
}

function PrescriptionsTab({ patientId }: { patientId: number }) {
  const navigate = useNavigate()
  const pagination = usePagination(10)
  const list = useQuery(
    'prescriptions.list',
    { patientId, page: pagination.page, pageSize: pagination.pageSize },
    { deps: [patientId, pagination.page] }
  )
  const app = useApp()
  const print = useAction(async (id: number) =>
    invoke('print.job', { documentType: 'prescription', entityId: id, mode: 'preview' })
  )

  return (
    <Card
      title="Prescriptions"
      flush
      actions={
        app.hasPermission('prescriptions.create') ? (
          <Button size="sm" onClick={() => navigate(`/prescriptions?new=1&patientId=${patientId}`)}>
            <Plus size={14} /> New prescription
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
            { key: 'date', header: 'Date', render: (row: Prescription) => formatDate(row.prescriptionDate) },
            { key: 'dentist', header: 'Dentist', render: (row: Prescription) => row.dentistName },
            { key: 'diagnosis', header: 'Diagnosis', render: (row: Prescription) => row.diagnosis ?? '—' },
            { key: 'medicines', header: 'Medicines', render: (row: Prescription) => row.items.length },
            {
              key: 'status',
              header: 'Status',
              render: (row: Prescription) => (
                <Badge tone={statusTone(row.status)}>{prescriptionStatusLabel(row.status)}</Badge>
              )
            },
            {
              key: 'actions',
              header: '',
              render: (row: Prescription) => (
                <div className="toolbar" style={{ gap: 4 }}>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/prescriptions/${row.id}`)}>
                    Open
                  </Button>
                  {app.hasPermission('prescriptions.print') ? (
                    <Button
                      size="sm"
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
                </div>
              )
            }
          ]}
          rows={list.data?.rows ?? []}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              title="No prescriptions yet"
              description="Prescriptions written for this patient appear here."
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
  )
}

function InvoicesTab({ patientId }: { patientId: number }) {
  const app = useApp()
  const navigate = useNavigate()
  const pagination = usePagination(10)
  const list = useQuery(
    'invoices.list',
    { patientId, page: pagination.page, pageSize: pagination.pageSize },
    { deps: [patientId, pagination.page] }
  )
  const print = useAction(async (id: number) =>
    invoke('print.job', { documentType: 'invoice', entityId: id, mode: 'preview' })
  )

  return (
    <Card
      title="Invoices"
      flush
      actions={
        app.hasPermission('invoices.create') ? (
          <Button size="sm" onClick={() => navigate(`/invoices?new=1&patientId=${patientId}`)}>
            <Plus size={14} /> New invoice
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
              key: 'no',
              header: 'Invoice',
              render: (row: Invoice) => <span className="mono">{row.invoiceNo}</span>
            },
            { key: 'date', header: 'Date', render: (row: Invoice) => formatDate(row.invoiceDate) },
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
              render: (row: Invoice) => <Money poisha={row.balancePoisha} />
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
                <Button
                  size="sm"
                  onClick={async () => {
                    const result = await print.run(row.id)
                    if (!result.ok)
                      app.toast({ tone: 'error', title: 'Could not open the preview', detail: result.error })
                  }}
                >
                  <Printer size={14} />
                </Button>
              )
            }
          ]}
          rows={list.data?.rows ?? []}
          rowKey={(row) => row.id}
          empty={<EmptyState title="No invoices yet" description="Billing for this patient appears here." />}
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
  )
}

function PaymentsTab({ patientId }: { patientId: number }) {
  const pagination = usePagination(10)
  const list = useQuery(
    'payments.list',
    { patientId, page: pagination.page, pageSize: pagination.pageSize },
    { deps: [patientId, pagination.page] }
  )
  return (
    <Card title="Payments" flush>
      {list.loading ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : (
        <DataTable
          columns={[
            {
              key: 'receipt',
              header: 'Receipt',
              render: (row) => <span className="mono">{row.receiptNo}</span>
            },
            { key: 'date', header: 'Date', render: (row) => formatDate(row.receivedAt.slice(0, 10)) },
            { key: 'method', header: 'Method', render: (row) => row.methodName },
            {
              key: 'amount',
              header: 'Amount',
              align: 'right',
              render: (row) => <Money poisha={row.amountPoisha} />
            },
            { key: 'by', header: 'Received by', render: (row) => row.receivedBy ?? '—' },
            {
              key: 'status',
              header: 'Status',
              render: (row) =>
                row.voidedAt ? <Badge tone="danger">Void</Badge> : <Badge tone="success">Active</Badge>
            }
          ]}
          rows={list.data?.rows ?? []}
          rowKey={(row) => row.id}
          empty={
            <EmptyState title="No payments yet" description="Receipts issued to this patient appear here." />
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
  )
}

function ReferralsTab({ patientId }: { patientId: number }) {
  const app = useApp()
  const [formOpen, setFormOpen] = useState(false)
  const [referredToName, setReferredToName] = useState('')
  const [institution, setInstitution] = useState('')
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [referralDate, setReferralDate] = useState(todayIso())
  const [dentistId, setDentistId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const list = useQuery('referrals.list', { patientId }, { deps: [patientId] })
  const dentists = useQuery('dentists.list', { includeInactive: false })
  const create = useAction(async (input: ReferralInput) => invoke('referrals.create', input))
  const update = useAction(
    async (payload: { id: number; status: Referral['status']; outcome?: string | null }) =>
      invoke('referrals.updateStatus', payload)
  )

  return (
    <Card
      title="Referrals"
      flush
      actions={
        app.hasPermission('visits.create') ? (
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus size={14} /> New referral
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
            { key: 'date', header: 'Date', render: (row: Referral) => formatDate(row.referralDate) },
            {
              key: 'to',
              header: 'Referred to',
              render: (row: Referral) =>
                `${row.referredToName}${row.referredToInstitution ? ` · ${row.referredToInstitution}` : ''}`
            },
            { key: 'reason', header: 'Reason', render: (row: Referral) => row.reason },
            {
              key: 'status',
              header: 'Status',
              render: (row: Referral) => (
                <Badge tone={statusTone(row.status)}>{referralStatusLabel(row.status)}</Badge>
              )
            },
            {
              key: 'actions',
              header: '',
              render: (row: Referral) =>
                row.status !== 'completed' &&
                row.status !== 'cancelled' &&
                app.hasPermission('visits.edit') ? (
                  <div className="toolbar" style={{ gap: 4 }}>
                    <Button
                      size="sm"
                      onClick={async () => {
                        const result = await update.run({ id: row.id, status: 'completed' })
                        if (result.ok) {
                          app.toast({ tone: 'success', title: 'Referral completed' })
                          list.reload()
                        } else app.toast({ tone: 'error', title: 'Could not update', detail: result.error })
                      }}
                    >
                      Complete
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const result = await update.run({ id: row.id, status: 'cancelled' })
                        if (result.ok) list.reload()
                        else app.toast({ tone: 'error', title: 'Could not update', detail: result.error })
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : null
            }
          ]}
          rows={list.data ?? []}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              title="No referrals"
              description="Referrals to specialists or hospitals are recorded here."
            />
          }
        />
      )}

      {formOpen ? (
        <Modal
          title="New referral"
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={create.pending}
                onClick={async () => {
                  if (referredToName.trim().length < 2) {
                    setError('Enter who the patient is being referred to.')
                    return
                  }
                  if (reason.trim().length < 3) {
                    setError('Give a reason for the referral.')
                    return
                  }
                  const result = await create.run({
                    patientId,
                    referralDate,
                    referringDentistId: dentistId ? Number(dentistId) : null,
                    referredToName: referredToName.trim(),
                    referredToInstitution: institution.trim() || null,
                    referredToPhone: phone.trim() || null,
                    reason: reason.trim()
                  })
                  if (result.ok) {
                    app.toast({ tone: 'success', title: 'Referral recorded' })
                    setFormOpen(false)
                    list.reload()
                  } else setError(result.error)
                }}
              >
                Save referral
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
            <TextInput label="Date" type="date" value={referralDate} onValueChange={setReferralDate} />
            <TextInput
              label="Referred to"
              required
              value={referredToName}
              onValueChange={setReferredToName}
            />
            <TextInput label="Institution" value={institution} onValueChange={setInstitution} />
            <TextInput label="Phone" value={phone} onValueChange={setPhone} />
            <Select
              label="Referring dentist"
              value={dentistId}
              onValueChange={setDentistId}
              options={(dentists.data ?? []).map((dentist) => ({
                value: String(dentist.id),
                label: dentist.fullName
              }))}
              placeholder="Not specified"
            />
            <TextArea label="Reason" required rows={3} value={reason} onValueChange={setReason} full />
          </div>
        </Modal>
      ) : null}
    </Card>
  )
}

function AttachmentsTab({ patientId }: { patientId: number }) {
  const app = useApp()
  const confirm = useConfirm()
  const pagination = usePagination(15)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const list = useQuery(
    'attachments.list',
    { patientId, page: pagination.page, pageSize: pagination.pageSize },
    { deps: [patientId, pagination.page] }
  )
  const add = useAction(
    async (payload: {
      patientId: number
      visitId?: number | null
      title: string
      category?: string | null
      sourcePath: string
      notes?: string | null
    }) => invoke('attachments.add', payload)
  )
  const remove = useAction(async (id: number) => invoke('attachments.delete', { id }))
  const open = useAction(async (id: number) => invoke('attachments.open', { id }))

  async function pickFile(): Promise<void> {
    try {
      const paths = await invoke('attachments.pick', { multiple: false })
      if (paths.length > 0) {
        setSourcePath(paths[0] ?? '')
        if (!title) setTitle(paths[0]?.split(/[\\/]/).pop() ?? '')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <Card
      title="Attachments"
      flush
      actions={
        app.hasPermission('patients.attachments.manage') ? (
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <FileUp size={14} /> Attach a file
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
            { key: 'title', header: 'Title', render: (row: Attachment) => row.title ?? row.originalName },
            { key: 'category', header: 'Category', render: (row: Attachment) => row.category ?? '—' },
            {
              key: 'size',
              header: 'Size',
              align: 'right',
              render: (row: Attachment) => filesize(row.sizeBytes)
            },
            {
              key: 'uploaded',
              header: 'Added',
              render: (row: Attachment) =>
                `${formatDate(row.uploadedAt.slice(0, 10))}${row.uploadedBy ? ` · ${row.uploadedBy}` : ''}`
            },
            {
              key: 'actions',
              header: '',
              render: (row: Attachment) => (
                <div className="toolbar" style={{ gap: 4 }}>
                  <Button
                    size="sm"
                    onClick={async () => {
                      const result = await open.run(row.id)
                      if (!result.ok)
                        app.toast({ tone: 'error', title: 'Could not open the file', detail: result.error })
                    }}
                  >
                    <Paperclip size={14} /> Open
                  </Button>
                  {app.hasPermission('patients.attachments.manage') ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        confirm({
                          title: 'Remove this attachment?',
                          message:
                            'The stored copy is moved to the trash folder inside your data directory. The record stays in the audit log.',
                          tone: 'danger',
                          confirmLabel: 'Remove',
                          onConfirm: async () => {
                            const result = await remove.run(row.id)
                            if (result.ok) {
                              app.toast({ tone: 'success', title: 'Attachment removed' })
                              list.reload()
                            } else throw new Error(result.error)
                          }
                        })
                      }
                    >
                      <Trash2 size={14} />
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
              title="No attachments"
              description="X-rays, scans, consent forms and photographs are stored inside your data folder."
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

      {uploadOpen ? (
        <Modal
          title="Attach a file"
          onClose={() => setUploadOpen(false)}
          footer={
            <>
              <Button onClick={() => setUploadOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={add.pending}
                onClick={async () => {
                  if (!sourcePath) {
                    setError('Choose a file first.')
                    return
                  }
                  const result = await add.run({
                    patientId,
                    title: title.trim() || (sourcePath.split(/[\\/]/).pop() ?? 'Attachment'),
                    category: category.trim() || null,
                    sourcePath,
                    notes: notes.trim() || null
                  })
                  if (result.ok) {
                    app.toast({ tone: 'success', title: 'Attachment stored' })
                    setUploadOpen(false)
                    setSourcePath('')
                    setTitle('')
                    setCategory('')
                    setNotes('')
                    list.reload()
                  } else setError(result.error)
                }}
              >
                Store attachment
              </Button>
            </>
          }
        >
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="toolbar" style={{ marginBottom: 'var(--space-3)' }}>
            <Button onClick={() => void pickFile()}>
              <FolderOpen size={16} /> Choose file
            </Button>
            <span className="field__hint">{sourcePath || 'No file selected'}</span>
          </div>
          <TextInput label="Title" value={title} onValueChange={setTitle} />
          <TextInput
            label="Category"
            value={category}
            onValueChange={setCategory}
            hint="X-ray, photograph, consent form…"
          />
          <TextArea label="Notes" rows={2} value={notes} onValueChange={setNotes} />
          <Checkbox
            label="The file is copied into the clinic data folder (the original is left untouched)."
            checked
            onCheckedChange={() => undefined}
            disabled
          />
        </Modal>
      ) : null}

      <p className="field__hint">
        Teeth available in the chart: {PERMANENT_TEETH.length} permanent and {PRIMARY_TEETH.length} primary —
        e.g. {toothShortLabel('11')}, {toothShortLabel('36')}.
      </p>
    </Card>
  )
}
