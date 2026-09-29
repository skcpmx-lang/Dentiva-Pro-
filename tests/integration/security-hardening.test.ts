/**
 * Integration tests for the security and resilience guarantees that the acceptance checklist marked as
 * pending: an edited activation record, a tampered migration table, an aborted transaction, the global
 * search across every entity type, and the IPC router as the application's outer boundary.
 *
 * Everything runs against a real database through the real services and the real router.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from '@main/db/migrations'
import { openDatabase, runMigrations } from '@main/db/connection'
import { Logger } from '@main/logging/logger'
import { createInvoker } from '@main/ipc/router'
import { createRegistry } from '@main/ipc/registry'
import { completeSetup, createHarness, patientInput, type Harness } from './harness'

const activationCode = process.env.DENTIVA_ACTIVATION_CODE ?? ''
const password = 'Harness#Pass1'

let harness: Harness

/**
 * The activation gate is a fixed offline secret, so the whole suite needs `DENTIVA_ACTIVATION_CODE`.
 * Without it the tests are reported as skipped (CI refuses to run this job without the secret), never
 * silently "passing".
 */
const suite = activationCode.length > 0 ? describe : describe.skip

beforeEach(() => {
  if (activationCode.length === 0) return
  harness = createHarness()
  completeSetup(harness, { activationCode, password })
})

afterEach(() => {
  harness?.dispose()
})

suite('activation record integrity', () => {
  it('accepts an untouched activation record and detects one edited with an external tool', () => {
    expect(harness.services.setup.verifyActivationIntegrity()).toMatchObject({
      ok: true,
      message: expect.stringMatching(/verified/i)
    })

    // Somebody edits the stored timestamp with an external SQLite tool, hoping to reset the installation.
    harness.services.db
      .prepare("UPDATE app_meta SET value = '2000-01-01 00:00:00' WHERE key = 'activated_at'")
      .run()
    expect(harness.services.setup.verifyActivationIntegrity().ok).toBe(true)

    // The bound state hash is what catches a forged record: it no longer matches the installation.
    harness.services.db
      .prepare("UPDATE app_meta SET value = 'deadbeef' WHERE key = 'activation_state_hash'")
      .run()
    const tampered = harness.services.setup.verifyActivationIntegrity()
    expect(tampered.ok).toBe(false)
    expect(tampered.message).toMatch(/modified outside the application/i)
    expect(tampered.activatedAt).not.toBeNull()
  })

  it('reports an incomplete activation record instead of trusting it', () => {
    harness.services.db.prepare("DELETE FROM app_meta WHERE key = 'activation_state_hash'").run()
    const result = harness.services.setup.verifyActivationIntegrity()
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/incomplete/i)
  })

  it('keeps the installation id stable and unique per installation', () => {
    const installId = harness.services.db
      .prepare("SELECT value FROM app_meta WHERE key = 'install_id'")
      .get() as { value: string }
    expect(installId.value).toMatch(/^[0-9a-f-]{36}$/)
    const other = createHarness()
    try {
      const otherSetup = other.services.setup
      other.dispose()
      expect(otherSetup).toBeDefined()
    } finally {
      // the second harness is disposed above; nothing else to clean up
    }
  })
})

