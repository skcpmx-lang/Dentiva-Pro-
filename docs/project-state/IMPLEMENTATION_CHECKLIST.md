# Dentiva Pro — Implementation Checklist

**Purpose.** The build-state file says *where* the project is; this file says *what is done and what is not*
for every area of the master specification. It is the working document for the resume protocol: on
“Continue”, read `BUILD_STATE.md`, then find the first unchecked item here and finish it before starting
anything else.

Status values: **Done** (implemented and verified by an executed test or a run), **Partial** (implemented,
but a listed sub-item is missing), **Open** (not implemented yet). Nothing is marked Done because it
compiles.

Last reviewed: 2026-09-29 · branch `arena/01a0ee4f-dentiva-pro`

---

## 1. Platform and infrastructure

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 1.1 | Electron 38 + React 19 + TypeScript strict, electron-vite bundling | **Done** | `npm run build` produces `out/main`, `out/preload`, `out/renderer` |
| 1.2 | Renderer sandboxed: contextBridge only, no Node in the renderer | **Done** | `src/preload/index.ts`, `createInvoker` router |
| 1.3 | SQLite via better-sqlite3 with WAL, foreign keys, busy timeout | **Done** | `src/main/db/connection.ts`; integration suites run against it |
| 1.4 | Versioned migrations with checksums | **Partial** | `src/main/db/migrations.ts` (3 migrations); a checksum-mismatch test and a v1-fixture upgrade test are still missing |
| 1.5 | Immutable audit log (hash chain, append-only triggers) | **Done** | migrations 0003 triggers + `db/integrity.ts`; `backup-audit.test.ts` |
| 1.6 | Service container + IPC registry/router with payload validation | **Done** | `ipc/registry.ts` (≈140 channels), `ipc/router.ts`; integration tests exercise them through the harness |
| 1.7 | Restore-safe re-wiring (`reopenDb`, `rebuildContainer`) | **Done** | `src/main/index.ts`; `backup-audit.test.ts` restores and continues |
| 1.8 | Logging with rotation and no secrets | **Partial** | `src/main/logging/logger.ts`; redaction asserted only indirectly |
| 1.9 | Crash recovery | **Open** | No simulated-abort test yet (AT-F05) |

## 2. Setup, activation, security

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 2.1 | Setup wizard (activation → clinic → dentists → administrator) | **Done** | `features/setup/SetupWizard.tsx`; `setup-auth.test.ts` covers the service layer; UI in `setup-wizard.e2e.ts` (first Windows run pending) |
| 2.2 | Activation code verified by derived verifier (no plaintext) | **Done** | PBKDF2 verifier in `security/activation.ts`; `setup-auth.test.ts`; the code is absent from `src/` and `docs/` |
| 2.3 | Activation throttling and audit | **Done** | 10 attempts / 60 s cooldown; `setup-auth.test.ts` |
| 2.4 | Passwords: scrypt (N=2¹⁵, r=8, p=1), policy ≥10 chars, 5-failure lockout | **Partial** | Implemented; a dedicated unit test for the hash/verify/policy module is still missing (AT-B03) |
| 2.5 | Session: auto-lock 5/10/15/30, Lock Now, unlock by password | **Done** | `security/session.ts`; `setup-auth.test.ts` (auto-lock) |
| 2.6 | RBAC: role grants, per-user deny wins, last-admin guard, enforcement in services | **Partial** | Implemented (every service calls `require`); resolution unit test and a “denied service call” integration test are missing (AT-B04/B05) |
| 2.7 | Destructive-action safeguards (typed phrase + password + pre-action backup) | **Done** | `admin-service.ts` (`RESTORE BACKUP`); `backup-audit.test.ts` |

