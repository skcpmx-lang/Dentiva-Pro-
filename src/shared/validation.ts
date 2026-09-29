/**
 * Validation schemas (zod) used for every IPC payload and every form.
 *
 * The same schema validates the renderer form and the main-process boundary, so a crafted IPC message can
 * never bypass the rules the UI enforces. Messages are written for clinic staff, not developers.
 */

import { z } from 'zod'
import {
  APPOINTMENT_STATUSES,
  BLOOD_GROUPS,
  EXPORT_ENTITIES,
  GENDERS,
  INVENTORY_TRANSACTION_TYPES,
  PASSWORD_POLICY,
  PRESCRIPTION_WRITE_STATUSES,
  QUEUE_PRIORITIES,
  REFERRAL_STATUSES,
  REPORT_KEYS,
  STAFF_STATUSES,
  TOOTH_SURFACES
} from './constants'
import { isValidIsoDate, isValidTime } from './date'
import { isValidToothNumber } from './dental'
import { isPermissionCode } from './permissions'

const trimmed = (max: number) => z.string().trim().max(max)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()

export const isoDateSchema = z
  .string()
  .refine((value) => isValidIsoDate(value), { message: 'Enter a valid date (YYYY-MM-DD).' })

export const timeSchema = z
  .string()
  .refine((value) => isValidTime(value), { message: 'Enter a time as HH:MM.' })

export const phoneSchema = z
  .string()
  .trim()
  .min(6, 'Enter a phone number with at least 6 digits.')
  .max(32, 'Phone number is too long.')
  .refine((value) => /^[+()\-.\s\d]+$/.test(value), {
    message: 'Phone numbers may contain digits, spaces, +, -, (, ) only.'
  })
  .refine((value) => (value.match(/\d/g) ?? []).length >= 6, { message: 'Enter at least 6 digits.' })

export const emailSchema = z.string().trim().email('Enter a valid email address.').max(160)

export const optionalEmailSchema = z
  .string()
  .trim()
  .max(160)
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional()
  .refine((value) => value == null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), {
    message: 'Enter a valid email address.'
  })

export const poishaSchema = z
  .number({ message: 'Enter an amount.' })
  .int('Amounts must be whole poisha (two decimals).')
  .min(0, 'Amount cannot be negative.')
  .max(Number.MAX_SAFE_INTEGER, 'Amount is too large.')

export const positivePoishaSchema = poishaSchema.refine((value) => value > 0, {
  message: 'Amount must be greater than zero.'
})

export const milliSchema = z
  .number({ message: 'Enter a quantity.' })
  .int('Quantity precision is limited to three decimals.')
  .min(0, 'Quantity cannot be negative.')

export const positiveMilliSchema = milliSchema.refine((value) => value > 0, {
  message: 'Quantity must be greater than zero.'
})

export const toothSchema = z.string().refine((value) => isValidToothNumber(value), {
  message: 'Unknown tooth number.'
})

export const permissionCodeSchema = z.string().refine((value) => isPermissionCode(value), {
  message: 'Unknown permission.'
})

// ---------------------------------------------------------------------------------------------
// Auth / setup
// ---------------------------------------------------------------------------------------------

export const passwordSchema = z
  .string()
  .min(PASSWORD_POLICY.minLength, `Password must be at least ${PASSWORD_POLICY.minLength} characters.`)
  .max(PASSWORD_POLICY.maxLength, 'Password is too long.')
  .refine((value) => {
    const classes = [
      PASSWORD_POLICY.classes.lower.test(value),
      PASSWORD_POLICY.classes.upper.test(value),
      PASSWORD_POLICY.classes.digit.test(value),
      PASSWORD_POLICY.classes.symbol.test(value)
    ].filter(Boolean).length
    return classes >= PASSWORD_POLICY.requireClasses
  }, `Use at least ${PASSWORD_POLICY.requireClasses} of: lowercase letters, uppercase letters, numbers, symbols.`)
  .refine(
    (value) => !PASSWORD_POLICY.weakPasswords.includes(value.toLowerCase()),
    'This password is too common. Choose a different one.'
  )

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters.')
  .max(40, 'Username is too long.')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dots, dashes and underscores only.')

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, 'Enter your password.')
})

export const unlockSchema = z.object({
  password: z.string().min(1, 'Enter your password.')
})

export const activationSchema = z.object({
  code: z.string().trim().min(1, 'Enter the activation code.')
})

