/**
 * Queue management: today's waiting list with arrival, calling, in-treatment and completion states.
 * The queue is persisted in the database (not in memory) and survives restarts.
 */

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, CheckCircle2, Clock, Megaphone, Plus, TriangleAlert } from 'lucide-react'
import type { Dentist, QueueEntry } from '@shared/types'
import { invoke } from '../../lib/api'
import { useApp } from '../../app/state'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  StatCard,
  TextArea,
  TextInput
} from '../../components/ui'
import { useAction, useQuery } from '../../lib/hooks'
import { formatTime12h, queuePriorityLabel, queueStatusLabel, statusTone, todayIso } from '../../lib/format'
import { QUEUE_PRIORITY_LABELS, QUEUE_STATUS_LABELS } from '@shared/constants'
import type { QueuePriority, QueueStatus } from '@shared/constants'

const PRIORITY_OPTIONS = (Object.keys(QUEUE_PRIORITY_LABELS) as QueuePriority[]).map((value) => ({
  value,
  label: QUEUE_PRIORITY_LABELS[value]
}))

export function QueuePage() {
  const app = useApp()
  const [date, setDate] = useState(todayIso())
  const [addOpen, setAddOpen] = useState(false)
  const [patientTerm, setPatientTerm] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<{ id: number; label: string } | null>(null)
  const [priority, setPriority] = useState<QueuePriority>('normal')
  const [dentistId, setDentistId] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const queue = useQuery('queue.get', { date }, { deps: [date] })
  const dentists = useQuery('dentists.list', { includeInactive: false })
  const patients = useQuery(
    'patients.lookup',
    { term: patientTerm, limit: 10 },
    { enabled: addOpen && patientTerm.trim().length >= 2, deps: [patientTerm, addOpen] }
  )

  const addAction = useAction(
    async (input: {
      patientId: number
      priority: QueuePriority
      dentistId: number | null
      notes: string | null
    }) => invoke('queue.add', input)
  )
  const updateAction = useAction(
    async (input: {
      id: number
      status?: QueueStatus
      priority?: QueuePriority
      dentistId?: number | null
    }) => invoke('queue.update', input)
  )
  const reorderAction = useAction(async (input: { queueDate: string; orderedIds: number[] }) =>
    invoke('queue.reorder', input)
  )

  useEffect(() => {
    if (queue.error) setError(null)
  }, [queue.error])

  async function move(entry: QueueEntry, direction: -1 | 1): Promise<void> {
    const entries = queue.data?.entries ?? []
    const index = entries.findIndex((item) => item.id === entry.id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= entries.length) return
    const ordered = [...entries]
    const [moved] = ordered.splice(index, 1)
    ordered.splice(target, 0, moved as QueueEntry)
    const result = await reorderAction.run({ queueDate: date, orderedIds: ordered.map((item) => item.id) })
    if (result.ok) queue.reload()
    else app.toast({ tone: 'error', title: 'Could not reorder the queue', detail: result.error })
  }

  const entries = queue.data?.entries ?? []
  const waiting = entries.filter((entry) => entry.status === 'waiting' || entry.status === 'called')
  const inTreatment = entries.filter((entry) => entry.status === 'in_treatment')
  const done = entries.filter((entry) => entry.status === 'completed')

  return (
    <>
      <PageHeader
        title="Queue"
        subtitle="Patients waiting in the clinic right now"
        actions={
          <>
            <TextInput label="Date" type="date" value={date} onValueChange={setDate} />
            {app.hasPermission('queue.manage') ? (
              <Button
                variant="primary"
                onClick={() => {
                  setAddOpen(true)
                  setSelectedPatient(null)
                  setPatientTerm('')
                  setNotes('')
                  setPriority('normal')
                }}
              >
                <Plus size={16} /> Add to queue
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid--kpi">
        <StatCard
          label="Waiting"
          value={String(queue.data?.waitingCount ?? 0)}
          hint="Including patients being called"
          tone="brand"
        />
        <StatCard
          label="In treatment"
          value={String(queue.data?.inTreatmentCount ?? 0)}
          hint="Currently in the chair"
        />
        <StatCard label="Completed" value={String(queue.data?.completedCount ?? 0)} hint="Seen today" />
        <StatCard
          label="Average wait"
          value={queue.data?.averageWaitMinutes != null ? `${queue.data.averageWaitMinutes} min` : '—'}
          hint="From arrival to start of treatment"
        />
      </div>

      <Card title={`Waiting (${waiting.length + inTreatment.length})`} flush>
        {queue.loading ? (
          <LoadingState label="Loading the queue…" />
        ) : queue.error ? (
          <ErrorState message={queue.error} onRetry={queue.reload} />
        ) : entries.length === 0 ? (
          <EmptyState
            title="The queue is empty"
            description="Add patients as they arrive so nobody waits unnoticed."
          />
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>#</th>
                  <th>Patient</th>
                  <th>Dentist</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Arrived</th>
                  <th>Waiting</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr key={entry.id}>
                    <td className="mono">{entry.position}</td>
                    <td>
                      {entry.patientName}{' '}
                      <span className="mono" style={{ color: 'var(--ink-500)' }}>
                        {entry.patientCode}
                      </span>
                    </td>
                    <td>{entry.dentistName ?? '—'}</td>
                    <td>
                      <Badge tone={entry.priority === 'normal' ? 'neutral' : statusTone(entry.priority)}>
                        {queuePriorityLabel(entry.priority)}
                      </Badge>
                    </td>
                    <td>
                      <Badge tone={statusTone(entry.status)}>{queueStatusLabel(entry.status)}</Badge>
                    </td>
                    <td>{formatTime12h(entry.arrivedAt.slice(11, 16))}</td>
                    <td>{entry.estimatedWaitMinutes != null ? `${entry.estimatedWaitMinutes} min` : '—'}</td>
                    <td>
                      <div className="toolbar" style={{ gap: 4 }}>
                        {app.hasPermission('queue.manage') ? (
                          <>
                            {entry.status === 'waiting' ? (
                              <Button
                                size="sm"
                                onClick={() => void updateAction.run({ id: entry.id, status: 'called' })}
                              >
                                <Megaphone size={14} /> Call
                              </Button>
                            ) : null}
                            {entry.status === 'called' ? (
                              <Button
                                size="sm"
                                onClick={() =>
                                  void updateAction.run({ id: entry.id, status: 'in_treatment' })
                                }
                              >
                                <Clock size={14} /> Start
                              </Button>
                            ) : null}
                            {entry.status === 'in_treatment' ? (
                              <Button
                                size="sm"
                                onClick={() => void updateAction.run({ id: entry.id, status: 'completed' })}
                              >
                                <CheckCircle2 size={14} /> Done
                              </Button>
                            ) : null}
                            {entry.status !== 'completed' &&
                            entry.status !== 'left' &&
                            entry.status !== 'cancelled' ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  void updateAction.run({
                                    id: entry.id,
                                    priority: entry.priority === 'normal' ? 'urgent' : 'normal'
                                  })
                                }
                                title="Toggle urgent"
                              >
                                <TriangleAlert size={14} />
                              </Button>
                            ) : null}
                            {entry.status !== 'completed' &&
                            entry.status !== 'left' &&
                            entry.status !== 'cancelled' ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void updateAction.run({ id: entry.id, status: 'cancelled' })}
                              >
                                Cancel
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                        {app.hasPermission('queue.reorder') && index > 0 ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Move up"
                            onClick={() => void move(entry, -1)}
                          >
                            <ArrowUp size={14} />
                          </Button>
                        ) : null}
                        {app.hasPermission('queue.reorder') && index < entries.length - 1 ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Move down"
                            onClick={() => void move(entry, 1)}
                          >
                            <ArrowDown size={14} />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {done.length > 0 ? (
          <div className="card__footer">
            {done.length} patient(s) finished with today · average wait{' '}
            {queue.data?.averageWaitMinutes ?? '—'} min
          </div>
        ) : null}
      </Card>

      {addOpen ? (
        <Modal
          title="Add a patient to the queue"
          onClose={() => setAddOpen(false)}
          footer={
            <>
              <Button onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={addAction.pending}
                onClick={async () => {
                  if (!selectedPatient) {
                    setError('Choose the patient first.')
                    return
                  }
                  const result = await addAction.run({
                    patientId: selectedPatient.id,
                    priority,
                    dentistId: dentistId ? Number(dentistId) : null,
                    notes: notes.trim() || null
                  })
                  if (result.ok) {
                    app.toast({ tone: 'success', title: `${selectedPatient.label} added to the queue` })
                    setAddOpen(false)
                    queue.reload()
                  } else {
                    setError(result.error)
                  }
                }}
              >
                Add to queue
              </Button>
            </>
          }
        >
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          <TextInput
            label="Patient"
            required
            value={patientTerm}
            onValueChange={setPatientTerm}
            placeholder="Search by name, code or phone"
            hint="At least two characters."
          />
          {patients.data && patients.data.length > 0 ? (
            <div className="card" style={{ maxHeight: 200, overflowY: 'auto' }}>
              {patients.data.map((patient) => (
                <button
                  key={patient.id}
                  type="button"
                  className="nav-item"
                  onClick={() => {
                    setSelectedPatient({ id: patient.id, label: patient.fullName })
                    setPatientTerm(`${patient.fullName} (${patient.code})`)
                  }}
                >
                  <span className="nav-item__label">
                    {patient.fullName} · <span className="mono">{patient.code}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="form-grid form-grid--wide" style={{ marginTop: 'var(--space-3)' }}>
            <Select
              label="Priority"
              value={priority}
              onValueChange={(value) => setPriority(value as QueuePriority)}
              options={PRIORITY_OPTIONS}
            />
            <Select
              label="Dentist"
              value={dentistId}
              onValueChange={setDentistId}
              options={(dentists.data ?? []).map((dentist: Dentist) => ({
                value: String(dentist.id),
                label: dentist.fullName
              }))}
              placeholder="Any available"
            />
            <TextArea label="Notes" rows={2} value={notes} onValueChange={setNotes} full />
          </div>
        </Modal>
      ) : null}
    </>
  )
}

export const QUEUE_STATUS_OPTIONS = (Object.keys(QUEUE_STATUS_LABELS) as QueueStatus[]).map((value) => ({
  value,
  label: QUEUE_STATUS_LABELS[value]
}))
