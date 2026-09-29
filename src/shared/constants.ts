import type { PermissionCode } from './permissions'

/**
 * Application constants, system default catalogues and security parameters.
 *
 * "System default" rows are seeded on first run and clearly marked as such in the UI; administrators may
 * rename, reorder, deactivate or add entries, but the seeds give a new clinic a complete, usable system
 * immediately (REQ §120). No demo patients, appointments or financial records are ever created (§119).
 */

export const APP_INFO = {
  productName: 'Dentiva Pro',
  shortName: 'Dentiva',
  tagline: 'Advanced dental clinic management — offline and yours',
  author: 'Shohan Khan',
  authorEmail: 'helloiamshohan@gmail.com',
  copyright: `Copyright © ${new Date().getFullYear()} Shohan Khan. All rights reserved.`,
  dataFormatVersion: 1,
  defaultDataFolderName: 'Dentiva Pro',
  appId: 'com.dentivapro.desktop'
} as const

/** Build metadata is injected at build time by electron-vite (`define`). */
export interface BuildInfo {
  version: string
  buildNumber: string
  commit: string
  buildDate: string
}

export const DEFAULT_BUILD_INFO: BuildInfo = {
  version: '1.0.0',
  buildNumber: '1',
  commit: 'development',
  buildDate: 'development'
}

// ---------------------------------------------------------------------------------------------
// Security parameters
// ---------------------------------------------------------------------------------------------

export const WEAK_PASSWORDS: readonly string[] = [
  'password',
  'password1',
  'password123',
  'administrator',
  'administrator1',
  'admin',
  'admin123',
  'dentist',
  'dentist123',
  'dentiva',
  'dentivapro',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'clinic123',
  'welcome123',
  'letmein123',
  'iloveyou',
  'abc12345'
]

export const PASSWORD_POLICY = {
  minLength: 10,
  maxLength: 128,
  requireClasses: 3,
  classes: {
    lower: /[a-z]/,
    upper: /[A-Z]/,
    digit: /[0-9]/,
    symbol: /[^A-Za-z0-9]/
  },
  weakPasswords: WEAK_PASSWORDS
} as const

export const SCRYPT_PARAMS = {
  N: 32768, // 2^15
  r: 8,
  p: 1,
  keyLength: 32,
  saltLength: 16
} as const

export const LOGIN_POLICY = {
  maxFailedAttempts: 5,
  lockoutMinutes: 5,
  maxActivationAttempts: 10,
  activationCooldownSeconds: 60
} as const

export const LOCK_TIMEOUT_OPTIONS = [5, 10, 15, 30] as const
export type LockTimeoutMinutes = (typeof LOCK_TIMEOUT_OPTIONS)[number]

export const BACKUP_INTERVAL_OPTIONS = [7, 15, 30] as const

/** Human wording for `BackupRecord.trigger`, so a notification never shows a raw enum value. */
export const BACKUP_TRIGGER_LABELS = {
  manual: 'Manual backup',
  auto: 'Automatic backup',
  pre_destructive: 'Safety backup before a destructive action',
  pre_restore: 'Safety backup before a restore'
} as const
export type BackupIntervalDays = (typeof BACKUP_INTERVAL_OPTIONS)[number]

/**
 * Patient import (master §40, REQ-DATA-001). The template below is the file the clinic fills in; the
 * service maps these labels, validates every row with the same schema the registration form uses, reports
 * every problem with its row number and imports all-or-nothing.
 */
export const PATIENT_IMPORT = {
  maxBytes: 5 * 1024 * 1024,
  maxRows: 5000,
  templateHeader: [
    'Full Name',
    'Name (Bangla)',
    'Phone',
    'Alternate Phone',
    'Email',
    'Gender',
    'Date of Birth',
    'Age',
    'Blood Group',
    'Address',
    'City',
    'National ID',
    'Occupation',
    'Guardian Name',
    'Emergency Phone',
    'Allergies',
    'Medical History',
    'Notes'
  ]
} as const

export const ATTACHMENT_LIMITS = {
  maxSizeBytes: 25 * 1024 * 1024,
  allowedExtensions: [
    '.pdf',
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.gif',
    '.bmp',
    '.tif',
    '.tiff',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.txt',
    '.csv',
    '.rtf',
    '.odt',
    '.ods',
    '.dcm' // dental imaging export
  ],
  allowedMimeTypes: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/tiff',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'application/rtf',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet'
  ]
} as const

