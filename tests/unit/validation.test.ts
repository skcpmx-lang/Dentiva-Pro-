/**
 * Unit tests for the validation schemas (acceptance test AT-G03, and the boundary half of AT-H02).
 *
 * The same schemas validate the form and the IPC payload, so these tests are the proof that a crafted
 * message cannot smuggle in values the screens would refuse: fractional poisha, negative quantities,
 * unknown teeth, blank medicine rows, percentages above 100 %, free-text where a payment method belongs,
 * and so on.
 */

import { describe, expect, it } from 'vitest'
import {
  activationSchema,
  changePasswordSchema,
  clinicInputSchema,
  emailSchema,
  invoiceInputSchema,
  isoDateSchema,
  loginSchema,
  patientInputSchema,
  paymentInputSchema,
  permissionCodeSchema,
  phoneSchema,
  poishaSchema,
  positivePoishaSchema,
  positiveMilliSchema,
  prescriptionInputSchema,
  setupInputSchema,
  timeSchema,
  toothSchema,
  usernameSchema,
  visitInputSchema,
  voidRequestSchema
} from '@shared/validation'

function issues(
  schema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: { message: string }[] } } },
  value: unknown
): string[] {
  const result = schema.safeParse(value)
  return result.success ? [] : (result.error?.issues.map((issue) => issue.message) ?? [])
}

function passes(schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown): boolean {
  return schema.safeParse(value).success
}

describe('money and quantity schemas', () => {
  it('accepts whole poisha and refuses fractions, negatives and nonsense', () => {
    expect(passes(poishaSchema, 0)).toBe(true)
    expect(passes(poishaSchema, 350000)).toBe(true)
    expect(issues(poishaSchema, 12.5)).toContainEqual(expect.stringContaining('whole poisha'))
    expect(issues(poishaSchema, -1)).toContainEqual(expect.stringContaining('negative'))
    expect(issues(poishaSchema, '350')).not.toHaveLength(0)
    expect(passes(positivePoishaSchema, 1)).toBe(true)
    expect(issues(positivePoishaSchema, 0)).toContainEqual(expect.stringContaining('greater than zero'))
  })

  it('accepts quantities down to a thousandth and refuses negative or fractional-thousandth values', () => {
    expect(passes(positiveMilliSchema, 1)).toBe(true)
    expect(passes(positiveMilliSchema, 1500)).toBe(true)
    expect(issues(positiveMilliSchema, 0)).toContainEqual(expect.stringContaining('greater than zero'))
    expect(issues(positiveMilliSchema, 1.5)).toContainEqual(expect.stringContaining('three decimals'))
    expect(issues(positiveMilliSchema, -1000)).not.toHaveLength(0)
  })
})

describe('dates, times, phone numbers and e-mail', () => {
  it('accepts real calendar dates only', () => {
    expect(passes(isoDateSchema, '2026-09-30')).toBe(true)
    expect(passes(isoDateSchema, '2024-02-29')).toBe(true)
    expect(issues(isoDateSchema, '2026-02-30')).toContainEqual(expect.stringContaining('valid date'))
    expect(issues(isoDateSchema, '30/09/2026')).not.toHaveLength(0)
    expect(issues(isoDateSchema, '2026-9-3')).not.toHaveLength(0)
  })

  it('accepts 24-hour times only', () => {
    expect(passes(timeSchema, '00:00')).toBe(true)
    expect(passes(timeSchema, '23:59')).toBe(true)
    expect(issues(timeSchema, '24:00')).not.toHaveLength(0)
    expect(issues(timeSchema, '9:5')).not.toHaveLength(0)
  })

  it('accepts the phone formats a Bangladeshi clinic actually receives', () => {
    for (const phone of ['01712345678', '+880 1712-345678', '(02) 9556677', '+880-2-9556677']) {
      expect(passes(phoneSchema, phone)).toBe(true)
    }
    expect(issues(phoneSchema, 'call me')).toContainEqual(expect.stringContaining('digits'))
    expect(issues(phoneSchema, '12345')).not.toHaveLength(0)
  })

  it('accepts a normal e-mail address and rejects a malformed one', () => {
    expect(passes(emailSchema, 'clinic@example.com')).toBe(true)
    expect(passes(emailSchema, '  spaced@example.com  ')).toBe(true)
    expect(issues(emailSchema, 'clinic@')).not.toHaveLength(0)
  })
})

