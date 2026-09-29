/**
 * CSV export helpers (RFC 4180 quoting, UTF-8 BOM so Bengali text opens correctly in Excel).
 * Used by every "Export to CSV" action and verified by unit tests.
 */

export interface CsvColumn<T> {
  key: string
  label: string
  /** Convert the row into the cell text; money is formatted with `formatBDT` by callers. */
  value: (row: T) => string | number | null | undefined
}

export const UTF8_BOM = '\uFEFF'

export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function toCsvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(escapeCsvCell).join(',')
}

export function toCsv<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
  options: { bom?: boolean } = {}
): string {
  const { bom = true } = options
  const header = toCsvRow(columns.map((column) => column.label))
  const body = rows.map((row) => toCsvRow(columns.map((column) => column.value(row))))
  const content = [header, ...body].join('\r\n')
  return `${bom ? UTF8_BOM : ''}${content}\r\n`
}

/** Parse a CSV document into rows of cells (used by the safe import path and tests). */
export function parseCsv(input: string, options: { delimiter?: string } = {}): string[][] {
  const delimiter = options.delimiter ?? ','
  const text = input.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\r') {
      // ignore, handled by \n
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((values) => values.some((value) => value.trim() !== ''))
}

/** Excel-safe file name for exports: "patients_2026-09-29_1842.csv". */
export function exportFileName(base: string, timestamp: string, extension: 'csv' | 'json'): string {
  const safeBase = base
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
  const safeStamp = timestamp.replace(/[: ]/g, '').replace(/-/g, '').slice(0, 15)
  const readableStamp = `${timestamp.slice(0, 10)}_${timestamp.slice(11, 13)}${timestamp.slice(14, 16)}${timestamp.slice(17, 19)}`
  return `${safeBase}_${safeStamp ? readableStamp : ''}.${extension}`.replace(/__+/g, '_')
}
