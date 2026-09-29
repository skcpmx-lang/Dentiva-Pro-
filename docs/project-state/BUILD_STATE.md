# Dentiva Pro — Build State (resume protocol)

> **If you are resuming this project: read this file first, then inspect the repository
> (`git log --oneline -12`, `git status`, run the test suite, check CI status). Finish the
> in-progress task before starting the next one. Never redo completed work.**
> The feature-by-feature status lives in `IMPLEMENTATION_CHECKLIST.md` (same folder); the requirement
> matrix lives in `docs/testing/ACCEPTANCE_TEST_CHECKLIST.md`.

```yaml
project: Dentiva Pro
current_phase: 5 - Verification and delivery (release pipeline fixed; the first windows-latest run of the fast suites exposed and fixed a real handle-leak defect; awaiting the green tag-triggered release run)
branch: arena/01a0ef61-dentiva-pro (session branch; merged into main via PR)
last_updated: 2026-09-30
```

## Status

| Area | State |
|---|---|
| Requirements, architecture, ADRs, DB design, RBAC, design system, print, backup, testing docs | **Complete** |
| Project scaffolding (Electron + TS + React + SQLite + electron-builder) | **Complete** |
| Database schema + migrations + repositories | **Complete** (migrations 0001–0005, checksum/append-only/fixture tests in `security-hardening.test.ts`) |
| Services + IPC router (business-layer authorization) | **Complete** (~140 channels, every service checks permissions) |
| Renderer design system + shell + feature screens | **Complete** (prescriptions screen runs on the real channels; verified through the router in the preview harness) |
| Unit tests | **138 passing** (9 files) — money 16, date 15, dental/ids/csv 17, printing 21, security 17, validation 20, session/activation 14, window state 8, renderer components 10 |
| Integration tests | **110 passing** (8 files) — setup/auth 10, clinical 10, billing 13, admin 18, backup/audit 15, security hardening 16 (router boundary, migrations, aborted transactions, activation and audit tamper, global search), reports 10, operations 18 (destructive safeguards, reset, patient filters, every notification category, setup validation, CSV import) |
| Pre-release audits (master §113) | **Running** — `npm run audit:prerelease` executes 14 audits; the Windows-only two report a reasoned skip |
| Requirements traceability matrix | **Complete** — `docs/testing/TRACEABILITY_MATRIX.md`, regenerated and freshness-checked in CI |
| Release readiness document | **Written** — `docs/release/RELEASE_READINESS.md` (verdict: not releasable until the Windows evidence exists) |
| End-to-end (Electron) suites | **Written, first run pending on windows-latest** |
| Performance measurement (NFR-003) | **Measured** — `docs/testing/PERFORMANCE_MEASUREMENTS.md` |
| Dependency/licence audit + third-party notices | **Complete** (`npm run audit:deps`, `npm run licenses`) |
| GitHub Actions CI + release pipeline | **Running** — quality, maintenance and integration jobs are green on GitHub since the `DENTIVA_ACTIVATION_CODE` secret was configured (the integration job now runs all 110 integration tests for real). The Windows end-to-end job executes the suite and is being diagnosed through annotations. Since the v1.0.0 tag run: a `windows-tests` CI job runs the unit + integration suites on windows-latest on every push, and both the release job and that CI job publish test failures as job annotations (the runner log archive is not reachable from this environment) |
| Windows installer build, clean-machine test | **Pending** (windows-latest) — the release job now gets past `npm ci`/lint/typecheck/secret gate; its first real test run (run 36639642068) exposed the `closeDatabase` handle-leak defect, which is fixed with a regression test; the tag is re-pointed to the fix commit to trigger the next run |
| Release (GitHub Release or `dist/`) | **Pending — must remain a DRAFT** until every release gate below is verified; no release has been created yet (both release runs failed before the publish step) |

## Machine-readable task state