describe('credentials and permissions', () => {
  it('enforces the password policy', () => {
    const change = {
      currentPassword: 'x',
      newPassword: 'Dentiva#Chart2026',
      confirmPassword: 'Dentiva#Chart2026'
    }
    expect(passes(changePasswordSchema, change)).toBe(true)
    expect(issues(changePasswordSchema, { ...change, confirmPassword: 'Dentiva#Chart2027' })).toContainEqual(
      expect.stringContaining('do not match')
    )
    expect(
      issues(changePasswordSchema, { ...change, newPassword: 'password', confirmPassword: 'password' })
    ).not.toHaveLength(0)
    expect(
      issues(changePasswordSchema, {
        ...change,
        newPassword: 'alllowercase1',
        confirmPassword: 'alllowercase1'
      })
    ).toContainEqual(expect.stringContaining('at least 3 of'))
  })

  it('restricts usernames to the characters the sign-in screen can show', () => {
    expect(passes(usernameSchema, 'dr.farhana_1')).toBe(true)
    expect(issues(usernameSchema, 'ab')).not.toHaveLength(0)
    expect(issues(usernameSchema, 'dr farhana')).toContainEqual(expect.stringContaining('letters, numbers'))
    expect(issues(usernameSchema, 'farhana@clinic')).not.toHaveLength(0)
  })

  it('accepts only known permission codes', () => {
    expect(passes(permissionCodeSchema, 'patients.view')).toBe(true)
    expect(passes(permissionCodeSchema, 'totally.made.up')).toBe(false)
  })

  it('requires an activation code and a login name', () => {
    expect(passes(activationSchema, { code: '1516591935015165' })).toBe(true)
    expect(issues(activationSchema, { code: '' })).not.toHaveLength(0)
    expect(passes(loginSchema, { username: 'admin', password: 'secret' })).toBe(true)
    expect(issues(loginSchema, { username: '', password: 'secret' })).not.toHaveLength(0)
  })
})

describe('setup and clinic', () => {
  const clinic = {
    name: 'E2E Dental Care',
    address: '12 Mirpur Road, Dhaka 1216',
    phone1: '01712345678'
  }

  it('requires the clinic identity the print header needs', () => {
    expect(passes(clinicInputSchema, clinic)).toBe(true)
    expect(issues(clinicInputSchema, { ...clinic, name: '' })).not.toHaveLength(0)
    expect(issues(clinicInputSchema, { ...clinic, phone1: 'nope' })).not.toHaveLength(0)
  })

  it('accepts a complete setup payload and refuses one without an administrator', () => {
    const setup = {
      activationCode: '1516591935015165',
      clinic,
      dentists: [
        {
          fullName: 'Dr. Farhana Rahman',
          designations: ['Chief Consultant'],
          qualifications: ['BDS'],
          isPrimary: true
        }
      ],
      admin: {
        username: 'admin',
        displayName: 'Administrator',
        password: 'Dentiva#Chart2026',
        confirmPassword: 'Dentiva#Chart2026'
      }
    }
    expect(passes(setupInputSchema, setup)).toBe(true)
    expect(issues(setupInputSchema, { ...setup, admin: undefined })).not.toHaveLength(0)
  })
})

describe('clinical payloads', () => {
  it('requires a patient name and a usable phone number', () => {
    expect(passes(patientInputSchema, { fullName: 'Abdul Karim', phone: '01712345678' })).toBe(true)
    const blankName = issues(patientInputSchema, { fullName: ' ', phone: '01712345678' })
    expect(blankName).toContainEqual(expect.stringContaining('patient name'))
    expect(issues(patientInputSchema, { fullName: 'Abdul Karim', phone: '123' })).not.toHaveLength(0)
  })

  it('refuses fields the schema does not know, so a crafted payload cannot set hidden columns', () => {
    expect(
      passes(patientInputSchema, { fullName: 'Abdul Karim', phone: '01712345678', isArchived: true })
    ).toBe(false)
    expect(passes(patientInputSchema, { fullName: 'Abdul Karim', phone: '01712345678', notes: '' })).toBe(
      true
    )
  })

  it('validates teeth against the FDI numbering', () => {
    expect(passes(toothSchema, '11')).toBe(true)
    expect(passes(toothSchema, '85')).toBe(true)
    expect(passes(toothSchema, '99')).toBe(false)
    expect(passes(toothSchema, 'UR1')).toBe(false)
  })

  it('requires a dentist, a time and valid teeth on a visit', () => {
    const visit = {
      patientId: 1,
      visitDate: '2026-09-30',
      visitTime: '10:15',
      dentistId: 1,
      treatments: [
        { treatmentId: null, treatmentName: 'Scaling', teeth: ['11', '12'], feePoisha: 150000, note: null }
      ]
    }
    expect(passes(visitInputSchema, visit)).toBe(true)
    expect(issues(visitInputSchema, { ...visit, visitTime: '25:00' })).not.toHaveLength(0)
    expect(issues(visitInputSchema, { ...visit, dentistId: 0 })).not.toHaveLength(0)
    expect(
      issues(visitInputSchema, {
        ...visit,
        treatments: [{ treatmentId: null, treatmentName: 'Scaling', teeth: ['99'], feePoisha: 150000 }]
      })
    ).not.toHaveLength(0)
  })

  it('refuses a prescription without medicines and a row without a name', () => {
    const prescription = {
      patientId: 1,
      dentistId: 1,
      prescriptionDate: '2026-09-30',
      items: [
        {
          sortOrder: 0,
          medicineName: 'Amoxicillin 500 mg',
          morning: '1',
          noon: '0',
          night: '1',
          durationValue: 7,
          durationUnit: 'day'
        }
      ]
    }
    expect(passes(prescriptionInputSchema, prescription)).toBe(true)
    // Finalising travels through the same payload; voiding has its own action and can never be smuggled in.
    expect(passes(prescriptionInputSchema, { ...prescription, status: 'draft' })).toBe(true)
    expect(passes(prescriptionInputSchema, { ...prescription, status: 'final' })).toBe(true)
    expect(issues(prescriptionInputSchema, { ...prescription, status: 'void' })).not.toHaveLength(0)
    expect(issues(prescriptionInputSchema, { ...prescription, items: [] })).toContainEqual(
      expect.stringContaining('at least one medicine')
    )
    expect(
      issues(prescriptionInputSchema, {
        ...prescription,
        items: [{ sortOrder: 0, medicineName: '  ' }]
      })
    ).toContainEqual(expect.stringContaining('medicine name'))
  })
})