// ---------------------------------------------------------------------------------------------
// Domain enumerations
// ---------------------------------------------------------------------------------------------

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'arrived',
  'in_queue',
  'in_treatment',
  'completed',
  'cancelled',
  'no_show',
  'rescheduled'
] as const
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  arrived: 'Arrived',
  in_queue: 'In Queue',
  in_treatment: 'In Treatment',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
  rescheduled: 'Rescheduled'
}

export const QUEUE_STATUSES = ['waiting', 'called', 'in_treatment', 'completed', 'left', 'cancelled'] as const
export type QueueStatus = (typeof QUEUE_STATUSES)[number]

export const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  waiting: 'Waiting',
  called: 'Called',
  in_treatment: 'In Treatment',
  completed: 'Completed',
  left: 'Left',
  cancelled: 'Cancelled'
}

export const QUEUE_PRIORITIES = ['normal', 'urgent', 'emergency'] as const
export type QueuePriority = (typeof QUEUE_PRIORITIES)[number]

export const QUEUE_PRIORITY_LABELS: Record<QueuePriority, string> = {
  normal: 'Normal',
  urgent: 'Urgent',
  emergency: 'Emergency'
}

export const VISIT_STATUSES = ['draft', 'final', 'amended'] as const
export type VisitStatus = (typeof VISIT_STATUSES)[number]

export const PRESCRIPTION_STATUSES = ['draft', 'final', 'void'] as const
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number]
/** Statuses a prescription may be saved with; `void` is only reachable through the void action. */
export const PRESCRIPTION_WRITE_STATUSES = ['draft', 'final'] as const
export type PrescriptionWriteStatus = (typeof PRESCRIPTION_WRITE_STATUSES)[number]

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  draft: 'Draft',
  final: 'Finalised',
  amended: 'Amended'
}

export const INVOICE_STATUSES = ['unpaid', 'partial', 'paid', 'overpaid', 'void'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  unpaid: 'Unpaid',
  partial: 'Partially Paid',
  paid: 'Paid',
  overpaid: 'Overpaid',
  void: 'Void'
}

export const PAYMENT_KINDS = ['payment', 'advance', 'refund'] as const
export type PaymentKind = (typeof PAYMENT_KINDS)[number]

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  payment: 'Payment',
  advance: 'Advance',
  refund: 'Refund'
}

export const DENTITIONS = ['permanent', 'primary'] as const
export type Dentition = (typeof DENTITIONS)[number]

export const TOOTH_SURFACES = ['M', 'D', 'B', 'L', 'O', 'I'] as const
export type ToothSurface = (typeof TOOTH_SURFACES)[number]

export const TOOTH_SURFACE_LABELS: Record<ToothSurface, string> = {
  M: 'Mesial',
  D: 'Distal',
  B: 'Buccal',
  L: 'Lingual',
  O: 'Occlusal',
  I: 'Incisal'
}

export const REFERRAL_STATUSES = ['pending', 'accepted', 'completed', 'cancelled'] as const
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number]

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  completed: 'Completed',
  cancelled: 'Cancelled'
}

export const STAFF_STATUSES = ['active', 'on_leave', 'inactive', 'terminated'] as const
export type StaffStatus = (typeof STAFF_STATUSES)[number]

export const STAFF_STATUS_LABELS: Record<StaffStatus, string> = {
  active: 'Active',
  on_leave: 'On leave',
  inactive: 'Inactive',
  terminated: 'Terminated'
}

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'] as const

export const GENDERS = ['male', 'female', 'other'] as const
export type Gender = (typeof GENDERS)[number]

export const GENDER_LABELS: Record<Gender, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other'
}

export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed', 'other'] as const

export const RELATIONSHIP_TYPES = [
  'father',
  'mother',
  'spouse',
  'son',
  'daughter',
  'brother',
  'sister',
  'guardian',
  'friend',
  'other'
] as const

/**
 * Financial report catalogue: the single list the reports screen renders, the router validates and the
 * report builders implement. Keeping the keys here means a report cannot exist in one layer and be missing
 * in another (the reports suite asserts every entry produces a real, titled report).
 */
export const REPORT_KEYS = [
  'daily_income',
  'expense_summary',
  'net_cash_flow',
  'outstanding_dues',
  'payment_methods',
  'treatment_revenue',
  'invoice_summary',
  'expense_categories',
  'inventory_purchases',
  'period_summary'
] as const
export type ReportKey = (typeof REPORT_KEYS)[number]

/**
 * The entity families the data-export service can write. The payload schema, the service signature and the
 * screens all read this list, so an export button can never ask for something the service cannot produce.
 */
