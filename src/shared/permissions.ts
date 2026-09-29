/**
 * Permission catalogue and resolution rules (single source of truth).
 *
 * The database is seeded from this catalogue at startup; the IPC router requires a permission for every
 * channel. Resolution rules (ADR-0006):
 *   effective = (role permissions ∪ user 'allow' overrides) − user 'deny' overrides
 * There is no implicit wildcard or "admin bypass" — the Administrator role simply holds every code.
 */

export const PERMISSION_MODULES = [
  'Dashboard',
  'Patients',
  'Appointments',
  'Queue',
  'Clinical',
  'Billing',
  'Finance',
  'Inventory',
  'People',
  'System'
] as const

export type PermissionModule = (typeof PERMISSION_MODULES)[number]

export const PERMISSION_CODES = [
  // Dashboard
  'dashboard.view',
  'dashboard.configure',
  // Patients
  'patients.view',
  'patients.create',
  'patients.edit',
  'patients.delete',
  'patients.attachments.view',
  'patients.attachments.manage',
  'patients.export',
  // Appointments
  'appointments.view',
  'appointments.create',
  'appointments.edit',
  'appointments.cancel',
  'appointments.delete',
  // Queue
  'queue.view',
  'queue.manage',
  'queue.reorder',
  'queue.priority',
  // Clinical
  'visits.view',
  'visits.create',
  'visits.edit',
  'visits.finalize',
  'visits.amend',
  'visits.delete',
  'chart.view',
  'chart.edit',
  'treatments.view',
  'treatments.manage',
  'prescriptions.view',
  'prescriptions.create',
  'prescriptions.edit',
  'prescriptions.delete',
  'prescriptions.print',
  // Billing
  'invoices.view',
  'invoices.create',
  'invoices.edit',
  'invoices.void',
  'invoices.print',
  'payments.view',
  'payments.create',
  'payments.void',
  'payments.print',
  // Finance
  'reports.financial.view',
  'reports.financial.export',
  'accounting.view',
  'accounting.manage',
  'accounting.export',
  // Inventory
  'inventory.view',
  'inventory.manage',
  'inventory.adjust',
  'inventory.export',
  // People
  'staff.view',
  'staff.manage',
  'users.view',
  'users.manage',
  'roles.manage',
  // System
  'settings.view',
  'settings.manage',
  'printers.manage',
  'backup.create',
  'backup.restore',
  'backup.configure',
  'audit.view',
  'audit.export',
  'data.export',
  'data.import',
  'data.destructive',
  'notifications.view',
  'notifications.manage'
] as const

export type PermissionCode = (typeof PERMISSION_CODES)[number]

export interface PermissionDefinition {
  code: PermissionCode
  module: PermissionModule
  label: string
  description: string
  /** Destructive or irreversible operations require re-authentication in addition to the permission. */
  destructive?: boolean
  /** Financial data access is never implied by another module's permissions. */
  financial?: boolean
}

const define = (
  code: PermissionCode,
  module: PermissionModule,
  label: string,
  description: string,
  flags: { destructive?: boolean; financial?: boolean } = {}
): PermissionDefinition => ({ code, module, label, description, ...flags })