describe('billing payloads', () => {
  const item = {
    itemType: 'treatment',
    treatmentId: null,
    description: 'Composite filling (46)',
    quantityMilli: 1000,
    unitPricePoisha: 350000,
    discountPoisha: 0,
    note: null
  }

  it('requires at least one invoice line and keeps percentages inside 100 %', () => {
    const invoice = { patientId: 1, invoiceDate: '2026-09-30', items: [item] }
    expect(passes(invoiceInputSchema, invoice)).toBe(true)
    expect(issues(invoiceInputSchema, { ...invoice, items: [] })).toContainEqual(
      expect.stringContaining('at least one line item')
    )
    expect(passes(invoiceInputSchema, { ...invoice, discountPercentX100: 10_000 })).toBe(true)
    expect(issues(invoiceInputSchema, { ...invoice, discountPercentX100: 10_001 })).not.toHaveLength(0)
    expect(issues(invoiceInputSchema, { ...invoice, taxPercentX100: -1 })).not.toHaveLength(0)
    expect(passes(invoiceInputSchema, { ...invoice, items: [{ ...item, quantityMilli: 500 }] })).toBe(true)
    expect(
      issues(invoiceInputSchema, { ...invoice, items: [{ ...item, quantityMilli: 0 }] })
    ).not.toHaveLength(0)
  })

  it('defaults a payment to a normal payment and validates the receipt details', () => {
    const parsed = paymentInputSchema.safeParse({
      patientId: 1,
      amountPoisha: 200000,
      methodCode: 'bkash',
      receivedAt: '2026-09-30 10:20'
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.kind).toBe('payment')
    expect(
      passes(paymentInputSchema, {
        patientId: 1,
        kind: 'advance',
        amountPoisha: 500000,
        methodCode: 'cash',
        receivedAt: '2026-09-30 10:20:31'
      })
    ).toBe(true)
    expect(
      issues(paymentInputSchema, {
        patientId: 1,
        amountPoisha: 0,
        methodCode: 'bkash',
        receivedAt: '2026-09-30 10:20'
      })
    ).toContainEqual(expect.stringContaining('greater than zero'))
    expect(
      issues(paymentInputSchema, {
        patientId: 1,
        amountPoisha: 100,
        methodCode: 'bkash',
        receivedAt: '30/09/2026 10:20'
      })
    ).toContainEqual(expect.stringContaining('payment date and time'))
    expect(
      issues(paymentInputSchema, {
        patientId: 1,
        amountPoisha: 100,
        methodCode: 'x',
        receivedAt: '2026-09-30 10:20'
      })
    ).not.toHaveLength(0)
  })

  it('demands a reason when something is voided', () => {
    expect(passes(voidRequestSchema, { id: 3, reason: 'Billed to the wrong patient' })).toBe(true)
    expect(issues(voidRequestSchema, { id: 3, reason: '  ' })).toContainEqual(
      expect.stringContaining('at least 3 characters')
    )
    expect(issues(voidRequestSchema, { id: 0, reason: 'Wrong patient' })).not.toHaveLength(0)
  })
})
