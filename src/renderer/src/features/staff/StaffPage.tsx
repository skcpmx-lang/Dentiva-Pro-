/**
 * Staff, dentists, user accounts and roles.
 *
 * Roles carry the permissions; a user gets their role's permissions with optional per-user allow/deny
 * overrides. The business layer re-checks every permission, so this screen is only about administration.
 */

import { useMemo, useState } from 'react'
import { KeyRound, Pencil, Plus, Power, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import type {
  Dentist,
  DentistInput,
  PermissionCatalogEntry,
  RoleSummary,
  StaffInput,
  StaffMember,
  UserInput,
  UserSummary
} from '@shared/types'
import type { PermissionCode, PermissionModule } from '@shared/permissions'
import { invoke } from '../../lib/api'
import { useApp } from '../../app/state'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  Money,
  MoneyInput,
  PageHeader,
  Select,
  Tabs,
  TextArea,
  TextInput,
  useConfirm
} from '../../components/ui'
import { useAction, useQuery } from '../../lib/hooks'
import {
  amountInput,
  formatDate,
  initials,
  parseMoneyInput,
  staffStatusLabel,
  statusTone,
  todayIso
} from '../../lib/format'
import { BLOOD_GROUPS, GENDER_LABELS, GENDERS, STAFF_STATUSES, STAFF_STATUS_LABELS } from '@shared/constants'
import type { Gender, StaffStatus } from '@shared/constants'

type Tab = 'dentists' | 'staff' | 'users' | 'roles'

export function StaffPage() {
  const app = useApp()
  const [tab, setTab] = useState<Tab>(app.hasPermission('staff.view') ? 'dentists' : 'users')

  const canSee = (candidate: Tab): boolean =>
    candidate === 'dentists'
      ? app.hasPermission('staff.view')
      : candidate === 'staff'
        ? app.hasPermission('staff.view')
        : candidate === 'users'
          ? app.hasPermission('users.view')
          : app.hasPermission('roles.manage') || app.hasPermission('users.view')

  const tabs = (['dentists', 'staff', 'users', 'roles'] as Tab[]).filter(canSee)

  return (
    <>
      <PageHeader title="Staff & users" subtitle="Dentists, employees, user accounts and role permissions" />

      <Tabs
        value={tab}
        onChange={setTab}
        options={tabs.map((entry) => ({
          value: entry,
          label:
            entry === 'dentists'
              ? 'Dentists'
              : entry === 'staff'
                ? 'Employees'
                : entry === 'users'
                  ? 'User accounts'
                  : 'Roles'
        }))}
      />

      {tab === 'dentists' ? <DentistsTab /> : null}
      {tab === 'staff' ? <EmployeesTab /> : null}
      {tab === 'users' ? <UsersTab /> : null}
      {tab === 'roles' ? <RolesTab /> : null}
    </>
  )
}

