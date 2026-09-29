/**
 * Money arithmetic for Dentiva Pro (ADR-0002).
 *
 * All monetary values are integers in **poisha** (1 BDT = 100 poisha). No floating point value ever
 * represents money. Percentages are expressed in **basis points** (x100) so that 12.5% == 1250.
 */

export const POISHA_PER_TAKA = 100
export const MAX_SAFE_POISHA = Number.MAX_SAFE_INTEGER

/** Currency of the product (Bangladesh). */
export const CURRENCY_CODE = 'BDT'
export const CURRENCY_SYMBOL = '\u09F3' // ৳

export class MoneyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoneyError'
  }
}

function assertSafe(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new MoneyError(`${label} must be a finite number`)
  if (!Number.isInteger(value)) throw new MoneyError(`${label} must be an integer number of poisha`)
  if (Math.abs(value) > MAX_SAFE_POISHA) throw new MoneyError(`${label} exceeds the safe range`)
}

/** Round a number half-away-from-zero to an integer. */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) throw new MoneyError('value must be finite')
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/** Convert a decimal taka amount (e.g. user typed 1250.75) to integer poisha. */
export function fromTaka(taka: number): number {
  if (!Number.isFinite(taka)) throw new MoneyError('taka amount must be finite')
  return roundHalfUp(taka * POISHA_PER_TAKA)
}

/** Convert integer poisha to a decimal taka number (for display/CSV only, never for arithmetic). */
export function toTaka(poisha: number): number {
  assertSafe(poisha, 'poisha')
  return poisha / POISHA_PER_TAKA
}

/** Canonical string form with exactly two decimals, e.g. "1234.56". */
export function toAmountString(poisha: number): string {
  assertSafe(poisha, 'poisha')
  const negative = poisha < 0
  const abs = Math.abs(poisha)
  const whole = Math.floor(abs / POISHA_PER_TAKA)
  const fraction = abs % POISHA_PER_TAKA
  return `${negative ? '-' : ''}${whole}.${String(fraction).padStart(2, '0')}`
}

/** Group digits (western grouping by default, South-Asian grouping when `southAsian` is true). */
export function groupDigits(intPart: string, southAsian = false): string {
  if (!southAsian) return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  // 1,23,45,678 style grouping used in Bangladesh
  const digits = intPart.replace(/^0+(?=\d)/, '')
  if (digits.length <= 3) return digits
  const last3 = digits.slice(-3)
  const rest = digits.slice(0, -3)
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return `${grouped},${last3}`
}

export interface FormatOptions {
  /** Include the ৳ symbol (default true). */
  symbol?: boolean
  /** Use South-Asian digit grouping (1,23,456.78). Default false → 123,456.78 */
  southAsianGrouping?: boolean
  /** Always show two decimals (default true). */
  decimals?: boolean
  /** Show explicit +/- sign for positive values. */
  signed?: boolean
}

/** Human readable money, e.g. "৳ 1,250.00" / "৳ -120.50". */
export function formatBDT(poisha: number, options: FormatOptions = {}): string {
  const { symbol = true, southAsianGrouping = false, decimals = true, signed = false } = options
  assertSafe(poisha, 'poisha')
  const negative = poisha < 0
  const abs = Math.abs(poisha)
  const whole = Math.floor(abs / POISHA_PER_TAKA)
  const fraction = abs % POISHA_PER_TAKA
  const wholeText = groupDigits(String(whole), southAsianGrouping)
  const fractionText = decimals ? `.${String(fraction).padStart(2, '0')}` : ''
  const sign = negative ? '-' : signed ? '+' : ''
  const body = `${sign}${wholeText}${fractionText}`
  return symbol ? `${CURRENCY_SYMBOL} ${body}` : body
}

/** Alias used by print/PDF documents (identical output, explicit name). */
export const formatMoney = formatBDT

/** Compact form for dashboards: ৳ 12.5k / ৳ 1.2M (never used in documents or financial totals). */
export function formatBDTCompact(poisha: number): string {
  assertSafe(poisha, 'poisha')
  const sign = poisha < 0 ? '-' : ''
  const abs = Math.abs(poisha)
  const taka = abs / POISHA_PER_TAKA
  if (taka >= 10_000_000) return `${sign}${CURRENCY_SYMBOL} ${(taka / 1_000_000).toFixed(2)}M`
  if (taka >= 100_000) return `${sign}${CURRENCY_SYMBOL} ${(taka / 1000).toFixed(1)}k`
  return formatBDT(poisha)
}

export function add(a: number, b: number): number {
  assertSafe(a, 'a')
  assertSafe(b, 'b')
  return a + b
}

export function sub(a: number, b: number): number {
  assertSafe(a, 'a')
  assertSafe(b, 'b')
  return a - b
}

/** Sum of integer poisha values (empty → 0). */
export function sum(values: readonly number[]): number {
  let total = 0
  for (const value of values) {
    assertSafe(value, 'value')
    total += value
  }
  return total
}

export function negate(value: number): number {
  assertSafe(value, 'value')
  return -value
}

export function isZero(value: number): boolean {
  return value === 0
}

export function clampMinZero(value: number): number {
  assertSafe(value, 'value')
  return value < 0 ? 0 : value
}