export const EXPORT_ENTITIES = [
  'patients',
  'invoices',
  'payments',
  'expenses',
  'inventory',
  'inventory_movements',
  'appointments',
  'visits',
  'prescriptions',
  'staff',
  'audit'
] as const
export type ExportEntity = (typeof EXPORT_ENTITIES)[number]

export interface ReportDefinition {
  key: ReportKey
  label: string
  description: string
}

export const REPORT_CATALOGUE: readonly ReportDefinition[] = [
  {
    key: 'daily_income',
    label: 'Daily income',
    description: 'Invoiced, received and net figures for each day'
  },
  { key: 'expense_summary', label: 'Expense summary', description: 'Expenses grouped by category' },
  { key: 'net_cash_flow', label: 'Net cash flow', description: 'Received minus expenses per day' },
  { key: 'outstanding_dues', label: 'Outstanding dues', description: 'Patients who still owe money' },
  {
    key: 'payment_methods',
    label: 'Payment methods',
    description: 'Receipts grouped by cash, bKash, Nagad, card and bank'
  },
  {
    key: 'treatment_revenue',
    label: 'Treatment revenue',
    description: 'Income by treatment, with quantities'
  },
  {
    key: 'invoice_summary',
    label: 'Invoice summary',
    description: 'Per-invoice totals, paid and outstanding'
  },
  {
    key: 'expense_categories',
    label: 'Expense categories',
    description: 'Category totals with entry counts'
  },
  {
    key: 'inventory_purchases',
    label: 'Inventory purchases',
    description: 'Stock-in value per item and supplier'
  },
  {
    key: 'period_summary',
    label: 'Period summary',
    description: 'One-page summary of a chosen period for the monthly review'
  }
]

export const NOTIFICATION_CATEGORIES = [
  'appointment',
  'queue',
  'inventory',
  'billing',
  'backup',
  'restore',
  'security',
  'system'
] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  appointment: 'Appointment',
  queue: 'Queue',
  inventory: 'Inventory',
  billing: 'Billing',
  backup: 'Backup',
  restore: 'Restore',
  security: 'Security',
  system: 'System'
}

export const NOTIFICATION_PRIORITIES = ['info', 'warning', 'critical'] as const
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number]

export const AUDIT_SEVERITIES = ['info', 'warning', 'critical'] as const
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number]

export const INVENTORY_TRANSACTION_TYPES = [
  'opening',
  'purchase',
  'usage',
  'adjustment_in',
  'adjustment_out',
  'wastage',
  'return',
  'expired'
] as const
export type InventoryTransactionType = (typeof INVENTORY_TRANSACTION_TYPES)[number]

export const INVENTORY_TRANSACTION_TYPE_LABELS: Record<InventoryTransactionType, string> = {
  opening: 'Opening stock',
  purchase: 'Purchase (stock in)',
  usage: 'Used in treatment',
  adjustment_in: 'Adjustment (increase)',
  adjustment_out: 'Adjustment (decrease)',
  wastage: 'Wastage',
  return: 'Returned to supplier',
  expired: 'Expired write-off'
}

export const INVENTORY_UNITS = [
  'piece',
  'box',
  'packet',
  'bottle',
  'tube',
  'sachet',
  'cartridge',
  'ml',
  'gram',
  'set'
] as const

export const ITEM_CATEGORIES = [
  'Restorative',
  'Endodontic',
  'Prosthodontic',
  'Orthodontic',
  'Surgical',
  'Preventive',
  'Disposable',
  'Anaesthetic',
  'Instrument',
  'Medication',
  'Other'
] as const

// ---------------------------------------------------------------------------------------------
// System default catalogues (seeded, admin editable)
// ---------------------------------------------------------------------------------------------

export interface SeedOption {
  value: string
  valueBn?: string
  sortOrder?: number
}

