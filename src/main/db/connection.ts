/**
 * Database connection, PRAGMA policy and the migration runner.
 *
 * Every connection is opened with the same PRAGMA set (see DATABASE_DESIGN.md §1) so behaviour is
 * identical in the app, in tests and in tooling. Migrations are checksummed: if an already applied
 * migration file changed, startup aborts with a clear message instead of silently mutating data.
 */

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { MIGRATIONS, LATEST_SCHEMA_VERSION, type Migration } from './migrations'

export type SqliteDatabase = Database.Database

export interface OpenDatabaseOptions {
  /** Skip migrations (used by integrity tooling and read-only inspection). */
  skipMigrations?: boolean
  appVersion?: string
  /** Read-only connections never write, migrate or create files. */
  readOnly?: boolean
}

export interface MigrationResult {
  applied: Migration[]
  currentVersion: number
  wasCreated: boolean
}

export function computeMigrationChecksum(migration: Migration): string {
  return createHash('sha256').update(migration.sql).digest('hex')
}

export function openDatabase(filePath: string, options: OpenDatabaseOptions = {}): SqliteDatabase {
  const { skipMigrations = false, appVersion = 'unknown', readOnly = false } = options
  if (!readOnly) mkdirSync(dirname(filePath), { recursive: true })

  const db = new Database(filePath, readOnly ? { readonly: true, fileMustExist: true } : {})
  applyPragmas(db, readOnly)

  if (!skipMigrations && !readOnly) {
    runMigrations(db, appVersion)
  }
  return db
}

export function applyPragmas(db: SqliteDatabase, readOnly = false): void {
  if (!readOnly) {
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('wal_autocheckpoint = 512')
  }
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 8000')
  db.pragma('temp_store = MEMORY')
  db.pragma('cache_size = -16000')
  db.pragma('trusted_schema = OFF')
  db.pragma('recursive_triggers = OFF')
}

function tableExists(db: SqliteDatabase, name: string): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) as
    { name: string } | undefined
  return row !== undefined
}

/** Run all pending migrations inside individual transactions. */
export function runMigrations(db: SqliteDatabase, appVersion: string): MigrationResult {
  const wasCreated = !tableExists(db, 'schema_migrations')
  if (wasCreated) {
    db.exec(`
      CREATE TABLE schema_migrations (
        version      INTEGER PRIMARY KEY,
        name         TEXT    NOT NULL,
        checksum     TEXT    NOT NULL,
        applied_at   TEXT    NOT NULL,
        duration_ms  INTEGER NOT NULL,
        app_version  TEXT    NOT NULL
      );
    `)
  }

  const applied = db.prepare('SELECT version, checksum FROM schema_migrations').all() as {
    version: number
    checksum: string
  }[]
  const appliedMap = new Map(applied.map((row) => [row.version, row.checksum]))

  // 1. Verify checksums of previously applied migrations.
  for (const migration of MIGRATIONS) {
    const recorded = appliedMap.get(migration.version)
    if (recorded !== undefined) {
      const checksum = computeMigrationChecksum(migration)
      if (checksum !== recorded) {
        throw new Error(
          `Database migration ${migration.name} (v${migration.version}) does not match the version that was ` +
            `applied to this database. Refusing to continue to protect your data. Please restore the matching ` +
            `application version or contact support with reference MIGRATION-MISMATCH.`
        )
      }
    }
  }

  // 2. Apply pending migrations in order.
  const pending = MIGRATIONS.filter((migration) => !appliedMap.has(migration.version)).sort(
    (a, b) => a.version - b.version
  )

  const appliedNow: Migration[] = []
  for (const migration of pending) {
    const startedAt = Date.now()
    const run = db.transaction(() => {
      db.exec(migration.sql)
      db.prepare(
        `INSERT INTO schema_migrations (version, name, checksum, applied_at, duration_ms, app_version)
         VALUES (?, ?, ?, datetime('now','localtime'), ?, ?)`
      ).run(
        migration.version,
        migration.name,
        computeMigrationChecksum(migration),
        Date.now() - startedAt,
        appVersion
      )
    })
    try {
      run()
      appliedNow.push(migration)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Applying database migration ${migration.name} failed: ${message}`, { cause: error })
    }
  }

  if (appliedNow.length > 0 || wasCreated) {
    db.prepare(
      `INSERT INTO app_meta (key, value, updated_at) VALUES ('data_schema_version', ?, datetime('now','localtime'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(String(LATEST_SCHEMA_VERSION))
  }

  return { applied: appliedNow, currentVersion: getSchemaVersion(db), wasCreated }
}

export function getSchemaVersion(db: SqliteDatabase): number {
  if (!tableExists(db, 'schema_migrations')) return 0
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as {
    version: number
  }
  return row.version
}

/**
 * Wrap a function in a database transaction. better-sqlite3 transactions are synchronous and
 * re-entrant-safe (nested calls become savepoints via `transaction.immediate` usage in services).
 */
export function withTransaction<T>(db: SqliteDatabase, fn: () => T): T {
  const run = db.transaction(fn)
  return run()
}

/** Convenience: read/write a value from the key/value `app_meta` table. */
export function getMeta(db: SqliteDatabase, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setMeta(db: SqliteDatabase, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value)
}

/** Close the connection cleanly, truncating the WAL so the database file is self-contained. */
export function closeDatabase(db: SqliteDatabase): void {
  if (!db.open) return
  try {
    // Best effort: a read-only connection (for example the one that verifies a freshly written
    // backup) cannot perform these, and a busy database may refuse either. Their failure must
    // never prevent the close below — a connection that stays open keeps its file handle open,
    // and on Windows that locks the database file against rename and delete.
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.pragma('optimize')
  } catch {
    // The pragmas are maintenance; closing is not optional.
  }
  try {
    db.close()
  } catch {
    // Closing must never throw during shutdown; the WAL is crash-safe by design.
  }
}