## 3. Clinical

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 3.1 | Patients: register, search, filters, archive/restore, unique codes | **Partial** | `clinical-service.ts`, `PatientsPage`; date-filter coverage missing (AT-C02) |
| 3.2 | Patient profile: counts, timeline, history tabs, balances | **Partial** | `getPatientProfile`; timeline merge assertions missing (AT-C04) |
| 3.3 | Visits: create, finalise, amend, immutable history | **Done** | `clinical.test.ts` |
| 3.4 | Dental chart (FDI, per-tooth entries tied to visits, history) | **Done** (service) | `clinical.test.ts`, `dental-ids-csv.test.ts`; on-screen interaction still to be reviewed in the E2E pass |
| 3.5 | Appointments with the full status set and rescheduling | **Done** | `clinical.test.ts` |
| 3.6 | Queue with priority, reorder and persistence | **Done** (ordering) | `clinical.test.ts`; restart-persistence assertion missing |
| 3.7 | Prescriptions: structured C/C, O/E, R/E, advice; multi-medicine rows; draft/final; void | **Done** (service) | `clinical.test.ts`; the screen rewrite against the real channels is the next UI task (see §7) |
| 3.8 | Referrals | **Done** | `clinical.test.ts` |
| 3.9 | Treatment catalogue and clinical option lists | **Partial** | Repositories + services implemented; CRUD integration test missing (AT-E01) |
| 3.10 | Attachments with safe file handling | **Partial** | `billing-service.attachFile` (path traversal, size limits) is used by the stress run; the validation assertions are missing (AT-E07) |

## 4. Billing and money

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 4.1 | Integer-minor-unit money everywhere | **Done** | `shared/money.ts` (+`fromDecimalString`); `money.test.ts` |
| 4.2 | Invoices: items, discounts, tax, round-off, void | **Done** | `billing.test.ts` |
| 4.3 | Payments: all methods, references, advances, void, patient balance | **Done** | `billing.test.ts` |
| 4.4 | Payment dashboard defaulting to today | **Partial** | Implemented; per-method totals assertion missing (AT-D03) |
| 4.5 | Accounting: invoiced revenue vs received cash, expenses, cash flow | **Done** | `billing.test.ts` |
| 4.6 | Financial reports from real transactions | **Open** | Reports service exists; acceptance assertions and CSV export checks missing (AT-D08) |
| 4.7 | Inventory: batches, expiry, low stock, immutable ledger | **Partial** | `billing.test.ts` (stock, issue, low stock, over-issue); expiry notification path missing |

## 5. Printing and PDF

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 5.1 | Prescription print layout with blank signature area ≥25 mm | **Partial** | `printing/documents.ts` builds the document; a unit test for the clearance and the “nothing below the signature” rule is missing (AT-D05) |
| 5.2 | Invoice print header limited to clinic name/logo/address/phone, no signature footer | **Partial** | Implemented; assertion missing |
| 5.3 | Preview window (`#/print/{jobId}`), print, save as PDF via `printToPDF` | **Done** (code) | `printing/print-host.ts`, `PrintDocumentView`; PDF fidelity has never been executed (no Electron in the sandbox) → AT-D06 |
| 5.4 | Paper sizes A4/A5/thermal 58/80 mm, printer profiles | **Partial** | `shared/printing/paper.ts` + profiles; the print matrix run is pending (AT-D07) |

## 6. Data safety

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 6.1 | Manual backup (manifest, checksums, config, attachments, README) | **Done** | `backup-audit.test.ts`; `scripts/verify-backup.mjs` verified a real backup and detected tampering |
| 6.2 | Automatic backup schedule and retention | **Done** | `backup-audit.test.ts` |
| 6.3 | Restore with pre-restore backup, verification and rollback | **Done** | `backup-audit.test.ts` |
| 6.4 | Data export / destructive data management | **Open** | Service exists (`exportData`, destructive actions); acceptance assertions missing (AT-E06) |