export const clinicInputSchema = z.object({
  name: trimmed(160).min(2, 'Enter the clinic name.'),
  nameBn: optionalText(160),
  address: trimmed(300).min(3, 'Enter the clinic address.'),
  city: optionalText(80),
  postalCode: optionalText(20),
  country: trimmed(80).default('Bangladesh'),
  phone1: phoneSchema,
  phone2: optionalText(32),
  email: optionalEmailSchema,
  website: optionalText(160),
  registrationNo: optionalText(60),
  footerQuote: optionalText(300),
  logoPath: optionalText(500)
})

export const dentistInputSchema = z.object({
  fullName: trimmed(120).min(3, 'Enter the dentist name.'),
  phone: optionalText(32),
  email: optionalEmailSchema,
  registrationNo: optionalText(60),
  signaturePath: optionalText(500),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  notes: optionalText(500),
  designations: z.array(trimmed(60).min(1)).max(10).default([]),
  qualifications: z.array(trimmed(60).min(1)).max(20).default([]),
  certifications: z.array(trimmed(60).min(1)).max(20).default([]),
  schedules: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startTime: timeSchema,
        endTime: timeSchema
      })
    )
    .max(21)
    .default([])
})

export const setupInputSchema = z
  .object({
    clinic: clinicInputSchema,
    dentists: z.array(dentistInputSchema).min(1, 'Add at least one dentist.'),
    admin: z
      .object({
        username: usernameSchema,
        displayName: trimmed(120).min(2, 'Enter the display name.'),
        password: passwordSchema,
        confirmPassword: z.string()
      })
      .refine((value) => value.password === value.confirmPassword, {
        message: 'Passwords do not match.',
        path: ['confirmPassword']
      }),
    dataRoot: z.string().trim().min(3).optional(),
    activationCode: z.string().trim().min(1, 'Activation is required before setup.')
  })
  .strict()

// ---------------------------------------------------------------------------------------------
// Patients / visits / chart
// ---------------------------------------------------------------------------------------------

export const patientInputSchema = z
  .object({
    fullName: trimmed(120).min(2, 'Enter the patient name.'),
    fullNameBn: optionalText(120),
    dateOfBirth: isoDateSchema.nullable().optional(),
    ageYears: z.number().int().min(0).max(130).nullable().optional(),
    gender: z.enum(GENDERS).nullable().optional(),
    bloodGroup: z.enum(BLOOD_GROUPS).nullable().optional(),
    phone: phoneSchema,
    phoneAlt: optionalText(32),
    email: optionalEmailSchema,
    address: optionalText(300),
    addressBn: optionalText(300),
    city: optionalText(80),
    occupation: optionalText(80),
    maritalStatus: optionalText(30),
    nationalId: optionalText(40),
    guardianName: optionalText(120),
    emergencyName: optionalText(120),
    emergencyPhone: optionalText(32),
    relationship: optionalText(40),
    referralSource: optionalText(80),
    chiefComplaint: optionalText(500),
    medicalHistory: optionalText(2000),
    dentalHistory: optionalText(2000),
    allergies: optionalText(500),
    currentMedications: optionalText(1000),
    notes: optionalText(2000),
    isActive: z.boolean().optional()
  })
  .strict()
  .refine((value) => value.dateOfBirth != null || value.ageYears != null || true, { message: '' })

export const visitTreatmentInputSchema = z.object({
  treatmentId: z.number().int().positive().nullable(),
  treatmentName: trimmed(120).min(1, 'Enter a treatment name.'),
  teeth: z.array(toothSchema).max(32).default([]),
  feePoisha: poishaSchema,
  note: optionalText(300)
})

export const visitInputSchema = z.object({
  patientId: z.number().int().positive(),
  visitDate: isoDateSchema,
  visitTime: timeSchema,
  dentistId: z.number().int().positive(),
  appointmentId: z.number().int().positive().nullable().optional(),
  chiefComplaint: optionalText(1000),
  symptoms: optionalText(2000),
  examination: optionalText(4000),
  diagnosis: optionalText(2000),
  treatmentSummary: optionalText(4000),
  advice: optionalText(2000),
  followUpDate: isoDateSchema.nullable().optional(),
  notes: optionalText(2000),
  treatments: z.array(visitTreatmentInputSchema).max(60).default([])
})

export const dentalChartEntryInputSchema = z.object({
  toothNumber: toothSchema,
  conditionCode: trimmed(40).min(1),
  treatmentCode: optionalText(40),
  surfaces: z.array(z.enum(TOOTH_SURFACES)).max(6).default([]),
  status: z.enum(['existing', 'planned', 'completed']).default('existing'),
  note: optionalText(300)
})

export const chartSaveSchema = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().nullable().optional(),
  entries: z.array(dentalChartEntryInputSchema).max(200)
})

// ---------------------------------------------------------------------------------------------
// Appointments / queue
// ---------------------------------------------------------------------------------------------