export const DEFAULT_CLINICAL_OPTIONS: Record<string, SeedOption[]> = {
  chief_complaint: [
    { value: 'Pain' },
    { value: 'G. caries' },
    { value: 'Swelling' },
    { value: 'Gum bleeding' },
    { value: 'Bad breath' },
    { value: 'Sensitivity' },
    { value: 'Mobile tooth' },
    { value: 'Food impaction' },
    { value: 'Ulcer' },
    { value: 'Trauma' },
    { value: 'Routine check-up' },
    { value: 'Other' }
  ],
  examination: [
    { value: 'Caries' },
    { value: 'G. caries' },
    { value: 'BDR' },
    { value: 'BDC' },
    { value: 'Gingivitis' },
    { value: 'Periodontal pocket' },
    { value: 'Periodontitis' },
    { value: 'Pulpitis' },
    { value: 'Periapical abscess' },
    { value: 'Impacted teeth' },
    { value: 'Dry socket' },
    { value: 'Attrition' },
    { value: 'Erosion' },
    { value: 'Abrasion' },
    { value: 'Fractured tooth' },
    { value: 'Missing teeth' },
    { value: 'Malocclusion' },
    { value: 'TMJ disorder' },
    { value: 'Other' }
  ],
  advice: [
    { value: 'Avoid hot and cold food for 24 hours' },
    { value: 'Do not chew on the treated side for 24 hours' },
    { value: 'Maintain oral hygiene: brush twice daily' },
    { value: 'Use soft bristle toothbrush' },
    { value: 'Rinse with warm salt water' },
    { value: 'Complete the full course of medicine' },
    { value: 'Avoid smoking and tobacco' },
    { value: 'Reduce sugary food and drinks' },
    { value: 'Return if pain persists or increases' },
    { value: 'Take soft, lukewarm diet' },
    { value: 'Other' }
  ],
  medicine_type: [
    { value: 'Tablet' },
    { value: 'Capsule' },
    { value: 'Syrup' },
    { value: 'Suspension' },
    { value: 'Cream' },
    { value: 'Gel' },
    { value: 'Ointment' },
    { value: 'Drops' },
    { value: 'Mouthwash' },
    { value: 'Injection' },
    { value: 'Powder' },
    { value: 'Spray' }
  ],
  medicine_timing: [
    { value: 'Before food' },
    { value: 'After food' },
    { value: 'With food' },
    { value: 'Empty stomach' },
    { value: 'At bedtime' },
    { value: 'Anytime' }
  ],
  medicine_instruction: [
    { value: 'Take if pain occurs' },
    { value: 'Take if fever occurs' },
    { value: 'Do not chew, swallow whole' },
    { value: 'Shake well before use' },
    { value: 'Apply on the affected area only' },
    { value: 'Rinse and spit out, do not swallow' },
    { value: 'Continue until the course is finished' },
    { value: 'Stop if rash or allergy appears' }
  ],
  duration_unit: [
    { value: 'day', valueBn: 'দিন' },
    { value: 'week', valueBn: 'সপ্তাহ' },
    { value: 'month', valueBn: 'মাস' },
    { value: 'dose', valueBn: 'ডোজ' },
    { value: 'continuing', valueBn: 'চলমান' }
  ],
  appointment_type: [
    { value: 'Consultation' },
    { value: 'Treatment' },
    { value: 'Follow-up' },
    { value: 'Scaling & polishing' },
    { value: 'Root canal' },
    { value: 'Extraction' },
    { value: 'Filling' },
    { value: 'Crown / bridge seating' },
    { value: 'Orthodontic adjustment' },
    { value: 'Denture trial' },
    { value: 'Report review' },
    { value: 'Emergency' }
  ],
  treatment_category: [
    { value: 'Diagnostic' },
    { value: 'Preventive' },
    { value: 'Restorative' },
    { value: 'Endodontic' },
    { value: 'Periodontic' },
    { value: 'Prosthodontic' },
    { value: 'Orthodontic' },
    { value: 'Oral surgery' },
    { value: 'Pediatric' },
    { value: 'Cosmetic' },
    { value: 'Radiology' },
    { value: 'Other' }
  ],
  referral_reason: [
    { value: 'Specialist consultation' },
    { value: 'Cone-beam CT / imaging' },
    { value: 'Biopsy and histopathology' },
    { value: 'Orthodontic treatment' },
    { value: 'Minor oral surgery' },
    { value: 'Maxillofacial surgery' },
    { value: 'Restorative specialist opinion' },
    { value: 'Medical consultation' }
  ]
}

export interface SeedCondition {
  code: string
  name: string
  color: string
  textColor: string
  category: 'condition' | 'treatment' | 'restoration'
  appliesTo: 'permanent' | 'primary' | 'both'
  sortOrder: number
}