export const PERMISSIONS: readonly PermissionDefinition[] = [
  define('dashboard.view', 'Dashboard', 'View dashboard', 'Open the clinic dashboard'),
  define('dashboard.configure', 'Dashboard', 'Configure dashboard', 'Show/hide dashboard widgets'),

  define('patients.view', 'Patients', 'View patients', 'Browse and search patient records'),
  define('patients.create', 'Patients', 'Create patients', 'Register new patients'),
  define('patients.edit', 'Patients', 'Edit patients', 'Modify patient demographics and history'),
  define('patients.delete', 'Patients', 'Delete patients', 'Archive/delete patient records', {
    destructive: true
  }),
  define('patients.attachments.view', 'Patients', 'View attachments', 'Open patient documents and images'),
  define(
    'patients.attachments.manage',
    'Patients',
    'Manage attachments',
    'Add, rename and delete attachments',
    {
      destructive: true
    }
  ),
  define('patients.export', 'Patients', 'Export patients', 'Export patient lists and profiles', {
    financial: true
  }),

  define('appointments.view', 'Appointments', 'View appointments', 'See appointment schedule'),
  define('appointments.create', 'Appointments', 'Create appointments', 'Book new appointments'),
  define('appointments.edit', 'Appointments', 'Edit appointments', 'Edit, reschedule and change status'),
  define('appointments.cancel', 'Appointments', 'Cancel appointments', 'Cancel or mark no-show'),
  define('appointments.delete', 'Appointments', 'Delete appointments', 'Permanently remove appointments', {
    destructive: true
  }),

  define('queue.view', 'Queue', 'View queue', "See today's patient queue"),
  define('queue.manage', 'Queue', 'Manage queue', 'Add patients to the queue and change status'),
  define('queue.reorder', 'Queue', 'Reorder queue', 'Change queue positions and call order'),
  define('queue.priority', 'Queue', 'Set priority', 'Mark queue entries as urgent'),

  define('visits.view', 'Clinical', 'View visits', 'Read visit records'),
  define('visits.create', 'Clinical', 'Create visits', 'Record new visits'),
  define('visits.edit', 'Clinical', 'Edit visits', 'Modify draft visits'),
  define('visits.finalize', 'Clinical', 'Finalize visits', 'Finalize a visit and freeze its record'),
  define('visits.amend', 'Clinical', 'Amend visits', 'Amend a finalized visit with an audit trail'),
  define('visits.delete', 'Clinical', 'Delete visits', 'Delete visit records', { destructive: true }),
  define('chart.view', 'Clinical', 'View dental chart', 'View dental chart and history'),
  define('chart.edit', 'Clinical', 'Edit dental chart', 'Mark teeth, conditions and treatments'),
  define('treatments.view', 'Clinical', 'View treatments', 'Browse the treatment catalogue'),
  define('treatments.manage', 'Clinical', 'Manage treatments', 'Create and edit treatment catalogue entries'),
  define('prescriptions.view', 'Clinical', 'View prescriptions', 'Read prescriptions'),
  define('prescriptions.create', 'Clinical', 'Create prescriptions', 'Write prescriptions'),
  define('prescriptions.edit', 'Clinical', 'Edit prescriptions', 'Modify prescriptions'),
  define('prescriptions.delete', 'Clinical', 'Delete prescriptions', 'Void prescriptions', {
    destructive: true
  }),
  define('prescriptions.print', 'Clinical', 'Print prescriptions', 'Print or export prescription PDFs'),

  define('invoices.view', 'Billing', 'View invoices', 'Read invoices and balances', { financial: true }),
  define('invoices.create', 'Billing', 'Create invoices', 'Raise new invoices', { financial: true }),
  define('invoices.edit', 'Billing', 'Edit invoices', 'Modify unpaid invoices', { financial: true }),
  define('invoices.void', 'Billing', 'Void invoices', 'Void invoices with audit trail', {
    destructive: true,
    financial: true
  }),
  define('invoices.print', 'Billing', 'Print invoices', 'Print or export invoice PDFs', { financial: true }),
  define('payments.view', 'Billing', 'View payments', 'Read payment transactions', { financial: true }),
  define('payments.create', 'Billing', 'Record payments', 'Record and adjust payments', { financial: true }),
  define('payments.void', 'Billing', 'Void payments', 'Void payment transactions', {
    destructive: true,
    financial: true
  }),
  define('payments.print', 'Billing', 'Print receipts', 'Print or export payment receipts', {
    financial: true
  }),

  define(
    'reports.financial.view',
    'Finance',
    'View financial reports',
    'See revenue, dues and cash-flow reports',
    {
      financial: true
    }
  ),
  define('reports.financial.export', 'Finance', 'Export financial reports', 'Export financial reports', {
    financial: true
  }),
  define('accounting.view', 'Finance', 'View accounting', 'See income and expense records', {
    financial: true
  }),
  define('accounting.manage', 'Finance', 'Manage accounting', 'Record and edit expenses and income', {
    financial: true
  }),
  define('accounting.export', 'Finance', 'Export accounting', 'Export accounting data', { financial: true }),

  define('inventory.view', 'Inventory', 'View inventory', 'Browse stock items and history'),
  define('inventory.manage', 'Inventory', 'Manage inventory', 'Add items, batches and purchases'),
  define('inventory.adjust', 'Inventory', 'Adjust stock', 'Adjust, consume or write off stock'),
  define('inventory.export', 'Inventory', 'Export inventory', 'Export stock lists and movements'),

  define('staff.view', 'People', 'View staff', 'See staff records including salary'),
  define('staff.manage', 'People', 'Manage staff', 'Create and edit staff records'),
  define('users.view', 'People', 'View users', 'See application users and roles'),
  define('users.manage', 'People', 'Manage users', 'Create, edit, deactivate users and reset passwords', {
    destructive: true
  }),
  define('roles.manage', 'People', 'Manage roles', 'Create and edit roles and permissions', {
    destructive: true
  }),

  define('settings.view', 'System', 'View settings', 'Open the settings section'),
  define(
    'settings.manage',
    'System',
    'Manage settings',
    'Change clinic, clinical, billing and system settings'
  ),
  define('printers.manage', 'System', 'Manage printers', 'Create and edit printer profiles'),
  define('backup.create', 'System', 'Create backups', 'Run manual and automatic backups'),
  define('backup.restore', 'System', 'Restore backups', 'Restore clinic data from a backup', {
    destructive: true
  }),
  define('backup.configure', 'System', 'Configure backups', 'Choose backup folders, schedule and encryption'),
  define('audit.view', 'System', 'View audit log', 'Read the security audit trail'),
  define('audit.export', 'System', 'Export audit log', 'Export audit records'),
  define('data.export', 'System', 'Export data', 'Export clinic data sets', { financial: true }),
  define('data.import', 'System', 'Import data', 'Import clinic data sets', { destructive: true }),
  define('data.destructive', 'System', 'Destructive data actions', 'Delete all or bulk data', {
    destructive: true
  }),
  define('notifications.view', 'System', 'View notifications', 'See the notification centre'),
  define('notifications.manage', 'System', 'Manage notifications', 'Configure and dismiss notifications')
]