```yaml
current_task: Release pipeline repair. The v1.0.0 tag release run 36639642068 failed at the Tests step on windows-latest — the first run of the unit + integration suites on Windows. Diagnostic run 36643028902 (tag re-pointed to the instrumented branch commit) published the failure as annotations: 12 EBUSY "resource busy or locked, unlink ...Backups...dentiva.db" teardown errors, exactly the 12 tests that call createBackup. Root cause reproduced locally with an /proc/self/fd probe: closeDatabase() runs wal_checkpoint + optimize + close() in ONE try/catch; on a real clinic database PRAGMA optimize throws "attempt to write a readonly database" on the read-only backup-verification connection, so the catch swallowed it and db.close() never ran — leaking the file handle. POSIX never notices (unlink works on open files); Windows locks the file, so every dispose() rmSync of a test data root containing a backup fails with EBUSY. Fixed by making the two maintenance pragmas best-effort and closing unconditionally (src/main/db/connection.ts), plus a cross-platform regression test (backup-audit.test.ts: /proc fd probe on Linux, rename round-trip on Windows) and maxRetries on the harness teardown.
next_task: Push the fix, watch the branch CI (the new windows-tests job is the platform proof), merge to main, re-point v1.0.0 at the merged commit and push the tag, then verify the release run is green: installer + SHA256SUMS.txt + build-info.json uploaded, verify:installer passed, GitHub Release v1.0.0 exists as a DRAFT. Download and hash-verify the three artifacts. Do NOT publish the release. Then record the executed evidence in docs/release/RELEASE_READINESS.md and continue the remaining Windows evidence items.
completed:
  - docs/* (requirements, architecture, ADRs, database, security, ux, printing, backup-restore, testing, compliance, project-state, user guide)
  - src/shared/** (money incl. fromDecimalString, date, ids, dental, csv, permissions, validation, constants, printing models)
  - src/main/db/** (connection, migrations, integrity, repositories-core/clinical/billing)
  - src/main/security/** (activation verifier, scrypt passwords, session, audit hash chain)
  - src/main/services/** (container, auth, setup, clinical, billing, admin, reports, headless host)
  - src/main/ipc/** (registry v2 + router with live-container resolution), preload bridge
  - src/renderer/** (design system, shell, all feature screens)
  - integration suites (setup-auth, clinical, billing, backup-audit)
  - unit suites (money, date, dental-ids-csv)
  - maintenance tooling (dependency audit, third-party notices, backup verifier, release artifact verifier, stress seeder, preview harness)
  - GitHub Actions ci.yml + release.yml, Playwright config + e2e suites
in_progress:
  - Windows-only evidence: Electron end-to-end suites, installer build/install/uninstall, print matrix and DPI screenshots (everything else is verified locally or by the CI quality/maintenance jobs)
  - The `integration`/`e2e-windows`/Release jobs stay red until the repository owner adds the DENTIVA_ACTIVATION_CODE secret; the sandbox token cannot create it, and the fixed offline secret must not live in the repository
failed_tests: []
known_issues:
  - Electron cannot run in the development sandbox (no binary), so E2E, PDF fidelity, print matrix and DPI checks only run on windows-latest.
  - The sandbox `npm install` cannot compile better-sqlite3 (no reachable Node headers) and its prebuild download is blocked, so use `npm install --ignore-scripts`: the published tarball already contains `prebuilds/{linux,win32}-x64.node` and loads correctly.
  - The activation code is no longer written anywhere in the repository (the test fixtures were replaced with a synthetic code and the shipped verifier is exercised only through `DENTIVA_ACTIVATION_CODE`); audit A2 of `npm run audit:prerelease` fails the build if a code-shaped literal reappears.
  - `npm install` with lifecycle scripts cannot work on a machine without reachable Node headers
    (better-sqlite3's node-gyp step fails); `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --ignore-scripts`
    installs the published prebuilds and is the supported path in a sandbox. On a normal Windows developer
    machine a plain `npm ci` works.
  - Empty folders kept out of git (for example an empty attachments directory) must be created by the code at runtime; do not re-add committed placeholder files.
pending_fixes: []
last_successful_build: green (electron-vite build, out/renderer ~1.45 MB js + 49 kB css; GitHub Actions quality job green)
last_successful_test: 249 passing locally (138 unit + 111 integration) with the activation verifier exercised through a synthetic code (the local-only substitute for the CI secret; the one test that verifies the SHIPPED verifier against the real code is the only local exception and passes in CI where the secret holds the real code). Without any code the activation-dependent suites report as skipped by design. GitHub CI: lint/types/build/unit, maintenance and integration jobs green; the new windows-tests job (unit + integration on windows-latest) is the platform parity gate; the Windows e2e job runs the Electron suite and its failures are published as annotations.
```