export const DEFAULT_DENTAL_CONDITIONS: SeedCondition[] = [
  {
    code: 'SOUND',
    name: 'Sound / healthy',
    color: '#ffffff',
    textColor: '#0f172a',
    category: 'condition',
    appliesTo: 'both',
    sortOrder: 1
  },
  {
    code: 'CARIES',
    name: 'Caries',
    color: '#ef4444',
    textColor: '#ffffff',
    category: 'condition',
    appliesTo: 'both',
    sortOrder: 2
  },
  {
    code: 'DEEP_CARIES',
    name: 'Deep caries',
    color: '#b91c1c',
    textColor: '#ffffff',
    category: 'condition',
    appliesTo: 'both',
    sortOrder: 3
  },
  {
    code: 'PULPITIS',
    name: 'Pulpitis',
    color: '#f97316',
    textColor: '#ffffff',
    category: 'condition',
    appliesTo: 'both',
    sortOrder: 4
  },
  {
    code: 'NECROSIS',
    name: 'Pulpal necrosis',
    color: '#7c2d12',
    textColor: '#ffffff',
    category: 'condition',
    appliesTo: 'both',
    sortOrder: 5
  },
  {
    code: 'PERIAPICAL',
    name: 'Periapical pathology',
    color: '#a855f7',
    textColor: '#ffffff',
    category: 'condition',
    appliesTo: 'both',
    sortOrder: 6
  },
  {
    code: 'MOBILE',
    name: 'Mobile tooth',
    color: '#0ea5e9',
    textColor: '#ffffff',
    category: 'condition',
    appliesTo: 'both',
    sortOrder: 7
  },
  {
    code: 'GINGIVITIS',
    name: 'Gingivitis',
    color: '#fbbf24',
    textColor: '#0f172a',
    category: 'condition',
    appliesTo: 'both',
    sortOrder: 8
  },
  {
    code: 'PERIODONTITIS',
    name: 'Periodontitis',
    color: '#f59e0b',
    textColor: '#0f172a',
    category: 'condition',
    appliesTo: 'both',
    sortOrder: 9
  },
  {
    code: 'MISSING',
    name: 'Missing',
    color: '#475569',
    textColor: '#ffffff',
    category: 'condition',
    appliesTo: 'both',
    sortOrder: 10
  },
  {
    code: 'IMPACTED',
    name: 'Impacted',
    color: '#64748b',
    textColor: '#ffffff',
    category: 'condition',
    appliesTo: 'both',
    sortOrder: 11
  },
  {
    code: 'FRACTURED',
    name: 'Fractured',
    color: '#dc2626',
    textColor: '#ffffff',
    category: 'condition',
    appliesTo: 'both',
    sortOrder: 12
  },
  {
    code: 'ATTRITION',
    name: 'Attrition / erosion',
    color: '#84cc16',
    textColor: '#0f172a',
    category: 'condition',
    appliesTo: 'both',
    sortOrder: 13
  },
  {
    code: 'FILLING',
    name: 'Restoration (filling)',
    color: '#2563eb',
    textColor: '#ffffff',
    category: 'restoration',
    appliesTo: 'both',
    sortOrder: 14
  },
  {
    code: 'CROWN',
    name: 'Crown',
    color: '#1d4ed8',
    textColor: '#ffffff',
    category: 'restoration',
    appliesTo: 'permanent',
    sortOrder: 15
  },
  {
    code: 'BRIDGE',
    name: 'Bridge abutment',
    color: '#4338ca',
    textColor: '#ffffff',
    category: 'restoration',
    appliesTo: 'permanent',
    sortOrder: 16
  },
  {
    code: 'RCT',
    name: 'Root canal treated',
    color: '#0d9488',
    textColor: '#ffffff',
    category: 'treatment',
    appliesTo: 'both',
    sortOrder: 17
  },
  {
    code: 'IMPLANT',
    name: 'Implant',
    color: '#059669',
    textColor: '#ffffff',
    category: 'treatment',
    appliesTo: 'permanent',
    sortOrder: 18
  },
  {
    code: 'EXTRACTION_PLANNED',
    name: 'Extraction planned',
    color: '#e11d48',
    textColor: '#ffffff',
    category: 'treatment',
    appliesTo: 'both',
    sortOrder: 19
  },
  {
    code: 'SEALANT',
    name: 'Sealant / fluoride',
    color: '#22c55e',
    textColor: '#0f172a',
    category: 'treatment',
    appliesTo: 'primary',
    sortOrder: 20
  },
  {
    code: 'ORTHO',
    name: 'Orthodontic appliance',
    color: '#8b5cf6',
    textColor: '#ffffff',
    category: 'treatment',
    appliesTo: 'both',
    sortOrder: 21
  }
]

export interface SeedTreatment {
  code: string
  name: string
  category: string
  defaultFeePoisha: number
  durationMinutes: number
}