export const appointmentInputSchema = z.object({
  patientId: z.number().int().positive(),
  dentistId: z.number().int().positive(),
  appointmentDate: isoDateSchema,
  startTime: timeSchema,
  endTime: timeSchema.nullable().optional(),
  typeCode: optionalText(60),
  reason: optionalText(500),
  notes: optionalText(500),
  status: z.enum(APPOINTMENT_STATUSES).optional()
})

export const appointmentStatusSchema = z.object({
  appointmentId: z.number().int().positive(),
  status: z.enum(APPOINTMENT_STATUSES),
  reason: optionalText(300)
})

export const rescheduleSchema = z.object({
  appointmentId: z.number().int().positive(),
  appointmentDate: isoDateSchema,
  startTime: timeSchema,
  endTime: timeSchema.nullable().optional(),
  dentistId: z.number().int().positive().optional(),
  reason: optionalText(300)
})

export const queueAddSchema = z.object({
  patientId: z.number().int().positive(),
  appointmentId: z.number().int().positive().nullable().optional(),
  dentistId: z.number().int().positive().nullable().optional(),
  priority: z.enum(QUEUE_PRIORITIES).default('normal'),
  notes: optionalText(300)
})

export const queueUpdateSchema = z.object({
  queueId: z.number().int().positive(),
  status: z.enum(['waiting', 'called', 'in_treatment', 'completed', 'left', 'cancelled']).optional(),
  priority: z.enum(QUEUE_PRIORITIES).optional(),
  dentistId: z.number().int().positive().nullable().optional(),
  notes: optionalText(300)
})

export const queueReorderSchema = z.object({
  queueDate: isoDateSchema,
  orderedIds: z.array(z.number().int().positive()).min(1)
})

// ---------------------------------------------------------------------------------------------
// Treatments / prescriptions / referrals
// ---------------------------------------------------------------------------------------------

export const treatmentInputSchema = z.object({
  code: optionalText(30),
  name: trimmed(120).min(2, 'Enter the treatment name.'),
  nameBn: optionalText(120),
  category: trimmed(60).min(2, 'Choose a category.'),
  description: optionalText(1000),
  defaultFeePoisha: poishaSchema,
  durationMinutes: z.number().int().min(0).max(600).nullable().optional(),
  isActive: z.boolean().default(true)
})

export const prescriptionItemSchema = z.object({
  sortOrder: z.number().int().min(0),
  medicineName: trimmed(160).min(1, 'Enter the medicine name.'),
  medicineType: optionalText(60),
  strength: optionalText(60),
  dose: optionalText(60),
  morning: optionalText(20),
  noon: optionalText(20),
  night: optionalText(20),
  timing: optionalText(40),
  durationValue: z.number().int().min(0).max(999).nullable().optional(),
  durationUnit: optionalText(30),
  quantity: optionalText(40),
  instruction: optionalText(300),
  conditionalInstruction: optionalText(300),
  notes: optionalText(300)
})

export const prescriptionInputSchema = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().nullable().optional(),
  dentistId: z.number().int().positive(),
  prescriptionDate: isoDateSchema,
  chiefComplaints: z.array(trimmed(200)).max(20).default([]),
  onExamination: z.array(trimmed(200)).max(20).default([]),
  diagnosis: optionalText(1000),
  advice: z.array(trimmed(300)).max(20).default([]),
  followUpDate: isoDateSchema.nullable().optional(),
  notes: optionalText(1000),
  // Saving as `final` is what the print/reprint path uses; voiding has its own action and payload.
  status: z.enum(PRESCRIPTION_WRITE_STATUSES).optional(),
  items: z.array(prescriptionItemSchema).min(1, 'Add at least one medicine.').max(30)
})

export const referralInputSchema = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().nullable().optional(),
  referralDate: isoDateSchema,
  referringDentistId: z.number().int().positive().nullable().optional(),
  referredToName: trimmed(160).min(2, 'Enter the doctor or institution.'),
  referredToInstitution: optionalText(160),
  referredToPhone: optionalText(32),
  reason: trimmed(500).min(2, 'Enter the reason for referral.'),
  notes: optionalText(1000),
  status: z.enum(REFERRAL_STATUSES).optional(),
  followUpDate: isoDateSchema.nullable().optional()
})

// ---------------------------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------------------------

export const invoiceItemInputSchema = z.object({
  itemType: z.enum(['treatment', 'product', 'service', 'other']),
  treatmentId: z.number().int().positive().nullable().optional(),
  inventoryItemId: z.number().int().positive().nullable().optional(),
  description: trimmed(200).min(1, 'Enter an item description.'),
  quantityMilli: positiveMilliSchema,
  unitPricePoisha: poishaSchema,
  discountPoisha: poishaSchema.default(0),
  note: optionalText(300)
})