export const ALL_PERMISSION_CODES: readonly PermissionCode[] = PERMISSIONS.map((p) => p.code)

const PERMISSION_BY_CODE = new Map<string, PermissionDefinition>(PERMISSIONS.map((p) => [p.code, p]))

export function isPermissionCode(value: string): value is PermissionCode {
  return PERMISSION_BY_CODE.has(value)
}

export function getPermission(code: string): PermissionDefinition | undefined {
  return PERMISSION_BY_CODE.get(code)
}

export function permissionsByModule(): { module: PermissionModule; permissions: PermissionDefinition[] }[] {
  return PERMISSION_MODULES.map((module) => ({
    module,
    permissions: PERMISSIONS.filter((p) => p.module === module)
  }))
}

// ---------------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------------

export type PermissionEffect = 'allow' | 'deny'

export interface PermissionOverride {
  code: PermissionCode
  effect: PermissionEffect
}

export interface PermissionInput {
  rolePermissions: readonly PermissionCode[]
  overrides?: readonly PermissionOverride[]
}

/** Compute the effective permission set (deny always wins). */
export function resolvePermissions(input: PermissionInput): Set<PermissionCode> {
  const effective = new Set<PermissionCode>()
  for (const code of input.rolePermissions) effective.add(code)
  for (const override of input.overrides ?? []) {
    if (override.effect === 'allow') effective.add(override.code)
    else effective.delete(override.code)
  }
  return effective
}

export function hasPermission(effective: ReadonlySet<PermissionCode>, code: PermissionCode): boolean {
  return effective.has(code)
}

export function hasAnyPermission(
  effective: ReadonlySet<PermissionCode>,
  codes: readonly PermissionCode[]
): boolean {
  return codes.some((code) => effective.has(code))
}

export function hasAllPermissions(
  effective: ReadonlySet<PermissionCode>,
  codes: readonly PermissionCode[]
): boolean {
  return codes.every((code) => effective.has(code))
}

/** Permissions that require the acting user to re-enter their password before the action runs. */
export function requiresReauthentication(code: PermissionCode): boolean {
  return getPermission(code)?.destructive === true
}

export function isFinancialPermission(code: PermissionCode): boolean {
  return getPermission(code)?.financial === true
}

// ---------------------------------------------------------------------------------------------
// System roles (seeded on first run; fully editable afterwards)
// ---------------------------------------------------------------------------------------------

