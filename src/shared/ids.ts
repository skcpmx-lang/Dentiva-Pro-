/**
 * Business identifier formatting and user input sanitisation.
 *
 * Patient codes, invoice numbers, receipt numbers and expense numbers are generated from database
 * counters inside the owning transaction (never from timestamps or randomness), so they are unique,
 * sequential and human friendly:
 *   patient   P-000123      invoice   INV-000045      receipt   RCP-000180      expense   EXP-000012
 */

export interface SequenceFormat {
  prefix: string
  padding: number
}

export function formatSequence(value: number, format: SequenceFormat): string {
  if (!Number.isInteger(value) || value < 1) throw new Error('sequence value must be a positive integer')
  const padding = Math.max(1, Math.min(12, Math.trunc(format.padding)))
  return `${format.prefix}${String(value).padStart(padding, '0')}`
}

export function parseSequence(value: string, prefix: string): number | null {
  if (!value.startsWith(prefix)) return null
  const rest = value.slice(prefix.length)
  if (!/^\d+$/.test(rest)) return null
  const parsed = Number(rest)
  return Number.isSafeInteger(parsed) ? parsed : null
}

const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
])

/**
 * Sanitise a user-provided file name so it is safe on every supported file system:
 * strips directory separators, control characters, reserved device names, trailing dots/spaces and
 * caps the length. Returns a fallback when nothing usable remains.
 */
export function sanitizeFileName(input: string, fallback = 'file'): string {
  const withoutPaths = input.replace(/\\/g, '/').split('/').pop() ?? ''
  const name = withoutPaths
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (name === '' || name === '.' || name === '..') return fallback
  const dotIndex = name.lastIndexOf('.')
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name
  const extension = dotIndex > 0 ? name.slice(dotIndex).toLowerCase().slice(0, 12) : ''
  const safeBase = WINDOWS_RESERVED_NAMES.has(base.toUpperCase())
    ? `${base}_file`
    : base.replace(/[. ]+$/g, '')
  const trimmedBase = safeBase.slice(0, 120) || fallback
  return `${trimmedBase}${extension}`
}

export function fileExtension(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index).toLowerCase() : ''
}

export function fileBaseName(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(0, index) : name
}

/** Trailing-slash normalisation for folder paths used in backup destinations, etc. */
export function normalizeFolderPath(path: string): string {
  return path.replace(/[\\/]+$/, '')
}

const GENERATED_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous characters

/** Short, unambiguous reference used for error reports and support requests. */
export function generateReference(length = 6): string {
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += GENERATED_CODE_ALPHABET[Math.floor(Math.random() * GENERATED_CODE_ALPHABET.length)]
  }
  return out
}

/** UUID v4 (used for stored attachment names and installation ids). */
export function uuid(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID()
  // Fallback for environments without WebCrypto (deterministic quality is not required here)
  const hex = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-'
    else if (i === 14) out += '4'
    else if (i === 19) out += hex[(Math.floor(Math.random() * 4) + 8) & 0xf]
    else out += hex[Math.floor(Math.random() * 16)]
  }
  return out
}

/** Normalised comparison key for names (used by duplicate detection and search). */
export function normalizeNameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Digits-only phone normalisation for search and duplicate detection. */
export function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, '')
}

/** SQL LIKE pattern for a user search term (escapes wildcards so they are treated literally). */
export function containsPattern(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (match) => `\\${match}`)
  return `%${escaped}%`
}

export function startsWithPattern(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (match) => `\\${match}`)
  return `${escaped}%`
}