/** System default treatment catalogue — a complete starting point a clinic can extend or re-price. */
export const DEFAULT_TREATMENTS: SeedTreatment[] = [
  {
    code: 'CONS-01',
    name: 'Consultation & examination',
    category: 'Diagnostic',
    defaultFeePoisha: 50000,
    durationMinutes: 15
  },
  {
    code: 'DX-01',
    name: 'Periapical radiograph (IOPA)',
    category: 'Radiology',
    defaultFeePoisha: 30000,
    durationMinutes: 10
  },
  {
    code: 'DX-02',
    name: 'OPG / panoramic radiograph',
    category: 'Radiology',
    defaultFeePoisha: 90000,
    durationMinutes: 15
  },
  {
    code: 'PREV-01',
    name: 'Scaling & polishing (full mouth)',
    category: 'Preventive',
    defaultFeePoisha: 150000,
    durationMinutes: 30
  },
  {
    code: 'PREV-02',
    name: 'Fluoride application',
    category: 'Preventive',
    defaultFeePoisha: 80000,
    durationMinutes: 15
  },
  {
    code: 'PREV-03',
    name: 'Pit and fissure sealant (per tooth)',
    category: 'Preventive',
    defaultFeePoisha: 70000,
    durationMinutes: 15
  },
  {
    code: 'REST-01',
    name: 'Composite filling (per tooth, anterior)',
    category: 'Restorative',
    defaultFeePoisha: 200000,
    durationMinutes: 30
  },
  {
    code: 'REST-02',
    name: 'Composite filling (per tooth, posterior)',
    category: 'Restorative',
    defaultFeePoisha: 250000,
    durationMinutes: 40
  },
  {
    code: 'REST-03',
    name: 'Glass ionomer filling',
    category: 'Restorative',
    defaultFeePoisha: 150000,
    durationMinutes: 25
  },
  {
    code: 'REST-04',
    name: 'Temporary restoration',
    category: 'Restorative',
    defaultFeePoisha: 80000,
    durationMinutes: 20
  },
  {
    code: 'ENDO-01',
    name: 'Pulpotomy (primary tooth)',
    category: 'Endodontic',
    defaultFeePoisha: 200000,
    durationMinutes: 40
  },
  {
    code: 'ENDO-02',
    name: 'Root canal treatment — anterior tooth',
    category: 'Endodontic',
    defaultFeePoisha: 600000,
    durationMinutes: 60
  },
  {
    code: 'ENDO-03',
    name: 'Root canal treatment — premolar',
    category: 'Endodontic',
    defaultFeePoisha: 750000,
    durationMinutes: 75
  },
  {
    code: 'ENDO-04',
    name: 'Root canal treatment — molar',
    category: 'Endodontic',
    defaultFeePoisha: 900000,
    durationMinutes: 90
  },
  {
    code: 'ENDO-05',
    name: 'Re-root canal treatment',
    category: 'Endodontic',
    defaultFeePoisha: 1100000,
    durationMinutes: 90
  },
  {
    code: 'PERIO-01',
    name: 'Deep cleaning (per quadrant)',
    category: 'Periodontic',
    defaultFeePoisha: 250000,
    durationMinutes: 40
  },
  {
    code: 'PERIO-02',
    name: 'Periodontal flap surgery (per quadrant)',
    category: 'Periodontic',
    defaultFeePoisha: 1000000,
    durationMinutes: 60
  },
  {
    code: 'SURG-01',
    name: 'Extraction — simple (per tooth)',
    category: 'Oral surgery',
    defaultFeePoisha: 200000,
    durationMinutes: 30
  },
  {
    code: 'SURG-02',
    name: 'Extraction — surgical (per tooth)',
    category: 'Oral surgery',
    defaultFeePoisha: 450000,
    durationMinutes: 45
  },
  {
    code: 'SURG-03',
    name: 'Impacted tooth removal (surgical)',
    category: 'Oral surgery',
    defaultFeePoisha: 1000000,
    durationMinutes: 60
  },
  {
    code: 'SURG-04',
    name: 'Incision and drainage of abscess',
    category: 'Oral surgery',
    defaultFeePoisha: 300000,
    durationMinutes: 30
  },
  {
    code: 'PROST-01',
    name: 'Metal-free ceramic crown',
    category: 'Prosthodontic',
    defaultFeePoisha: 1200000,
    durationMinutes: 60
  },
  {
    code: 'PROST-02',
    name: 'Metal-ceramic crown',
    category: 'Prosthodontic',
    defaultFeePoisha: 800000,
    durationMinutes: 60
  },
  {
    code: 'PROST-03',
    name: 'Complete denture — upper or lower',
    category: 'Prosthodontic',
    defaultFeePoisha: 2500000,
    durationMinutes: 90
  },
  {
    code: 'PROST-04',
    name: 'Removable partial denture',
    category: 'Prosthodontic',
    defaultFeePoisha: 2000000,
    durationMinutes: 90
  },
  {
    code: 'PROST-05',
    name: 'Post and core build-up',
    category: 'Prosthodontic',
    defaultFeePoisha: 600000,
    durationMinutes: 45
  },
  {
    code: 'ORTHO-01',
    name: 'Orthodontic consultation & records',
    category: 'Orthodontic',
    defaultFeePoisha: 300000,
    durationMinutes: 45
  },
  {
    code: 'ORTHO-02',
    name: 'Fixed orthodontic appliance — bonding (one arch)',
    category: 'Orthodontic',
    defaultFeePoisha: 4000000,
    durationMinutes: 90
  },
  {
    code: 'ORTHO-03',
    name: 'Orthodontic adjustment visit',
    category: 'Orthodontic',
    defaultFeePoisha: 200000,
    durationMinutes: 30
  },
  {
    code: 'PEDO-01',
    name: 'Pediatric consultation',
    category: 'Pediatric',
    defaultFeePoisha: 50000,
    durationMinutes: 20
  },
  {
    code: 'PEDO-02',
    name: 'Pulpectomy (primary tooth)',
    category: 'Pediatric',
    defaultFeePoisha: 250000,
    durationMinutes: 45
  },
  {
    code: 'COSM-01',
    name: 'Teeth whitening (full mouth)',
    category: 'Cosmetic',
    defaultFeePoisha: 1500000,
    durationMinutes: 60
  },
  {
    code: 'COSM-02',
    name: 'Veneer (per tooth)',
    category: 'Cosmetic',
    defaultFeePoisha: 1500000,
    durationMinutes: 60
  }
]