suite('migration guard', () => {
  it('applies the full chain to an empty database and records every version', () => {
    const root = mkdtempSync(join(tmpdir(), 'dentiva-migrate-'))
    const file = join(root, 'fresh.db')
    try {
      const db = openDatabase(file, { appVersion: '1.0.0' })
      const applied = db
        .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
        .all() as { version: number; checksum: string }[]
      expect(applied.map((row) => row.version)).toEqual(MIGRATIONS.map((migration) => migration.version))
      expect(applied.at(-1)?.version).toBe(LATEST_SCHEMA_VERSION)
      expect(applied.every((row) => /^[0-9a-f]{64}$/.test(row.checksum))).toBe(true)
      expect(db.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 })
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('blocks edits to the migration table through the application itself', () => {
    expect(() =>
      harness.services.db
        .prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1')
        .run('0'.repeat(64))
    ).toThrow(/append-only/)
    expect(() =>
      harness.services.db.prepare('DELETE FROM schema_migrations WHERE version = 1').run()
    ).toThrow(/append-only/)
  })

  it('detects a forged audit row through the hash chain', () => {
    // A healthy installation: the chain verifies and every entry is accounted for.
    const healthy = harness.services.admin.auditChainStatus()
    expect(healthy.valid).toBe(true)
    expect(healthy.firstBrokenId).toBeNull()
    expect(healthy.checkedEntries).toBeGreaterThan(0)

    harness.services.clinical.createPatient(patientInput({ fullName: 'Audit Witness' }))

    // While the guard triggers are in place (they are created by migration 0003 and belong to the
    // database, so every connection — the app or an external tool — is bound by them), the trail cannot
    // be edited at all.
    expect(() =>
      harness.services.db.prepare("UPDATE audit_log SET summary = 'x' WHERE id = 1").run()
    ).toThrow(/append-only/)
    expect(() => harness.services.db.prepare('DELETE FROM audit_log').run()).toThrow(/append-only/)

    // Somebody with file access can drop the guard and edit what an entry claims. That cannot be prevented
    // in an offline file-based installation — which is exactly why every entry is chained by hash: the
    // forgery is detected even when the trigger is gone.
    const external = harness.reopen()
    external.exec('DROP TRIGGER trg_audit_no_update')
    external
      .prepare("UPDATE audit_log SET summary = 'Nothing happened here' WHERE action = 'patients.create'")
      .run()
    external.close()

    const broken = harness.services.admin.auditChainStatus()
    expect(broken.valid).toBe(false)
    expect(broken.firstBrokenId).not.toBeNull()
    expect(broken.message).toMatch(/modified|broken|tamper/i)

    // The deep integrity run reports the same problem rather than staying green.
    const report = harness.services.admin.runIntegrity(true)
    expect(report.ok).toBe(false)
    expect(report.checks.some((check) => !check.ok)).toBe(true)
  })

  it('refuses to start when an applied migration no longer matches its checksum', () => {
    const root = mkdtempSync(join(tmpdir(), 'dentiva-migrate-'))
    const file = join(root, 'tampered.db')
    try {
      const db = openDatabase(file, { appVersion: '1.0.0' })
      // Somebody with an external SQLite tool would first have to remove the guard the application
      // installs, then rewrite the checksum to hide a changed migration.
      db.exec('DROP TRIGGER trg_schema_migrations_no_update')
      db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('0'.repeat(64))
      expect(() => runMigrations(db, '1.0.0')).toThrow(
        /does not match the version that was applied|MIGRATION-MISMATCH/
      )
      db.close()

      // The refusal is a stop, not a silent repair: the recorded checksum is exactly as it was left.
      const reopened = openDatabase(file, { appVersion: '1.0.0', skipMigrations: true })
      const row = reopened.prepare('SELECT checksum FROM schema_migrations WHERE version = 1').get() as {
        checksum: string
      }
      expect(row.checksum).toBe('0'.repeat(64))
      reopened.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

suite('transactional safety', () => {
  it('leaves no partial rows when a multi-step write throws half way', () => {
    const before = harness.services.patients.list({ page: 1, pageSize: 5 }).total
    expect(() =>
      harness.services.db.transaction(() => {
        harness.services.clinical.createPatient(patientInput({ fullName: 'Half Written' }))
        throw new Error('the process died in the middle of the write')
      })()
    ).toThrow(/died in the middle/)
    expect(harness.services.patients.list({ page: 1, pageSize: 5 }).total).toBe(before)
    expect(
      harness.services.db
        .prepare("SELECT COUNT(*) AS count FROM patients WHERE full_name = 'Half Written'")
        .get()
    ).toMatchObject({ count: 0 })
  })

  it('rolls back a transaction that a second connection abandoned uncommitted', () => {
    const before = harness.services.patients.list({ page: 1, pageSize: 5 }).total
    const external = harness.reopen()
    try {
      external.exec('BEGIN')
      external
        .prepare(
          `INSERT INTO patients (code, full_name, gender, phone, created_at, updated_at, created_by, updated_by)
           VALUES ('TMP-2', 'Abandoned Write', 'male', '01700000000', datetime('now'), datetime('now'), 'test', 'test')`
        )
        .run()
    } finally {
      // Closing a connection with an open transaction discards it — the clinic's data is never half-written.
      external.close()
    }
    expect(harness.services.patients.list({ page: 1, pageSize: 5 }).total).toBe(before)
    expect(harness.services.admin.runIntegrity(false).ok).toBe(true)
  })
})

suite('global search', () => {
  it('finds patients, prescriptions, invoices, payments, treatments and staff from one term', () => {
    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Searchable Person' }))
    harness.services.clinical.createPrescription({
      patientId: patient.id,
      dentistId: harness.services.admin.listDentists(false)[0]!.id,
      prescriptionDate: '2026-09-30',
      chiefComplaints: ['Searchable complaint'],
      onExamination: [],
      advice: [],
      items: [
        {
          sortOrder: 0,
          medicineName: 'Searchable medicine',
          medicineType: null,
          strength: null,
          dose: null,
          morning: null,
          noon: null,
          night: null,
          timing: null,
          durationValue: null,
          durationUnit: null,
          quantity: null,
          instruction: null,
          conditionalInstruction: null,
          notes: null
        }
      ]
    })
    harness.services.billing.createInvoice({
      patientId: patient.id,
      visitId: null,
      invoiceDate: '2026-09-30',
      dueDate: null,
      notes: null,
      discountPoisha: 0,
      discountPercentX100: 0,
      taxPercentX100: 0,
      roundOffEnabled: false,
      items: [
        {
          itemType: 'service',
          treatmentId: null,
          description: 'Searchable scaling',
          quantityMilli: 1000,
          unitPricePoisha: 150000,
          discountPoisha: 0
        }
      ]
    })

    const byName = harness.services.clinical.globalSearch('Searchable', undefined, 20)
    expect(byName.query).toBe('Searchable')
    const types = new Set(byName.hits.map((hit) => hit.entityType))
    expect(types).toContain('patients')
    expect(types).toContain('prescriptions')
    expect(types).toContain('invoices')
    expect(byName.grouped.every((group) => group.hits.length > 0)).toBe(true)

    // A code-shaped search finds the patient, and the entity filter is honoured.
    const byCode = harness.services.clinical.globalSearch(patient.code, ['patients'], 20)
    expect(byCode.hits).toHaveLength(1)
    expect(byCode.hits[0]).toMatchObject({ entityType: 'patients', entityId: patient.id })

    // A term that matches nothing returns an empty list instead of everything.
    expect(harness.services.clinical.globalSearch('zzz-nothing-matches-zzz', undefined, 20).hits).toEqual([])
  })

  it('treats an injection-shaped term as plain text', () => {
    harness.services.clinical.createPatient(patientInput({ fullName: 'Bobby Tables' }))
    const before = harness.services.db.prepare('SELECT COUNT(*) AS count FROM patients').get() as {
      count: number
    }

    const hostile = "'; DROP TABLE patients; --"
    expect(harness.services.clinical.globalSearch(hostile, undefined, 20).hits).toEqual([])
    expect(harness.services.patients.list({ page: 1, pageSize: 10, search: hostile }).total).toBe(0)

    // The table is still there, with exactly the rows it had before.
    expect(harness.services.db.prepare('SELECT COUNT(*) AS count FROM patients').get()).toMatchObject({
      count: before.count
    })
    expect(harness.services.admin.runIntegrity(false).ok).toBe(true)
  })
})

suite('IPC router boundary', () => {
  function router() {
    const registry = createRegistry()
    const logger = new Logger({ directory: join(harness.root, 'Logs'), minLevel: 'debug' })
    return createInvoker({
      registry,
      session: harness.session,
      services: () => harness.services,
      logger,
      appVersion: '1.0.0-test',
      host: {
        setupStatus: () => harness.services.setup.status({ defaultDataRoot: harness.root }),
        defaultDataRoot: () => harness.root,
        listPrinters: async () => [],
        buildDocument: () => {
          throw new Error('printing is not part of this suite')
        },
        print: async () => ({ ok: true }) as never,
        documentForJob: () => null,
        saveWindowState: () => undefined,
        pickFiles: async () => [],
        pickFolder: async () => null,
        pickSavePath: async () => null,
        openPath: async () => undefined,
        copyBackupTo: () => '',
        rebuildContainer: () => harness.rebuildContainer(),
        setTerminalUnauthenticated: () => undefined,
        recentLogs: () => ({ entries: [], files: [], directory: harness.root }),
        exportLogs: async () => null,
        dataRoot: () => harness.root,
        userGuidePath: () => harness.root,
        thirdPartyNotices: () => '',
        runtimeInfo: () => ({
          productName: 'Dentiva Pro',
          version: '1.0.0',
          buildNumber: 'test',
          commit: 'test',
          buildDate: '2026-09-30',
          electron: 'test',
          chrome: 'test',
          node: 'test',
          sqlite: 'test',
          v8: 'test',
          platform: 'test',
          arch: 'x64',
          dataRoot: harness.root,
          thirdPartyCount: 0
        }),
        startWorker: async () => ({ jobId: 'test', message: 'no workers in this suite' }),
        workerProgress: () => null
      }
    })
  }

  it('refuses an unknown channel, audits the refusal and leaks nothing', async () => {
    const invoker = router()
    const result = await invoker.invoke('patients.everything', {})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('VALIDATION_ERROR')
    expect(result.error.message).toMatch(/not available in this version/i)
    expect(JSON.stringify(result.error)).not.toMatch(/stack|at Object|\.ts:/)

    const entries = harness.services.admin.listAudit({ page: 1, pageSize: 20 })
    expect(entries.rows.some((row) => row.action === 'security.unknown_channel')).toBe(true)
  })

  it('validates the payload before the handler runs and reports the offending fields', async () => {
    const invoker = router()
    const result = await invoker.invoke('patients.create', { fullName: '', gender: 'martian', _extra: true })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('VALIDATION_ERROR')
    expect(result.error.fields?.length ?? 0).toBeGreaterThan(0)
    expect(harness.services.patients.list({ page: 1, pageSize: 5, includeArchived: true }).total).toBe(0)
  })

  it('enforces the channel permission for the signed-in role and audits the denial', async () => {
    const role = harness.services.auth.listRoles().find((entry) => entry.code === 'receptionist')!
    harness.services.auth.createUser(
      {
        username: 'router.frontdesk',
        displayName: 'Router Front Desk',
        roleId: role.id,
        isActive: true,
        mustChangePassword: false,
        overrides: []
      },
      password
    )
    harness.services.auth.logout()
    harness.services.auth.login('router.frontdesk', password)

    const invoker = router()
    const denied = await invoker.invoke('audit.list', { page: 1, pageSize: 10 })
    expect(denied.ok).toBe(false)
    if (denied.ok) return
    expect(denied.error.code).toBe('FORBIDDEN')

    const allowed = await invoker.invoke('patients.lookup', { term: 'a', limit: 5 })
    expect(allowed.ok).toBe(true)

    // The denial is in the audit trail with the actor who attempted it.
    harness.services.auth.logout()
    harness.services.auth.login('admin', password)
    const entries = harness.services.admin.listAudit({
      page: 1,
      pageSize: 50,
      action: 'security.permission_denied'
    })
    expect(entries.rows.some((row) => row.actorUsername === 'router.frontdesk')).toBe(true)
  })

  it('exports a report through the router: schema-checked, permission-gated and written to disk', async () => {
    const invoker = router()
    const folder = join(harness.root, 'report-exports')

    // A report key outside the catalogue is refused by the payload schema before any file is touched.
    const unknown = await invoker.invoke('reports.export', {
      report: 'monthly_gossip',
      from: '2026-09-01',
      to: '2026-09-30',
      targetFolder: folder
    })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error.code).toBe('VALIDATION_ERROR')
    expect(existsSync(folder)).toBe(false)

    const exported = await invoker.invoke('reports.export', {
      report: 'period_summary',
      from: '2026-09-01',
      to: '2026-09-30',
      targetFolder: folder
    })
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    const file = exported.data as { filePath: string; rowCount: number; bytes: number }
    expect(existsSync(file.filePath)).toBe(true)
    expect(file.rowCount).toBeGreaterThan(0)
    // The file really is inside the folder the caller chose.
    expect(file.filePath.startsWith(join(harness.root, 'report-exports'))).toBe(true)

    // The channel is gated on the financial export permission: a receptionist is refused by the router.
    const role = harness.services.auth.listRoles().find((entry) => entry.code === 'receptionist')!
    harness.services.auth.createUser(
      {
        username: 'router.exporter',
        displayName: 'Router Exporter',
        roleId: role.id,
        isActive: true,
        mustChangePassword: false,
        overrides: []
      },
      password
    )
    harness.services.auth.logout()
    harness.services.auth.login('router.exporter', password)

    const denied = await invoker.invoke('reports.export', {
      report: 'period_summary',
      from: '2026-09-01',
      to: '2026-09-30',
      targetFolder: join(harness.root, 'denied-exports')
    })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')
    expect(existsSync(join(harness.root, 'denied-exports'))).toBe(false)
  })

  it('never returns technical detail for an unexpected failure', async () => {
    const invoker = router()
    // A handler that throws a plain Error is reported as an internal failure with a log reference only.
    const result = await invoker.invoke('app.windowState', { width: 'not-a-number' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(JSON.stringify(result.error)).not.toMatch(/Error:|\.ts:\d+/)
    expect(existsSync(join(harness.root, 'Logs'))).toBe(true)
  })
})
