/**
 * Service container: wires repositories and services onto one database connection.
 *
 * The container is rebuilt after a restore (the database file is swapped) and is the single place where
 * the dependency graph between repositories and services is decided.
 */

import { AuthService } from './auth-service'
import { ClinicalService } from './clinical-service'
import { BillingService } from './billing-service'
import { AdminService } from './admin-service'
import { SetupService } from './setup-service'
import {
  applyInitialDefaults,
  CatalogueRepository,
  ClinicRepository,
  CounterRepository,
  DentistRepository,
  MetaRepository,
  PermissionRepository,
  PrinterProfileRepository,
  RoleRepository,
  SettingsRepository,
  StaffRepository,
  UserRepository
} from '../db/repositories-core'
import {
  AppointmentRepository,
  AttachmentRepository,
  AuditRepository,
  DentalChartRepository,
  NotificationRepository,
  PatientRepository,
  PrescriptionRepository,
  QueueRepository,
  ReferralRepository,
  VisitRepository
} from '../db/repositories-clinical'
import {
  ExpenseRepository,
  InventoryRepository,
  InvoiceRepository,
  PaymentRepository,
  SupplierRepository,
  TreatmentRepository
} from '../db/repositories-billing'
import { SessionManager } from '../security/session'
import type { SqliteDatabase } from '../db/connection'
import type { DataLayout } from '../storage/paths'
import type { AppSettingsShape } from '@shared/constants'
import type { JobProgress } from '@shared/types'

export interface ContainerOptions {
  db: SqliteDatabase
  layout: DataLayout
  session: SessionManager
  appVersion: string
  buildInfo: { version: string; buildNumber: string; commit: string; buildDate: string }
  runtime: { electron: string; chrome: string; node: string; sqlite: string; thirdPartyCount: number }
  activation: {
    activated: boolean
    verify: (input: string) => boolean
    markActivated: () => void
    activationStateHash: () => string
  }
  closeDb: () => void
  reopenDb: () => SqliteDatabase
  listSystemPrinters: () => Promise<import('@shared/types').PrinterInfo[]>
  onProgress?: (progress: JobProgress) => void
}

export { applyInitialDefaults }

export interface Services {
  db: SqliteDatabase
  meta: MetaRepository
  counters: CounterRepository
  settings: SettingsRepository
  clinic: ClinicRepository
  permissions: PermissionRepository
  roles: RoleRepository
  users: UserRepository
  dentists: DentistRepository
  staff: StaffRepository
  catalogue: CatalogueRepository
  printerProfiles: PrinterProfileRepository
  patients: PatientRepository
  visits: VisitRepository
  chart: DentalChartRepository
  prescriptions: PrescriptionRepository
  referrals: ReferralRepository
  appointments: AppointmentRepository
  queue: QueueRepository
  attachments: AttachmentRepository
  notifications: NotificationRepository
  audit: AuditRepository
  treatments: TreatmentRepository
  invoices: InvoiceRepository
  payments: PaymentRepository
  inventory: InventoryRepository
  suppliers: SupplierRepository
  expenses: ExpenseRepository
  auth: AuthService
  clinical: ClinicalService
  billing: BillingService
  admin: AdminService
  setup: SetupService
  session: SessionManager
  settingsCache: AppSettingsShape
  refreshSettingsCache: () => AppSettingsShape
}

export function createServices(options: ContainerOptions): Services {
  const { db, layout, session } = options

  const meta = new MetaRepository(db)
  const counters = new CounterRepository(db)
  const settings = new SettingsRepository(db)
  const clinic = new ClinicRepository(db)
  const permissions = new PermissionRepository(db)
  const roles = new RoleRepository(db)
  const users = new UserRepository(db)
  const dentists = new DentistRepository(db)
  const staff = new StaffRepository(db)
  const catalogue = new CatalogueRepository(db)
  const printerProfiles = new PrinterProfileRepository(db)
  const patients = new PatientRepository(db)
  const visits = new VisitRepository(db)
  const chart = new DentalChartRepository(db)
  const prescriptions = new PrescriptionRepository(db)
  const referrals = new ReferralRepository(db)
  const appointments = new AppointmentRepository(db)
  const queue = new QueueRepository(db)
  const attachments = new AttachmentRepository(db)
  const notifications = new NotificationRepository(db)
  const audit = new AuditRepository(db)
  const treatments = new TreatmentRepository(db)
  const invoices = new InvoiceRepository(db)
  const payments = new PaymentRepository(db)
  const inventory = new InventoryRepository(db)
  const suppliers = new SupplierRepository(db)
  const expenses = new ExpenseRepository(db)

  const auth = new AuthService({
    db,
    users,
    roles,
    audit,
    session,
    appVersion: options.appVersion
  })

  const billing = new BillingService({
    db,
    layout,
    invoices,
    payments,
    expenses,
    inventory,
    suppliers,
    treatments,
    attachments,
    patients,
    counters,
    settings,
    audit,
    session,
    appVersion: options.appVersion
  })

  const clinical = new ClinicalService({
    db,
    patients,
    visits,
    chart,
    prescriptions,
    referrals,
    appointments,
    queue,
    dentists,
    treatments,
    invoices,
    payments,
    inventory,
    counters,
    settings,
    notifications,
    audit,
    auth,
    session,
    appVersion: options.appVersion
  })

  const admin = new AdminService({
    db,
    layout,
    settings,
    clinic,
    dentists,
    staff,
    printerProfiles,
    counters,
    audit,
    patients,
    invoices,
    prescriptions,
    attachments,
    billing,
    auth,
    session,
    appVersion: options.appVersion,
    buildInfo: options.buildInfo,
    runtime: options.runtime,
    closeDb: options.closeDb,
    reopenDb: options.reopenDb,
    listSystemPrinters: options.listSystemPrinters,
    onProgress: options.onProgress
  })

  const setup = new SetupService({
    db,
    layout,
    meta,
    counters,
    settings,
    clinic,
    permissions,
    roles,
    users,
    catalogue,
    dentists,
    audit,
    session,
    appVersion: options.appVersion,
    buildInfo: options.buildInfo,
    activation: options.activation
  })

  const settingsCache = { current: settings.get() }
  const refreshSettingsCache = (): AppSettingsShape => {
    settingsCache.current = settings.get()
    session.setAutoLockMinutes(settingsCache.current.autoLockMinutes)
    return settingsCache.current
  }
  refreshSettingsCache()

  return {
    db,
    meta,
    counters,
    settings,
    clinic,
    permissions,
    roles,
    users,
    dentists,
    staff,
    catalogue,
    printerProfiles,
    patients,
    visits,
    chart,
    prescriptions,
    referrals,
    appointments,
    queue,
    attachments,
    notifications,
    audit,
    treatments,
    invoices,
    payments,
    inventory,
    suppliers,
    expenses,
    auth,
    clinical,
    billing,
    admin,
    setup,
    session,
    get settingsCache() {
      return settingsCache.current
    },
    refreshSettingsCache
  }
}