export const invoiceInputSchema = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().nullable().optional(),
  invoiceDate: isoDateSchema,
  dueDate: isoDateSchema.nullable().optional(),
  discountPoisha: poishaSchema.default(0),
  discountPercentX100: z.number().int().min(0).max(10_000).default(0),
  taxPercentX100: z.number().int().min(0).max(10_000).default(0),
  roundOffEnabled: z.boolean().default(false),
  notes: optionalText(1000),
  items: z.array(invoiceItemInputSchema).min(1, 'Add at least one line item.').max(100)
})

export const paymentInputSchema = z.object({
  patientId: z.number().int().positive(),
  invoiceId: z.number().int().positive().nullable().optional(),
  kind: z.enum(['payment', 'advance', 'refund']).default('payment'),
  amountPoisha: positivePoishaSchema,
  methodCode: trimmed(40).min(2, 'Choose a payment method.'),
  referenceNo: optionalText(80),
  receivedAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/, 'Enter the payment date and time.')
    .refine((value) => isValidIsoDate(value.slice(0, 10)), { message: 'Enter a valid payment date.' }),
  notes: optionalText(500)
})

export const voidRequestSchema = z.object({
  id: z.number().int().positive(),
  reason: trimmed(300).min(3, 'Enter the reason (at least 3 characters).')
})

// ---------------------------------------------------------------------------------------------
// Inventory / accounting
// ---------------------------------------------------------------------------------------------

export const inventoryItemInputSchema = z.object({
  code: optionalText(40),
  name: trimmed(140).min(2, 'Enter the item name.'),
  category: optionalText(60),
  supplierId: z.number().int().positive().nullable().optional(),
  unit: trimmed(30).min(1, 'Choose a unit.'),
  quantityMilli: milliSchema.default(0),
  minStockMilli: milliSchema.default(0),
  purchasePricePoisha: poishaSchema.default(0),
  sellPricePoisha: poishaSchema.nullable().optional(),
  location: optionalText(60),
  isActive: z.boolean().default(true),
  notes: optionalText(500)
})

export const stockInSchema = z.object({
  itemId: z.number().int().positive(),
  batchNo: optionalText(60),
  expiryDate: isoDateSchema.nullable().optional(),
  quantityMilli: positiveMilliSchema,
  unitCostPoisha: poishaSchema,
  purchaseDate: isoDateSchema,
  supplierId: z.number().int().positive().nullable().optional(),
  reference: optionalText(80),
  notes: optionalText(300)
})

export const stockIssueSchema = z.object({
  itemId: z.number().int().positive(),
  batchId: z.number().int().positive().nullable().optional(),
  quantityMilli: positiveMilliSchema,
  txnType: z.enum(
    INVENTORY_TRANSACTION_TYPES.filter((t) =>
      ['usage', 'adjustment_out', 'wastage', 'return', 'expired'].includes(t)
    ) as unknown as [string, ...string[]]
  ),
  reason: optionalText(300),
  referenceType: optionalText(40),
  referenceId: z.number().int().positive().nullable().optional(),
  notes: optionalText(300)
})

export const supplierInputSchema = z.object({
  name: trimmed(140).min(2, 'Enter the supplier name.'),
  contactPerson: optionalText(120),
  phone: optionalText(32),
  email: optionalEmailSchema,
  address: optionalText(300),
  notes: optionalText(500),
  isActive: z.boolean().default(true)
})

export const expenseCategoryInputSchema = z.object({
  code: optionalText(40),
  name: trimmed(80).min(2, 'Enter a category name.'),
  nameBn: optionalText(80),
  isActive: z.boolean().default(true)
})

export const expenseInputSchema = z.object({
  categoryId: z.number().int().positive(),
  expenseDate: isoDateSchema,
  amountPoisha: positivePoishaSchema,
  methodCode: trimmed(40).min(2, 'Choose a payment method.'),
  paidTo: optionalText(140),
  referenceNo: optionalText(80),
  description: trimmed(300).min(2, 'Enter a description.')
})

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------

export const staffInputSchema = z.object({
  name: trimmed(140).min(2, 'Enter the staff name.'),
  age: z.number().int().min(14).max(90).nullable().optional(),
  gender: z.enum(GENDERS).nullable().optional(),
  address: optionalText(300),
  bloodGroup: z.enum(BLOOD_GROUPS).nullable().optional(),
  identificationNo: optionalText(60),
  photoPath: optionalText(500),
  phone: phoneSchema,
  position: trimmed(80).min(2, 'Enter the position.'),
  department: optionalText(80),
  salaryPoisha: poishaSchema.nullable().optional(),
  joiningDate: isoDateSchema,
  status: z.enum(STAFF_STATUSES).default('active'),
  notes: optionalText(1000)
})

