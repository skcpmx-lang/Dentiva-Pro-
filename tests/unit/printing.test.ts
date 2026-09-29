/**
 * Unit tests for the print document builders (acceptance test AT-D05).
 *
 * The builders are pure functions, so the layout rules that matter clinically and legally can be checked
 * without a printer: the prescription shows only the sections that have content, in the right order, with
 * every medicine row numbered and its dose/duration formatted; the signature block reserves a physically
 * blank area of at least 25 mm and stays the last thing on the page; and the invoice header carries the
 * clinic identity only, with the doctor shown just when the clinic asks for it.
 */

import { describe, expect, it } from 'vitest'
import { PAPER_SIZES } from '@shared/printing/paper'
import type { InvoiceDocument, PrescriptionDocument } from '@shared/printing/model'
import {
  buildHeader,
  buildInvoiceDocument,
  buildPatientBlock,
  buildPrescriptionDocument,
  buildReportDocument,
  SIGNATURE_CLEARANCE_MM,
  type ClinicForPrint,
  type DentistForPrint,
  type InvoicePrintInput,
  type PrescriptionPrintInput
} from '@shared/printing/documents'

const clinic: ClinicForPrint = {
  name: 'E2E Dental Care',
  nameBn: 'ই২ই ডেন্টাল কেয়ার',
  logoDataUrl: 'data:image/png;base64,AAAA',
  address: '12 Mirpur Road, Dhaka 1216',
  phone1: '+880 1700-000000',
  phone2: '+880 1700-000001',
  email: 'clinic@example.com',
  registrationNo: 'DGDA-1234'
}

const dentist: DentistForPrint = {
  fullName: 'Dr. Farhana Rahman',
  qualifications: ['BDS', 'FCPS (Oral & Maxillofacial)'],
  designations: ['Chief Consultant', 'Oral Surgeon'],
  signatureDataUrl: null
}

const generatedAt = '2026-09-30 10:15:00'

function prescription(overrides: Partial<PrescriptionPrintInput> = {}): PrescriptionDocument {
  const base: PrescriptionPrintInput = {
    paper: PAPER_SIZES.A4,
    clinic,
    dentist,
    patient: buildPatientBlock({
      name: 'Abdul Karim',
      nameBn: 'আব্দুল করিম',
      age: '42 years',
      gender: 'Male',
      code: 'P-000123',
      phone: '+880 1800-000000',
      date: '2026-09-30'
    }),
    chiefComplaints: ['Pain in the lower right molar for 3 days'],
    onExamination: ['Deep caries on 46', 'Percussion tender'],
    remarks: 'Pulpitis\nNo periapical pathology on IOPA',
    advice: ['Warm saline rinse', 'Avoid hard food'],
    medicines: [
      {
        medicineName: 'Amoxicillin 500 mg',
        medicineType: 'Capsule',
        strength: '500 mg',
        dose: '1',
        morning: '1',
        noon: '0',
        night: '1',
        timing: 'After food',
        durationValue: 7,
        durationUnit: 'day',
        quantity: '14',
        instruction: null,
        conditionalInstruction: null
      },
      {
        medicineName: 'Ibuprofen 400 mg',
        medicineType: 'Tablet',
        strength: '400 mg',
        dose: null,
        morning: '1',
        noon: '1',
        night: '1',
        timing: 'After food',
        durationValue: 3,
        durationUnit: 'day',
        quantity: '9',
        instruction: 'Take with plenty of water',
        conditionalInstruction: 'if pain occurs'
      }
    ],
    followUpDate: '2026-10-07',
    footerQuote: 'Brush twice a day and floss before bed.',
    consultationTiming: ['Sat–Thu 10:00–14:00', 'Sat–Thu 17:00–21:00'],
    settings: {
      showDentist: true,
      showQualifications: true,
      showLogo: true,
      showConsultationTiming: true,
      dateFormat: 'dd MMM yyyy'
    },
    prescriptionId: 123,
    generatedAt
  }
  return buildPrescriptionDocument({ ...base, ...overrides })
}