function DentistsTab() {
  const app = useApp()
  const list = useQuery('dentists.list', { includeInactive: true })
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Dentist | null>(null)
  const [form, setForm] = useState<DentistInput>({
    fullName: '',
    phone: null,
    email: null,
    registrationNo: null,
    signaturePath: null,
    isActive: true,
    sortOrder: 0,
    notes: null,
    designations: [],
    qualifications: [],
    certifications: [],
    schedules: []
  })
  const [designations, setDesignations] = useState('')
  const [qualifications, setQualifications] = useState('')
  const [certifications, setCertifications] = useState('')
  const [schedules, setSchedules] = useState<{ weekday: number; startTime: string; endTime: string }[]>([])

  const save = useAction(async (payload: DentistInput & { id?: number }) => invoke('dentists.save', payload))
  const toggle = useAction(async (payload: { id: number; isActive: boolean }) =>
    invoke('dentists.setActive', payload)
  )
  const signature = useAction(async (payload: { id: number; sourcePath: string }) =>
    invoke('dentists.signature', payload)
  )

  const canManage = app.hasPermission('staff.manage')

  function openCreate(): void {
    setEditing(null)
    setForm({
      ...form,
      fullName: '',
      phone: null,
      email: null,
      registrationNo: null,
      signaturePath: null,
      notes: null
    })
    setDesignations('')
    setQualifications('')
    setCertifications('')
    setSchedules([])
    setFormOpen(true)
  }

  function openEdit(dentist: Dentist): void {
    setEditing(dentist)
    setForm({
      fullName: dentist.fullName,
      phone: dentist.phone,
      email: dentist.email,
      registrationNo: dentist.registrationNo,
      signaturePath: dentist.signaturePath,
      isActive: dentist.isActive,
      sortOrder: dentist.sortOrder,
      notes: dentist.notes,
      designations: dentist.designations,
      qualifications: dentist.qualifications,
      certifications: dentist.certifications,
      schedules: dentist.schedules.map((schedule) => ({
        weekday: schedule.weekday,
        startTime: schedule.startTime,
        endTime: schedule.endTime
      }))
    })
    setDesignations(dentist.designations.join(', '))
    setQualifications(dentist.qualifications.join(', '))
    setCertifications(dentist.certifications.join(', '))
    setSchedules(
      dentist.schedules.map((schedule) => ({
        weekday: schedule.weekday,
        startTime: schedule.startTime,
        endTime: schedule.endTime
      }))
    )
    setFormOpen(true)
  }

  const splitList = (value: string): string[] =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)

  return (
    <Card
      title="Dentists"
      flush
      actions={
        canManage ? (
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} /> Add dentist
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
            { key: 'name', header: 'Dentist', render: (row: Dentist) => row.fullName },
            {
              key: 'designation',
              header: 'Designations',
              render: (row) => row.designations.join(', ') || '—'
            },
            {
              key: 'qualification',
              header: 'Qualifications',
              render: (row) => row.qualifications.join(', ') || '—'
            },
            { key: 'registration', header: 'BMDC no.', render: (row) => row.registrationNo ?? '—' },
            { key: 'phone', header: 'Phone', render: (row) => row.phone ?? '—' },
            {
              key: 'signature',
              header: 'Signature',
              render: (row) =>
                row.signaturePath ? (
                  <Badge tone="success">Uploaded</Badge>
                ) : (
                  <Badge tone="warning">Not set</Badge>
                )
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) =>
                row.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Inactive</Badge>
            },
            {
              key: 'actions',
              header: '',
              render: (row: Dentist) =>
                canManage ? (
                  <div className="toolbar" style={{ gap: 4 }}>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                      <Pencil size={14} /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Upload a signature image for prescriptions"
                      loading={signature.pending}
                      onClick={async () => {
                        const paths = await invoke('system.openDialog', {
                          title: `Signature for ${row.fullName}`,
                          multiple: false,
                          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
                        }).catch(() => [] as string[])
                        const path = paths[0]
                        if (!path) return
                        const result = await signature.run({ id: row.id, sourcePath: path })
                        if (result.ok) {
                          app.toast({ tone: 'success', title: 'Signature stored' })
                          list.reload()
                        } else {
                          app.toast({
                            tone: 'error',
                            title: 'Could not store the signature',
                            detail: result.error
                          })
                        }
                      }}
                    >
                      Signature
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={row.isActive ? 'Deactivate' : 'Reactivate'}
                      onClick={async () => {
                        const result = await toggle.run({ id: row.id, isActive: !row.isActive })
                        if (result.ok) list.reload()
                        else app.toast({ tone: 'error', title: 'Could not update', detail: result.error })
                      }}
                    >
                      <Power size={14} />
                    </Button>
                  </div>
                ) : null
            }
          ]}
          rows={list.data ?? []}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              title="No dentists yet"
              description="Dentists sign prescriptions and own visits."
              action={canManage ? <Button onClick={openCreate}>Add the first dentist</Button> : null}
            />
          }
        />
      )}

      {formOpen ? (
        <Modal
          title={editing ? `Edit ${editing.fullName}` : 'Add a dentist'}
          size="lg"
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={save.pending}
                onClick={async () => {
                  if (form.fullName.trim().length < 3) {
                    app.toast({ tone: 'warning', title: 'Enter the dentist name' })
                    return
                  }
                  if (splitList(designations).length === 0) {
                    app.toast({ tone: 'warning', title: 'At least one designation is required' })
                    return
                  }
                  const result = await save.run({
                    ...form,
                    id: editing?.id,
                    designations: splitList(designations),
                    qualifications: splitList(qualifications),
                    certifications: splitList(certifications),
                    schedules
                  })
                  if (result.ok) {
                    app.toast({ tone: 'success', title: editing ? 'Dentist updated' : 'Dentist added' })
                    setFormOpen(false)
                    list.reload()
                  } else {
                    app.toast({ tone: 'error', title: 'Could not save', detail: result.error })
                  }
                }}
              >
                Save dentist
              </Button>
            </>
          }
        >
          <div className="form-grid form-grid--wide">
            <TextInput
              label="Full name"
              required
              value={form.fullName}
              onValueChange={(value) => setForm({ ...form, fullName: value })}
            />
            <TextInput
              label="Designations"
              required
              value={designations}
              onValueChange={setDesignations}
              hint="Comma separated, e.g. Consultant, Dental Surgeon"
            />
            <TextInput
              label="Qualifications"
              value={qualifications}
              onValueChange={setQualifications}
              hint="Comma separated, e.g. BDS, FCPS"
            />
            <TextInput label="Certifications" value={certifications} onValueChange={setCertifications} />
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
              label="BMDC / registration number"
              value={form.registrationNo ?? ''}
              onValueChange={(value) => setForm({ ...form, registrationNo: value || null })}
            />
            <TextInput
              label="Display order"
              value={String(form.sortOrder)}
              onValueChange={(value) =>
                setForm({ ...form, sortOrder: Number(value.replace(/\D/g, '') || 0) })
              }
            />
            <TextArea
              label="Notes"
              rows={2}
              value={form.notes ?? ''}
              onValueChange={(value) => setForm({ ...form, notes: value || null })}
              full
            />
          </div>

          <h4>Consultation hours</h4>
          {schedules.map((schedule, index) => (
            <div key={index} className="toolbar" style={{ marginBottom: 4 }}>
              <Select
                label="Day"
                value={String(schedule.weekday)}
                onValueChange={(value) =>
                  setSchedules(
                    schedules.map((entry, position) =>
                      position === index ? { ...entry, weekday: Number(value) } : entry
                    )
                  )
                }
                options={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                  (label, day) => ({
                    value: String(day),
                    label
                  })
                )}
              />
              <TextInput
                label="From"
                type="time"
                value={schedule.startTime}
                onValueChange={(value) =>
                  setSchedules(
                    schedules.map((entry, position) =>
                      position === index ? { ...entry, startTime: value } : entry
                    )
                  )
                }
              />
              <TextInput
                label="To"
                type="time"
                value={schedule.endTime}
                onValueChange={(value) =>
                  setSchedules(
                    schedules.map((entry, position) =>
                      position === index ? { ...entry, endTime: value } : entry
                    )
                  )
                }
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSchedules(schedules.filter((_, position) => position !== index))}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <Button
            onClick={() => setSchedules([...schedules, { weekday: 0, startTime: '10:00', endTime: '14:00' }])}
          >
            <Plus size={16} /> Add hours
          </Button>
          <p className="field__hint">
            Consultation hours are printed on prescriptions when enabled in Settings.
          </p>

          {editing ? (
            <Checkbox
              label="Active"
              checked={form.isActive}
              onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
            />
          ) : null}
        </Modal>
      ) : null}
    </Card>
  )
}