## 7. Interface

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 7.1 | App shell: header (notifications, lock, user menu), collapsible sidebar with four groups | **Done** (code) | `app/Shell.tsx`, `app/routes.tsx`; E2E assertions written, first run pending |
| 7.2 | Design system, balanced grids, reusable modal/drawer | **Done** (code) | `components/ui.tsx`, `styles/design-system.css`; component tests missing (AT-G02) |
| 7.3 | Empty / loading / error states on every list | **Partial** | Present per screen; not systematically asserted |
| 7.4 | Unsaved-changes warnings | **Partial** | Implemented in the form screens; not asserted |
| 7.5 | Keyboard shortcuts and global search | **Partial** | Implemented; shortcut E2E missing (AT-G04) |
| 7.6 | Prescriptions screen against the real channels | **Open** | The staged rewrite was discarded for using non-existent channels; the rewrite is the immediate UI task |
| 7.7 | Responsive 1366×768 → 4K, 100–200 % DPI | **Partial** | Layout uses relative units; DPI verification pending (AT-G06) |
| 7.8 | Accessibility pass (focus, ARIA, labels, contrast) | **Partial** | Semantic markup and focus handling exist; audit pending (AT-G05) |

## 8. Quality gates and delivery

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 8.1 | Unit tests | **Done** (first batch) | 48 tests across money, date, ids, dental, csv. Remaining: password, permissions, printing, validation, errors |
| 8.2 | Integration tests over the real service layer | **Done** (first batch) | 46 tests: setup/auth, clinical, billing, backup/audit |
| 8.3 | End-to-end acceptance suite | **Pending (written)** | `tests/e2e/*` runs on windows-latest; the job is gated on the `DENTIVA_ACTIVATION_CODE` secret, so it has not executed yet |
| 8.4 | Stress dataset and measured performance | **Done** | `scripts/seed-stress-data.mjs`, `docs/testing/PERFORMANCE_MEASUREMENTS.md` |
| 8.5 | Dependency and licence audit + notices | **Done** | `npm run audit:deps`, `npm run licenses`; CI checks freshness |
| 8.6 | CI pipeline (lint, types, tests, build, tools, E2E) | **Partial** | `.github/workflows/ci.yml` runs on GitHub: the lint/types/unit/build job and the maintenance-tools job are green. The integration and E2E jobs fail on purpose until the `DENTIVA_ACTIVATION_CODE` repository secret is added |
| 8.7 | Windows installer build | **Pending** | `release.yml` + `npm run verify:installer`; requires windows-latest |
| 8.8 | Clean-machine install / uninstall / data-preservation test | **Pending** | Checklist in `docs/release/` to be completed with evidence |
| 8.9 | Release readiness document | **Pending** | `docs/release/RELEASE_READINESS.md` |
| 8.10 | 14 pre-release audits (master §113) | **Pending** | Each audit is tracked in the acceptance checklist and the readiness document |
| 8.11 | User guide | **Done** | `docs/user-guide/USER_GUIDE.html` (shipped in the installer) |
| 8.12 | Acceptance checklist with per-requirement status | **Done** | `docs/testing/ACCEPTANCE_TEST_CHECKLIST.md` (honest status: 25 pass / 6 written / 31 open) |

---

## Next actions, in order

1. **Prescriptions screen rewrite** against the real channels (`prescriptions.list|get|create|update|void`,
   `patients.lookup`, `clinical.options`, `print.build` → `print.job` → `#/print/{jobId}`).
2. **Unit-test batches**: password/session/activation, permission resolution, printing (paper + signature
   clearance), validation schemas, error shapes.
3. **Integration coverage** for the open items in groups C, E and F (treatments, staff/users, settings,
   attachments, notifications, data export, migration fixture, crash recovery).
4. **Push and watch CI**: first real run of lint/types/tests/build/tools/E2E, then fix anything it finds.
5. **Windows packaging**: run `release.yml`, verify the installer, install/uninstall on a clean Windows
   machine, collect evidence.
6. **Print matrix and DPI evidence** on Windows, then the **14 audits** and `RELEASE_READINESS.md`.

## Definition of done for a feature

A feature is only Done when: it is implemented in the service layer (not only the screen), it enforces
permissions there, it writes audit entries where the specification requires it, it has an executed test
covering the happy path **and** at least one refusal path, it appears in the acceptance checklist with
honest status, and the build, lint and type checks are green.
