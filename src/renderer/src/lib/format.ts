/**
 * Formatting helpers for the renderer. Money and dates always go through the shared modules so the
 * screen can never disagree with the numbers stored in the database.
 */

import { formatBDT, formatBDTCompact, parseAmount, toAmountString } from '@shared/money'
import {
  formatAge,
  formatDate,
  formatDurationMinutes,
  formatRelativeDate,
  formatTime12h,
  formatTimestamp,
  todayIso,
  toBengaliDigits
} from '@shared/date'
import {
  APPOINTMENT_STATUS_LABELS,
  INVENTORY_TRANSACTION_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  NOTIFICATION_CATEGORY_LABELS,
  PAYMENT_KIND_LABELS,
  QUEUE_PRIORITY_LABELS,
  QUEUE_STATUS_LABELS,
  REFERRAL_STATUS_LABELS,
  STAFF_STATUS_LABELS,
  VISIT_STATUS_LABELS
} from '@shared/constants'
import type {
  AppointmentStatus,
  InventoryTransactionType,
  InvoiceStatus,
  NotificationCategory,
  PaymentKind,
  QueuePriority,
  QueueStatus,
  ReferralStatus,
  StaffStatus,
  VisitStatus
} from '@shared/constants'

export {
  formatAge,
  formatDate,
  formatRelativeDate,
  formatTime12h,
  formatTimestamp,
  toBengaliDigits,
  todayIso
}

export function money(poisha: number, options: { compact?: boolean; symbol?: boolean } = {}): string {
  if (options.compact) return formatBDTCompact(poisha)
  return formatBDT(poisha, { symbol: options.symbol ?? true })
}

export function amountInput(poisha: number): string {
  return toAmountString(poisha)
}

export function quantityMilliText(milli: number): string {
  if (milli % 1000 === 0) return String(milli / 1000)
  return (milli / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

export function parseMoneyInput(value: string): number | null {
  return parseAmount(value)
}

export function percentText(percentX100: number): string {
  return `${(percentX100 / 100).toFixed(percentX100 % 100 === 0 ? 0 : 2)}%`
}

export function durationText(minutes: number | null): string {
  if (minutes == null || minutes < 0) return '—'
  return formatDurationMinutes(minutes)
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function appointmentStatusLabel(status: AppointmentStatus): string {
  return APPOINTMENT_STATUS_LABELS[status] ?? titleCase(status)
}
export function queueStatusLabel(status: QueueStatus): string {
  return QUEUE_STATUS_LABELS[status] ?? titleCase(status)
}
export function queuePriorityLabel(priority: QueuePriority): string {
  return QUEUE_PRIORITY_LABELS[priority] ?? titleCase(priority)
}
export function visitStatusLabel(status: VisitStatus): string {
  return VISIT_STATUS_LABELS[status] ?? titleCase(status)
}
export function invoiceStatusLabel(status: InvoiceStatus): string {
  return INVOICE_STATUS_LABELS[status] ?? titleCase(status)
}
export function paymentKindLabel(kind: PaymentKind): string {
  return PAYMENT_KIND_LABELS[kind] ?? titleCase(kind)
}
export function prescriptionStatusLabel(status: 'draft' | 'final' | 'void'): string {
  return status === 'draft' ? 'Draft' : status === 'final' ? 'Final' : 'Void'
}
export function referralStatusLabel(status: ReferralStatus): string {
  return REFERRAL_STATUS_LABELS[status] ?? titleCase(status)
}
export function staffStatusLabel(status: StaffStatus): string {
  return STAFF_STATUS_LABELS[status] ?? titleCase(status)
}
export function inventoryTypeLabel(type: InventoryTransactionType): string {
  return INVENTORY_TRANSACTION_TYPE_LABELS[type] ?? titleCase(type)
}
export function notificationCategoryLabel(category: NotificationCategory): string {
  return NOTIFICATION_CATEGORY_LABELS[category] ?? titleCase(category)
}

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'

/** Badge tone for a status value; keeps colours consistent across screens. */
export function statusTone(value: string): BadgeTone {
  switch (value) {
    case 'completed':
    case 'paid':
    case 'active':
    case 'final':
    case 'finalized':
    case 'verified':
    case 'received':
    case 'sent':
    case 'answered':
      return 'success'
    case 'in_queue':
    case 'waiting':
    case 'called':
    case 'scheduled':
    case 'confirmed':
    case 'draft':
    case 'planned':
    case 'partial':
    case 'pending':
      return 'info'
    case 'amended':
    case 'rescheduled':
    case 'arrived':
    case 'in_treatment':
    case 'on_leave':
    case 'urgent':
    case 'low_stock':
    case 'expiring':
      return 'warning'
    case 'cancelled':
    case 'void':
    case 'no_show':
    case 'expired':
    case 'failed':
    case 'terminated':
    case 'emergency':
    case 'overdue':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function fullName(person: { fullName?: string; name?: string }): string {
  return person.fullName ?? person.name ?? ''
}

export function patientAgeText(patient: { dateOfBirth: string | null; ageYears: number | null }): string {
  if (patient.dateOfBirth) return formatAge(patient.dateOfBirth)
  if (patient.ageYears != null) return `${patient.ageYears} years`
  return '—'
}

export function filesize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function relativeToToday(value: string | null): string {
  if (!value) return '—'
  return formatRelativeDate(value)
}

export function dateRangeLabel(from: string | null, to: string | null): string {
  if (!from && !to) return 'All time'
  if (from && to && from === to) return formatDate(from)
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`
  return from ? `From ${formatDate(from)}` : `Until ${formatDate(to as string)}`
}
