/**
 * Shared domain view models exchanged between the main process and the renderer over IPC.
 * These are plain data structures (no behaviour) so they can be validated, logged and tested easily.
 */

import type {
  AppointmentStatus,
  Dentition,
  Gender,
  InventoryTransactionType,
  InvoiceStatus,
  NotificationCategory,
  NotificationPriority,
  PaymentKind,
  QueuePriority,
  QueueStatus,
  ReferralStatus,
  StaffStatus,
  VisitStatus,
  AppSettingsShape
} from './constants'
import type { PermissionCode, PermissionModule } from './permissions'

// ---------------------------------------------------------------------------------------------
// Session / auth
// ---------------------------------------------------------------------------------------------

export type SessionState = 'unauthenticated' | 'authenticated' | 'locked'

export interface SessionUser {
  id: number
  username: string
  displayName: string
  roleId: number
  roleCode: string
  roleName: string
  isActive: boolean
  lastLoginAt: string | null
}

export interface SessionSnapshot {
  state: SessionState
  user: SessionUser | null
  permissions: PermissionCode[]
  /** Minutes of inactivity before the application locks itself. */
  autoLockMinutes: number
  activatedAt: string | null
}

export interface LoginResult {
  snapshot: SessionSnapshot
  /** True when the account must set a new password before continuing. */
  mustChangePassword: boolean
}

export interface SetupStatus {
  /** Setup wizard has not been completed yet. */
  setupRequired: boolean
  activationRequired: boolean
  /** Resolved data root (display only — path decisions live in the main process). */
  dataRoot: string
  defaultDataRoot: string
  appVersion: string
  buildNumber: string
  commit: string
  buildDate: string
}

export interface ActivationResult {
  activated: boolean
  message: string
  attemptsRemaining: number
}

export interface SetupInput {
  clinic: ClinicInput
  dentists: DentistInput[]
  admin: {
    username: string
    displayName: string
    password: string
    confirmPassword: string
  }
  dataRoot?: string
  activationCode: string
}

// ---------------------------------------------------------------------------------------------
// Clinic / dentists / staff / users
// ---------------------------------------------------------------------------------------------

export interface ClinicProfile {
  id: number
  name: string
  nameBn: string | null
  logoPath: string | null
  address: string
  city: string | null
  postalCode: string | null
  country: string
  phone1: string
  phone2: string | null
  email: string | null
  website: string | null
  registrationNo: string | null
  footerQuote: string | null
  updatedAt: string
}

export type ClinicInput = Omit<ClinicProfile, 'id' | 'updatedAt' | 'logoPath'> & {
  logoPath?: string | null
}

export interface Dentist {
  id: number
  fullName: string
  phone: string | null
  email: string | null
  registrationNo: string | null
  signaturePath: string | null
  isActive: boolean
  sortOrder: number
  notes: string | null
  designations: string[]
  qualifications: string[]
  certifications: string[]
  schedules: DentistSchedule[]
  createdAt: string
  updatedAt: string
}

export interface DentistSchedule {
  id: number
  weekday: number
  startTime: string
  endTime: string
}

export type DentistInput = Omit<
  Dentist,
  'id' | 'createdAt' | 'updatedAt' | 'designations' | 'qualifications' | 'certifications' | 'schedules'
> & {
  designations: string[]
  qualifications: string[]
  certifications: string[]
  schedules: { weekday: number; startTime: string; endTime: string }[]
}