function EmployeesTab() {
  const app = useApp()
  const confirm = useConfirm()
  const list = useQuery('staff.list', undefined)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<StaffMember | null>(null)
  const [form, setForm] = useState<StaffInput>({
    name: '',
    age: null,
    gender: null,
    address: null,
    bloodGroup: null,
    identificationNo: null,
    photoPath: null,
    phone: '',
    position: '',
    department: null,
    salaryPoisha: null,
    joiningDate: todayIso(),
    status: 'active',
    notes: null
  })

  const save = useAction(async (payload: StaffInput & { id?: number }) => invoke('staff.save', payload))
  const remove = useAction(async (id: number) => invoke('staff.remove', { id }))
  const canManage = app.hasPermission('staff.manage')

  return (
    <Card
      title="Employees"
      flush
      actions={
        canManage ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setForm({
                name: '',
                age: null,
                gender: null,
                address: null,
                bloodGroup: null,
                identificationNo: null,
                photoPath: null,
                phone: '',
                position: '',
                department: null,
                salaryPoisha: null,
                joiningDate: todayIso(),
                status: 'active',
                notes: null
              })
              setFormOpen(true)
            }}
          >
            <Plus size={14} /> Add employee
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
            { key: 'name', header: 'Name', render: (row: StaffMember) => row.name },
            { key: 'position', header: 'Position', render: (row) => row.position },
            { key: 'department', header: 'Department', render: (row) => row.department ?? '—' },
            { key: 'phone', header: 'Phone', render: (row) => row.phone },
            { key: 'joining', header: 'Joined', render: (row) => formatDate(row.joiningDate) },
            {
              key: 'salary',
              header: 'Salary',
              align: 'right',
              render: (row) => (row.salaryPoisha == null ? '—' : <Money poisha={row.salaryPoisha} />)
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => <Badge tone={statusTone(row.status)}>{staffStatusLabel(row.status)}</Badge>
            },
            {
              key: 'actions',
              header: '',
              render: (row: StaffMember) =>
                canManage ? (
                  <div className="toolbar" style={{ gap: 4 }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(row)
                        setForm({
                          name: row.name,
                          age: row.age,
                          gender: row.gender,
                          address: row.address,
                          bloodGroup: row.bloodGroup,
                          identificationNo: row.identificationNo,
                          photoPath: row.photoPath,
                          phone: row.phone,
                          position: row.position,
                          department: row.department,
                          salaryPoisha: row.salaryPoisha,
                          joiningDate: row.joiningDate,
                          status: row.status,
                          notes: row.notes
                        })
                        setFormOpen(true)
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        confirm({
                          title: 'Remove this employee record?',
                          message: `${row.name} will be removed from the staff register. Attendance and salary history are not affected because none is stored here.`,
                          tone: 'danger',
                          confirmLabel: 'Remove',
                          onConfirm: async () => {
                            const result = await remove.run(row.id)
                            if (result.ok) {
                              app.toast({ tone: 'success', title: 'Employee removed' })
                              list.reload()
                            } else throw new Error(result.error)
                          }
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ) : null
            }
          ]}
          rows={list.data ?? []}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              title="No employees yet"
              description="Receptionists, assistants and lab technicians can be recorded here."
            />
          }
        />
      )}

      {formOpen ? (
        <Modal
          title={editing ? `Edit ${editing.name}` : 'Add an employee'}
          size="lg"
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={save.pending}
                onClick={async () => {
                  if (form.name.trim().length < 3) {
                    app.toast({ tone: 'warning', title: 'Enter the employee name' })
                    return
                  }
                  if (form.position.trim().length < 2) {
                    app.toast({ tone: 'warning', title: 'Enter the position' })
                    return
                  }
                  const result = await save.run({ ...form, id: editing?.id })
                  if (result.ok) {
                    app.toast({ tone: 'success', title: editing ? 'Employee updated' : 'Employee added' })
                    setFormOpen(false)
                    list.reload()
                  } else {
                    app.toast({ tone: 'error', title: 'Could not save', detail: result.error })
                  }
                }}
              >
                Save employee
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
              label="Phone"
              required
              value={form.phone}
              onValueChange={(value) => setForm({ ...form, phone: value })}
            />
            <TextInput
              label="Position"
              required
              value={form.position}
              onValueChange={(value) => setForm({ ...form, position: value })}
            />
            <TextInput
              label="Department"
              value={form.department ?? ''}
              onValueChange={(value) => setForm({ ...form, department: value || null })}
            />
            <TextInput
              label="Age"
              value={form.age == null ? '' : String(form.age)}
              onValueChange={(value) =>
                setForm({ ...form, age: value === '' ? null : Number(value.replace(/\D/g, '')) })
              }
            />
            <Select
              label="Gender"
              value={form.gender ?? ''}
              onValueChange={(value) => setForm({ ...form, gender: (value || null) as Gender | null })}
              options={GENDERS.map((gender) => ({ value: gender, label: GENDER_LABELS[gender] }))}
              placeholder="Not recorded"
            />
            <Select
              label="Blood group"
              value={form.bloodGroup ?? ''}
              onValueChange={(value) => setForm({ ...form, bloodGroup: value || null })}
              options={BLOOD_GROUPS.map((group) => ({ value: group, label: group }))}
              placeholder="Unknown"
            />
            <TextInput
              label="Identification number"
              value={form.identificationNo ?? ''}
              onValueChange={(value) => setForm({ ...form, identificationNo: value || null })}
            />
            <MoneyInput
              label="Monthly salary"
              value={form.salaryPoisha == null ? '' : amountInput(form.salaryPoisha)}
              onValueChange={(value) =>
                setForm({ ...form, salaryPoisha: value === '' ? null : (parseMoneyInput(value) ?? null) })
              }
            />
            <TextInput
              label="Joining date"
              type="date"
              value={form.joiningDate}
              onValueChange={(value) => setForm({ ...form, joiningDate: value })}
            />
            <Select
              label="Status"
              value={form.status}
              onValueChange={(value) => setForm({ ...form, status: value as StaffStatus })}
              options={STAFF_STATUSES.map((status) => ({
                value: status,
                label: STAFF_STATUS_LABELS[status]
              }))}
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
        </Modal>
      ) : null}
    </Card>
  )
}

