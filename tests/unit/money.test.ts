/**
 * Unit tests for the money module (ADR-0002).
 *
 * Money is the one area where a rounding mistake silently corrupts a clinic's books, so the tests cover
 * the arithmetic that invoices and reports depend on: exact conversion, single-rounding multiplication,
 * percentage/discount resolution and the largest-remainder allocator that must never lose a poisha.
 */

import { describe, expect, it } from 'vitest'
import {
  MoneyError,
  fromDecimalString,
  allocate,
  formatBDT,
  formatBDTCompact,
  fromTaka,
  normalizeDigits,
  parseAmount,
  percentOf,
  resolveDiscount,
  roundHalfUp,
  roundToTaka,
  toAmountString,
  toTaka,
  mulByQuantity,
  sum
} from '@shared/money'

describe('money conversion', () => {
  it('converts taka to poisha without floating point drift', () => {
    expect(fromTaka(1250.75)).toBe(125075)
    expect(fromTaka(0)).toBe(0)
    expect(fromTaka(0.1)).toBe(10)
    expect(fromTaka(19.99)).toBe(1999)
    // 0.29 * 100 is 28.999999999999996 in IEEE-754; rounding must fix it.
    expect(fromTaka(0.29)).toBe(29)
    // 1.005 is not representable in binary floating point (it stores as 1.00499999…), so rounding the value
    // that actually exists gives 100. User input never takes this path — it is parsed as text below.
    expect(fromTaka(1.005)).toBe(100)
  })

  it('rounds half away from zero', () => {
    expect(roundHalfUp(2.5)).toBe(3)
    expect(roundHalfUp(-2.5)).toBe(-3)
    expect(roundHalfUp(2.4)).toBe(2)
  })

  it('rejects non-integer and non-finite poisha', () => {
    expect(() => toTaka(10.5)).toThrow(MoneyError)
    expect(() => toTaka(Number.NaN)).toThrow(MoneyError)
    expect(() => fromTaka(Number.POSITIVE_INFINITY)).toThrow(MoneyError)
  })

  it('renders canonical amount strings', () => {
    expect(toAmountString(125075)).toBe('1250.75')
    expect(toAmountString(-5)).toBe('-0.05')
    expect(toAmountString(100)).toBe('1.00')
  })

  it('multiplies by milli-quantities with exactly one rounding', () => {
    expect(mulByQuantity(10000, 1500)).toBe(15000)
    expect(mulByQuantity(33333, 1500)).toBe(50000)
    expect(mulByQuantity(999, 333)).toBe(333)
  })

  it('applies basis-point percentages', () => {
    expect(percentOf(100000, 1250)).toBe(12500) // 12.5 %
    expect(percentOf(999, 500)).toBe(50) // 5 % of 9.99 → 0.50
    expect(percentOf(100000, 10000)).toBe(100000)
  })

  it('resolves discounts and never exceeds the amount', () => {
    expect(resolveDiscount(100000, 0, 1000)).toBe(10000)
    expect(resolveDiscount(100000, 2500, 1000)).toBe(2500)
    expect(resolveDiscount(100000, 999999, 0)).toBe(100000)
    expect(resolveDiscount(100000, 0, 0)).toBe(0)
  })

  it('allocates a total without losing or inventing a poisha', () => {
    const parts = allocate(10000, [1, 1, 1])
    expect(sum(parts)).toBe(10000)
    expect(parts).toEqual([3334, 3333, 3333])

    const weighted = allocate(12345, [5000, 3000, 2000])
    expect(sum(weighted)).toBe(12345)

    // Degenerate input: no weights at all must not silently drop the total.
    expect(allocate(500, [0, 0])).toEqual([500, 0])
    expect(allocate(500, [])).toEqual([])
  })

  it('rounds invoices to whole taka and records the round-off', () => {
    const { rounded, roundOff } = roundToTaka(123455)
    expect(rounded).toBe(123500)
    expect(roundOff).toBe(45)
    expect(roundToTaka(123400)).toEqual({ rounded: 123400, roundOff: 0 })
  })
})

describe('money formatting', () => {
  it('formats taka with the Bangladeshi symbol', () => {
    expect(formatBDT(125075)).toBe('৳ 1,250.75')
    expect(formatBDT(-125075)).toBe('৳ -1,250.75')
    expect(formatBDT(125075, { symbol: false })).toBe('1,250.75')
    expect(formatBDT(125075, { decimals: false })).toBe('৳ 1,250')
    expect(formatBDT(125075, { signed: true })).toBe('৳ +1,250.75')
  })

  it('supports South-Asian digit grouping for print and reports', () => {
    expect(formatBDT(1234567890, { southAsianGrouping: true, decimals: false })).toBe('৳ 1,23,45,678')
    expect(formatBDT(1234567890, { decimals: false })).toBe('৳ 12,345,678')
  })

  it('formats compact values for dashboards only', () => {
    expect(formatBDTCompact(125000)).toBe('৳ 1,250.00')
    expect(formatBDTCompact(25000000)).toBe('৳ 250.0k')
    expect(formatBDTCompact(2500000000)).toBe('৳ 25.00M')
  })
})

describe('amount parsing', () => {
  it('accepts the forms a receptionist actually types', () => {
    expect(parseAmount('1250')).toBe(125000)
    expect(parseAmount('1,250.50')).toBe(125050)
    expect(parseAmount(' ৳ 12,50,000 ')).toBe(125000000)
    expect(parseAmount('০.৫০')).toBe(50) // Bengali digits
    expect(parseAmount('+75')).toBe(7500)
  })

  it('rejects anything ambiguous', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('12.345')).toBeNull()
    expect(parseAmount('.')).toBeNull()
    expect(parseAmount('-')).toBeNull()
    expect(parseAmount('12k')).toBeNull()
  })

  it('converts typed decimal text exactly, without a floating point step', () => {
    expect(fromDecimalString('1.005')).toBeNull() // more than two decimals is not an amount
    expect(fromDecimalString('1.00')).toBe(100)
    expect(fromDecimalString('100')).toBe(10000)
    expect(fromDecimalString('0.05')).toBe(5)
    expect(fromDecimalString('.5')).toBe(50)
    expect(fromDecimalString('-2.75')).toBe(-275)
    expect(fromDecimalString('')).toBeNull()
    expect(fromDecimalString('1.2.3')).toBeNull()
    expect(fromDecimalString('1e3')).toBeNull()
    // 0.29 and 8.11 are the classic cases where Number(x) * 100 drifts; the text path cannot drift.
    expect(fromDecimalString('0.29')).toBe(29)
    expect(fromDecimalString('8.11')).toBe(811)
    expect(fromDecimalString('99999999999999999.99')).toBeNull()
  })

  it('transliterates Bengali digits', () => {
    expect(normalizeDigits('০১২৩৪৫৬৭৮৯')).toBe('0123456789')
    expect(normalizeDigits('৳৪৫০')).toBe('৳450')
  })
})
