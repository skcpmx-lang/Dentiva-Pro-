/**
 * Document builders: database rows → typed print documents.
 *
 * These are pure functions with no I/O, which makes the whole print layout testable (long names, many
 * medicines, empty sections, Bengali content, multi-page invoices) without a printer.
 */

import { CURRENCY_SYMBOL, formatBDT, toAmountString } from '../money'
import { formatDate } from '../date'
import type { PaperSize } from './paper'
import type {
  InvoiceDocument,
  InvoiceItemRow,
  InvoicePaymentRow,
  PrescriptionDocument,
  PrescriptionMedicineRow,
  PrintHeaderBlock,
  PrintPatientBlock,
  PrintSection,
  ReportDocument
} from './model'

const MIN_SIGNATURE_CLEARANCE_MM = 25

export interface ClinicForPrint {
  name: string
  nameBn: string | null
  logoDataUrl: string | null
  address: string
  phone1: string
  phone2: string | null
  email: string | null
  registrationNo: string | null
}

export interface DentistForPrint {
  fullName: string
  qualifications: string[]
  designations: string[]
  signatureDataUrl?: string | null
}

export function buildHeader(
  clinic: ClinicForPrint,
  options: {
    dentist?: DentistForPrint | null
    showLogo?: boolean
    showDentist?: boolean
    showQualifications?: boolean
  } = {}
): PrintHeaderBlock {
  const { dentist = null, showLogo = true, showDentist = false, showQualifications = true } = options
  return {
    clinicName: clinic.name,
    clinicNameBn: clinic.nameBn,
    logoDataUrl: showLogo ? clinic.logoDataUrl : null,
    address: clinic.address,
    phone: clinic.phone1,
    phone2: clinic.phone2,
    email: clinic.email,
    registrationNo: clinic.registrationNo,
    dentistName: showDentist && dentist ? dentist.fullName : null,
    dentistQualifications: showDentist && dentist && showQualifications ? dentist.qualifications : [],
    dentistDesignations: showDentist && dentist ? dentist.designations : []
  }
}

export function buildPatientBlock(input: {
  name: string
  nameBn?: string | null
  age?: string | null
  gender?: string | null
  code: string
  phone?: string | null
  date: string
  dateFormat?: 'dd MMM yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd' | 'dd MMMM yyyy' | 'MMM dd, yyyy'
}): PrintPatientBlock {
  return {
    name: input.name,
    nameBn: input.nameBn ?? null,
    age: input.age ?? null,
    gender: input.gender ?? null,
    patientCode: input.code,
    phone: input.phone ?? null,
    date: formatDate(input.date, input.dateFormat ?? 'dd MMM yyyy')
  }
}

// ---------------------------------------------------------------------------------------------
// Prescription
// ---------------------------------------------------------------------------------------------

export interface PrescriptionPrintInput {
  paper: PaperSize
  clinic: ClinicForPrint
  dentist: DentistForPrint
  patient: PrintPatientBlock
  chiefComplaints: string[]
  onExamination: string[]
  remarks: string | null
  advice: string[]
  medicines: {
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
  }[]
  followUpDate: string | null
  footerQuote: string | null
  consultationTiming: string[]
  settings: {
    showDentist: boolean
    showQualifications: boolean
    showLogo: boolean
    showConsultationTiming: boolean
    dateFormat?: 'dd MMM yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd' | 'dd MMMM yyyy' | 'MMM dd, yyyy'
  }
  prescriptionId: number
  generatedAt: string
}

function formatDose(row: PrescriptionPrintInput['medicines'][number]): string | null {
  const parts = [row.morning, row.noon, row.night].map((value) =>
    value && value.trim() !== '' ? value : '0'
  )
  const hasAny = [row.morning, row.noon, row.night].some((value) => value && value.trim() !== '')
  if (!hasAny && !row.dose) return null
  const schedule = hasAny ? parts.join(' - ') : null
  return row.dose && schedule ? `${row.dose} (${schedule})` : (row.dose ?? schedule)
}

function formatDuration(value: number | null, unit: string | null): string | null {
  if (value == null && !unit) return null
  if (value == null) return unit
  const unitText = unit ?? 'day'
  const plural = value === 1 ? unitText : unitText.endsWith('s') ? unitText : `${unitText}s`
  return `${value} ${plural}`
}

export function buildPrescriptionDocument(input: PrescriptionPrintInput): PrescriptionDocument {
  const clinical: PrintSection[] = []
  if (input.chiefComplaints.length > 0) {
    clinical.push({ label: 'C/C', lines: input.chiefComplaints })
  }
  if (input.onExamination.length > 0) {
    clinical.push({ label: 'O/E', lines: input.onExamination })
  }
  if (input.remarks && input.remarks.trim() !== '') {
    clinical.push({ label: 'R/E', lines: input.remarks.split('\n').filter((line) => line.trim() !== '') })
  }
  if (input.advice.length > 0) {
    clinical.push({ label: 'Advice', lines: input.advice })
  }

  const medicines: PrescriptionMedicineRow[] = input.medicines.map((row, index) => ({
    index: index + 1,
    medicine: row.medicineName,
    type: row.medicineType,
    strength: row.strength,
    dose: formatDose(row),
    morning: row.morning,
    noon: row.noon,
    night: row.night,
    timing: row.timing,
    duration: formatDuration(row.durationValue, row.durationUnit),
    quantity: row.quantity,
    instruction: row.instruction,
    conditionalInstruction: row.conditionalInstruction
  }))

  return {
    kind: 'prescription',
    title: 'Prescription',
    paper: input.paper,
    header: buildHeader(input.clinic, {
      dentist: input.dentist,
      showLogo: input.settings.showLogo,
      showDentist: true,
      showQualifications: input.settings.showQualifications
    }),
    patient: input.patient,
    clinical,
    medicines,
    followUp: input.followUpDate
      ? formatDate(input.followUpDate, input.settings.dateFormat ?? 'dd MMM yyyy')
      : null,
    footerQuote: input.footerQuote,
    consultationTiming: input.settings.showConsultationTiming ? input.consultationTiming : [],
    signature: {
      name: input.dentist.fullName,
      designationLines: [...input.dentist.designations, ...input.dentist.qualifications],
      clearanceMm: MIN_SIGNATURE_CLEARANCE_MM
    },
    generatedAt: input.generatedAt,
    documentId: `RX-${input.prescriptionId}`
  }
}