export const userInputSchema = z.object({
  username: usernameSchema,
  displayName: trimmed(120).min(2, 'Enter the display name.'),
  password: passwordSchema.optional(),
  roleId: z.number().int().positive(),
  isActive: z.boolean().default(true),
  mustChangePassword: z.boolean().default(false),
  overrides: z
    .array(z.object({ code: permissionCodeSchema, effect: z.enum(['allow', 'deny']) }))
    .max(200)
    .default([])
})

export const roleInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Enter a role code.')
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores only.'),
  name: trimmed(80).min(2, 'Enter the role name.'),
  description: optionalText(300),
  permissions: z.array(permissionCodeSchema).max(200)
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword']
  })

// ---------------------------------------------------------------------------------------------
// Settings / system
// ---------------------------------------------------------------------------------------------

export const settingsPatchSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()])
)

export const attachmentInputSchema = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().nullable().optional(),
  title: optionalText(160),
  category: optionalText(60),
  notes: optionalText(500),
  sourcePath: z.string().trim().min(1, 'Choose a file.')
})

export const attachmentRenameSchema = z.object({
  id: z.number().int().positive(),
  title: trimmed(160).min(1, 'Enter a name.')
})

export const printRequestSchema = z.object({
  documentType: z.enum(['prescription', 'invoice', 'report']),
  entityId: z.number().int().positive(),
  profileId: z.number().int().positive().nullable().optional(),
  printerName: z.string().trim().nullable().optional(),
  copies: z.number().int().min(1).max(20).optional(),
  mode: z.enum(['preview', 'print', 'pdf']),
  /** Absolute target path for `pdf` mode (chosen by the user through a save dialog). */
  targetPath: z.string().trim().nullable().optional()
})

export const reportRequestSchema = z.object({
  report: z.enum([
    'daily_income',
    'expense_summary',
    'net_cash_flow',
    'outstanding_dues',
    'payment_methods',
    'treatment_revenue',
    'invoice_summary',
    'expense_categories',
    'inventory_purchases'
  ]),
  from: isoDateSchema,
  to: isoDateSchema
})

export const backupRequestSchema = z.object({
  targetFolder: z.string().trim().min(3, 'Choose a backup folder.'),
  includeAttachments: z.boolean().default(true),
  password: z.string().min(8, 'Backup password must be at least 8 characters.').nullable().optional()
})

export const restoreRequestSchema = z.object({
  folderPath: z.string().trim().min(3, 'Choose a backup folder.'),
  password: z.string().nullable().optional(),
  confirmationPhrase: z.string().trim().min(1, 'Type the confirmation phrase.')
})

export const destructiveRequestSchema = z.object({
  action: z.enum([
    'delete_patient',
    'delete_selected_patients',
    'delete_all_patients',
    'delete_business_data',
    'reset_database'
  ]),
  confirmationPhrase: z.string().trim().min(1, 'Type the confirmation phrase.'),
  password: z.string().min(1, 'Enter your password.'),
  ids: z.array(z.number().int().positive()).max(10_000).optional(),
  includeAttachments: z.boolean().optional()
})

export const exportRequestSchema = z.object({
  entity: z.enum(EXPORT_ENTITIES),
  format: z.enum(['csv', 'json']),
  from: isoDateSchema.nullable().optional(),
  to: isoDateSchema.nullable().optional(),
  targetFolder: z.string().trim().min(3, 'Choose an export folder.')
})

export const printerProfileInputSchema = z.object({
  name: trimmed(80).min(2, 'Enter a profile name.'),
  documentType: z.enum(['prescription', 'invoice', 'report']),
  printerName: optionalText(200),
  paperSize: z.enum(['A4', 'A5', 'A6', 'Letter', 'thermal58', 'thermal80', 'custom']),
  customWidthMm: z.number().min(40).max(320).nullable().optional(),
  customHeightMm: z.number().min(40).max(1000).nullable().optional(),
  orientation: z.enum(['portrait', 'landscape']),
  marginTopMm: z.number().min(0).max(40),
  marginRightMm: z.number().min(0).max(40),
  marginBottomMm: z.number().min(0).max(40),
  marginLeftMm: z.number().min(0).max(40),
  scalePercent: z.number().int().min(50).max(200),
  copies: z.number().int().min(1).max(20),
  isDefault: z.boolean().default(false)
})

export const pageQuerySchema = z.object({
  page: z.number().int().min(1).max(100_000).default(1),
  pageSize: z.number().int().min(1).max(500).default(25),
  sortBy: z.string().trim().max(40).nullable().optional(),
  sortDir: z.enum(['asc', 'desc']).nullable().optional()
})