## Corrections found by auditing the repository (2026-09-30, keep them fixed)

1. **The activation code was committed in three test files** while ADR-0004 claims it is never written
   anywhere in the repository. `createVerifierFromSecret` / `createActivationVerifier` were added to
   `src/main/security/activation.ts`, the unit suite now proves the verifier against a synthetic code, the
   integration suite exercises the shipped verifier only through `DENTIVA_ACTIVATION_CODE`, and audit A2 of
   `npm run audit:prerelease` fails the build if a 16-digit code-shaped literal reappears.
2. **The lock-out guard for user accounts was wrong.** `AdminService`'s sibling in `AuthService` counted
   holders of `users.manage` in any role and discarded its role argument, so an account manager could
   deactivate the last administrator while the error message claimed otherwise. The guard now counts both
   what would remain (administrators in the role, and effective holders of the permission, overrides
   honoured) and is covered by `admin.test.ts`.
3. **The root `.gitignore` ignored `docs/release/`.** The unanchored `release/` pattern matched the
   documentation folder as well as the electron-builder output; both are now anchored (`/release/`).
4. **The command palette search field had no accessible name** (placeholder only). Audit A12 now proves
   every form control in the renderer carries an accessible name.
5. **Four export buttons could not work.** The reports screen asked the export service for
   `report_<key>`, the audit screen for `audit_log` and the inventory screen for
   `inventory_transactions` — none of which the service (or its payload schema) accepts, and the settings
   screen gated the invoice export on `data.export` while the service requires
   `reports.financial.export`. Fixed by: a dedicated `reports.export` channel that writes exactly the report
   the screen shows (same headers, rows and summary block, audited); typed `ExportEntity` union so the
   compiler refuses an entity the service cannot produce; a real `inventory_movements` dataset for the
   inventory ledger; matching permission gates and error toasts on the settings screen. Tests:
   `reports.test.ts` (report CSV), `security-hardening.test.ts` (the channel through the real router),
   `admin.test.ts` (movements export).
6. **The auditor role could not export the audit log.** `export.data` is gated on `data.export` at the
   router and narrowed per entity in the service, so a role holding only `audit.export` was refused before
   the service ran. The auditor now carries `data.export`, and a unit test asserts that every role able to
   export a dataset also holds the channel permission.
7. **Every patient date filter crashed.** `PatientRepository.list` mixed a positional `?` placeholder with
   named parameters, so better-sqlite3 refused the statement: "today", "last 7 days", "last 30/90 days" and
   "last year" on the patient register produced an error instead of a list, while the default view (no range)
   worked — which is why no earlier test caught it. The preset window now binds `@rangeFrom`, and
   `operations.test.ts` asserts every preset plus a custom range and the newest-first default.
8. **"Reset database" could never complete.** `audit_log.actor_user_id` referenced `users (id) ON DELETE SET
   NULL`, so deleting the accounts made SQLite UPDATE the append-only audit rows, which the immutability
   trigger refused; the reset always ended in an error. Migration `0005_audit_log_without_actor_fk` rebuilds
   the table without that foreign key (the actor is already snapshotted in `actor_username`), which makes the
   reset work *and* removes the one path by which a foreign key could rewrite history. The reset now also
   counts every deleted row, keeps the audit trail, and `operations.test.ts` verifies that the database stays
   foreign-key clean afterwards.
