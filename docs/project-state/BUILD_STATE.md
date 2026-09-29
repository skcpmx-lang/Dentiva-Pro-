# Dentiva Pro — Build State (resume protocol)

> **If you are resuming this project: read this file first, then inspect the repository
> (`git log --oneline -12`, `git status`, run the test suite, check CI status). Finish the
> in-progress task before starting the next one. Never redo completed work.**
> The feature-by-feature status lives in `IMPLEMENTATION_CHECKLIST.md` (same folder); the requirement
> matrix lives in `docs/testing/ACCEPTANCE_TEST_CHECKLIST.md`.

```yaml
project: Dentiva Pro
current_phase: 5 - Verification and delivery (feature surface implemented; acceptance evidence, audits and release documents being completed)
branch: arena/01a0ee4f-dentiva-pro
last_updated: 2026-09-30
```

## Status

| Area | State |
|---|---|
| Requirements, architecture, ADRs, DB design, RBAC, design system, print, backup, testing docs | **Complete** |
| Project scaffolding (Electron + TS + React + SQLite + electron-builder) | **Complete** |
| Database schema + migrations + repositories | **Complete** (migrations 0001–0003; fixture/checksum tests pending) |
| Services + IPC router (business-layer authorization) | **Complete** (~140 channels, every service checks permissions) |
| Renderer design system + shell + feature screens | **Complete** (prescriptions screen runs on the real channels; verified through the router in the preview harness) |
| Unit tests | **127 passing** (8 files) — money 16, date 15, dental/ids/csv 17, printing 21, security 15, validation 20, session/activation 14, window state 8 |
| Integration tests | **91 passing** (7 files) — setup/auth 10, clinical 10, billing 13, admin 18, backup/audit 15, security hardening 15 (router boundary, migrations, aborted transactions, activation tamper, global search), reports 10 |
| Pre-release audits (master §113) | **Running** — `npm run audit:prerelease` executes 14 audits; the Windows-only two report a reasoned skip |
| Requirements traceability matrix | **Complete** — `docs/testing/TRACEABILITY_MATRIX.md`, regenerated and freshness-checked in CI |
| Release readiness document | **Written** — `docs/release/RELEASE_READINESS.md` (verdict: not releasable until the Windows evidence exists) |
| End-to-end (Electron) suites | **Written, first run pending on windows-latest** |
| Performance measurement (NFR-003) | **Measured** — `docs/testing/PERFORMANCE_MEASUREMENTS.md` |
| Dependency/licence audit + third-party notices | **Complete** (`npm run audit:deps`, `npm run licenses`) |
| GitHub Actions CI + release pipeline | **Running** — quality, maintenance and build jobs pass on GitHub; the integration and end-to-end jobs need the `DENTIVA_ACTIVATION_CODE` repository secret (not yet configured, see below) |
| Windows installer build, clean-machine test | **Pending** (windows-latest) |
| Release (GitHub Release or `dist/`) | **Pending** |

## Machine-readable task state

```yaml
current_task: §113 pre-release audits, traceability matrix and release-readiness document shipped; next is the packaged Windows installer run on windows-latest
next_task: Run the CI and Release workflows on windows-latest (activate the DENTIVA_ACTIVATION_CODE repository secret first), then complete docs/release/RELEASE_READINESS.md with the executed evidence
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
failed_tests: []
known_issues:
  - Electron cannot run in the development sandbox (no binary), so E2E, PDF fidelity, print matrix and DPI checks only run on windows-latest.
  - The sandbox `npm install` cannot compile better-sqlite3 (no reachable Node headers) and its prebuild download is blocked, so use `npm install --ignore-scripts`: the published tarball already contains `prebuilds/{linux,win32}-x64.node` and loads correctly.
  - The activation code is no longer written anywhere in the repository (the test fixtures were replaced with a synthetic code and the shipped verifier is exercised only through `DENTIVA_ACTIVATION_CODE`); audit A2 of `npm run audit:prerelease` fails the build if a code-shaped literal reappears.
  - Empty folders kept out of git (for example an empty attachments directory) must be created by the code at runtime; do not re-add committed placeholder files.
pending_fixes: []
last_successful_build: green (electron-vite build, out/renderer ~1.45 MB js + 49 kB css; GitHub Actions quality job green)
last_successful_test: 218 passing locally (127 unit + 91 integration) with DENTIVA_ACTIVATION_CODE set; without it the activation-dependent integration suites report as skipped by design (133 passed / 85 skipped). GitHub CI: lint/types/build/unit + maintenance jobs green, integration + e2e waiting for the repository secret.
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
7. **The traceability freshness check was date-dependent.** The generator stamped the file with the current
   date and CI compared it byte for byte, so the check would have failed on the next day even with an
   unchanged repository. The timestamp is gone; `npm run docs:traceability -- --check` is now stable.

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
* **Repository secret to configure:** add `DENTIVA_ACTIVATION_CODE` under
  *Settings → Secrets and variables → Actions → New repository secret*. Until it exists, the `integration`
  and `e2e-windows` jobs fail on purpose with an explanatory message instead of reporting a green build in
  which 40 of 46 integration tests (and every Electron acceptance test) were skipped.

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
