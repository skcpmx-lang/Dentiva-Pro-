/**
 * Appointments: day/week list with real status transitions, booking, editing, rescheduling and reminders.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarPlus, CheckCircle2, Clock, Pencil, RefreshCw, UserX, XCircle } from 'lucide-react'
import type { AppointmentInput, AppointmentSummary, Dentist } from '@shared/types'
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
  Modal,
  PageHeader,
  Pagination,
  Select,
  TextArea,
  TextInput
} from '../../components/ui'
import { useAction, usePagination, useQuery } from '../../lib/hooks'
import { appointmentStatusLabel, formatDate, formatTime12h, statusTone, todayIso } from '../../lib/format'
import { APPOINTMENT_STATUS_LABELS, type AppointmentStatus } from '@shared/constants'

const STATUS_OPTIONS: { value: AppointmentStatus; label: string }[] = (
  Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]
).map((status) => ({ value: status, label: APPOINTMENT_STATUS_LABELS[status] }))

const EMPTY_FORM: AppointmentInput = {
  patientId: 0,
  dentistId: 0,
  appointmentDate: todayIso(),
  startTime: '10:00',
  endTime: '10:30',
  typeCode: null,
  reason: '',
  notes: null,
  status: 'scheduled'
}

export function AppointmentsPage() {
  const app = useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const pagination = usePagination(25)
  const [date, setDate] = useState(todayIso())
  const [status, setStatus] = useState<'' | AppointmentStatus>('')
  const [search, setSearch] = useState('')
  const [drawerId, setDrawerId] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AppointmentSummary | null>(null)
  const [form, setForm] = useState<AppointmentInput>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [patientTerm, setPatientTerm] = useState('')
  const [dentistId, setDentistId] = useState<string>('')

  const list = useQuery(
    'appointments.list',
    {
      page: pagination.page,
      pageSize: pagination.pageSize,
      from: date,
      to: date,
      status: status || null,
      search: search.trim() || null,
      dentistId: dentistId ? Number(dentistId) : null
    },
    { deps: [pagination.page, pagination.pageSize, date, status, search, dentistId] }
  )
  const dentists = useQuery('dentists.list', { includeInactive: false })

  const detail = useQuery(
    'appointments.get',
    { id: drawerId ?? 0 },
    { enabled: drawerId !== null, deps: [drawerId] }
  )
  const patients = useQuery(
    'patients.lookup',
    { term: patientTerm, limit: 12 },
    { enabled: formOpen && patientTerm.trim().length >= 2, deps: [patientTerm, formOpen] }
  )

  const saveAction = useAction(async (input: AppointmentInput) => {
    if (editing) return invoke('appointments.update', { id: editing.id, input })
    return invoke('appointments.create', input)
  })
  const statusAction = useAction(
    async (payload: { id: number; status: AppointmentStatus; reason?: string | null }) =>
      invoke('appointments.setStatus', payload)
  )
  const deleteAction = useAction(async (payload: { id: number; reason: string }) =>
    invoke('appointments.delete', payload)
  )

  useEffect(() => {
    if (params.get('new') === '1' && app.hasPermission('appointments.create')) {
      setEditing(null)
      setForm(EMPTY_FORM)
      setFormOpen(true)
      params.delete('new')
      setParams(params, { replace: true })
    }
  }, [params, setParams, app])

  const dentistOptions = useMemo(
    () =>
      (dentists.data ?? []).map((dentist: Dentist) => ({
        value: String(dentist.id),
        label: dentist.fullName
      })),
    [dentists.data]
  )

  function openEdit(appointment: AppointmentSummary): void {
    setEditing(appointment)
    setForm({
      patientId: appointment.patientId,
      dentistId: appointment.dentistId,
      appointmentDate: appointment.appointmentDate,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      typeCode: appointment.typeCode,
      reason: appointment.reason,
      notes: appointment.notes,
      status: appointment.status
    })
    setPatientTerm(`${appointment.patientName} (${appointment.patientCode})`)
    setFormError(null)
    setFormOpen(true)
  }

  async function submit(): Promise<void> {
    if (form.patientId === 0) {
      setFormError('Choose the patient for this appointment.')
      return
    }
    if (form.dentistId === 0) {
      setFormError('Choose the dentist who will see the patient.')
      return
    }
    if (!/^\d{2}:\d{2}$/.test(form.startTime)) {
      setFormError('Enter the start time as HH:MM.')
      return
    }
    const result = await saveAction.run(form)
    if (result.ok) {
      app.toast({ tone: 'success', title: editing ? 'Appointment updated' : 'Appointment booked' })
      setFormOpen(false)
      setEditing(null)
      list.reload()
    } else {
      setFormError(result.error)
    }
  }

  async function changeStatus(appointment: AppointmentSummary, next: AppointmentStatus): Promise<void> {
    const result = await statusAction.run({ id: appointment.id, status: next })
    if (result.ok) {
      app.toast({ tone: 'success', title: `Marked ${appointmentStatusLabel(next)}` })
      list.reload()
    } else {
      app.toast({ tone: 'error', title: 'Could not update the appointment', detail: result.error })
    }
  }

  return (
    <>
      <PageHeader
        title="Appointments"
        subtitle="Bookings, reminders and day-to-day scheduling"
        actions={
          <>
            <Button onClick={() => list.reload()}>
              <RefreshCw size={16} /> Refresh
            </Button>
            {app.hasPermission('appointments.create') ? (
              <Button
                variant="primary"
                onClick={() => {
                  setEditing(null)
                  setForm({ ...EMPTY_FORM, appointmentDate: date })
                  setPatientTerm('')
                  setFormError(null)
                  setFormOpen(true)
                }}
              >
                <CalendarPlus size={16} /> New appointment
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <div className="toolbar">
          <TextInput label="Date" type="date" value={date} onValueChange={setDate} />
          <Select
            label="Status"
            value={status}
            onValueChange={(value) => setStatus(value as '' | AppointmentStatus)}
            options={STATUS_OPTIONS}
            placeholder="All statuses"
          />
          <Select
            label="Dentist"
            value={dentistId}
            onValueChange={setDentistId}
            options={dentistOptions}
            placeholder="Any dentist"
          />
          <div className="toolbar__grow">
            <TextInput
              label="Search"
              value={search}
              onValueChange={setSearch}
              placeholder="Patient name, code or phone"
            />
          </div>
          <Button size="sm" onClick={() => setDate(todayIso())}>
            Today
          </Button>
        </div>
      </Card>

      <Card flush>
        {list.loading ? (
          <LoadingState label="Loading appointments…" />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : (
          <DataTable
            columns={[
              {
                key: 'time',
                header: 'Time',
                render: (row) =>
                  `${formatTime12h(row.startTime)}${row.endTime ? ` – ${formatTime12h(row.endTime)}` : ''}`
              },
              {
                key: 'patient',
                header: 'Patient',
                render: (row) => (
                  <span>
                    {row.patientName}{' '}
                    <span className="mono" style={{ color: 'var(--ink-500)' }}>
                      {row.patientCode}
                    </span>
                  </span>
                )
              },
              { key: 'reason', header: 'Reason', render: (row) => row.reason },
              { key: 'dentist', header: 'Dentist', render: (row) => row.dentistName ?? '—' },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <Badge tone={statusTone(row.status)}>{appointmentStatusLabel(row.status)}</Badge>
                )
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) => (
                  <div className="toolbar" style={{ gap: 4 }}>
                    {app.hasPermission('appointments.edit') &&
                    ['scheduled', 'confirmed', 'rescheduled'].includes(row.status) ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => void changeStatus(row, 'arrived')}
                          title="Patient arrived"
                        >
                          <Clock size={14} /> Arrived
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void changeStatus(row, 'completed')}
                          title="Complete"
                        >
                          <CheckCircle2 size={14} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void changeStatus(row, 'no_show')}
                          title="No show"
                        >
                          <UserX size={14} />
                        </Button>
                      </>
                    ) : null}
                    {app.hasPermission('appointments.edit') ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(row)}
                        title="Edit and reschedule"
                      >
                        <Pencil size={14} />
                      </Button>
                    ) : null}
                    {app.hasPermission('appointments.delete') && row.status !== 'completed' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Cancel appointment"
                        onClick={async () => {
                          const reason = window.prompt('Reason for cancelling this appointment?') ?? ''
                          if (reason.trim().length < 3) return
                          const result = await deleteAction.run({ id: row.id, reason: reason.trim() })
                          if (result.ok) {
                            app.toast({ tone: 'success', title: 'Appointment cancelled' })
                            list.reload()
                          } else {
                            app.toast({ tone: 'error', title: 'Could not cancel', detail: result.error })
                          }
                        }}
                      >
                        <XCircle size={14} />
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => setDrawerId(row.id)}>
                      Details
                    </Button>
                  </div>
                )
              }
            ]}
            rows={list.data?.rows ?? []}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="No appointments for this day"
                description="Change the date or book a new appointment."
                action={
                  app.hasPermission('appointments.create') ? (
                    <Button variant="primary" onClick={() => setFormOpen(true)}>
                      New appointment
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
          title={editing ? `Edit appointment — ${editing.patientName}` : 'New appointment'}
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => void submit()} loading={saveAction.pending}>
                {editing ? 'Save changes' : 'Book appointment'}
              </Button>
            </>
          }
        >
          {formError ? (
            <p className="field__error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="form-grid form-grid--wide">
            <div>
              <TextInput
                label="Patient"
                required
                value={patientTerm}
                onValueChange={setPatientTerm}
                placeholder="Type at least 2 characters"
                hint="Search by name, patient code or phone number."
              />
              {patientTerm.trim().length >= 2 && patients.data && patients.data.length > 0 ? (
                <div className="card" style={{ marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
                  {patients.data.map((patient) => (
                    <button
                      key={patient.id}
                      type="button"
                      className="nav-item"
                      onClick={() => {
                        setForm({ ...form, patientId: patient.id })
                        setPatientTerm(`${patient.fullName} (${patient.code})`)
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
              {form.patientId > 0 ? (
                <p className="field__hint">Selected patient id: {form.patientId}</p>
              ) : null}
            </div>
            <Select
              label="Dentist"
              value={form.dentistId ? String(form.dentistId) : ''}
              onValueChange={(value) => setForm({ ...form, dentistId: value ? Number(value) : 0 })}
              options={dentistOptions}
              placeholder="Unassigned"
            />
            <TextInput
              label="Date"
              type="date"
              required
              value={form.appointmentDate}
              onValueChange={(value) => setForm({ ...form, appointmentDate: value })}
            />
            <TextInput
              label="Start time"
              type="time"
              required
              value={form.startTime}
              onValueChange={(value) => setForm({ ...form, startTime: value })}
            />
            <TextInput
              label="End time"
              type="time"
              value={form.endTime ?? ''}
              onValueChange={(value) => setForm({ ...form, endTime: value || null })}
            />
            <TextInput
              label="Type"
              value={form.typeCode ?? ''}
              onValueChange={(value) => setForm({ ...form, typeCode: value || null })}
              placeholder="Consultation, scaling, follow-up…"
            />
            <TextInput
              label="Reason"
              value={form.reason ?? ''}
              onValueChange={(value) => setForm({ ...form, reason: value })}
            />
            <TextArea
              label="Notes"
              rows={3}
              value={form.notes ?? ''}
              onValueChange={(value) => setForm({ ...form, notes: value || null })}
              full
            />
          </div>
        </Modal>
      ) : null}

      {drawerId !== null ? (
        <Drawer
          title="Appointment details"
          onClose={() => setDrawerId(null)}
          footer={
            <>
              <Button
                size="sm"
                onClick={() => {
                  if (detail.data) {
                    navigate(`/patients/${detail.data.patientId}`)
                    setDrawerId(null)
                  }
                }}
              >
                Open patient
              </Button>
              {detail.data && app.hasPermission('appointments.edit') ? (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    const appointment = detail.data
                    if (appointment) openEdit(appointment)
                    setDrawerId(null)
                  }}
                >
                  Edit appointment
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
              <div className="detail-list">
                <dt>Patient</dt>
                <dd>
                  {detail.data.patientName} ({detail.data.patientCode})
                </dd>
                <dt>Date</dt>
                <dd>{formatDate(detail.data.appointmentDate)}</dd>
                <dt>Time</dt>
                <dd>
                  {formatTime12h(detail.data.startTime)}
                  {detail.data.endTime ? ` – ${formatTime12h(detail.data.endTime)}` : ''}
                </dd>
                <dt>Dentist</dt>
                <dd>{detail.data.dentistName ?? 'Unassigned'}</dd>
                <dt>Status</dt>
                <dd>
                  <Badge tone={statusTone(detail.data.status)}>
                    {appointmentStatusLabel(detail.data.status)}
                  </Badge>
                </dd>
                <dt>Reason</dt>
                <dd>{detail.data.reason}</dd>
                <dt>Notes</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{detail.data.notes ?? '—'}</dd>
              </div>
              {app.hasPermission('appointments.edit') ? (
                <div className="toolbar">
                  {STATUS_OPTIONS.filter((option) => option.value !== 'completed').map((option) => (
                    <Button
                      key={option.value}
                      size="sm"
                      onClick={() => void changeStatus(detail.data as AppointmentSummary, option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </Drawer>
      ) : null}
    </>
  )
}