/**
 * Multiply a money amount by a quantity expressed in milli-units (1.5 → 1500).
 * Result is rounded half-up exactly once, so line totals are reproducible.
 */
export function mulByQuantity(amountPoisha: number, quantityMilli: number): number {
  assertSafe(amountPoisha, 'amountPoisha')
  if (!Number.isInteger(quantityMilli)) throw new MoneyError('quantityMilli must be an integer')
  return roundHalfUp((amountPoisha * quantityMilli) / 1000)
}

/** Apply a percentage expressed in basis points (1250 → 12.5 %). Half-up, single rounding. */
export function percentOf(amountPoisha: number, percentX100: number): number {
  assertSafe(amountPoisha, 'amountPoisha')
  if (!Number.isInteger(percentX100)) throw new MoneyError('percentX100 must be an integer')
  return roundHalfUp((amountPoisha * percentX100) / 10_000)
}

/**
 * Resolve a discount expressed either as absolute poisha or as basis points into absolute poisha.
 * An absolute discount wins when both are given; the result never exceeds the amount.
 */
export function resolveDiscount(amountPoisha: number, discountPoisha = 0, discountPercentX100 = 0): number {
  assertSafe(amountPoisha, 'amountPoisha')
  const absolute = discountPoisha || 0
  const fromPercent = discountPercentX100 ? percentOf(amountPoisha, discountPercentX100) : 0
  const chosen = absolute > 0 ? absolute : fromPercent
  return Math.max(0, Math.min(chosen, amountPoisha))
}

/**
 * Split a total into parts proportional to `weights` without losing or inventing a single poisha
 * (largest-remainder method). Used for distributing invoice-level discounts across line items.
 */
export function allocate(totalPoisha: number, weights: readonly number[]): number[] {
  assertSafe(totalPoisha, 'totalPoisha')
  if (weights.length === 0) return []
  const cleanWeights = weights.map((w) => Math.max(0, w))
  const weightSum = cleanWeights.reduce((a, b) => a + b, 0)
  if (weightSum === 0) {
    const parts = new Array<number>(weights.length).fill(0)
    parts[0] = totalPoisha
    return parts
  }
  const exact = cleanWeights.map((w) => (totalPoisha * w) / weightSum)
  const floors = exact.map((v) => Math.floor(v))
  let remainder = totalPoisha - floors.reduce((a, b) => a + b, 0)
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  const result = [...floors]
  for (const { index } of order) {
    if (remainder <= 0) break
    result[index] = (result[index] ?? 0) + 1
    remainder -= 1
  }
  return result
}

const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯'

/** Translate Bengali digits in a string to ASCII digits. */
export function normalizeDigits(input: string): string {
  let out = ''
  for (const char of input) {
    const index = BENGALI_DIGITS.indexOf(char)
    out += index >= 0 ? String(index) : char
  }
  return out
}

/**
 * Decimal-exact conversion of a *string* amount ("1250.75", "-4", ".5") into integer poisha.
 *
 * This is the conversion the user interface uses: a typed amount never passes through a binary floating
 * point value, so "0.29" always becomes 29 poisha and no amount can drift by one poisha. Returns null when
 * the text is not a plain decimal with at most two fraction digits.
 */
export function fromDecimalString(value: string): number | null {
  if (typeof value !== 'string') return null
  const match = /^(-?)(\d*)(?:\.(\d{0,2}))?$/.exec(value)
  if (!match) return null
  const [, sign = '', wholeRaw = '', fractionRaw = ''] = match
  if (wholeRaw === '' && fractionRaw === '') return null
  const whole = wholeRaw === '' ? 0 : Number(wholeRaw)
  const fraction = fractionRaw === '' ? 0 : Number(fractionRaw.padEnd(2, '0'))
  if (!Number.isSafeInteger(whole)) return null
  const poisha = whole * POISHA_PER_TAKA + fraction
  if (!Number.isSafeInteger(poisha)) return null
  return sign === '-' ? -poisha : poisha
}

/**
 * Tolerant parser for user-entered amounts: accepts "1,250", "৳1250.5" (and Bengali digits), rejects
 * "12.5k" and any amount with more than two decimals. Surrounding spaces and currency symbols are ignored.
 * Returns null when the input is not a valid amount.
 */
export function parseAmount(input: string): number | null {
  if (typeof input !== 'string') return null
  const cleaned = normalizeDigits(input)
    .replace(/[\s,\u09F3৳]/g, '')
    .replace(/^\+/, '')
  if (cleaned === '') return null
  return fromDecimalString(cleaned)
}

/** Validate that a value is a usable amount (integer poisha, within range). */
export function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= MAX_SAFE_POISHA
}

/** Invoice-style rounding to the nearest whole taka, e.g. 1234.55 → 1235.00 (round-off recorded). */
export function roundToTaka(amountPoisha: number): { rounded: number; roundOff: number } {
  assertSafe(amountPoisha, 'amountPoisha')
  const rounded = Math.round(amountPoisha / POISHA_PER_TAKA) * POISHA_PER_TAKA
  return { rounded, roundOff: rounded - amountPoisha }
}