// ---------------------------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------------------------

export interface InvoicePrintInput {
  paper: PaperSize
  clinic: ClinicForPrint
  dentist?: DentistForPrint | null
  patient: PrintPatientBlock
  invoiceNo: string
  invoiceDate: string
  dueDate: string | null
  items: {
    description: string
    quantityMilli: number
    unitPricePoisha: number
    discountPoisha: number
    lineTotalPoisha: number
  }[]
  subtotalPoisha: number
  discountPoisha: number
  taxPoisha: number
  roundOffPoisha: number
  totalPoisha: number
  paidPoisha: number
  balancePoisha: number
  statusLabel: string
  payments: {
    receiptNo: string
    receivedAt: string
    methodName: string
    amountPoisha: number
    referenceNo: string | null
  }[]
  termsNote: string | null
  settings: {
    showDentist: boolean
    showLogo: boolean
    showPaymentHistory: boolean
    dateFormat?: 'dd MMM yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd' | 'dd MMMM yyyy' | 'MMM dd, yyyy'
  }
  invoiceId: number
  generatedAt: string
  voided: boolean
  voidReason: string | null
}

function quantityText(quantityMilli: number): string {
  if (quantityMilli % 1000 === 0) return String(quantityMilli / 1000)
  return (quantityMilli / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

export function buildInvoiceDocument(input: InvoicePrintInput): InvoiceDocument {
  const dateFormat = input.settings.dateFormat ?? 'dd MMM yyyy'
  const items: InvoiceItemRow[] = input.items.map((item, index) => ({
    index: index + 1,
    description: item.description,
    quantity: quantityText(item.quantityMilli),
    unitPrice: formatBDT(item.unitPricePoisha, { symbol: false }),
    discount: item.discountPoisha > 0 ? formatBDT(item.discountPoisha, { symbol: false }) : null,
    lineTotal: formatBDT(item.lineTotalPoisha, { symbol: false })
  }))

  const paymentHistory: InvoicePaymentRow[] = input.settings.showPaymentHistory
    ? input.payments.map((payment) => ({
        receiptNo: payment.receiptNo,
        date: formatDate(payment.receivedAt.slice(0, 10), dateFormat),
        method: payment.methodName,
        amount: formatBDT(payment.amountPoisha, { symbol: false }),
        reference: payment.referenceNo
      }))
    : []

  return {
    kind: 'invoice',
    title: 'Invoice',
    paper: input.paper,
    header: buildHeader(input.clinic, {
      dentist: input.dentist ?? null,
      showLogo: input.settings.showLogo,
      showDentist: input.settings.showDentist,
      showQualifications: true
    }),
    patient: input.patient,
    invoiceNo: input.invoiceNo,
    invoiceDate: formatDate(input.invoiceDate, dateFormat),
    dueDate: input.dueDate ? formatDate(input.dueDate, dateFormat) : null,
    items,
    totals: {
      subtotal: formatBDT(input.subtotalPoisha, { symbol: false }),
      discount: input.discountPoisha > 0 ? formatBDT(input.discountPoisha, { symbol: false }) : null,
      tax: input.taxPoisha > 0 ? formatBDT(input.taxPoisha, { symbol: false }) : null,
      roundOff: input.roundOffPoisha !== 0 ? toAmountString(input.roundOffPoisha) : null,
      total: formatBDT(input.totalPoisha, { symbol: false }),
      paid: formatBDT(input.paidPoisha, { symbol: false }),
      due: formatBDT(input.balancePoisha, { symbol: false }),
      statusLabel: input.statusLabel
    },
    paymentHistory,
    termsNote: input.termsNote,
    generatedAt: input.generatedAt,
    documentId: `INV-${input.invoiceId}`,
    voided: input.voided,
    voidReason: input.voidReason
  }
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

export interface ReportPrintInput {
  paper: PaperSize
  clinic: ClinicForPrint
  title: string
  from: string
  to: string
  columns: { key: string; label: string; align: 'left' | 'right' | 'center' }[]
  rows: string[][]
  summaries: { label: string; value: string; emphasis?: boolean }[]
  footNotes?: string[]
  generatedAt: string
  generatedBy: string
  currencySuffix?: boolean
}

export function buildReportDocument(input: ReportPrintInput): ReportDocument {
  return {
    kind: 'report',
    title: input.title,
    paper: input.paper,
    header: buildHeader(input.clinic, { showLogo: true }),
    range: { from: formatDate(input.from), to: formatDate(input.to) },
    columns: input.columns,
    rows: input.rows,
    summaries: input.summaries,
    footNotes: [
      ...(input.footNotes ?? []),
      input.currencySuffix === false ? '' : `All amounts are shown in ${CURRENCY_SYMBOL} (BDT).`
    ].filter((note) => note !== ''),
    generatedAt: input.generatedAt,
    generatedBy: input.generatedBy,
    documentId: `RPT-${input.from}-${input.to}`
  }
}

/** Signature clearance used by the prescription layout and its tests. */
export const SIGNATURE_CLEARANCE_MM = MIN_SIGNATURE_CLEARANCE_MM