export const patientQuerySchema = pageQuerySchema.extend({
  search: z.string().trim().max(120).nullable().optional(),
  range: z.enum(['today', 'last7', 'last30', 'last90', 'lastYear', 'custom', 'all']).default('all'),
  from: isoDateSchema.nullable().optional(),
  to: isoDateSchema.nullable().optional(),
  gender: z.enum(GENDERS).nullable().optional(),
  includeArchived: z.boolean().default(false)
})

export const appointmentQuerySchema = pageQuerySchema.extend({
  view: z
    .enum(['today', 'upcoming', 'past', 'completed', 'no_show', 'cancelled', 'rescheduled', 'all'])
    .default('today'),
  from: isoDateSchema.nullable().optional(),
  to: isoDateSchema.nullable().optional(),
  dentistId: z.number().int().positive().nullable().optional(),
  status: z.enum(APPOINTMENT_STATUSES).nullable().optional(),
  search: z.string().trim().max(120).nullable().optional()
})

export const invoiceQuerySchema = pageQuerySchema.extend({
  search: z.string().trim().max(120).nullable().optional(),
  status: z.enum(['unpaid', 'partial', 'paid', 'overpaid', 'void']).nullable().optional(),
  from: isoDateSchema.nullable().optional(),
  to: isoDateSchema.nullable().optional(),
  patientId: z.number().int().positive().nullable().optional()
})

export const paymentQuerySchema = pageQuerySchema.extend({
  range: z.enum(['today', 'last7', 'last30', 'last90', 'lastYear', 'custom', 'all']).default('today'),
  from: isoDateSchema.nullable().optional(),
  to: isoDateSchema.nullable().optional(),
  methodCode: z.string().trim().max(40).nullable().optional(),
  patientId: z.number().int().positive().nullable().optional(),
  search: z.string().trim().max(120).nullable().optional()
})

export const inventoryQuerySchema = pageQuerySchema.extend({
  search: z.string().trim().max(120).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  lowStockOnly: z.boolean().default(false),
  expiringWithinDays: z.number().int().min(0).max(3650).nullable().optional(),
  includeInactive: z.boolean().default(false)
})

export const expenseQuerySchema = pageQuerySchema.extend({
  from: isoDateSchema.nullable().optional(),
  to: isoDateSchema.nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  search: z.string().trim().max(120).nullable().optional()
})

export const auditQuerySchema = pageQuerySchema.extend({
  from: isoDateSchema.nullable().optional(),
  to: isoDateSchema.nullable().optional(),
  actorUserId: z.number().int().positive().nullable().optional(),
  action: z.string().trim().max(80).nullable().optional(),
  entityType: z.string().trim().max(60).nullable().optional(),
  severity: z.enum(['info', 'warning', 'critical']).nullable().optional(),
  search: z.string().trim().max(160).nullable().optional()
})

export const searchQuerySchema = z.object({
  query: z.string().trim().min(1, 'Type something to search.').max(120),
  entityTypes: z.array(z.string().trim().max(40)).max(20).optional(),
  limit: z.number().int().min(1).max(50).default(10)
})

export const idSchema = z.number().int().positive()

export const dateRangeSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema
})

export const visitQuerySchema = pageQuerySchema.extend({
  patientId: z.number().int().positive().nullable().optional(),
  dentistId: z.number().int().positive().nullable().optional(),
  from: isoDateSchema.nullable().optional(),
  to: isoDateSchema.nullable().optional(),
  search: z.string().trim().max(120).nullable().optional()
})

export const prescriptionQuerySchema = pageQuerySchema.extend({
  patientId: z.number().int().positive().nullable().optional(),
  dentistId: z.number().int().positive().nullable().optional(),
  from: isoDateSchema.nullable().optional(),
  to: isoDateSchema.nullable().optional(),
  search: z.string().trim().max(120).nullable().optional()
})

export const attachmentQuerySchema = pageQuerySchema.extend({
  patientId: z.number().int().positive(),
  category: z.string().trim().max(60).nullable().optional()
})

export const dateRangeSchemaOptional = z.object({
  from: isoDateSchema.nullable(),
  to: isoDateSchema.nullable(),
  groupBy: z.enum(['day', 'month']).optional()
})

export const idOptionalSchema = z.number().int().positive().nullable().optional()

export const notificationListSchema = z.object({
  onlyUnread: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional()
})

export const treatmentListSchema = z.object({
  search: z.string().trim().max(120).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  includeInactive: z.boolean().optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(1000).optional()
})

export type ValidationIssue = { field: string; message: string }

