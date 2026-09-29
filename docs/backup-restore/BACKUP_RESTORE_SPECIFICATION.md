# Dentiva Pro — Backup & Restore Specification

**Document ID:** BR-001 · **Version:** 1.0.0 · **Status:** Approved
**Related:** REQ §50–§53, §88–§89, ADR-0005

---

## 1. Backup content and layout

A backup is a **self-contained folder** (never just the database):

```
DentivaPro_Backup_YYYY-MM-DD_HH-mm-ss/
├── manifest.json                # format/version metadata + integrity data
├── DentivaPro.db                # consistent SQLite snapshot (online backup API)
├── attachments/                 # <PatientCode>/<file> — only referenced files
├── config/                      # clinic, print profiles, notification + app settings (JSON)
├── fonts/                       # informational copy of bundled OFL fonts (licence notice)
├── Restore-Instructions.txt
└── SHA256SUMS.txt               # per-file checksums
```

`manifest.json`:

```json
{
  "format": "dentiva-backup",
  "formatVersion": 1,
  "appVersion": "1.0.0",
  "buildNumber": 1,
  "dataSchemaVersion": 1,
  "backupDate": "2026-09-29 18:42:11",
  "backupDateEpochMs": 1790778131000,
  "trigger": "manual",
  "clinic": "…", "machine": "…", "createdBy": "admin",
  "encrypted": false,
  "encryption": null,
  "counts": { "patients": 512, "visits": 1840, "invoices": 900, "attachments": 120 },
  "database": { "file": "DentivaPro.db", "sizeBytes": 81234567, "sha256": "…", "integrityCheck": "ok" },
  "files": [ { "path": "attachments/P-000123/xyz-report.pdf", "sizeBytes": 1234, "sha256": "…" } ],
  "auditChainHead": "…",
  "notes": ""
}
```

## 2. Creation

1. Pre-flight: `PRAGMA integrity_check` (quick) + `foreign_key_check`; abort with a clear error if the
   database is unhealthy (a backup must never capture corruption silently).
2. Quiesce writes (short-lived write lock; reads continue), take a **SQLite online backup** into the
   destination (consistent with WAL, no `File.Copy` of a live file).
3. Copy referenced attachments (streamed, hashed), config snapshot, fonts and instructions.
4. Verify: reopen the backup database read-only, run `integrity_check` + `foreign_key_check`, compare
   counts against the manifest, re-hash every file, then write `SHA256SUMS.txt` last.
5. Record in `backups` table + audit (`backup.create` / `backup.failed`), and show a toast + notification.
6. Progress is streamed to the UI (`job:progress`) with current phase, files copied and bytes.

Automatic backups (REQ §51): schedulable every 7 / 15 / 30 days at a chosen time, to a clinic-chosen
destination folder. Failures (folder missing, drive unplugged, insufficient space, permission denied) are
**never silent**: they create a `critical` notification, a failed `backups` row, an audit entry and a
status-bar indicator. A missed schedule is reported on the next launch. Retention: keep last N automatic
backups (default 10) — pruning is logged and never touches manual/pre-restore backups.

## 3. Encryption (optional)

If "Encrypt backups" is enabled, the archive is stored as `DentivaPro.db.enc` (+ attachment files
encrypted individually) using AES-256-GCM with a scrypt-derived key (N=2^15, r=8, p=1) from the
administrator's backup password; the manifest records `encrypted: true` and the KDF parameters, never the
key. Restore prompts for the password. The clinic is told plainly that a lost password means an
unrecoverable backup, and that unencrypted backups should be stored on controlled media.

## 4. Restore (REQ §52)

Mandatory sequence:

1. **Selection** — browse a backups folder or pick a recent backup from history; multiple files/folders
   can be inspected; the UI shows date, size, clinic, counts, app/schema version and integrity status.
2. **Inspection/validation** — read manifest, verify `SHA256SUMS.txt`, verify database `integrity_check`
   and `foreign_key_check`, verify attachment references, and check version compatibility:
   * same/older schema → allowed (migrations run after restore)
   * newer schema/app than this build → **refused** with a clear message (no corruption risk)
   * missing/invalid manifest, mismatched checksums, or unreadable DB → **refused**
3. **Pre-restore backup (automatic, mandatory)** — the current installation is backed up to
   `Backups/pre-restore_<timestamp>/` before any change; failure aborts the restore.
4. **Confirmation** — typed confirmation phrase plus the acting user's password; the dialog lists exactly
   what will be replaced and what will be preserved.
5. **Staging** — copy the backup into `Temp/restore-<timestamp>/`, run migrations against the staged copy,
   run integrity checks again, and only then swap: current DB → `Backups/pre-restore_...` (kept), staged
   DB → live path; attachments merged with the same patient-code layout (backup wins, extra new files kept).
6. **Verification** — reopen the live DB, integrity check, count reconciliation, audit chain verification,
   and a summary dialog (what was restored, counts, pre-restore backup path). A new `restore` audit entry
   is written **after** the swap using the restored DB.
7. **Failure handling** — any failure during staging leaves the current installation untouched; a failure
   during the swap triggers an automatic rollback from the pre-restore backup, followed by an explicit
   error report. Restore never "half-applies" silently.

## 5. Verification & tests

* `scripts/verify-backup.mjs <folder>` — standalone CLI verification (manifest, checksums, integrity,
  counts) usable by clinic IT.
* Automated tests: backup→restore round-trip on a seeded dataset (patients, visits, chart, prescriptions,
  invoices, payments, inventory, expenses, staff, users, attachments, printer profiles, settings) with
  row-count and deep-content equality; corrupt-DB backup refused; truncated backup refused; checksum
  tampering detected; restore of a newer-format backup refused; forced failure mid-restore rolls back;
  automatic-backup failure produces notification + audit; encrypted backup round-trip with correct and
  wrong password.