9. **`data.import` gated nothing.** The permission existed in the catalogue but no importer did, although the
   data-management requirement asks for import validation. A CSV patient import now ships end to end: header
   mapping with aliases, per-row validation through the registration schema, duplicate detection inside the
   file and against the register, a dry run that writes nothing, an all-or-nothing transaction, one audit
   entry, and a confirmation dialog that lists every problem with its line number.
10. **Five notification categories could never appear.** The centre declared eight categories, but only
   appointment, inventory and billing were ever written: nothing raised backup, restore, security, system or
   queue notices, although REQ-NOTIF-001 asks for backup status, restore warnings and system/security
   notices, and the queue is where a silent delay costs a patient. All five now fire from real events
   (queue waiting past `queueWaitingReminderMinutes`, every backup and a failed one, an overdue schedule, a
   finished restore, failed sign-ins and lockouts, a failed integrity check), each with deduplication, and
   `operations.test.ts` covers them.
11. **A broken backup folder leaked a filesystem error.** `backupRoot()` created the folder outside any
   error handling, so a backup folder that was a file (or below one) surfaced as a raw `ENOTDIR`, and no
   failed attempt was recorded. Both paths now explain themselves, record the failed attempt in the backup
   register and raise a critical notice.
12. **The traceability freshness check was date-dependent.** The generator stamped the file with the current
   date and CI compared it byte for byte, so the check would have failed on the next day even with an
   unchanged repository. The timestamp is gone; `npm run docs:traceability -- --check` is now stable.
13. **Every backup leaked a read-only database connection (Windows file-lock defect).**
   `closeDatabase()` ran `wal_checkpoint(TRUNCATE)`, `optimize` and `close()` inside one try/catch. On a
   real clinic database `PRAGMA optimize` throws `attempt to write a readonly database` on the
   read-only connection `createBackup` uses to verify the file it just wrote, the catch swallowed the
   error and `db.close()` never ran. The leaked handle is invisible on POSIX (unlink works on open
   files) but on Windows it locks the backup's `dentiva.db`, so the backup prune, restore staging and
   every test-teardown delete fail with EBUSY. This was the failure of the release run 36639642068
   (12 of the 12 tests that create a backup). `closeDatabase` now treats the two maintenance pragmas as
   best-effort and always closes; `backup-audit.test.ts` proves the backup file is left unlocked
   (/proc fd probe on Linux, rename round-trip on Windows), and the integration harness teardown
   retries like the e2e harness does.

## Corrections found by running the app (2026-09-30, keep them fixed)

Running the prescriptions flow through the real IPC router exposed four defects that no passing unit test
had caught. All four are fixed, with integration coverage:

1. **`status` never reached the service.** `prescriptionInputSchema` had no `status` field and the router
   hands the *parsed* payload to the handler, so "Finalise" always saved a draft. The schema now carries
   `status: 'draft' | 'final'` (never `void`), and `clinical.test.ts` asserts the finalisation persists.
2. **An edit without a status reset the sheet to draft.** The repository wrote `status = @status`; it now
   uses `COALESCE(@status, status)` so a reorder cannot silently draft a final sheet.
3. **The register's status filter was ignored.** `PrescriptionQuery`/`PrescriptionRepository.list` had no
   `status` filter while the channel advertised one; it is now a real `WHERE r.status = @status` clause.
4. **The void reason was discarded.** The channel validated a reason (min 3 characters) and the service
   threw it away, and the table had nowhere to keep it. Migration `0004` adds `void_reason`/`voided_at`,
   `Prescription.voidReason`/`voidedAt` are exposed, the audit entry quotes the reason, the confirm dialog
   now asks for one (invoices and payments too), and voided prescriptions are refused by the print path.

## Environment notes (important for resuming)