function invoice(overrides: Partial<InvoicePrintInput> = {}): InvoiceDocument {
  const base: InvoicePrintInput = {
    paper: PAPER_SIZES.A5,
    clinic,
    dentist,
    patient: buildPatientBlock({ name: 'Abdul Karim', code: 'P-000123', date: '2026-09-30' }),
    invoiceNo: 'INV-2026-000123',
    invoiceDate: '2026-09-30',
    dueDate: null,
    items: [
      {
        description: 'Root canal treatment (46)',
        quantityMilli: 1000,
        unitPricePoisha: 850000,
        discountPoisha: 0,
        lineTotalPoisha: 850000
      },
      {
        description: 'Composite restoration (46)',
        quantityMilli: 1000,
        unitPricePoisha: 350000,
        discountPoisha: 5000,
        lineTotalPoisha: 345000
      },
      {
        description: 'Anaesthetic cartridge',
        quantityMilli: 1500,
        unitPricePoisha: 20000,
        discountPoisha: 0,
        lineTotalPoisha: 30000
      }
    ],
    subtotalPoisha: 1225000,
    discountPoisha: 5000,
    taxPoisha: 0,
    roundOffPoisha: 0,
    totalPoisha: 1220000,
    paidPoisha: 200000,
    balancePoisha: 1020000,
    statusLabel: 'Partial',
    payments: [
      {
        receiptNo: 'RCP-000456',
        receivedAt: '2026-09-30 10:20:00',
        methodName: 'bKash',
        amountPoisha: 200000,
        referenceNo: 'TX99887766'
      }
    ],
    termsNote: 'Treatment costs are payable at the time of service.',
    settings: { showDentist: false, showLogo: true, showPaymentHistory: true, dateFormat: 'dd MMM yyyy' },
    invoiceId: 456,
    generatedAt,
    voided: false,
    voidReason: null
  }
  return buildInvoiceDocument({ ...base, ...overrides })
}

describe('print header', () => {
  it('carries the clinic identity and hides the doctor unless it is asked for', () => {
    const header = buildHeader(clinic, { dentist, showDentist: false })
    expect(header.clinicName).toBe('E2E Dental Care')
    expect(header.clinicNameBn).toBe('ই২ই ডেন্টাল কেয়ার')
    expect(header.address).toBe('12 Mirpur Road, Dhaka 1216')
    expect(header.phone).toBe('+880 1700-000000')
    expect(header.dentistName).toBeNull()
    expect(header.dentistDesignations).toEqual([])
    expect(header.dentistQualifications).toEqual([])
  })

  it('carries the doctor when the clinic asks for it, and drops the logo when asked', () => {
    const header = buildHeader(clinic, {
      dentist,
      showDentist: true,
      showQualifications: true,
      showLogo: false
    })
    expect(header.dentistName).toBe('Dr. Farhana Rahman')
    expect(header.dentistDesignations).toEqual(['Chief Consultant', 'Oral Surgeon'])
    expect(header.dentistQualifications).toEqual(['BDS', 'FCPS (Oral & Maxillofacial)'])
    expect(header.logoDataUrl).toBeNull()
  })
})

