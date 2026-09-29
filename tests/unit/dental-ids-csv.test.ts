/**
 * Unit tests for the dental chart model, the identifier/file-name helpers and the CSV exporter.
 *
 * File names matter for security (a patient attachment must never escape its folder) and CSV matters for
 * data portability, so both are covered here rather than only through the UI.
 */

import { describe, expect, it } from 'vitest'
import {
  PERMANENT_TEETH,
  PRIMARY_TEETH,
  allTeeth,
  chartRows,
  dentitionOf,
  formatToothList,
  isValidToothNumber,
  quadrantOf,
  sortTeeth,
  surfacesForTooth,
  toothLabel,
  toothShortLabel
} from '@shared/dental'
import {
  containsPattern,
  fileBaseName,
  fileExtension,
  formatSequence,
  generateReference,
  normalizeFolderPath,
  normalizeNameKey,
  normalizePhone,
  parseSequence,
  sanitizeFileName,
  startsWithPattern,
  uuid
} from '@shared/ids'
import { UTF8_BOM, escapeCsvCell, exportFileName, parseCsv, toCsv, toCsvRow } from '@shared/csv'

describe('dental chart model', () => {
  it('covers both dentitions with the FDI numbering', () => {
    expect(PERMANENT_TEETH).toHaveLength(32)
    expect(PRIMARY_TEETH).toHaveLength(20)
    expect(new Set(PERMANENT_TEETH).size).toBe(32)
    expect(new Set(PRIMARY_TEETH).size).toBe(20)
    expect(allTeeth('permanent')).toHaveLength(32)
    expect(allTeeth('primary')).toHaveLength(20)
  })

  it('classifies tooth numbers', () => {
    expect(dentitionOf('11')).toBe('permanent')
    expect(dentitionOf('48')).toBe('permanent')
    expect(dentitionOf('51')).toBe('primary')
    expect(dentitionOf('85')).toBe('primary')
    expect(dentitionOf('99')).toBeNull()
    expect(dentitionOf('1')).toBeNull()
    expect(isValidToothNumber('36')).toBe(true)
    expect(isValidToothNumber('36a')).toBe(false)
  })

  it('mirrors quadrants for primary teeth', () => {
    expect(quadrantOf('18')).toBe(1)
    expect(quadrantOf('28')).toBe(2)
    expect(quadrantOf('38')).toBe(3)
    expect(quadrantOf('48')).toBe(4)
    expect(quadrantOf('55')).toBe(1)
    expect(quadrantOf('85')).toBe(4)
    expect(quadrantOf('x')).toBeNull()
  })

  it('offers occlusal surfaces for posteriors and incisal for anteriors', () => {
    expect(surfacesForTooth('16')).toContain('O')
    expect(surfacesForTooth('16')).not.toContain('I')
    expect(surfacesForTooth('11')).toContain('I')
    expect(surfacesForTooth('11')).not.toContain('O')
  })

  it('lays out the chart rows mirroring the patient', () => {
    const permanent = chartRows('permanent')
    expect(permanent.upper[0]?.[0]).toBe('18')
    expect(permanent.upper[1]?.[7]).toBe('28')
    expect(permanent.lower[0]?.[0]).toBe('48')
    expect(permanent.lower[1]?.[0]).toBe('31')
    const primary = chartRows('primary')
    expect(primary.upper[0]?.[0]).toBe('55')
    expect(primary.lower[1]?.[4]).toBe('75')
  })

  it('labels teeth in words and short codes', () => {
    expect(toothLabel('11')).toBe('Upper right central incisor')
    expect(toothShortLabel('11')).toBe('UR1')
    expect(toothLabel('99')).toBe('Tooth 99')
  })

  it('sorts and formats tooth lists anatomically', () => {
    expect(sortTeeth(['36', '11', '48'])).toEqual(['11', '36', '48'])
    expect(formatToothList(['48', '11', '36'])).toBe('11, 36, 48')
  })
})

