/**
 * Typed print document model (ADR-0003).
 *
 * Services build these structures from database rows; the renderer renders them; the print host sends
 * them to Chromium. No HTML from the renderer or the database ever enters a print job.
 */

import type { PaperMarginsMm, PaperSize } from './paper'

export interface PrintHeaderBlock {
  clinicName: string
  clinicNameBn: string | null
  logoDataUrl: string | null
  address: string
  phone: string
  phone2: string | null
  email: string | null
  registrationNo: string | null
  /** Dentist identity is only present on documents that show it (never on invoices by default). */
  dentistName: string | null
  dentistQualifications: string[]
  dentistDesignations: string[]
}

export interface PrintPatientBlock {
  name: string
  nameBn: string | null
  age: string | null
  gender: string | null
  patientCode: string
  phone: string | null
  date: string
}

export interface PrescriptionMedicineRow {
  index: number
  medicine: string
  type: string | null
  strength: string | null
  dose: string | null
  morning: string | null
  noon: string | null
  night: string | null
  timing: string | null
  duration: string | null
  quantity: string | null
  instruction: string | null
  conditionalInstruction: string | null
}

export interface PrintSection {
  label: string
  lines: string[]
}

export interface PrescriptionSignatureBlock {
  name: string
  designationLines: string[]
  /** Minimum clear space reserved for a handwritten signature, in millimetres. */
  clearanceMm: number
}

export interface PrescriptionDocument {
  kind: 'prescription'
  title: string
  paper: PaperSize
  header: PrintHeaderBlock
  patient: PrintPatientBlock
  clinical: PrintSection[]
  medicines: PrescriptionMedicineRow[]
  followUp: string | null
  footerQuote: string | null
  consultationTiming: string[]
  signature: PrescriptionSignatureBlock
  generatedAt: string
  documentId: string
}

export interface InvoiceItemRow {
  index: number
  description: string
  quantity: string
  unitPrice: string
  discount: string | null
  lineTotal: string
}

export interface InvoiceTotals {
  subtotal: string
  discount: string | null
  tax: string | null
  roundOff: string | null
  total: string
  paid: string
  due: string
  statusLabel: string
}

export interface InvoicePaymentRow {
  receiptNo: string
  date: string
  method: string
  amount: string
  reference: string | null
}

export interface InvoiceDocument {
  kind: 'invoice'
  title: string
  paper: PaperSize
  header: PrintHeaderBlock
  patient: PrintPatientBlock
  invoiceNo: string
  invoiceDate: string
  dueDate: string | null
  items: InvoiceItemRow[]
  totals: InvoiceTotals
  paymentHistory: InvoicePaymentRow[]
  termsNote: string | null
  /** Invoices intentionally carry no signature block (product requirement). */
  generatedAt: string
  documentId: string
  voided: boolean
  voidReason: string | null
}

export interface ReportDocument {
  kind: 'report'
  title: string
  paper: PaperSize
  header: PrintHeaderBlock
  range: { from: string; to: string }
  columns: { key: string; label: string; align: 'left' | 'right' | 'center' }[]
  rows: string[][]
  summaries: { label: string; value: string; emphasis?: boolean }[]
  footNotes: string[]
  generatedAt: string
  generatedBy: string
  documentId: string
}

export type PrintDocument = PrescriptionDocument | InvoiceDocument | ReportDocument

export interface PrintJobRequest {
  documentType: 'prescription' | 'invoice' | 'report'
  document: PrintDocument
  printerName: string | null
  copies: number
  mode: 'preview' | 'print' | 'pdf'
  targetPath: string | null
  /** Page range for Chromium ("1-3"), null = all pages. */
  pageRanges: string | null
}

export interface PrintJobResult {
  ok: boolean
  mode: 'preview' | 'print' | 'pdf'
  filePath: string | null
  pages: number | null
  message: string
}

export interface PrintHostProps {
  document: PrintDocument
  margins?: PaperMarginsMm
}