export interface SeedPaymentMethod {
  code: string
  name: string
  nameBn?: string
  requiresReference: boolean
  systemDefault: boolean
}

export const DEFAULT_PAYMENT_METHODS: SeedPaymentMethod[] = [
  { code: 'cash', name: 'Cash', nameBn: 'নগদ', requiresReference: false, systemDefault: true },
  { code: 'bank', name: 'Bank transfer', nameBn: 'ব্যাংক', requiresReference: true, systemDefault: true },
  { code: 'card', name: 'Card', nameBn: 'কার্ড', requiresReference: true, systemDefault: true },
  { code: 'bkash', name: 'bKash', nameBn: 'বিকাশ', requiresReference: true, systemDefault: true },
  { code: 'nagad', name: 'Nagad', nameBn: 'নগদ (Nagad)', requiresReference: true, systemDefault: true },
  { code: 'rocket', name: 'Rocket', nameBn: 'রকেট', requiresReference: true, systemDefault: true },
  { code: 'upay', name: 'Upay', nameBn: 'উপায়', requiresReference: true, systemDefault: true },
  { code: 'other', name: 'Other', nameBn: 'অন্যান্য', requiresReference: false, systemDefault: true }
]

export interface SeedExpenseCategory {
  code: string
  name: string
  nameBn?: string
}

export const DEFAULT_EXPENSE_CATEGORIES: SeedExpenseCategory[] = [
  { code: 'rent', name: 'Clinic rent', nameBn: 'ক্লিনিক ভাড়া' },
  { code: 'electricity', name: 'Electricity', nameBn: 'বিদ্যুৎ' },
  { code: 'water', name: 'Water', nameBn: 'পানি' },
  { code: 'internet', name: 'Internet & phone', nameBn: 'ইন্টারনেট ও ফোন' },
  { code: 'equipment', name: 'Equipment & accessories', nameBn: 'যন্ত্রপাতি' },
  { code: 'consumables', name: 'Consumables', nameBn: 'সরঞ্জাম' },
  { code: 'salary', name: 'Staff salary', nameBn: 'বেতন' },
  { code: 'maintenance', name: 'Maintenance & repair', nameBn: 'মেরামত' },
  { code: 'marketing', name: 'Marketing', nameBn: 'বিজ্ঞাপন' },
  { code: 'transport', name: 'Transport', nameBn: 'পরিবহন' },
  { code: 'tax', name: 'Taxes & licences', nameBn: 'কর ও লাইসেন্স' },
  { code: 'other', name: 'Other expenses', nameBn: 'অন্যান্য' }
]

// ---------------------------------------------------------------------------------------------
// Settings defaults
// ---------------------------------------------------------------------------------------------