// ---------------------------------------------------------------------------------------------
// IPC envelope schemas
//
// These describe the exact payload of each IPC channel. They are intentionally declared here (rather
// than inline in the main process) so the renderer, the tests and the main process validate against
// one definition.
// ---------------------------------------------------------------------------------------------

export const emptySchema = z.union([z.undefined(), z.null()])
export const idPayloadSchema = z.object({ id: idSchema })
export const unorderedIdSchema = z.object({ id: idSchema })
export const idWithReasonSchema = z.object({
  id: idSchema,
  reason: z.string().trim().min(3, 'Give a reason of at least 3 characters.').max(400)
})
export const windowStateSchema = z.object({
  isMaximized: z.boolean(),
  isFullScreen: z.boolean(),
  isFocused: z.boolean()
})
export const dashboardGetSchema = emptySchema
export const globalSearchSchema = z.object({
  term: z.string().trim().max(120),
  entityTypes: z.array(z.string().trim().max(40)).max(12).optional(),
  limit: z.number().int().min(1).max(50).optional()
})
export const patientListSchema = patientQuerySchema.extend({
  includeArchived: z.boolean().optional()
})
export const patientArchiveSchema = idPayloadSchema
export const patientRestoreSchema = idPayloadSchema
export const patientTimelineSchema = z.object({ patientId: idSchema })
export const patientNoteSchema = z.object({
  patientId: idSchema,
  note: z.string().trim().min(2, 'Enter a note.').max(4000)
})
export const patientLookupSchema = z.object({
  term: z.string().trim().max(120),
  limit: z.number().int().min(1).max(50).optional()
})
export const visitListSchema = visitQuerySchema
export const prescriptionListSchema = prescriptionQuerySchema.extend({
  status: z.string().trim().max(20).optional()
})
export const prescriptionVoidSchema = idWithReasonSchema
export const attachmentListSchema = attachmentQuerySchema
export const attachmentAddSchema = attachmentInputSchema
export const attachmentDeleteSchema = idPayloadSchema
export const attachmentPickSchema = z.object({ multiple: z.boolean().optional() }).or(z.undefined())
export const referralListSchema = z.object({
  patientId: idSchema.nullable().optional(),
  term: z.string().trim().max(120).optional()
})
export const treatmentSaveSchema = treatmentInputSchema.extend({ id: idSchema.optional() })
export const treatmentDeactivateSchema = idPayloadSchema
export const includeInactiveSchema = z.object({ includeInactive: z.boolean().optional() }).or(z.undefined())
export const outstandingSchema = z
  .object({ limit: z.number().int().min(1).max(500).optional() })
  .or(z.undefined())
export const invoiceNumberSchema = z.object({ invoiceNo: z.string().trim().min(3).max(40) })
export const accountingRangeSchema = z.object({
  from: isoDateSchema.nullable(),
  to: isoDateSchema.nullable()
})
export const revenueQuerySchema = accountingRangeSchema.extend({
  groupBy: z.enum(['day', 'month']).optional()
})
export const categoryInputSchema = expenseCategoryInputSchema.extend({ id: idSchema.optional() })
export const batchListSchema = z.object({ itemId: idSchema })
export const inventoryTransactionsSchema = z.object({
  itemId: idSchema.optional(),
  txnType: z.string().trim().max(40).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  page: z.number().int().min(1).max(100_000).optional(),
  pageSize: z.number().int().min(1).max(500).optional()
})
export const supplierSaveSchema = supplierInputSchema.extend({ id: idSchema.optional() })
export const clinicLogoSchema = z.object({ sourcePath: z.string().trim().min(3).max(600) })
export const dentistActiveSchema = z.object({ id: idSchema, isActive: z.boolean() })
export const signatureSchema = z.object({ id: idSchema, sourcePath: z.string().trim().min(3).max(600) })
export const userSaveSchema = userInputSchema.extend({
  id: idSchema.optional(),
  password: passwordSchema.optional()
})
export const roleSaveSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(3, 'Enter a role name.').max(60),
  description: z.string().trim().max(300).nullable().optional(),
  permissions: z.array(permissionCodeSchema).min(1, 'Choose at least one permission.').max(200)
})
export const permissionCatalogueSchema = z
  .object({ modules: z.array(z.string().trim().max(40)).max(20).optional() })
  .or(z.undefined())