describe('prescription document', () => {
  it('builds a prescription with the structured clinical sections in order', () => {
    const document = prescription()
    expect(document.kind).toBe('prescription')
    expect(document.title).toBe('Prescription')
    expect(document.paper.key).toBe('A4')
    expect(document.documentId).toBe('RX-123')
    expect(document.generatedAt).toBe(generatedAt)
    expect(document.clinical.map((section) => section.label)).toEqual(['C/C', 'O/E', 'R/E', 'Advice'])
    expect(document.clinical[0]?.lines).toEqual(['Pain in the lower right molar for 3 days'])
    expect(document.clinical[2]?.lines).toEqual(['Pulpitis', 'No periapical pathology on IOPA'])
  })

  it('omits sections that have no content instead of printing empty headings', () => {
    const document = prescription({
      chiefComplaints: [],
      onExamination: [],
      remarks: '   ',
      advice: []
    })
    expect(document.clinical).toEqual([])
  })

  it('numbers medicine rows from one and keeps every clinical detail', () => {
    const document = prescription()
    expect(document.medicines).toHaveLength(2)
    const [first, second] = document.medicines
    expect(first).toMatchObject({
      index: 1,
      medicine: 'Amoxicillin 500 mg',
      type: 'Capsule',
      strength: '500 mg',
      dose: '1 (1 - 0 - 1)',
      morning: '1',
      noon: '0',
      night: '1',
      timing: 'After food',
      duration: '7 days',
      quantity: '14'
    })
    expect(second?.index).toBe(2)
    expect(second?.duration).toBe('3 days')
    expect(second?.instruction).toBe('Take with plenty of water')
    expect(second?.conditionalInstruction).toBe('if pain occurs')
  })

  it('formats a schedule without an explicit dose and a single-day duration', () => {
    const document = prescription({
      medicines: [
        {
          medicineName: 'Chlorhexidine mouthwash',
          medicineType: 'Mouthwash',
          strength: null,
          dose: null,
          morning: null,
          noon: null,
          night: '1',
          timing: 'Before bed',
          durationValue: 1,
          durationUnit: 'day',
          quantity: '1',
          instruction: null,
          conditionalInstruction: null
        },
        {
          medicineName: 'Vitamin D3',
          medicineType: null,
          strength: null,
          dose: null,
          morning: null,
          noon: null,
          night: null,
          timing: null,
          durationValue: null,
          durationUnit: null,
          quantity: null,
          instruction: null,
          conditionalInstruction: null
        }
      ]
    })
    expect(document.medicines[0]?.dose).toBe('0 - 0 - 1')
    expect(document.medicines[0]?.duration).toBe('1 day')
    expect(document.medicines[1]?.dose).toBeNull()
    expect(document.medicines[1]?.duration).toBeNull()
  })

  it('reserves a physically blank signature area of at least 25 mm and keeps it last', () => {
    const document = prescription()
    expect(SIGNATURE_CLEARANCE_MM).toBeGreaterThanOrEqual(25)
    expect(document.signature.clearanceMm).toBeGreaterThanOrEqual(25)
    expect(document.signature.name).toBe('Dr. Farhana Rahman')
    expect(document.signature.designationLines).toEqual([
      'Chief Consultant',
      'Oral Surgeon',
      'BDS',
      'FCPS (Oral & Maxillofacial)'
    ])

    // Nothing may be printed below the reserved area: the signature block is the last content of the
    // prescription document, followed only by the generation stamp and the document id.
    const keys = Object.keys(document)
    const signatureAt = keys.indexOf('signature')
    expect(signatureAt).toBeGreaterThan(-1)
    expect(keys.slice(signatureAt + 1)).toEqual(['generatedAt', 'documentId'])
  })

  it('keeps the follow-up, footer quote and consultation timing when they are set', () => {
    const document = prescription()
    expect(document.followUp).toBe('07 Oct 2026')
    expect(document.footerQuote).toBe('Brush twice a day and floss before bed.')
    expect(document.consultationTiming).toEqual(['Sat–Thu 10:00–14:00', 'Sat–Thu 17:00–21:00'])

    const quiet = prescription({ followUpDate: null, footerQuote: null, consultationTiming: [] })
    expect(quiet.followUp).toBeNull()
    expect(quiet.footerQuote).toBeNull()
    expect(quiet.consultationTiming).toEqual([])
  })

  it('hides the consultation timing when the clinic turned it off, without touching the rest', () => {
    const document = prescription({
      consultationTiming: ['Sat–Thu 10:00–14:00'],
      settings: {
        showDentist: true,
        showQualifications: false,
        showLogo: false,
        showConsultationTiming: false
      }
    })
    expect(document.consultationTiming).toEqual([])
    expect(document.header.logoDataUrl).toBeNull()
    expect(document.header.dentistQualifications).toEqual([])
    expect(document.header.dentistName).toBe('Dr. Farhana Rahman')
  })

  it('carries Bengali patient and clinic text through unchanged', () => {
    const document = prescription()
    expect(document.patient.nameBn).toBe('আব্দুল করিম')
    expect(document.header.clinicNameBn).toBe('ই২ই ডেন্টাল কেয়ার')
  })
})

