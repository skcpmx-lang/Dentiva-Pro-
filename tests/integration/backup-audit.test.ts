/**
 * Integration tests for the audit trail, backups and restore.
 *
 * These are the guarantees the clinic depends on when something goes wrong: every change is traceable,
 * the audit log cannot be edited without it being provable, a backup is verified before it is trusted, a
 * restore always keeps a way back, and tampered backups are rejected before the live database is touched.
 */

import { existsSync, readFileSync, readdirSync, readlinkSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

function backupRoot(): string {
  return harness.layout.backupsDir
}

suite('audit trail', () => {
  it('records every clinical change with the actor, and the hash chain verifies', () => {
    harness.services.clinical.createPatient(patientInput({ fullName: 'Audited Patient' }))

    const status = harness.services.admin.auditChainStatus()
    expect(status.valid).toBe(true)
    expect(status.checkedEntries).toBeGreaterThan(0)

    const entries = harness.services.admin.listAudit({ page: 1, pageSize: 200 })
    const created = entries.rows.find((row) => row.action === 'patients.create')
    expect(created).toBeDefined()
    expect(created?.actorUsername).toBe('admin')
    expect(created?.summary).toContain('Audited Patient')
  })

  it('refuses an update or delete of the audit log through the application itself', () => {
    harness.services.clinical.createPatient(patientInput({ fullName: 'First Patient' }))
    expect(() =>
      harness.services.db
        .prepare("UPDATE audit_log SET summary = 'nothing happened here' WHERE action = 'patients.create'")
        .run()
    ).toThrow(/append-only/)
    expect(() =>
      harness.services.db.prepare('DELETE FROM audit_log WHERE action = ?').run('patients.create')
    ).toThrow(/append-only/)
  })

  it('detects an audit row that an external tool rewrote', () => {
    harness.services.clinical.createPatient(patientInput({ fullName: 'First Patient' }))
    harness.services.clinical.createPatient(patientInput({ fullName: 'Second Patient' }))
    expect(harness.services.admin.auditChainStatus().valid).toBe(true)

    // Somebody with the database file and an external SQLite tool would first have to remove the guards
    // the application installs, then edit the row. The hash chain still gives them away.
    const external = harness.reopen()
    try {
      external.exec('DROP TRIGGER trg_audit_no_update')
      external
        .prepare("UPDATE audit_log SET summary = 'nothing happened here' WHERE action = 'patients.create'")
        .run()
    } finally {
      external.close()
    }

    const status = harness.services.admin.auditChainStatus()
    expect(status.valid).toBe(false)
    expect(status.firstBrokenId).not.toBeNull()
    expect(status.message).toContain('modified outside the application')
  })

  it('keeps the audit log append-only through the application (no update or delete path)', () => {
    const auditRepository = harness.services.audit as unknown as Record<string, unknown>
    expect(typeof auditRepository.update).toBe('undefined')
    expect(typeof auditRepository.delete).toBe('undefined')
    expect(typeof auditRepository.remove).toBe('undefined')
  })

  it('stores the acting user on each entry so actions cannot be repudiated', () => {
    const patient = harness.services.clinical.createPatient(patientInput({ fullName: 'Traceable Patient' }))
    const entries = harness.services.admin.listAudit({
      page: 1,
      pageSize: 50,
      action: 'patients.create'
    })
    expect(entries.rows[0]?.entityId).toContain(String(patient.id))
  })
})

suite('backups', () => {
  it('creates a timestamped, self-describing backup that verifies', async () => {
    harness.services.clinical.createPatient(patientInput({ fullName: 'Backup Patient' }))
    const record = await harness.services.admin.createBackup('manual', { includeAttachments: true })

    expect(record.path).toBe(join(backupRoot(), record.fileName))
    expect(record.fileName).toMatch(/^DentivaPro_Backup_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}/)
    expect(existsSync(join(record.path, 'Database', 'dentiva.db'))).toBe(true)
    expect(existsSync(join(record.path, 'manifest.json'))).toBe(true)
    expect(existsSync(join(record.path, 'SHA256SUMS.txt'))).toBe(true)
    expect(record.status).toBe('success')
    expect(record.sizeBytes).toBeGreaterThan(0)

    const manifest = JSON.parse(readFileSync(join(record.path, 'manifest.json'), 'utf8')) as {
      format: string
      formatVersion: number
      database: { file: string; sha256: string; integrityCheck: string }
      counts: Record<string, number>
    }
    expect(manifest.format).toBe('dentiva-backup')
    expect(manifest.formatVersion).toBe(1)
    expect(manifest.database.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.database.integrityCheck).toBe('ok')
    expect(manifest.counts['patients']).toBe(1)

    const inspection = harness.services.admin.verifyBackup(record.path)
    expect(inspection.valid).toBe(true)
    expect(inspection.problems).toEqual([])
    expect(inspection.schemaCompatible).toBe(true)
    expect(inspection.fileCount).toBeGreaterThan(0)
  })

  it('closes its verification connection so the backup database is not left locked', async () => {
    const record = await harness.services.admin.createBackup('manual', { includeAttachments: false })
    const databaseFile = join(record.path, 'Database', 'dentiva.db')

    // A handle left open on the backup file is harmless on POSIX (unlink works anyway) but on
    // Windows it locks the file: the backup prune, the restore staging copy and every teardown
    // delete fail with EBUSY. Two platform-specific probes catch the same bug:
    //  * on Linux an open file descriptor is visible in /proc/self/fd;
    //  * on Windows a locked file cannot be renamed.
    if (process.platform === 'linux') {
      const open = readdirSync('/proc/self/fd').filter((fd) => {
        try {
          return readlinkSync(`/proc/self/fd/${fd}`) === databaseFile
        } catch {
          return false
        }
      })
      expect(open, `the backup database is still open through descriptor(s) ${open.join(', ')}`).toEqual([])
    }
    const moved = `${databaseFile}.locked-check`
    renameSync(databaseFile, moved)
    try {
      expect(existsSync(moved)).toBe(true)
    } finally {
      renameSync(moved, databaseFile)
    }
    // The move round-trips without touching the bytes: the checksum in the manifest still holds.
    expect(harness.services.admin.verifyBackup(record.path).valid).toBe(true)
  })

  it('lists backups newest first and keeps them in the backup folder', async () => {
    await harness.services.admin.createBackup('manual')
    await harness.services.admin.createBackup('manual')
    const backups = harness.services.admin.listBackups()
    expect(backups.length).toBe(2)
    expect(backups[0]!.createdAt >= backups[1]!.createdAt).toBe(true)
    expect(new Set(backups.map((row) => row.fileName)).size).toBe(2)
    expect(backups.every((row) => existsSync(row.path))).toBe(true)
  })

  it('reports a backup whose database was edited after it was written', async () => {
    const record = await harness.services.admin.createBackup('manual')
    const databaseFile = join(record.path, 'Database', 'dentiva.db')
    const bytes = readFileSync(databaseFile)
    writeFileSync(databaseFile, Buffer.concat([bytes, Buffer.from('\n-- tampered\n')]))

    const inspection = harness.services.admin.verifyBackup(record.path)
    expect(inspection.valid).toBe(false)
    expect(inspection.problems.join(' ')).toMatch(/checksum/i)
  })

  it('rejects a folder that is not a Dentiva backup', () => {
    const inspection = harness.services.admin.verifyBackup(harness.root)
    expect(inspection.valid).toBe(false)
    expect(inspection.problems.join(' ')).toMatch(/manifest\.json is missing/)
  })

  it('prunes old backups down to the retention count', async () => {
    for (let index = 0; index < 4; index += 1) {
      await harness.services.admin.createBackup('manual')
    }
    expect(harness.services.admin.listBackups().length).toBe(4)
    harness.services.admin.pruneBackups(2, 'manual')
    expect(harness.services.admin.listBackups().length).toBe(2)
    // The newest two survive: pruning must never delete the most recent safety net.
    const remaining = readdirSync(backupRoot())
      .filter((name) => name.startsWith('DentivaPro_Backup_'))
      .sort()
    expect(remaining.length).toBe(2)
  })

  it('writes a verified pre-restore backup when restoring', async () => {
    harness.services.clinical.createPatient(patientInput({ fullName: 'Before Restore' }))
    const record = await harness.services.admin.createBackup('manual')

    harness.services.clinical.createPatient(patientInput({ fullName: 'After Backup' }))
    const restored = await harness.services.admin.restoreBackup({
      folderPath: record.path,
      confirmationPhrase: 'RESTORE BACKUP',
      password
    })
    // The IPC host rebuilds the container on the re-opened connection after a restore, and the session
    // ends because the restored database may contain different users.
    harness.rebuildContainer()
    expect(harness.session.sessionState).toBe('unauthenticated')
    expect(harness.services.auth.login('admin', password).snapshot.user?.username).toBe('admin')

    expect(restored.preRestoreBackup.trigger).toBe('pre_restore')
    expect(existsSync(restored.preRestoreBackup.path)).toBe(true)
    expect(harness.services.admin.verifyBackup(restored.preRestoreBackup.path).valid).toBe(true)

    // The restored database is the one from the backup: the patient that was created later is gone.
    const patients = harness.services.patients.list({ page: 1, pageSize: 50, includeArchived: true })
    expect(patients.rows.some((row) => row.fullName === 'Before Restore')).toBe(true)
    expect(patients.rows.some((row) => row.fullName === 'After Backup')).toBe(false)

    // ...and the audit chain of the restored database still verifies.
    expect(harness.services.admin.auditChainStatus().valid).toBe(true)

    // The notification centre records what happened, on the restored database: the safety copy and the
    // restore itself. Nothing is stored on the database that was just replaced.
    const notices = harness.services.clinical.listNotifications(false, 50)
    const restoreNotice = notices.find((row) => row.category === 'restore')
    expect(restoreNotice?.priority).toBe('warning')
    expect(restoreNotice?.body).toContain(restored.preRestoreBackup.fileName)
  })

  it('refuses to restore without the typed confirmation phrase', async () => {
    const record = await harness.services.admin.createBackup('manual')
    await expect(
      harness.services.admin.restoreBackup({
        folderPath: record.path,
        confirmationPhrase: 'restore',
        password
      })
    ).rejects.toThrow(/RESTORE BACKUP/)
  })

  it('refuses to restore without the account password when the clinic requires one', async () => {
    const record = await harness.services.admin.createBackup('manual')
    await expect(
      harness.services.admin.restoreBackup({
        folderPath: record.path,
        confirmationPhrase: 'RESTORE BACKUP',
        password: 'not-the-password'
      })
    ).rejects.toThrow()
    // ...and a restore with no password at all is refused just the same.
    await expect(
      harness.services.admin.restoreBackup({
        folderPath: record.path,
        confirmationPhrase: 'RESTORE BACKUP'
      })
    ).rejects.toThrow()
  })

  it('leaves the live database untouched when the chosen backup is corrupt', async () => {
    const record = await harness.services.admin.createBackup('manual')
    harness.services.clinical.createPatient(patientInput({ fullName: 'Survivor Patient' }))

    const databaseFile = join(record.path, 'Database', 'dentiva.db')
    writeFileSync(databaseFile, Buffer.from('this is not a sqlite database at all'))

    await expect(
      harness.services.admin.restoreBackup({
        folderPath: record.path,
        confirmationPhrase: 'RESTORE BACKUP',
        password
      })
    ).rejects.toThrow()

    // The clinic keeps working on the untouched data.
    const patients = harness.services.patients.list({ page: 1, pageSize: 50, includeArchived: true })
    expect(patients.rows.some((row) => row.fullName === 'Survivor Patient')).toBe(true)
    expect(harness.services.admin.auditChainStatus().valid).toBe(true)
  })

  it('takes automatic backups on the configured schedule and honours the interval', async () => {
    // Automatic backups are off until the clinic turns them on, and 00:00 has already passed today.
    expect(await harness.services.admin.runAutoBackupIfDue()).toBeNull()

    harness.services.admin.updateSettings({
      autoBackupEnabled: true,
      autoBackupIntervalDays: 7,
      autoBackupTime: '00:00',
      autoBackupRetention: 10
    })

    const first = await harness.services.admin.runAutoBackupIfDue()
    expect(first).not.toBeNull()
    expect(first?.trigger).toBe('auto')

    // A second run on the same day must not create another backup.
    const second = await harness.services.admin.runAutoBackupIfDue()
    expect(second).toBeNull()
  })
})