function UsersTab() {
  const app = useApp()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<UserSummary | null>(null)
  const [form, setForm] = useState<Omit<UserInput, 'overrides'> & { password: string }>({
    username: '',
    displayName: '',
    password: '',
    roleId: 0,
    isActive: true,
    mustChangePassword: true
  })
  const [overrides, setOverrides] = useState<{ code: PermissionCode; effect: 'allow' | 'deny' }[]>([])
  const [error, setError] = useState<string | null>(null)

  const users = useQuery('users.list', undefined)
  const roles = useQuery('roles.list', undefined)
  const catalogue = useQuery('permissions.catalogue', undefined)
  const save = useAction(async (payload: UserInput & { id?: number; password?: string }) =>
    payload.id
      ? invoke('users.update', {
          id: payload.id,
          username: payload.username,
          displayName: payload.displayName,
          password: payload.password,
          roleId: payload.roleId,
          isActive: payload.isActive,
          mustChangePassword: payload.mustChangePassword,
          overrides: payload.overrides
        })
      : invoke('users.create', {
          username: payload.username,
          displayName: payload.displayName,
          password: payload.password,
          roleId: payload.roleId,
          isActive: payload.isActive,
          mustChangePassword: payload.mustChangePassword,
          overrides: payload.overrides
        })
  )

  const grouped = useMemo(() => {
    const map = new Map<PermissionModule, PermissionCatalogEntry[]>()
    for (const entry of catalogue.data ?? []) {
      const list = map.get(entry.module) ?? []
      list.push(entry)
      map.set(entry.module, list)
    }
    return [...map.entries()]
  }, [catalogue.data])

  const canManage = app.hasPermission('users.manage')

  return (
    <Card
      title="User accounts"
      flush
      actions={
        canManage ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setForm({
                username: '',
                displayName: '',
                password: '',
                roleId: roles.data?.[0]?.id ?? 0,
                isActive: true,
                mustChangePassword: true
              })
              setOverrides([])
              setError(null)
              setFormOpen(true)
            }}
          >
            <UserPlus size={14} /> New user
          </Button>
        ) : null
      }
    >
      {users.loading ? (
        <LoadingState />
      ) : users.error ? (
        <ErrorState message={users.error} onRetry={users.reload} />
      ) : (
        <DataTable
          columns={[
            {
              key: 'user',
              header: 'User',
              render: (row: UserSummary) => (
                <span className="toolbar" style={{ gap: 8 }}>
                  <span
                    className="auth-card__brand-mark"
                    style={{ width: 28, height: 28, fontSize: 'var(--text-xs)' }}
                    aria-hidden="true"
                  >
                    {initials(row.displayName)}
                  </span>
                  <span>
                    {row.displayName}
                    <span className="field__hint" style={{ display: 'block' }}>
                      @{row.username}
                    </span>
                  </span>
                </span>
              )
            },
            { key: 'role', header: 'Role', render: (row) => row.roleName },
            {
              key: 'overrides',
              header: 'Overrides',
              render: (row) => (row.overrides.length === 0 ? '—' : `${row.overrides.length}`)
            },
            {
              key: 'lastLogin',
              header: 'Last sign-in',
              render: (row) =>
                row.lastLoginAt
                  ? `${formatDate(row.lastLoginAt.slice(0, 10))} ${row.lastLoginAt.slice(11, 16)}`
                  : 'Never'
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) =>
                row.isActive ? (
                  <Badge tone={row.mustChangePassword ? 'warning' : 'success'}>
                    {row.mustChangePassword ? 'Must change password' : 'Active'}
                  </Badge>
                ) : (
                  <Badge tone="warning">Disabled</Badge>
                )
            },
            {
              key: 'actions',
              header: '',
              render: (row: UserSummary) =>
                canManage ? (
                  <div className="toolbar" style={{ gap: 4 }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(row)
                        setForm({
                          username: row.username,
                          displayName: row.displayName,
                          password: '',
                          roleId: row.roleId,
                          isActive: row.isActive,
                          mustChangePassword: row.mustChangePassword
                        })
                        setOverrides(row.overrides)
                        setError(null)
                        setFormOpen(true)
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Reset password"
                      onClick={() => {
                        setEditing(row)
                        setForm({
                          username: row.username,
                          displayName: row.displayName,
                          password: '',
                          roleId: row.roleId,
                          isActive: row.isActive,
                          mustChangePassword: true
                        })
                        setOverrides(row.overrides)
                        setError('Set a new password below. The user must change it at the next sign-in.')
                        setFormOpen(true)
                      }}
                    >
                      <KeyRound size={14} />
                    </Button>
                  </div>
                ) : null
            }
          ]}
          rows={users.data ?? []}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              title="No user accounts"
              description="Create an account for each person who uses the system."
            />
          }
        />
      )}

      {formOpen ? (
        <Modal
          title={editing ? `Edit ${editing.displayName}` : 'New user account'}
          size="lg"
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={save.pending}
                onClick={async () => {
                  if (form.username.trim().length < 3) {
                    setError('The username needs at least 3 characters.')
                    return
                  }
                  if (!editing && form.password.length < 10) {
                    setError(
                      'Choose a password of at least 10 characters with upper case, lower case, a number and a symbol.'
                    )
                    return
                  }
                  if (form.roleId === 0) {
                    setError('Choose a role for this account.')
                    return
                  }
                  const result = await save.run({
                    id: editing?.id,
                    username: form.username.trim(),
                    displayName: form.displayName.trim() || form.username.trim(),
                    password: form.password || undefined,
                    roleId: form.roleId,
                    isActive: form.isActive,
                    mustChangePassword: form.mustChangePassword,
                    overrides
                  })
                  if (result.ok) {
                    app.toast({ tone: 'success', title: editing ? 'User updated' : 'User created' })
                    setFormOpen(false)
                    users.reload()
                  } else {
                    setError(result.error)
                  }
                }}
              >
                Save user
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
              label="Username"
              required
              value={form.username}
              onValueChange={(value) => setForm({ ...form, username: value })}
            />
            <TextInput
              label="Display name"
              value={form.displayName}
              onValueChange={(value) => setForm({ ...form, displayName: value })}
            />
            <TextInput
              label={editing ? 'New password (leave empty to keep)' : 'Password'}
              type="password"
              value={form.password}
              onValueChange={(value) => setForm({ ...form, password: value })}
              autoComplete="new-password"
            />
            <Select
              label="Role"
              required
              value={form.roleId ? String(form.roleId) : ''}
              onValueChange={(value) => setForm({ ...form, roleId: Number(value) })}
              options={(roles.data ?? []).map((role: RoleSummary) => ({
                value: String(role.id),
                label: `${role.name} (${role.permissionCodes.length} permissions)`
              }))}
              placeholder="Choose a role"
            />
          </div>
          <Checkbox
            label="Account is active"
            checked={form.isActive}
            onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
          />
          <Checkbox
            label="Require a password change at the next sign-in"
            checked={form.mustChangePassword}
            onCheckedChange={(checked) => setForm({ ...form, mustChangePassword: checked })}
          />

          <h4 style={{ marginTop: 'var(--space-4)' }}>Permission overrides</h4>
          <p className="field__hint">
            The role decides the baseline. An override here applies to this account only; “deny” always wins
            over “allow”.
          </p>
          {grouped.map(([module, entries]) => (
            <div key={module} style={{ marginBottom: 'var(--space-3)' }}>
              <strong>{module}</strong>
              <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
                {entries.map((entry) => {
                  const override = overrides.find((item) => item.code === entry.code)
                  return (
                    <div key={entry.code} className="toolbar" style={{ gap: 8 }}>
                      <span style={{ flex: 1 }}>
                        {entry.label}
                        {entry.destructive ? <Badge tone="danger">destructive</Badge> : null}
                        {entry.financial ? <Badge tone="warning">financial</Badge> : null}
                      </span>
                      <Button
                        size="sm"
                        variant={override?.effect === 'allow' ? 'primary' : 'default'}
                        onClick={() =>
                          setOverrides([
                            ...overrides.filter((item) => item.code !== entry.code),
                            ...(override?.effect === 'allow'
                              ? []
                              : [{ code: entry.code, effect: 'allow' as const }])
                          ])
                        }
                      >
                        Allow
                      </Button>
                      <Button
                        size="sm"
                        variant={override?.effect === 'deny' ? 'danger' : 'default'}
                        onClick={() =>
                          setOverrides([
                            ...overrides.filter((item) => item.code !== entry.code),
                            ...(override?.effect === 'deny'
                              ? []
                              : [{ code: entry.code, effect: 'deny' as const }])
                          ])
                        }
                      >
                        Deny
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </Modal>
      ) : null}
    </Card>
  )
}

function RolesTab() {
  const app = useApp()
  const confirm = useConfirm()
  const roles = useQuery('roles.list', undefined)
  const catalogue = useQuery('permissions.catalogue', undefined)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<RoleSummary | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<Set<PermissionCode>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const save = useAction(
    async (payload: {
      id?: number
      name: string
      description?: string | null
      permissions: PermissionCode[]
    }) =>
      payload.id
        ? invoke('roles.update', {
            id: payload.id,
            name: payload.name,
            description: payload.description,
            permissions: payload.permissions
          })
        : invoke('roles.create', payload)
  )
  const remove = useAction(async (id: number) => invoke('roles.delete', { id }))

  const grouped = useMemo(() => {
    const map = new Map<PermissionModule, PermissionCatalogEntry[]>()
    for (const entry of catalogue.data ?? []) {
      const list = map.get(entry.module) ?? []
      list.push(entry)
      map.set(entry.module, list)
    }
    return [...map.entries()]
  }, [catalogue.data])

  const canManage = app.hasPermission('roles.manage')

  return (
    <Card
      title="Roles"
      flush
      actions={
        canManage ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setName('')
              setDescription('')
              setSelected(new Set())
              setError(null)
              setFormOpen(true)
            }}
          >
            <ShieldCheck size={14} /> New role
          </Button>
        ) : null
      }
    >
      {roles.loading ? (
        <LoadingState />
      ) : roles.error ? (
        <ErrorState message={roles.error} onRetry={roles.reload} />
      ) : (
        <DataTable
          columns={[
            { key: 'name', header: 'Role', render: (row: RoleSummary) => row.name },
            { key: 'code', header: 'Code', render: (row) => <span className="mono">{row.code}</span> },
            {
              key: 'permissions',
              header: 'Permissions',
              align: 'right',
              render: (row) => row.permissionCodes.length
            },
            { key: 'users', header: 'Users', align: 'right', render: (row) => row.userCount },
            { key: 'description', header: 'Description', render: (row) => row.description ?? '—' },
            {
              key: 'source',
              header: 'Source',
              render: (row) => (row.isSystem ? <Badge tone="info">Built-in</Badge> : <Badge>Custom</Badge>)
            },
            {
              key: 'actions',
              header: '',
              render: (row: RoleSummary) =>
                canManage ? (
                  <div className="toolbar" style={{ gap: 4 }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(row)
                        setName(row.name)
                        setDescription(row.description ?? '')
                        setSelected(new Set(row.permissionCodes))
                        setError(null)
                        setFormOpen(true)
                      }}
                    >
                      Open
                    </Button>
                    {!row.isSystem ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          confirm({
                            title: 'Delete this role?',
                            message: `${row.name} will be deleted. Roles that are still assigned to users cannot be deleted.`,
                            tone: 'danger',
                            confirmLabel: 'Delete role',
                            onConfirm: async () => {
                              const result = await remove.run(row.id)
                              if (result.ok) {
                                app.toast({ tone: 'success', title: 'Role deleted' })
                                roles.reload()
                              } else throw new Error(result.error)
                            }
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    ) : null}
                  </div>
                ) : null
            }
          ]}
          rows={roles.data ?? []}
          rowKey={(row) => row.id}
          empty={<EmptyState title="No roles" description="Roles are seeded on first run." />}
        />
      )}

      {formOpen ? (
        <Modal
          title={editing ? `Role — ${editing.name}` : 'New role'}
          size="lg"
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={save.pending}
                onClick={async () => {
                  if (name.trim().length < 2) {
                    setError('Give the role a name.')
                    return
                  }
                  if (selected.size === 0) {
                    setError('Choose at least one permission, otherwise the role can do nothing.')
                    return
                  }
                  const result = await save.run({
                    id: editing?.id,
                    name: name.trim(),
                    description: description.trim() || null,
                    permissions: [...selected]
                  })
                  if (result.ok) {
                    app.toast({ tone: 'success', title: editing ? 'Role updated' : 'Role created' })
                    setFormOpen(false)
                    roles.reload()
                  } else {
                    setError(result.error)
                  }
                }}
              >
                Save role
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
            <TextInput label="Name" required value={name} onValueChange={setName} />
            <TextInput label="Description" value={description} onValueChange={setDescription} />
          </div>
          <div className="toolbar" style={{ marginBottom: 'var(--space-2)' }}>
            <Button
              size="sm"
              onClick={() => setSelected(new Set((catalogue.data ?? []).map((entry) => entry.code)))}
            >
              Select all
            </Button>
            <Button size="sm" onClick={() => setSelected(new Set())}>
              Clear all
            </Button>
            <span className="field__hint">{selected.size} permission(s) selected</span>
          </div>
          {grouped.map(([module, entries]) => (
            <div key={module} style={{ marginBottom: 'var(--space-3)' }}>
              <div className="toolbar">
                <strong>{module}</strong>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setSelected((current) => {
                      const next = new Set(current)
                      const allSelected = entries.every((entry) => next.has(entry.code))
                      for (const entry of entries) {
                        if (allSelected) next.delete(entry.code)
                        else next.add(entry.code)
                      }
                      return next
                    })
                  }
                >
                  Toggle module
                </Button>
              </div>
              <div style={{ display: 'grid', gap: 2, marginTop: 4 }}>
                {entries.map((entry) => (
                  <label key={entry.code} className="checkbox">
                    <input
                      type="checkbox"
                      checked={selected.has(entry.code)}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current)
                          if (next.has(entry.code)) next.delete(entry.code)
                          else next.add(entry.code)
                          return next
                        })
                      }
                    />
                    {entry.label}
                    {entry.destructive ? <Badge tone="danger">destructive</Badge> : null}
                    {entry.financial ? <Badge tone="warning">financial</Badge> : null}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </Modal>
      ) : null}
    </Card>
  )
}