export interface StaffMember {
  id: number
  name: string
  age: number | null
  gender: Gender | null
  address: string | null
  bloodGroup: string | null
  identificationNo: string | null
  photoPath: string | null
  phone: string
  position: string
  department: string | null
  salaryPoisha: number | null
  joiningDate: string
  status: StaffStatus
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type StaffInput = Omit<StaffMember, 'id' | 'createdAt' | 'updatedAt'>

export interface RoleSummary {
  id: number
  code: string
  name: string
  description: string | null
  isSystem: boolean
  permissionCodes: PermissionCode[]
  userCount: number
  createdAt: string
  updatedAt: string
}

export interface PermissionCatalogEntry {
  code: PermissionCode
  module: PermissionModule
  label: string
  description: string
  destructive: boolean
  financial: boolean
}

export interface UserSummary {
  id: number
  username: string
  displayName: string
  roleId: number
  roleName: string
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  createdAt: string
  overrides: { code: PermissionCode; effect: 'allow' | 'deny' }[]
}

export interface UserInput {
  username: string
  displayName: string
  password?: string
  roleId: number
  isActive: boolean
  mustChangePassword: boolean
  overrides: { code: PermissionCode; effect: 'allow' | 'deny' }[]
}

// ---------------------------------------------------------------------------------------------
// Patients / visits / chart
// ---------------------------------------------------------------------------------------------

export interface PatientSummary {
  id: number
  code: string
  fullName: string
  fullNameBn: string | null
  ageYears: number | null
  dateOfBirth: string | null
  gender: Gender | null
  bloodGroup: string | null
  phone: string
  phoneAlt: string | null
  address: string | null
  chiefComplaint: string | null
  isActive: boolean
  /** Archived (soft-deleted) patients stay readable and can be restored. */
  isArchived: boolean
  createdAt: string
  lastVisitDate: string | null
  outstandingPoisha: number
}

export interface Patient extends PatientSummary {
  email: string | null
  addressBn: string | null
  city: string | null
  occupation: string | null
  maritalStatus: string | null
  nationalId: string | null
  guardianName: string | null
  emergencyName: string | null
  emergencyPhone: string | null
  relationship: string | null
  referralSource: string | null
  medicalHistory: string | null
  dentalHistory: string | null
  allergies: string | null
  currentMedications: string | null
  notes: string | null
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
}

export interface PatientInput {
  fullName: string
  fullNameBn?: string | null
  dateOfBirth?: string | null
  ageYears?: number | null
  gender?: Gender | null
  bloodGroup?: string | null
  phone: string
  phoneAlt?: string | null
  email?: string | null
  address?: string | null
  addressBn?: string | null
  city?: string | null
  occupation?: string | null
  maritalStatus?: string | null
  nationalId?: string | null
  guardianName?: string | null
  emergencyName?: string | null
  emergencyPhone?: string | null
  relationship?: string | null
  referralSource?: string | null
  chiefComplaint?: string | null
  medicalHistory?: string | null
  dentalHistory?: string | null
  allergies?: string | null
  currentMedications?: string | null
  notes?: string | null
  isActive?: boolean
}

export interface PatientTimelineEntry {
  id: string
  type: string
  at: string
  title: string
  summary: string | null
  amountPoisha: number | null
  route: string | null
}

export interface PatientFinancialSummary {
  totalInvoicedPoisha: number
  totalPaidPoisha: number
  balancePoisha: number
  invoiceCount: number
  paymentCount: number
  lastPaymentAt: string | null
}

export interface PatientProfile {
  patient: Patient
  financial: PatientFinancialSummary | null
  counts: {
    visits: number
    appointments: number
    prescriptions: number
    invoices: number
    payments: number
    attachments: number
    referrals: number
  }
  lastVisit: { id: number; visitDate: string; diagnosis: string | null } | null
  upcomingAppointments: AppointmentSummary[]
  latestChart: DentalChartEntry[]
}

export interface PatientNote {
  id: number
  patientId: number
  note: string
  createdAt: string
  createdBy: string | null
}

export interface Visit {
  id: number
  patientId: number
  patientCode: string
  patientName: string
  visitNo: number
  visitDate: string
  visitTime: string
  dentistId: number
  dentistName: string
  appointmentId: number | null
  chiefComplaint: string | null
  symptoms: string | null
  examination: string | null
  diagnosis: string | null
  treatmentSummary: string | null
  advice: string | null
  followUpDate: string | null
  notes: string | null
  status: VisitStatus
  finalizedAt: string | null
  amendmentOfVisitId: number | null
  treatments: VisitTreatment[]
  prescriptionId: number | null
  invoiceIds: number[]
  createdAt: string
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
}

export interface VisitTreatment {
  id: number
  visitId: number
  treatmentId: number | null
  treatmentName: string
  teeth: string[]
  feePoisha: number
  note: string | null
}

export interface VisitInput {
  patientId: number
  visitDate: string
  visitTime: string
  dentistId: number
  appointmentId?: number | null
  chiefComplaint?: string | null
  symptoms?: string | null
  examination?: string | null
  diagnosis?: string | null
  treatmentSummary?: string | null
  advice?: string | null
  followUpDate?: string | null
  notes?: string | null
  treatments: {
    treatmentId: number | null
    treatmentName: string
    teeth: string[]
    feePoisha: number
    note?: string | null
  }[]
}

export interface DentalChartEntry {
  id: number
  patientId: number
  visitId: number | null
  toothNumber: string
  dentition: Dentition
  conditionCode: string
  treatmentCode: string | null
  surfaces: string[]
  status: 'existing' | 'planned' | 'completed'
  note: string | null
  updatedAt: string
}

export interface DentalChartState {
  patientId: number
  entries: DentalChartEntry[]
  visitId: number | null
  snapshotAt: string | null
}

export interface DentalCondition {
  id: number
  code: string
  name: string
  color: string
  textColor: string
  category: 'condition' | 'treatment' | 'restoration'
  appliesTo: 'permanent' | 'primary' | 'both'
  isActive: boolean
  sortOrder: number
  isSystemDefault: boolean
}

// ---------------------------------------------------------------------------------------------
// Appointments / queue
// ---------------------------------------------------------------------------------------------

export interface AppointmentSummary {
  id: number
  patientId: number
  patientCode: string
  patientName: string
  dentistId: number
  dentistName: string
  appointmentDate: string
  startTime: string
  endTime: string | null
  typeCode: string | null
  reason: string | null
  status: AppointmentStatus
  queueStatus: QueueStatus | null
  notes: string | null
  cancelledReason: string | null
  rescheduledFromId: number | null
  createdAt: string
}

export interface AppointmentInput {
  patientId: number
  dentistId: number
  appointmentDate: string
  startTime: string
  endTime?: string | null
  typeCode?: string | null
  reason?: string | null
  notes?: string | null
  status?: AppointmentStatus
}

export interface QueueEntry {
  id: number
  patientId: number
  patientCode: string
  patientName: string
  appointmentId: number | null
  dentistId: number | null
  dentistName: string | null
  queueDate: string
  position: number
  priority: QueuePriority
  status: QueueStatus
  arrivedAt: string
  calledAt: string | null
  startedAt: string | null
  completedAt: string | null
  estimatedWaitMinutes: number | null
  notes: string | null
}

export interface QueueSnapshot {
  queueDate: string
  entries: QueueEntry[]
  waitingCount: number
  inTreatmentCount: number
  completedCount: number
  averageWaitMinutes: number | null
}

// ---------------------------------------------------------------------------------------------
// Treatments / prescriptions
// ---------------------------------------------------------------------------------------------

export interface Treatment {
  id: number
  code: string | null
  name: string
  nameBn: string | null
  category: string
  description: string | null
  defaultFeePoisha: number
  durationMinutes: number | null
  isActive: boolean
  isSystemDefault: boolean
  usageCount: number
  createdAt: string
  updatedAt: string
}

export type TreatmentInput = Omit<Treatment, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>

export interface ClinicalOption {
  id: number
  listCode: string
  value: string
  valueBn: string | null
  sortOrder: number
  isActive: boolean
  isSystemDefault: boolean
}

export interface PrescriptionItem {
  id: number
  sortOrder: number
  medicineName: string
  medicineType: string | null
  strength: string | null
  dose: string | null
  morning: string | null
  noon: string | null
  night: string | null
  timing: string | null
  durationValue: number | null
  durationUnit: string | null
  quantity: string | null
  instruction: string | null
  conditionalInstruction: string | null
  notes: string | null
}

export interface Prescription {
  id: number
  patientId: number
  patientCode: string
  patientName: string
  patientAge: string | null
  patientGender: Gender | null
  visitId: number | null
  dentistId: number
  dentistName: string
  prescriptionDate: string
  chiefComplaints: string[]
  onExamination: string[]
  diagnosis: string | null
  advice: string[]
  followUpDate: string | null
  notes: string | null
  status: 'draft' | 'final' | 'void'
  printedCount: number
  lastPrintedAt: string | null
  items: PrescriptionItem[]
  createdAt: string
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
}

export interface PrescriptionInput {
  /** Drafts stay editable; a final prescription is the version that is printed and given to the patient. */
  status?: 'draft' | 'final'
  patientId: number
  visitId?: number | null
  dentistId: number
  prescriptionDate: string
  chiefComplaints: string[]
  onExamination: string[]
  diagnosis?: string | null
  advice: string[]
  followUpDate?: string | null
  notes?: string | null
  items: Omit<PrescriptionItem, 'id'>[]
}

export interface Referral {
  id: number
  patientId: number
  patientCode: string
  patientName: string
  visitId: number | null
  referralDate: string
  referringDentistId: number | null
  referringDentistName: string | null
  referredToName: string
  referredToInstitution: string | null
  referredToPhone: string | null
  reason: string
  notes: string | null
  status: ReferralStatus
  followUpDate: string | null
  outcome: string | null
  createdAt: string
  createdBy: string | null
}

export interface ReferralInput {
  patientId: number
  visitId?: number | null
  referralDate: string
  referringDentistId?: number | null
  referredToName: string
  referredToInstitution?: string | null
  referredToPhone?: string | null
  reason: string
  notes?: string | null
  status?: ReferralStatus
  followUpDate?: string | null
}

// ---------------------------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------------------------

export interface InvoiceItem {
  id: number
  sortOrder: number
  itemType: 'treatment' | 'product' | 'service' | 'other'
  treatmentId: number | null
  inventoryItemId: number | null
  description: string
  quantityMilli: number
  unitPricePoisha: number
  discountPoisha: number
  lineTotalPoisha: number
  note: string | null
}

export interface Invoice {
  id: number
  invoiceNo: string
  patientId: number
  patientCode: string
  patientName: string
  patientAddress: string | null
  patientPhone: string | null
  visitId: number | null
  invoiceDate: string
  dueDate: string | null
  subtotalPoisha: number
  discountPoisha: number
  discountPercentX100: number
  taxPoisha: number
  roundOffPoisha: number
  totalPoisha: number
  paidPoisha: number
  balancePoisha: number
  status: InvoiceStatus
  notes: string | null
  voidedAt: string | null
  voidReason: string | null
  items: InvoiceItem[]
  payments: Payment[]
  createdAt: string
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
}

export interface InvoiceItemInput {
  itemType: 'treatment' | 'product' | 'service' | 'other'
  treatmentId?: number | null
  inventoryItemId?: number | null
  description: string
  quantityMilli: number
  unitPricePoisha: number
  discountPoisha: number
  note?: string | null
}

export interface InvoiceInput {
  patientId: number
  visitId?: number | null
  invoiceDate: string
  dueDate?: string | null
  discountPoisha: number
  discountPercentX100: number
  taxPercentX100: number
  roundOffEnabled: boolean
  notes?: string | null
  items: InvoiceItemInput[]
}

export interface Payment {
  id: number
  receiptNo: string
  patientId: number
  patientCode: string
  patientName: string
  invoiceId: number | null
  invoiceNo: string | null
  kind: PaymentKind
  amountPoisha: number
  methodCode: string
  methodName: string
  referenceNo: string | null
  receivedAt: string
  receivedBy: string | null
  notes: string | null
  voidedAt: string | null
  voidReason: string | null
}

export interface PaymentInput {
  patientId: number
  invoiceId?: number | null
  kind?: PaymentKind
  amountPoisha: number
  methodCode: string
  referenceNo?: string | null
  receivedAt: string
  notes?: string | null
}

export interface PaymentMethod {
  id: number
  code: string
  name: string
  nameBn: string | null
  requiresReference: boolean
  isActive: boolean
  isSystemDefault: boolean
  sortOrder: number
}

export interface PaymentDashboard {
  rangeFrom: string | null
  rangeTo: string | null
  totalPoisha: number
  byMethod: { methodCode: string; methodName: string; totalPoisha: number; count: number }[]
  outstandingPoisha: number
  payments: Payment[]
  count: number
}

// ---------------------------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------------------------

export interface InventoryItem {
  id: number
  code: string | null
  name: string
  category: string | null
  supplierId: number | null
  supplierName: string | null
  unit: string
  quantityMilli: number
  minStockMilli: number
  purchasePricePoisha: number
  sellPricePoisha: number | null
  location: string | null
  isActive: boolean
  notes: string | null
  earliestExpiry: string | null
  isLowStock: boolean
  updatedAt: string
}

export type InventoryItemInput = Omit<
  InventoryItem,
  'id' | 'updatedAt' | 'supplierName' | 'earliestExpiry' | 'isLowStock'
>

export interface InventoryBatch {
  id: number
  itemId: number
  batchNo: string | null
  expiryDate: string | null
  quantityInMilli: number
  quantityRemainingMilli: number
  purchasePricePoisha: number
  purchaseDate: string
  supplierId: number | null
  isExpired: boolean
}

export interface InventoryTransaction {
  id: number
  itemId: number
  itemName: string
  batchId: number | null
  txnType: InventoryTransactionType
  quantityMilli: number
  unitCostPoisha: number
  reason: string | null
  referenceType: string | null
  referenceId: number | null
  at: string
  userName: string | null
  notes: string | null
}

export interface StockInInput {
  itemId: number
  batchNo?: string | null
  expiryDate?: string | null
  quantityMilli: number
  unitCostPoisha: number
  purchaseDate: string
  supplierId?: number | null
  reference?: string | null
  notes?: string | null
}

export interface StockIssueInput {
  itemId: number
  batchId?: number | null
  quantityMilli: number
  txnType: Extract<InventoryTransactionType, 'usage' | 'adjustment_out' | 'wastage' | 'return' | 'expired'>
  reason?: string | null
  referenceType?: string | null
  referenceId?: number | null
  notes?: string | null
}

export interface Supplier {
  id: number
  name: string
  contactPerson: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  isActive: boolean
}

// ---------------------------------------------------------------------------------------------
// Accounting
// ---------------------------------------------------------------------------------------------

export interface ExpenseCategory {
  id: number
  code: string
  name: string
  nameBn: string | null
  isActive: boolean
  isSystemDefault: boolean
}

export interface Expense {
  id: number
  expenseNo: string
  categoryId: number
  categoryName: string
  expenseDate: string
  amountPoisha: number
  methodCode: string
  methodName: string
  paidTo: string | null
  referenceNo: string | null
  description: string
  createdAt: string
  createdBy: string | null
  voidedAt: string | null
  voidReason: string | null
}

export interface ExpenseInput {
  categoryId: number
  expenseDate: string
  amountPoisha: number
  methodCode: string
  paidTo?: string | null
  referenceNo?: string | null
  description: string
}

export interface AccountingSummary {
  from: string | null
  to: string | null
  invoiceRevenuePoisha: number
  collectedPoisha: number
  expensesPoisha: number
  netCashFlowPoisha: number
  outstandingPoisha: number
  byMethod: { methodCode: string; methodName: string; totalPoisha: number; count: number }[]
  byExpenseCategory: { categoryId: number; categoryName: string; totalPoisha: number; count: number }[]
}

// ---------------------------------------------------------------------------------------------
// Attachments / notifications / audit
// ---------------------------------------------------------------------------------------------

export interface Attachment {
  id: number
  patientId: number | null
  patientCode: string | null
  visitId: number | null
  entityType: string
  entityId: number | null
  originalName: string
  storedPath: string
  mimeType: string | null
  sizeBytes: number
  sha256: string | null
  title: string | null
  category: string | null
  notes: string | null
  uploadedAt: string
  uploadedBy: string | null
}

export interface AttachmentInput {
  patientId: number
  visitId?: number | null
  title?: string | null
  category?: string | null
  notes?: string | null
  /** Absolute source path chosen by the user; the main process copies it into managed storage. */
  sourcePath: string
}

export interface Notification {
  id: number
  category: NotificationCategory
  priority: NotificationPriority
  title: string
  body: string | null
  entityType: string | null
  entityId: number | null
  actionType: string | null
  actionPayload: Record<string, unknown> | null
  createdAt: string
  readAt: string | null
  dismissedAt: string | null
}

export interface AuditEntry {
  id: number
  at: string
  atEpochMs: number
  actorUserId: number | null
  actorUsername: string | null
  action: string
  entityType: string | null
  entityId: string | null
  summary: string
  beforeJson: string | null
  afterJson: string | null
  severity: 'info' | 'warning' | 'critical'
  appVersion: string
  hash: string
  prevHash: string | null
}

export interface AuditQuery {
  from?: string | null
  to?: string | null
  actorUserId?: number | null
  action?: string | null
  entityType?: string | null
  severity?: 'info' | 'warning' | 'critical' | null
  search?: string | null
  page?: number
  pageSize?: number
}

export interface AuditChainStatus {
  valid: boolean
  checkedEntries: number
  firstBrokenId: number | null
  message: string
}

// ---------------------------------------------------------------------------------------------
// Dashboard / reports / search
// ---------------------------------------------------------------------------------------------

export interface DashboardKpis {
  date: string
  appointmentsTotal: number
  appointmentsCompleted: number
  appointmentsPending: number
  appointmentsMissed: number
  appointmentsUpcoming: number
  newPatientsToday: number
  patientsSeenToday: number
  queueWaiting: number
  queueInTreatment: number
  revenueTodayPoisha: number
  collectedTodayPoisha: number
  outstandingTotalPoisha: number
  lowStockCount: number
  expiringCount: number
  expiredCount: number
}

export interface DashboardTrendPoint {
  date: string
  revenuePoisha: number
  collectedPoisha: number
}

export interface DashboardWidgetData {
  kpis: DashboardKpis
  revenueTrend: DashboardTrendPoint[]
  paymentMethods: { methodCode: string; methodName: string; totalPoisha: number; count: number }[]
  upcomingAppointments: AppointmentSummary[]
  recentPatients: PatientSummary[]
  recentActivity: AuditEntry[]
  lowStockItems: InventoryItem[]
  expiringItems: {
    itemId: number
    itemName: string
    batchNo: string | null
    expiryDate: string
    quantityMilli: number
  }[]
  widgets: string[]
}

export interface RevenueReportRow {
  date: string
  invoiceCount: number
  invoicedPoisha: number
  collectedPoisha: number
  expensesPoisha: number
  netPoisha: number
}

export interface OutstandingRow {
  patientId: number
  patientCode: string
  patientName: string
  phone: string
  invoiceCount: number
  outstandingPoisha: number
  oldestInvoiceDate: string
  lastPaymentDate: string | null
}

export interface TreatmentRevenueRow {
  treatmentId: number | null
  treatmentName: string
  category: string | null
  quantity: number
  revenuePoisha: number
}

export interface SearchHit {
  entityType: string
  entityId: number
  title: string
  subtitle: string | null
  meta: string | null
  route: string
}

export interface SearchResults {
  query: string
  hits: SearchHit[]
  grouped: { entityType: string; label: string; hits: SearchHit[] }[]
  tookMs: number
}

// ---------------------------------------------------------------------------------------------
// Lists / queries
// ---------------------------------------------------------------------------------------------

export interface PageQuery {
  page?: number
  pageSize?: number
  sortBy?: string | null
  sortDir?: 'asc' | 'desc' | null
}

export interface Paged<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

export interface PatientQuery extends PageQuery {
  search?: string | null
  range?: 'today' | 'last7' | 'last30' | 'last90' | 'lastYear' | 'custom' | 'all'
  from?: string | null
  to?: string | null
  gender?: Gender | null
  includeArchived?: boolean
}

export interface AppointmentQuery extends PageQuery {
  view?: 'today' | 'upcoming' | 'past' | 'completed' | 'no_show' | 'cancelled' | 'rescheduled' | 'all'
  from?: string | null
  to?: string | null
  dentistId?: number | null
  status?: AppointmentStatus | null
  search?: string | null
}

export interface InvoiceQuery extends PageQuery {
  search?: string | null
  status?: InvoiceStatus | null
  from?: string | null
  to?: string | null
  patientId?: number | null
}

export interface PaymentQuery extends PageQuery {
  range?: 'today' | 'last7' | 'last30' | 'last90' | 'lastYear' | 'custom' | 'all'
  from?: string | null
  to?: string | null
  methodCode?: string | null
  patientId?: number | null
  search?: string | null
}

export interface VisitQuery extends PageQuery {
  patientId?: number | null
  dentistId?: number | null
  from?: string | null
  to?: string | null
  search?: string | null
}

export interface PrescriptionQuery extends PageQuery {
  patientId?: number | null
  dentistId?: number | null
  from?: string | null
  to?: string | null
  search?: string | null
}

export interface InventoryQuery extends PageQuery {
  search?: string | null
  category?: string | null
  lowStockOnly?: boolean
  expiringWithinDays?: number | null
  includeInactive?: boolean
}

export interface ExpenseQuery extends PageQuery {
  from?: string | null
  to?: string | null
  categoryId?: number | null
  search?: string | null
}

export interface AuditListQuery extends AuditQuery {
  pageSize?: number
}

export interface AttachmentQuery extends PageQuery {
  patientId: number
  category?: string | null
}

// ---------------------------------------------------------------------------------------------
// Settings / backup / printing / system
// ---------------------------------------------------------------------------------------------

export interface SettingsSnapshot {
  settings: AppSettingsShape
  clinic: ClinicProfile
}

export interface BackupRecord {
  id: number
  fileName: string
  path: string
  sizeBytes: number
  sha256: string | null
  createdAt: string
  createdBy: string | null
  trigger: 'manual' | 'auto' | 'pre_restore' | 'pre_destructive'
  status: 'success' | 'failed' | 'verified'
  includesAttachments: boolean
  appVersion: string
  schemaVersion: number
  dataFormatVersion: number
  encrypted: boolean
  errorMessage: string | null
}

export interface BackupInspection {
  folderPath: string
  valid: boolean
  problems: string[]
  manifest: {
    format: string
    formatVersion: number
    appVersion: string
    buildNumber: string
    dataSchemaVersion: number
    backupDate: string
    trigger: string
    clinic: string | null
    createdBy: string | null
    encrypted: boolean
    counts: Record<string, number>
    database: { file: string; sizeBytes: number; sha256: string; integrityCheck: string }
    auditChainHead: string | null
    notes: string | null
  } | null
  sizeBytes: number
  fileCount: number
  schemaCompatible: boolean
  compatibilityMessage: string
}

export interface RestoreRequest {
  folderPath: string
  password?: string | null
  confirmationPhrase: string
}

export interface JobProgress {
  jobId: string
  kind: 'backup' | 'restore' | 'export' | 'print' | 'import' | 'integrity'
  phase: string
  current: number
  total: number
  message: string
  done: boolean
  failed: boolean
}

export interface PrinterProfile {
  id: number
  name: string
  documentType: 'prescription' | 'invoice' | 'report'
  printerName: string | null
  paperSize: string
  customWidthMm: number | null
  customHeightMm: number | null
  orientation: 'portrait' | 'landscape'
  marginTopMm: number
  marginRightMm: number
  marginBottomMm: number
  marginLeftMm: number
  scalePercent: number
  copies: number
  isDefault: boolean
}

export interface PrinterInfo {
  name: string
  displayName: string
  isDefault: boolean
  status: number
}

export interface IntegrityReport {
  ranAt: string
  ok: boolean
  checks: { name: string; ok: boolean; detail: string; count?: number }[]
}

export interface AppInfoPayload {
  productName: string
  version: string
  buildNumber: string
  commit: string
  buildDate: string
  electron: string
  chrome: string
  node: string
  sqlite: string
  author: string
  authorEmail: string
  copyright: string
  dataRoot: string
  databasePath: string
  logPath: string
  backupFolder: string
  licence: string
  thirdPartyCount: number
}

export interface DataExportRequest {
  entity:
    | 'patients'
    | 'invoices'
    | 'payments'
    | 'expenses'
    | 'inventory'
    | 'appointments'
    | 'visits'
    | 'prescriptions'
    | 'staff'
    | 'audit'
  format: 'csv' | 'json'
  from?: string | null
  to?: string | null
  targetFolder: string
}

export interface ExportResult {
  filePath: string
  rowCount: number
  bytes: number
}

export interface DestructiveRequest {
  action:
    | 'delete_patient'
    | 'delete_selected_patients'
    | 'delete_all_patients'
    | 'delete_business_data'
    | 'reset_database'
  confirmationPhrase: string
  password: string
  ids?: number[]
  includeAttachments?: boolean
}
