/**
 * Date and time helpers. Civil dates are stored as `YYYY-MM-DD`, timestamps as `YYYY-MM-DD HH:MM:SS`
 * (both in the clinic's local time), with epoch milliseconds stored alongside the timestamps that need
 * ordering guarantees (audit trail, payments, inventory ledger).
 */

export type IsoDate = string // YYYY-MM-DD
export type SqlTimestamp = string // YYYY-MM-DD HH:MM:SS
export type IsoTimestamp = string // YYYY-MM-DDTHH:MM:SS

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SQL_TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯'

export function toBengaliDigits(input: string): string {
  return input.replace(/\d/g, (d) => BENGALI_DIGITS[Number(d)] ?? d)
}

function pad(value: number, length = 2): string {
  return String(Math.abs(value)).padStart(length, '0')
}

/** Today's civil date in the machine's local timezone. */
export function todayIso(now: Date = new Date()): IsoDate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Current local timestamp in SQL form. */
export function nowSql(now: Date = new Date()): SqlTimestamp {
  return `${todayIso(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

export function nowEpochMs(now: Date = new Date()): number {
  return now.getTime()
}

export function currentTimeSql(now: Date = new Date()): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function isValidIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  if (m < 1 || m > 12 || d < 1) return false
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

export function isValidSqlTimestamp(value: unknown): value is SqlTimestamp {
  if (typeof value !== 'string' || !SQL_TS_RE.test(value)) return false
  const [datePart, timePart] = value.split(' ')
  if (!isValidIsoDate(datePart)) return false
  const [h, mi, s] = (timePart as string).split(':').map(Number) as [number, number, number]
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 59
}

/** Parse a civil date into a local Date at midnight. Throws on malformed input. */
export function parseIsoDate(value: IsoDate): Date {
  if (!isValidIsoDate(value)) throw new Error(`Invalid date: ${value}`)
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

/** Parse a SQL timestamp into a local Date. Throws on malformed input. */
export function parseSqlTimestamp(value: SqlTimestamp): Date {
  if (!isValidSqlTimestamp(value)) throw new Error(`Invalid timestamp: ${value}`)
  const [datePart, timePart] = value.split(' ') as [string, string]
  const [y, m, d] = datePart.split('-').map(Number) as [number, number, number]
  const [h, mi, s] = timePart.split(':').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, h, mi, s)
}

/** Epoch ms for a SQL timestamp interpreted in local time (used for ordering columns). */
export function sqlToEpochMs(value: SqlTimestamp): number {
  return parseSqlTimestamp(value).getTime()
}

export function epochMsToSql(epochMs: number): SqlTimestamp {
  return nowSql(new Date(epochMs))
}

export function dateToIso(date: Date): IsoDate {
  return todayIso(date)
}

export function addDaysIso(date: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(date)
  d.setDate(d.getDate() + days)
  return todayIso(d)
}

export function addMonthsIso(date: IsoDate, months: number): IsoDate {
  const d = parseIsoDate(date)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return todayIso(d)
}

export function diffDays(from: IsoDate, to: IsoDate): number {
  const a = parseIsoDate(from).getTime()
  const b = parseIsoDate(to).getTime()
  return Math.round((b - a) / 86_400_000)
}

export function compareIsoDates(a: IsoDate, b: IsoDate): number {
  return a === b ? 0 : a < b ? -1 : 1
}

export function minIsoDate(values: readonly IsoDate[]): IsoDate | null {
  return values.length ? values.reduce((min, v) => (v < min ? v : min)) : null
}

export function maxIsoDate(values: readonly IsoDate[]): IsoDate | null {
  return values.length ? values.reduce((max, v) => (v > max ? v : max)) : null
}

export interface DateRange {
  from: IsoDate
  to: IsoDate
}

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'last90'
  | 'lastYear'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'custom'
  | 'all'

/** Resolve a named date filter into a concrete range (inclusive). `all` returns null. */
export function resolveDateRange(preset: DateRangePreset, now: Date = new Date()): DateRange | null {
  const today = todayIso(now)
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday':
      return { from: addDaysIso(today, -1), to: addDaysIso(today, -1) }
    case 'last7':
      return { from: addDaysIso(today, -6), to: today }
    case 'last30':
      return { from: addDaysIso(today, -29), to: today }
    case 'last90':
      return { from: addDaysIso(today, -89), to: today }
    case 'lastYear':
      return { from: addDaysIso(today, -364), to: today }
    case 'thisMonth': {
      const first = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
      return { from: first, to: addDaysIso(addMonthsIso(first, 1), -1) }
    }
    case 'lastMonth': {
      const firstThisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
      const firstLastMonth = addMonthsIso(firstThisMonth, -1)
      return { from: firstLastMonth, to: addDaysIso(firstThisMonth, -1) }
    }
    case 'thisYear':
      return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` }
    case 'custom':
    case 'all':
      return null
  }
}