describe('invoice document', () => {
  it('stamps the document type, number and patient block', () => {
    const document = invoice()
    expect(document.kind).toBe('invoice')
    expect(document.title).toBe('Invoice')
    expect(document.paper.key).toBe('A5')
    expect(document.documentId).toBe('INV-456')
    expect(document.invoiceNo).toBe('INV-2026-000123')
    expect(document.invoiceDate).toBe('30 Sep 2026')
    expect(document.dueDate).toBeNull()
  })

  it('keeps the header to the clinic when the clinic does not print the doctor', () => {
    const document = invoice()
    expect(document.header.clinicName).toBe('E2E Dental Care')
    expect(document.header.dentistName).toBeNull()
    expect(document.header.dentistDesignations).toEqual([])
    expect(document.header.dentistQualifications).toEqual([])
  })

  it('shows the doctor on the invoice only when the setting is on', () => {
    const document = invoice({
      settings: { showDentist: true, showLogo: true, showPaymentHistory: true }
    })
    expect(document.header.dentistName).toBe('Dr. Farhana Rahman')
    expect(document.header.dentistQualifications).toEqual(['BDS', 'FCPS (Oral & Maxillofacial)'])
  })

  it('numbers the items and renders quantities and money without inventing precision', () => {
    const document = invoice()
    expect(document.items.map((row) => row.index)).toEqual([1, 2, 3])
    expect(document.items[0]?.quantity).toBe('1')
    expect(document.items[2]?.quantity).toBe('1.5')
    expect(document.items[0]?.unitPrice).toBe('8,500.00')
    expect(document.items[1]?.discount).toBe('50.00')
    expect(document.items[0]?.discount).toBeNull()
    expect(document.items[1]?.lineTotal).toBe('3,450.00')
  })

  it('totals the invoice from poisha and hides zero tax, discount and round-off', () => {
    const document = invoice()
    expect(document.totals).toMatchObject({
      subtotal: '12,250.00',
      discount: '50.00',
      tax: null,
      roundOff: null,
      total: '12,200.00',
      paid: '2,000.00',
      due: '10,200.00',
      statusLabel: 'Partial'
    })
  })

  it('shows a round-off adjustment when the invoice was rounded to whole taka', () => {
    const document = invoice({ roundOffPoisha: -9 })
    expect(document.totals.roundOff).toBe('-0.09')
  })

  it('lists the payments that were received, with their reference', () => {
    const document = invoice()
    expect(document.paymentHistory).toEqual([
      {
        receiptNo: 'RCP-000456',
        date: '30 Sep 2026',
        method: 'bKash',
        amount: '2,000.00',
        reference: 'TX99887766'
      }
    ])
    const hidden = invoice({
      settings: { showDentist: false, showLogo: true, showPaymentHistory: false }
    })
    expect(hidden.paymentHistory).toEqual([])
  })

  it('marks a voided invoice and keeps the reason', () => {
    const document = invoice({ voided: true, voidReason: 'Billed to the wrong patient' })
    expect(document.voided).toBe(true)
    expect(document.voidReason).toBe('Billed to the wrong patient')
    expect(document.totals.statusLabel).toBe('Partial')
  })

  it('never carries a signature block — the invoice is signed by hand if the clinic wants to', () => {
    const document = invoice()
    expect('signature' in document).toBe(false)
    expect('clearanceMm' in document).toBe(false)
  })
})

describe('report document', () => {
  it('formats the range, keeps the columns and footnotes the currency', () => {
    const document = buildReportDocument({
      paper: PAPER_SIZES.A4,
      clinic,
      title: 'Daily collection',
      from: '2026-09-01',
      to: '2026-09-30',
      columns: [
        { key: 'date', label: 'Date', align: 'left' },
        { key: 'amount', label: 'Amount', align: 'right' }
      ],
      rows: [
        ['30 Sep 2026', '12,200.00'],
        ['29 Sep 2026', '8,400.00']
      ],
      summaries: [{ label: 'Total', value: '20,600.00', emphasis: true }],
      footNotes: ['Payments received in cash are listed separately.'],
      generatedAt,
      generatedBy: 'Administrator'
    })
    expect(document.kind).toBe('report')
    expect(document.range).toEqual({ from: '01 Sep 2026', to: '30 Sep 2026' })
    expect(document.columns).toHaveLength(2)
    expect(document.rows[0]).toEqual(['30 Sep 2026', '12,200.00'])
    expect(document.summaries[0]).toMatchObject({ label: 'Total', emphasis: true })
    expect(document.footNotes).toEqual([
      'Payments received in cash are listed separately.',
      'All amounts are shown in ৳ (BDT).'
    ])
    expect(document.generatedBy).toBe('Administrator')
    expect(document.documentId).toBe('RPT-2026-09-01-2026-09-30')
  })

  it('drops the currency footnote when the report is not about money', () => {
    const document = buildReportDocument({
      paper: PAPER_SIZES.A4,
      clinic,
      title: 'Patient list',
      from: '2026-09-01',
      to: '2026-09-30',
      columns: [{ key: 'name', label: 'Name', align: 'left' }],
      rows: [['Abdul Karim']],
      summaries: [],
      generatedAt,
      generatedBy: 'Administrator',
      currencySuffix: false
    })
    expect(document.footNotes).toEqual([])
  })
})