export interface SystemRoleDefinition {
  code: string
  name: string
  description: string
  permissions: readonly PermissionCode[]
}

const CLINICAL_CORE: readonly PermissionCode[] = [
  'dashboard.view',
  'patients.view',
  'patients.create',
  'patients.edit',
  'patients.attachments.view',
  'patients.attachments.manage',
  'appointments.view',
  'appointments.create',
  'appointments.edit',
  'appointments.cancel',
  'queue.view',
  'queue.manage',
  'queue.reorder',
  'queue.priority',
  'visits.view',
  'visits.create',
  'visits.edit',
  'visits.finalize',
  'visits.amend',
  'chart.view',
  'chart.edit',
  'treatments.view',
  'prescriptions.view',
  'prescriptions.create',
  'prescriptions.edit',
  'prescriptions.print',
  'inventory.view',
  'inventory.manage',
  'notifications.view'
]

const BILLING_FRONT_DESK: readonly PermissionCode[] = [
  'invoices.view',
  'invoices.create',
  'invoices.print',
  'payments.view',
  'payments.create',
  'payments.print'
]

export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    code: 'administrator',
    name: 'Administrator',
    description: 'Clinic owner or manager with unrestricted access to every module.',
    permissions: ALL_PERMISSION_CODES
  },
  {
    code: 'dentist',
    name: 'Dentist',
    description:
      'Clinical work: patients, visits, dental chart, prescriptions and appointments. Financial reports are not included by default.',
    permissions: [
      ...CLINICAL_CORE,
      'invoices.view',
      'invoices.create',
      'invoices.print',
      'payments.create',
      'treatments.manage',
      'prescriptions.delete',
      'settings.view'
    ]
  },
  {
    code: 'receptionist',
    name: 'Receptionist',
    description: 'Front desk: registration, scheduling, queue, invoicing and payment collection.',
    permissions: [
      'dashboard.view',
      'patients.view',
      'patients.create',
      'patients.edit',
      'patients.attachments.view',
      'appointments.view',
      'appointments.create',
      'appointments.edit',
      'appointments.cancel',
      'queue.view',
      'queue.manage',
      'queue.reorder',
      'notifications.view',
      ...BILLING_FRONT_DESK
    ]
  },
  {
    code: 'accountant',
    name: 'Accountant',
    description: 'Finance: invoices, payments, expenses, accounting and financial reports.',
    permissions: [
      'dashboard.view',
      'patients.view',
      'invoices.view',
      'invoices.print',
      'invoices.void',
      'payments.view',
      'payments.create',
      'payments.void',
      'payments.print',
      'reports.financial.view',
      'reports.financial.export',
      'accounting.view',
      'accounting.manage',
      'accounting.export',
      'inventory.view',
      'notifications.view',
      'data.export'
    ]
  },
  {
    code: 'assistant',
    name: 'Assistant / Nurse',
    description: 'Chair-side support: queue, chart viewing, visit reading and stock handling.',
    permissions: [
      'dashboard.view',
      'patients.view',
      'patients.attachments.view',
      'appointments.view',
      'queue.view',
      'queue.manage',
      'visits.view',
      'chart.view',
      'prescriptions.view',
      'treatments.view',
      'inventory.view',
      'inventory.manage',
      'notifications.view'
    ]
  },
  {
    code: 'auditor',
    name: 'Auditor (read-only)',
    description: 'Read-only oversight of clinical, financial and security records.',
    permissions: [
      'dashboard.view',
      'patients.view',
      'patients.attachments.view',
      'appointments.view',
      'queue.view',
      'visits.view',
      'chart.view',
      'prescriptions.view',
      'treatments.view',
      'invoices.view',
      'payments.view',
      'reports.financial.view',
      'accounting.view',
      'inventory.view',
      'staff.view',
      'users.view',
      'audit.view',
      'audit.export',
      'notifications.view',
      'settings.view'
    ]
  }
]

/** Invariant safety rules enforced by the user/role services (see RBAC specification §4). */
export const CRITICAL_PERMISSIONS: readonly PermissionCode[] = [
  'users.manage',
  'roles.manage',
  'data.destructive',
  'backup.restore'
]