/** Age from a date of birth, as whole years and remaining months, evaluated on `onDate`. */
export function ageFromDob(dob: IsoDate, onDate: IsoDate = todayIso()): { years: number; months: number } {
  const birth = parseIsoDate(dob)
  const target = parseIsoDate(onDate)
  let years = target.getFullYear() - birth.getFullYear()
  let months = target.getMonth() - birth.getMonth()
  if (target.getDate() < birth.getDate()) months -= 1
  if (months < 0) {
    years -= 1
    months += 12
  }
  if (years < 0) return { years: 0, months: 0 }
  return { years, months }
}

/** Human age label used across the UI and print documents. */
export function formatAge(dob: IsoDate, onDate: IsoDate = todayIso()): string {
  const { years, months } = ageFromDob(dob, onDate)
  if (years === 0 && months === 0) return 'Newborn'
  if (years === 0) return `${months} month${months === 1 ? '' : 's'}`
  if (months === 0) return `${years} year${years === 1 ? '' : 's'}`
  return `${years} year${years === 1 ? '' : 's'} ${months} month${months === 1 ? '' : 's'}`
}

export type DateFormatName = 'dd MMM yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd' | 'dd MMMM yyyy' | 'MMM dd, yyyy'

/** Format a civil date for display (never ambiguous: DD before MM in the default format). */
export function formatDate(value: IsoDate, format: DateFormatName = 'dd MMM yyyy'): string {
  const date = parseIsoDate(value)
  const dd = pad(date.getDate())
  const mm = pad(date.getMonth() + 1)
  const yyyy = String(date.getFullYear())
  switch (format) {
    case 'dd MMM yyyy':
      return `${dd} ${MONTHS_SHORT[date.getMonth()]} ${yyyy}`
    case 'dd MMMM yyyy':
      return `${dd} ${MONTHS_LONG[date.getMonth()]} ${yyyy}`
    case 'dd/MM/yyyy':
      return `${dd}/${mm}/${yyyy}`
    case 'yyyy-MM-dd':
      return value
    case 'MMM dd, yyyy':
      return `${MONTHS_SHORT[date.getMonth()]} ${dd}, ${yyyy}`
  }
}

export function formatTimestamp(value: SqlTimestamp, format: DateFormatName = 'dd MMM yyyy'): string {
  const [datePart, timePart] = value.split(' ') as [string, string]
  return `${formatDate(datePart, format)} ${timePart.slice(0, 5)}`
}

/** Relative label for lists: Today, Yesterday, 3 days ago, 12 Sep 2026. */
export function formatRelativeDate(value: IsoDate, now: Date = new Date()): string {
  const today = todayIso(now)
  const days = diffDays(value, today)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days === -1) return 'Tomorrow'
  if (days > 1 && days < 7) return `${days} days ago`
  if (days < -1 && days > -7) return `in ${Math.abs(days)} days`
  return formatDate(value)
}

export function weekdayName(value: IsoDate, short = true): string {
  const index = parseIsoDate(value).getDay()
  return (short ? WEEKDAYS_SHORT : WEEKDAYS_LONG)[index] as string
}

/** Minutes between two HH:MM times (same day). */
export function minutesBetweenTimes(from: string, to: string): number {
  const [fh, fm] = from.split(':').map(Number) as [number, number]
  const [th, tm] = to.split(':').map(Number) as [number, number]
  return th * 60 + tm - (fh * 60 + fm)
}

export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number) as [number, number]
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

/** 24h time → friendly label (09:30 → 09:30 AM). */
export function formatTime12h(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number]
  const suffix = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${pad(hour)}:${pad(m)} ${suffix}`
}

export function isValidTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false
  const [h, m] = value.split(':').map(Number) as [number, number]
  return h >= 0 && h <= 23 && m >= 0 && m <= 59
}

/** Duration label used by queue estimates: 75 → "1h 15m". */
export function formatDurationMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  if (safe < 60) return `${safe} min`
  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}
