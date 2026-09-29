/**
 * Database integrity verification (REQ §59, §66).
 *
 * Runs structural checks (SQLite integrity, foreign keys, orphans) and business reconciliation
 * (invoice balances versus line items and payments, stock cache versus the immutable ledger, audit hash
 * chain). Used by Settings → Data Management, by the backup engine before/after a backup and by the
 * restore engine after a swap.
 */

import type { IntegrityReport, AuditChainStatus } from '@shared/types'
import { nowSql } from '@shared/date'
import { computeAuditHash, type AuditHashRow } from '../security/audit-hash'
import type { SqliteDatabase } from './connection'

interface CheckResult {
  name: string
  ok: boolean
  detail: string
  count?: number
}

function scalar(db: SqliteDatabase, sql: string, params: unknown[] = []): number {
  const row = db.prepare(sql).get(...(params as never[])) as { value: number | null } | undefined
  return Number(row?.value ?? 0)
}

export function checkSqliteIntegrity(db: SqliteDatabase): CheckResult {
  const rows = db.pragma('integrity_check') as { integrity_check: string }[]
  const messages = rows.map((row) => row.integrity_check).filter((message) => message !== 'ok')
  return {
    name: 'SQLite structural integrity',
    ok: messages.length === 0,
    detail: messages.length === 0 ? 'ok' : messages.join('; '),
    count: messages.length
  }
}

export function checkForeignKeys(db: SqliteDatabase): CheckResult {
  const rows = db.pragma('foreign_key_check') as Record<string, unknown>[]
  return {
    name: 'Foreign key constraints',
    ok: rows.length === 0,
    detail: rows.length === 0 ? 'ok' : `${rows.length} orphaned reference(s) found`,
    count: rows.length
  }
}

export function checkInvoiceReconciliation(db: SqliteDatabase): CheckResult {
  // Invoice total must equal the sum of its (rounded) line totals minus invoice-level discount plus tax
  // plus round-off; paid must equal the sum of non-voided payments; status must match the numbers.
  const mismatchedTotals = scalar(
    db,
    `SELECT COUNT(*) AS value FROM (
       SELECT i.id
         FROM invoices i
         LEFT JOIN (
           SELECT invoice_id, COALESCE(SUM(line_total_poisha), 0) AS items_total
             FROM invoice_items GROUP BY invoice_id
         ) items ON items.invoice_id = i.id
        WHERE i.status <> 'void'
          AND i.total_poisha <> MAX(0, COALESCE(items.items_total, 0) - i.discount_poisha + i.tax_poisha + i.round_off_poisha)
     )`
  )
  const mismatchedPaid = scalar(
    db,
    `SELECT COUNT(*) AS value FROM (
       SELECT i.id
         FROM invoices i
         LEFT JOIN (
           SELECT invoice_id, COALESCE(SUM(amount_poisha), 0) AS paid
             FROM payments WHERE invoice_id IS NOT NULL AND voided_at IS NULL AND kind <> 'refund'
            GROUP BY invoice_id
         ) p ON p.invoice_id = i.id
        WHERE i.status <> 'void' AND i.paid_poisha <> COALESCE(p.paid, 0)
     )`
  )
  const mismatchedStatus = scalar(
    db,
    `SELECT COUNT(*) AS value FROM invoices
      WHERE status <> 'void' AND (
        (paid_poisha = 0 AND status <> 'unpaid') OR
        (paid_poisha > 0 AND paid_poisha < total_poisha AND status <> 'partial') OR
        (paid_poisha = total_poisha AND total_poisha > 0 AND status <> 'paid') OR
        (paid_poisha > total_poisha AND status <> 'overpaid')
      )`
  )
  const total = mismatchedTotals + mismatchedPaid + mismatchedStatus
  return {
    name: 'Invoice totals and payment reconciliation',
    ok: total === 0,
    detail:
      total === 0
        ? 'ok'
        : `${mismatchedTotals} total mismatch(es), ${mismatchedPaid} paid mismatch(es), ${mismatchedStatus} status mismatch(es)`,
    count: total
  }
}

export function checkStockReconciliation(db: SqliteDatabase): CheckResult {
  const mismatched = scalar(
    db,
    `SELECT COUNT(*) AS value FROM (
       SELECT i.id
         FROM inventory_items i
         LEFT JOIN (
           SELECT item_id, COALESCE(SUM(quantity_milli), 0) AS ledger
             FROM inventory_transactions GROUP BY item_id
         ) t ON t.item_id = i.id
        WHERE i.quantity_milli <> COALESCE(t.ledger, 0)
     )`
  )
  const negative = scalar(db, `SELECT COUNT(*) AS value FROM inventory_items WHERE quantity_milli < 0`)
  const total = mismatched + negative
  return {
    name: 'Inventory stock versus ledger',
    ok: total === 0,
    detail: total === 0 ? 'ok' : `${mismatched} item(s) diverge from the ledger, ${negative} negative`,
    count: total
  }
}