describe('identifiers and file names', () => {
  it('formats sequences with zero padding', () => {
    expect(formatSequence(7, { prefix: 'P-', padding: 6 })).toBe('P-000007')
    expect(formatSequence(1, { prefix: 'INV-', padding: 5 })).toBe('INV-00001')
    expect(formatSequence(12345, { prefix: 'V-', padding: 3 })).toBe('V-12345')
    expect(parseSequence('P-000007', 'P-')).toBe(7)
    expect(parseSequence('X-1', 'P-')).toBeNull()
  })

  it('strips paths and reserved device names from file names', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFileName('C:\\Windows\\System32\\evil.exe')).toBe('evil.exe')
    expect(sanitizeFileName('CON')).toBe('CON_file')
    expect(sanitizeFileName('report.')).toBe('report')
    expect(sanitizeFileName('')).toBe('file')
    expect(sanitizeFileName('..')).toBe('file')
    expect(sanitizeFileName('bad<name>?.png')).toBe('badname.png')
    expect(sanitizeFileName('x'.repeat(400)).length).toBeLessThanOrEqual(125)
  })

  it('splits extensions and normalises folder paths', () => {
    expect(fileExtension('scan.PNG')).toBe('.png')
    expect(fileExtension('noextension')).toBe('')
    expect(fileBaseName('scan.png')).toBe('scan')
    expect(normalizeFolderPath('D:\\Backups\\')).toBe('D:\\Backups')
  })

  it('generates unambiguous references and UUIDs', () => {
    const reference = generateReference()
    expect(reference).toHaveLength(6)
    expect(reference).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/)
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('normalises names, phones and search patterns', () => {
    expect(normalizeNameKey('  Rahim   Uddin ')).toBe('rahim uddin')
    expect(normalizePhone('+880 1712-345678')).toBe('+8801712345678')
    // Wildcards typed by a user must be treated literally, never as SQL wildcards.
    expect(containsPattern('100%')).toBe('%100\\%%')
    expect(startsWithPattern('a_b')).toBe('a\\_b%')
  })
})

describe('CSV export and parsing', () => {
  interface Row {
    name: string
    amount: number
  }
  const rows: Row[] = [
    { name: 'Rahim, Uddin', amount: 125000 },
    { name: 'Sayeeda "Rani"', amount: 5000 }
  ]
  const columns = [
    { key: 'name', label: 'Patient', value: (row: Row) => row.name },
    { key: 'amount', label: 'Amount (BDT)', value: (row: Row) => (row.amount / 100).toFixed(2) }
  ]

  it('escapes delimiters, quotes and newlines', () => {
    expect(escapeCsvCell('plain')).toBe('plain')
    expect(escapeCsvCell('a,b')).toBe('"a,b"')
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvCell('line\nbreak')).toBe('"line\nbreak"')
    expect(escapeCsvCell(null)).toBe('')
    expect(escapeCsvCell(undefined)).toBe('')
    expect(escapeCsvCell(42)).toBe('42')
    expect(toCsvRow(['a', 'b'])).toBe('a,b')
  })

  it('writes a BOM-prefixed document with CRLF endings for Excel', () => {
    const csv = toCsv(rows, columns)
    expect(csv.startsWith(UTF8_BOM)).toBe(true)
    expect(csv).toContain('Patient,Amount (BDT)')
    expect(csv).toContain('"Rahim, Uddin",1250.00')
    expect(csv).toContain('"Sayeeda ""Rani""",50.00')
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(toCsv(rows, columns, { bom: false }).startsWith('Patient')).toBe(true)
  })

  it('round-trips its own output', () => {
    const parsed = parseCsv(toCsv(rows, columns, { bom: false }))
    expect(parsed).toEqual([
      ['Patient', 'Amount (BDT)'],
      ['Rahim, Uddin', '1250.00'],
      ['Sayeeda "Rani"', '50.00']
    ])
  })

  it('parses quoted fields, embedded newlines and blanks', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
    expect(parseCsv('"multi\nline",x')).toEqual([['multi\nline', 'x']])
    expect(parseCsv('a,,b')).toEqual([['a', '', 'b']])
    expect(parseCsv('a;b', { delimiter: ';' })).toEqual([['a', 'b']])
    expect(parseCsv('\n\n')).toEqual([])
  })

  it('produces Excel-safe file names', () => {
    expect(exportFileName('Patient List', '2026-09-30 09:05:07', 'csv')).toBe(
      'patient-list_2026-09-30_090507.csv'
    )
    expect(exportFileName('Revenue Report', '2026-09-30 23:15:00', 'json')).toBe(
      'revenue-report_2026-09-30_231500.json'
    )
  })
})