export interface AppSettingsShape {
  // Clinic / documents
  dateFormat: 'dd MMM yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd' | 'dd MMMM yyyy' | 'MMM dd, yyyy'
  southAsianGrouping: boolean
  showBengaliDigitsOnPrint: boolean
  // Prescription
  prescriptionPaper: string
  prescriptionShowDentistQualifications: boolean
  prescriptionFooterQuote: string
  prescriptionShowConsultationTiming: boolean
  prescriptionShowLogo: boolean
  // Invoice
  invoicePaper: string
  invoiceShowDentist: boolean
  invoiceShowPaymentHistory: boolean
  invoiceDefaultTaxPercentX100: number
  invoiceRoundOffEnabled: boolean
  invoiceTermsNote: string
  invoiceShowLogo: boolean
  // Clinical
  chartDefaultDentition: 'permanent' | 'primary'
  prescriptionDefaultFollowUpDays: number
  requireVisitFinalization: boolean
  // Inventory
  inventoryLowStockAlerts: boolean
  inventoryExpiryWarningDays: number
  inventoryAllowExpiredIssue: boolean
  // Notifications
  notificationsEnabled: boolean
  appointmentReminderMinutes: number
  notifyMissedAppointments: boolean
  notifyOutstandingBalances: boolean
  outstandingBalanceThresholdPoisha: number
  /** Remind the front desk when a queued patient has waited this long (0 turns the reminder off). */
  queueWaitingReminderMinutes: number
  // Security
  autoLockMinutes: number
  requirePasswordOnDestructive: boolean
  loginMaxAttempts: number
  // Backup
  backupFolder: string
  autoBackupEnabled: boolean
  autoBackupIntervalDays: number
  autoBackupTime: string
  autoBackupRetention: number
  encryptBackups: boolean
  // Data
  patientCodePrefix: string
  patientCodePadding: number
  invoicePrefix: string
  invoicePadding: number
  receiptPrefix: string
  expensePrefix: string
}

export const DEFAULT_SETTINGS: AppSettingsShape = {
  dateFormat: 'dd MMM yyyy',
  southAsianGrouping: false,
  showBengaliDigitsOnPrint: false,
  prescriptionPaper: 'A4',
  prescriptionShowDentistQualifications: true,
  prescriptionFooterQuote: 'Your smile deserves expert care — thank you for trusting us with it.',
  prescriptionShowConsultationTiming: true,
  prescriptionShowLogo: true,
  invoicePaper: 'A4',
  invoiceShowDentist: false,
  invoiceShowPaymentHistory: true,
  invoiceDefaultTaxPercentX100: 0,
  invoiceRoundOffEnabled: false,
  invoiceTermsNote: 'Thank you for choosing us. Please keep this invoice for your records.',
  invoiceShowLogo: true,
  chartDefaultDentition: 'permanent',
  prescriptionDefaultFollowUpDays: 7,
  requireVisitFinalization: true,
  inventoryLowStockAlerts: true,
  inventoryExpiryWarningDays: 90,
  inventoryAllowExpiredIssue: false,
  notificationsEnabled: true,
  appointmentReminderMinutes: 60,
  notifyMissedAppointments: true,
  notifyOutstandingBalances: true,
  outstandingBalanceThresholdPoisha: 0,
  queueWaitingReminderMinutes: 30,
  autoLockMinutes: 10,
  requirePasswordOnDestructive: true,
  loginMaxAttempts: 5,
  backupFolder: '',
  autoBackupEnabled: false,
  autoBackupIntervalDays: 7,
  autoBackupTime: '21:00',
  autoBackupRetention: 10,
  encryptBackups: false,
  patientCodePrefix: 'P-',
  patientCodePadding: 6,
  invoicePrefix: 'INV-',
  invoicePadding: 6,
  receiptPrefix: 'RCP-',
  expensePrefix: 'EXP-'
}

export const DASHBOARD_WIDGET_IDS = [
  'todayAppointments',
  'todayPatients',
  'todayCompleted',
  'todayPending',
  'todayMissed',
  'queueCount',
  'todayRevenue',
  'todayCollected',
  'outstandingDues',
  'lowStock',
  'expiringStock',
  'revenueTrend',
  'paymentMethods',
  'upcomingAppointments',
  'recentPatients',
  'recentActivity',
  'quickActions'
] as const
export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number]

export const DEFAULT_DASHBOARD_WIDGETS: DashboardWidgetId[] = [
  'todayAppointments',
  'todayPatients',
  'todayCompleted',
  'todayPending',
  'todayMissed',
  'queueCount',
  'todayRevenue',
  'todayCollected',
  'outstandingDues',
  'lowStock',
  'expiringStock',
  'revenueTrend',
  'paymentMethods',
  'upcomingAppointments',
  'recentPatients',
  'recentActivity',
  'quickActions'
]

/** Default permissions granted to the role of a freshly created custom role (none). */
export const EMPTY_PERMISSIONS: readonly PermissionCode[] = []
