/**
 * Audit hash chain (ADR-0006).
 *
 * Every audit row stores `hash = SHA-256(prev_hash || canonical_json(row))`. The hash is computed in the
 * same transaction as the mutation it describes, so an action can never be recorded without its effect and
 * the database triggers additionally forbid UPDATE/DELETE on `audit_log`. Any modification of history is
 * therefore detectable by `verifyAuditChain`.
 */

import { createHash } from 'node:crypto'

export interface AuditHashRow {
  at: string
  at_epoch_ms: number
  actor_user_id: number | null
  actor_username: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  summary: string
  before_json: string | null
  after_json: string | null
  severity: string
  app_version: string
}

const FIELD_ORDER: (keyof AuditHashRow)[] = [
  'at',
  'at_epoch_ms',
  'actor_user_id',
  'actor_username',
  'action',
  'entity_type',
  'entity_id',
  'summary',
  'before_json',
  'after_json',
  'severity',
  'app_version'
]

/** Deterministic serialisation: fixed field order, explicit nulls, no dependency on key insertion order. */
export function canonicalAuditJson(row: AuditHashRow): string {
  const parts = FIELD_ORDER.map((key) => {
    const value = row[key]
    return `${JSON.stringify(key)}:${value === null ? 'null' : JSON.stringify(String(value))}`
  })
  return `{${parts.join(',')}}`
}

export function computeAuditHash(row: AuditHashRow, prevHash: string | null): string {
  return createHash('sha256')
    .update(prevHash ?? 'GENESIS')
    .update(canonicalAuditJson(row))
    .digest('hex')
}

/** Redact obviously sensitive keys before storing before/after snapshots. */
const REDACTED_KEYS = ['password', 'password_hash', 'passwordhash', 'token', 'secret', 'activation', 'code']

export function redactForAudit(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]'
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => redactForAudit(entry, depth + 1))
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = REDACTED_KEYS.includes(key.toLowerCase())
        ? '[redacted]'
        : redactForAudit(entry, depth + 1)
    }
    return result
  }
  if (typeof value === 'string' && value.length > 4000) return `${value.slice(0, 4000)}…[truncated]`
  return value
}

export function serializeAuditPayload(value: unknown): string | null {
  if (value === null || value === undefined) return null
  try {
    return JSON.stringify(redactForAudit(value))
  } catch {
    return null
  }
}