export const integritySchema = z.object({ deep: z.boolean().optional() }).or(z.undefined())
export const setupActivateSchema = activationSchema
export const printerSaveSchema = printerProfileInputSchema.extend({ id: idSchema.optional() })
export const printerDeleteSchema = idPayloadSchema
export const backupCreateSchema = backupRequestSchema.extend({
  targetFolder: z.string().trim().max(600).nullable().optional()
})
export const backupDeleteSchema = z.object({ id: idSchema, deleteFiles: z.boolean().optional() })
export const backupVerifySchema = z.object({ folderPath: z.string().trim().min(3).max(600) })
export const exportDataSchema = exportRequestSchema
export const openPathSchema = z.object({ path: z.string().trim().min(1).max(600) })
export const chooseFolderSchema = z
  .object({
    title: z.string().trim().max(120).optional(),
    suggestedName: z.string().trim().max(120).optional()
  })
  .or(z.undefined())
export const openDialogSchema = z
  .object({
    title: z.string().trim().max(160).optional(),
    multiple: z.boolean().optional(),
    directory: z.boolean().optional(),
    filters: z
      .array(
        z.object({ name: z.string().trim().max(60), extensions: z.array(z.string().trim().max(12)).max(20) })
      )
      .max(8)
      .optional()
  })
  .or(z.undefined())
export const saveDialogSchema = z.object({
  title: z.string().trim().max(160).optional(),
  defaultPath: z.string().trim().max(600).optional(),
  suggestedName: z.string().trim().max(200).optional(),
  filters: z
    .array(
      z.object({ name: z.string().trim().max(60), extensions: z.array(z.string().trim().max(12)).max(20) })
    )
    .max(8)
    .optional()
})
export const reportDataSchema = z.object({
  // Only catalogue reports exist: a typo is refused with a field error instead of rendering an empty page.
  report: z.enum(REPORT_KEYS),
  from: isoDateSchema,
  to: isoDateSchema
})
export const reportExportSchema = z.object({
  report: z.enum(REPORT_KEYS),
  from: isoDateSchema,
  to: isoDateSchema,
  targetFolder: z.string().trim().min(1, 'Choose a folder to export into.').max(1000)
})
export const reportPrintSchema = z.object({
  title: z.string().trim().min(1).max(200),
  from: isoDateSchema,
  to: isoDateSchema,
  columns: z
    .array(
      z.object({
        key: z.string().trim().max(60),
        label: z.string().trim().max(120),
        align: z.enum(['left', 'right', 'center'])
      })
    )
    .min(1)
    .max(40),
  rows: z.array(z.array(z.string().max(200))).max(50_000),
  summaries: z
    .array(
      z.object({
        label: z.string().trim().max(120),
        value: z.string().trim().max(160),
        emphasis: z.boolean().optional()
      })
    )
    .max(30),
  footNotes: z.array(z.string().trim().max(400)).max(10).optional(),
  paper: z.string().trim().max(30).optional()
})

export const printBuildSchema = z.object({
  documentType: z.enum(['prescription', 'invoice', 'report']),
  entityId: idSchema,
  paper: z.string().trim().max(30).optional(),
  reportRequest: reportPrintSchema.optional()
})
export const printJobSchema = z.object({
  documentType: z.enum(['prescription', 'invoice', 'report']),
  entityId: idSchema,
  profileId: idSchema.nullable().optional(),
  copies: z.number().int().min(1).max(50).optional(),
  mode: z.enum(['preview', 'print', 'pdf']),
  targetPath: z.string().trim().max(600).nullable().optional(),
  reportRequest: reportPrintSchema.optional()
})
export const printReadySchema = z.object({ jobId: z.string().trim().min(6).max(80) })
export const startWorkerSchema = z.object({
  kind: z.enum(['integrity', 'backup', 'restore', 'export', 'print', 'import'])
})
export const workerProgressSchema = z.object({ jobId: z.string().trim().min(6).max(80) })

/** Helper for `{ id, input }` update payloads. */
export function updateWithInputSchema<T extends z.ZodType>(
  input: T
): z.ZodObject<{ id: typeof idSchema; input: T }> {
  return z.object({ id: idSchema, input })
}

export const chartGetSchema = z.object({
  patientId: idSchema,
  visitId: idSchema.nullable().optional()
})

export const queueGetSchema = z.object({ date: isoDateSchema.optional() }).or(z.undefined())

export const referralStatusSchema = z.object({
  id: idSchema,
  status: z.enum(['pending', 'sent', 'completed', 'cancelled']),
  outcome: z.string().trim().max(500).nullable().optional()
})

export const clinicalOptionListSchema = z
  .object({
    listCode: z.string().trim().min(1).max(60).optional(),
    includeInactive: z.boolean().optional()
  })
  .or(z.undefined())

export const clinicalOptionSaveSchema = z.object({
  id: z.number().int().positive().optional(),
  listCode: z.string().trim().min(1).max(60),
  value: z.string().trim().min(1).max(200),
  valueBn: z.string().trim().max(200).nullish(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional()
})