export function checkDuplicateBusinessKeys(db: SqliteDatabase): CheckResult {
  const checks: [string, string][] = [
    ['patients', 'code'],
    ['invoices', 'invoice_no'],
    ['payments', 'receipt_no'],
    ['expenses', 'expense_no'],
    ['users', 'username']
  ]
  const problems: string[] = []
  for (const [table, column] of checks) {
    const count = scalar(
      db,
      `SELECT COUNT(*) AS value FROM (SELECT ${column} FROM ${table} GROUP BY ${column} HAVING COUNT(*) > 1)`
    )
    if (count > 0) problems.push(`${table}.${column}: ${count}`)
  }
  return {
    name: 'Unique business keys',
    ok: problems.length === 0,
    detail: problems.length === 0 ? 'ok' : problems.join(', '),
    count: problems.length
  }
}

export function checkAttachmentReferences(db: SqliteDatabase): CheckResult {
  const missingPatient = scalar(
    db,
    `SELECT COUNT(*) AS value FROM attachments a
      LEFT JOIN patients p ON p.id = a.patient_id
      WHERE a.patient_id IS NOT NULL AND p.id IS NULL`
  )
  const missingVisit = scalar(
    db,
    `SELECT COUNT(*) AS value FROM attachments a
      LEFT JOIN visits v ON v.id = a.visit_id
      WHERE a.visit_id IS NOT NULL AND v.id IS NULL`
  )
  const total = missingPatient + missingVisit
  return {
    name: 'Attachment references',
    ok: total === 0,
    detail:
      total === 0
        ? 'ok'
        : `${missingPatient} patient reference(s), ${missingVisit} visit reference(s) missing`,
    count: total
  }
}

export function checkClinicalOrphans(db: SqliteDatabase): CheckResult {
  const orphanVisits = scalar(
    db,
    `SELECT COUNT(*) AS value FROM visits v LEFT JOIN patients p ON p.id = v.patient_id WHERE p.id IS NULL`
  )
  const orphanTreatments = scalar(
    db,
    `SELECT COUNT(*) AS value FROM visit_treatments t LEFT JOIN visits v ON v.id = t.visit_id WHERE v.id IS NULL`
  )
  const orphanItems = scalar(
    db,
    `SELECT COUNT(*) AS value FROM prescription_items i LEFT JOIN prescriptions p ON p.id = i.prescription_id WHERE p.id IS NULL`
  )
  const total = orphanVisits + orphanTreatments + orphanItems
  return {
    name: 'Clinical record orphans',
    ok: total === 0,
    detail:
      total === 0
        ? 'ok'
        : `${orphanVisits} visit(s), ${orphanTreatments} treatment(s), ${orphanItems} item(s)`,
    count: total
  }
}

/** Verify the audit hash chain end-to-end. */
export function verifyAuditChain(db: SqliteDatabase, limit?: number): AuditChainStatus {
  const rows = db
    .prepare(
      `SELECT id, at, at_epoch_ms, actor_user_id, actor_username, action, entity_type, entity_id,
              summary, before_json, after_json, severity, app_version, hash, prev_hash
         FROM audit_log
        ORDER BY id ASC
        ${limit ? 'LIMIT ?' : ''}`
    )
    .all(...(limit ? [limit] : [])) as (AuditHashRow & {
    id: number
    hash: string
    prev_hash: string | null
  })[]

  let previousHash: string | null = null
  for (const row of rows) {
    const expected = computeAuditHash(row, previousHash)
    if (expected !== row.hash) {
      return {
        valid: false,
        checkedEntries: rows.length,
        firstBrokenId: row.id,
        message: `Audit entry ${row.id} does not match its hash. The audit log was modified outside the application.`
      }
    }
    previousHash = row.hash
  }

  return {
    valid: true,
    checkedEntries: rows.length,
    firstBrokenId: null,
    message: `Audit chain verified for ${rows.length} entries.`
  }
}

export function checkAuditChain(db: SqliteDatabase): CheckResult {
  const status = verifyAuditChain(db)
  return {
    name: 'Audit log hash chain',
    ok: status.valid,
    detail: status.message,
    count: status.checkedEntries
  }
}

/** Full integrity report used by Settings, backup and restore. */
export function runIntegrityCheck(db: SqliteDatabase, options: { deep?: boolean } = {}): IntegrityReport {
  const checks: CheckResult[] = [
    checkSqliteIntegrity(db),
    checkForeignKeys(db),
    checkDuplicateBusinessKeys(db),
    checkInvoiceReconciliation(db),
    checkStockReconciliation(db),
    checkAttachmentReferences(db),
    checkClinicalOrphans(db),
    checkAuditChain(db)
  ]

  if (options.deep) {
    // Slow, thorough cross-checks are executed on demand and before/after backups.
    checks.push(
      {
        name: 'Invoice item integrity',
        ok:
          scalar(
            db,
            `SELECT COUNT(*) AS value FROM (SELECT invoice_id FROM invoice_items GROUP BY invoice_id HAVING COUNT(*) = 0)`
          ) === 0,
        detail: 'ok'
      },
      {
        name: 'Prescription item integrity',
        ok:
          scalar(
            db,
            `SELECT COUNT(*) AS value FROM (SELECT prescription_id FROM prescription_items GROUP BY prescription_id HAVING COUNT(*) = 0)`
          ) === 0,
        detail: 'ok'
      }
    )
  }

  return {
    ranAt: nowSql(),
    ok: checks.every((check) => check.ok),
    checks
  }
}
