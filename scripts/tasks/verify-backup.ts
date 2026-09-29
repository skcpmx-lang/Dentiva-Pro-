/**
 * Standalone backup verifier (`npm run verify:backup -- <folder>`).
 *
 * Support and clinic staff must be able to check a backup without opening the application: this task
 * re-uses the application's own integrity code (checksums, SQLite integrity check, audit hash chain) and
 * compares the database with the manifest the backup was created with.
 */

import { cpSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { openDatabase, closeDatabase } from '@main/db/connection'
import { verifyAuditChain } from '@main/db/integrity'
import { sha256File } from '@main/storage/hashing'

export interface VerifyBackupOptions {
  folder: string
  /** Optional folder to copy the verified database into (for inspection). */
  extractTo?: string
  log?: (message: string) => void
}

export interface VerifyBackupResult {
  ok: boolean
  folder: string
  problems: string[]
  checks: { name: string; ok: boolean; detail: string }[]
  counts: Record<string, number>
}

export function verifyBackupFolder(options: VerifyBackupOptions): VerifyBackupResult {
  const log = options.log ?? (() => undefined)
  const folder = resolve(options.folder)
  const problems: string[] = []
  const checks: VerifyBackupResult['checks'] = []
  const counts: Record<string, number> = {}

  const record = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail })
    if (!ok) problems.push(`${name}: ${detail}`)
  }

  record('Backup folder', existsSync(folder), existsSync(folder) ? folder : `${folder} does not exist`)
  if (!existsSync(folder)) return { ok: false, folder, problems, checks, counts }

  const manifestPath = join(folder, 'manifest.json')
  let manifest: {
    format?: string
    formatVersion?: number
    appVersion?: string
    backupDate?: string
    clinic?: string | null
    counts?: Record<string, number>
    database?: { file?: string; sha256?: string; sizeBytes?: number; integrityCheck?: string }
  } | null = null
  if (!existsSync(manifestPath)) {
    record('manifest.json', false, 'missing — this is not a Dentiva Pro backup folder')
  } else {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const formatOk = manifest?.format === 'dentiva-backup' && (manifest?.formatVersion ?? 0) <= 1
      record(
        'manifest.json',
        formatOk,
        formatOk ? `format ${manifest?.formatVersion} from ${manifest?.backupDate}` : 'unexpected format'
      )
    } catch (error) {
      record('manifest.json', false, `not valid JSON: ${String(error)}`)
    }
  }

  const databaseFile = join(folder, 'Database', 'dentiva.db')
  record(
    'Database file',
    existsSync(databaseFile),
    existsSync(databaseFile) ? databaseFile : 'Database/dentiva.db is missing'
  )

  if (existsSync(databaseFile) && manifest?.database?.sha256) {
    const hash = sha256File(databaseFile)
    record(
      'Database checksum',
      hash === manifest.database.sha256,
      hash === manifest.database.sha256
        ? 'matches the manifest'
        : `expected ${manifest.database.sha256.slice(0, 16)}… but found ${hash.slice(0, 16)}… (the file changed after the backup)`
    )
  }

  const sumsPath = join(folder, 'SHA256SUMS.txt')
  if (existsSync(sumsPath)) {
    const lines = readFileSync(sumsPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    let mismatches = 0
    for (const line of lines) {
      const match = /^([0-9a-f]{64})\s+(.+)$/.exec(line)
      if (!match) {
        mismatches += 1
        continue
      }
      const absolute = join(folder, match[2] as string)
      if (!existsSync(absolute) || sha256File(absolute) !== match[1]) mismatches += 1
    }
    record('Checksum file', mismatches === 0, `${lines.length} file(s) listed, ${mismatches} mismatch(es)`)
  } else {
    record('Checksum file', false, 'SHA256SUMS.txt is missing')
  }

  if (existsSync(databaseFile)) {
    try {
      const db = openDatabase(databaseFile, { skipMigrations: true, readOnly: true })
      try {
        const integrity = db.pragma('integrity_check') as { integrity_check: string }[]
        const integrityOk = (integrity[0]?.integrity_check ?? '') === 'ok'
        record('SQLite integrity', integrityOk, integrity[0]?.integrity_check ?? 'unknown')

        const foreignKeys = db.pragma('foreign_key_check') as unknown[]
        record('Foreign keys', foreignKeys.length === 0, `${foreignKeys.length} violation(s)`)

        const chain = verifyAuditChain(db)
        record('Audit hash chain', chain.valid, chain.message)

        for (const table of [
          'patients',
          'visits',
          'appointments',
          'prescriptions',
          'invoices',
          'payments',
          'audit_log'
        ]) {
          const row = db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as { value: number }
          counts[table] = Number(row.value)
        }
        if (manifest?.counts) {
          const mismatched = Object.entries(manifest.counts).filter(
            ([table, value]) => counts[table] !== undefined && counts[table] !== value
          )
          record(
            'Row counts',
            mismatched.length === 0,
            mismatched.length === 0
              ? 'match the manifest'
              : `differs for ${mismatched.map(([table]) => table).join(', ')}`
          )
        }
      } finally {
        closeDatabase(db)
      }
    } catch (error) {
      record('Database readable', false, String(error))
    }
  }

  if (options.extractTo && existsSync(databaseFile)) {
    cpSync(databaseFile, join(options.extractTo, 'dentiva.db'), { recursive: false })
    log(`Extracted a copy of the database to ${join(options.extractTo, 'dentiva.db')}`)
  }

  const attachments = join(folder, 'Attachments')
  const attachmentCount = existsSync(attachments) ? readdirSync(attachments).length : 0
  log(`Attachments in the backup: ${attachmentCount}`)
  log(`Backup size: ${(statSync(folder).size / 1024 / 1024).toFixed(2)} MB (top-level)`)

  return { ok: problems.length === 0, folder, problems, checks, counts }
}

export function formatVerifyReport(result: VerifyBackupResult): string {
  const lines = [`Backup: ${basename(result.folder)}`, '']
  for (const check of result.checks) {
    lines.push(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name.padEnd(22)} ${check.detail}`)
  }
  lines.push('')
  if (Object.keys(result.counts).length > 0) {
    lines.push('  Rows:')
    for (const [table, value] of Object.entries(result.counts)) {
      lines.push(`    ${table.padEnd(16)} ${value.toLocaleString()}`)
    }
    lines.push('')
  }
  lines.push(
    result.ok
      ? '  This backup verifies and can be restored.'
      : `  ${result.problems.length} problem(s) found.`
  )
  return lines.join('\n')
}