* The sandbox has **no Windows, no Wine and no access to GitHub release assets**; the Electron binary
  cannot be downloaded here.
  * Install with `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install`.
  * Electron-dependent verification (E2E, installer, PDF fidelity, print matrix, DPI) happens in GitHub
    Actions on `windows-latest`, or on a real Windows machine.
* `better-sqlite3@13` ships N-API prebuilds (including `win32-x64`), so no compiler is needed anywhere.
* UI review in the sandbox uses the **browser preview harness**:
  `npm run build:app && DENTIVA_ACTIVATION_CODE=… node scripts/preview-server.mjs --port 4173`.
  It serves the production renderer and runs the real service container, router and database behind it;
  printing and PDF export are the only features it refuses (they need Chromium's desktop pipeline).
* `node_modules/` is not preserved between sessions — re-run
  `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install` before working.
* The activation code is supplied through the environment (`DENTIVA_ACTIVATION_CODE`) for tests and the
  preview harness; it is deliberately absent from the repository.
* The application honours `DENTIVA_DATA_ROOT` (highest priority) and a `data-root.txt` next to the
  executable to point at a specific data folder. Electron resolves `app.getPath('appData')` through the
  Win32 shell API, so on Windows the `APPDATA` environment variable alone does **not** isolate a test run —
  the end-to-end harness therefore uses `DENTIVA_DATA_ROOT`, otherwise two test files would share one clinic
  database.
* **Repository secret to configure (blocking the release):** add `DENTIVA_ACTIVATION_CODE` under
  *Settings → Secrets and variables → Actions → New repository secret*. Until it exists, the `integration`,
  `e2e-windows` and Release jobs fail on purpose with an explanatory message instead of reporting a green
  build in which the activation-dependent tests (and every Electron acceptance test) were skipped. The
  installer artifact and the Windows evidence cannot be produced without it; the automated token used here
  can read and write the repository but cannot write secrets. The secret is configured (the release job's
  secret gate passes), so the suites run for real on GitHub.
* **GitHub access limits observed from this environment (2026-09-30, keep them in mind):**
  * The runner **log archive is unreachable** (the `results-receiver.actions.githubusercontent.com` redirect
    of `GET /actions/runs/{id}/logs` fails with an SSL error; `gh run view --log-failed` fails the same
    way). Failing steps must therefore publish their reason as **job annotations** — the pattern already in
    `scripts/ci-annotate.mjs`, now used by the release job and the `windows-tests` CI job.
  * Annotations are readable per check run: `gh api /repos/{owner}/{repo}/check-runs/{job_databaseId}/annotations`.
    The run-level endpoint `.../actions/runs/{run_id}/annotations` returns 404 for this token.
  * `gh workflow run` (workflow_dispatch) is **forbidden for the app token** (403
    "Resource not accessible by integration"), so the Release workflow is triggered by **pushing the tag**
    (it also runs on `push: tags: v*`). To re-run the release, force-move `v1.0.0` to the new commit and
    push the tag (`git tag -f v1.0.0 <sha> && git push -f origin v1.0.0`); the tag must always point at a
    commit whose `package.json` version matches the tag name.

## How to resume in 5 steps

1. `git log --oneline -12 && git status` — confirm the branch, the latest commit and that the tree is clean.
2. Read `IMPLEMENTATION_CHECKLIST.md` and continue the first **Partial**/**Open** item that the
   `machine-readable task state` above names as `current_task`.
3. `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install`, then `npm run verify`
   (lint + typecheck + tests with coverage) to see the current state.
4. `DENTIVA_ACTIVATION_CODE=… npx vitest run --config vitest.config.ts` for the integration suites.
5. Finish the task, run all gates (`npm run lint`, `npm run typecheck`, `npm run test`,
   `npm run audit:deps`, and for data changes `node scripts/seed-stress-data.mjs`), commit with a
   conventional message, and update this file plus `IMPLEMENTATION_CHECKLIST.md` at the end of the turn.
