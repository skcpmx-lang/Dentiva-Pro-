# Dentiva Pro — Build State (resume protocol)

> **If you are resuming this project: read this file first, then inspect the repository
> (`git log --oneline -12`, `git status`, run the test suite, check CI status). Finish the
> in-progress task before starting the next one. Never redo completed work.**
> The feature-by-feature status lives in `IMPLEMENTATION_CHECKLIST.md` (same folder); the requirement
> matrix lives in `docs/testing/ACCEPTANCE_TEST_CHECKLIST.md`.

```yaml
project: Dentiva Pro
current_phase: 5 - Verification and delivery (feature surface implemented, acceptance evidence being built)
branch: arena/01a0ee4f-dentiva-pro
last_updated: 2026-09-29
```

## Status

| Area | State |
|---|---|
| Requirements, architecture, ADRs, DB design, RBAC, design system, print, backup, testing docs | **Complete** |
| Project scaffolding (Electron + TS + React + SQLite + electron-builder) | **Complete** |
| Database schema + migrations + repositories | **Complete** (migrations 0001–0003; fixture/checksum tests pending) |
| Services + IPC router (business-layer authorization) | **Complete** (~140 channels, every service checks permissions) |
| Renderer design system + shell + feature screens | **Complete** (prescriptions screen runs on the real channels; verified through the router in the preview harness) |
| Unit tests | **104 passing** (money 16, date 15, dental/ids/csv 17, printing 21, security 15, validation 20) |
| Integration tests | **65 passing** (setup/auth 9, clinical 10, billing 13, admin 18, backup/audit 15) |
| End-to-end (Electron) suites | **Written, first run pending on windows-latest** |
| Performance measurement (NFR-003) | **Measured** — `docs/testing/PERFORMANCE_MEASUREMENTS.md` |
| Dependency/licence audit + third-party notices | **Complete** (`npm run audit:deps`, `npm run licenses`) |
| GitHub Actions CI + release pipeline | **Running** — quality, maintenance and build jobs pass on GitHub; the integration and end-to-end jobs need the `DENTIVA_ACTIVATION_CODE` repository secret (not yet configured, see below) |
| Windows installer build, clean-machine test | **Pending** (windows-latest) |
| Release (GitHub Release or `dist/`) | **Pending** |

## Machine-readable task state

```yaml
current_task: Prescriptions print/void corrections shipped; next is the remaining pre-release audit sweep
next_task: Pre-release audits (spec §113), then the packaged Windows installer run on windows-latest
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
  - Remaining pre-release audits and the packaged installer run (the prescriptions screen rewrite itself is complete and verified through the real router)
failed_tests: []
known_issues:
  - Electron cannot run in the development sandbox (no binary), so E2E, PDF fidelity, print matrix and DPI checks only run on windows-latest.
  - Empty folders kept out of git (for example an empty attachments directory) must be created by the code at runtime; do not re-add committed placeholder files.
pending_fixes: []
last_successful_build: green (electron-vite build, out/renderer ~1.45 MB js + 49 kB css; GitHub Actions quality job green)
last_successful_test: 169 passing locally (104 unit + 65 integration) with DENTIVA_ACTIVATION_CODE set; without it the activation-dependent integration suites report as skipped by design. GitHub CI: lint/types/build/unit + maintenance jobs green, integration + e2e waiting for the repository secret.
```

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
