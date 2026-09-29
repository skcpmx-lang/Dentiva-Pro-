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
| 1.4 | Versioned migrations with checksums | **Partial** | `src/main/db/migrations.ts` (5 migrations); `security-hardening.test.ts` covers the full chain on an empty file, the append-only guard and a checksum mismatch refusing to start. A committed v1-file upgrade fixture is still missing |
| 1.5 | Immutable audit log (hash chain, append-only triggers) | **Done** | migrations 0003 triggers + `db/integrity.ts`; `backup-audit.test.ts` |
| 1.6 | Service container + IPC registry/router with payload validation | **Done** | `ipc/registry.ts` (≈140 channels), `ipc/router.ts`; integration tests exercise them through the harness |
| 1.7 | Restore-safe re-wiring (`reopenDb`, `rebuildContainer`) | **Done** | `src/main/index.ts`; `backup-audit.test.ts` restores and continues |
| 1.8 | Logging with rotation and no secrets | **Partial** | `src/main/logging/logger.ts`; audit A6 asserts the redaction list and that no application file logs to a console — a runtime redaction assertion is still missing |
| 1.9 | Crash recovery | **Partial** | `security-hardening.test.ts` proves a thrown mid-transaction write and a transaction abandoned by a second connection both roll back with integrity intact; a real process-kill test is still missing |

## 2. Setup, activation, security

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 2.1 | Setup wizard (activation → clinic → dentists → administrator) | **Done** | `features/setup/SetupWizard.tsx`; `setup-auth.test.ts` covers the service layer; UI in `setup-wizard.e2e.ts` (first Windows run pending) |
| 2.2 | Activation code verified by derived verifier (no plaintext) | **Done** | PBKDF2 verifier in `security/activation.ts`; `setup-auth.test.ts`; the code is absent from `src/` and `docs/` |
| 2.3 | Activation throttling and audit | **Done** | 10 attempts / 60 s cooldown; `setup-auth.test.ts` |
| 2.4 | Passwords: scrypt (N=2¹⁵, r=8, p=1), policy ≥10 chars, 5-failure lockout | **Done** | `security.test.ts` (stored parameters, unique salts, wrong/tampered/unknown-scheme refusals, policy) and `setup-auth.test.ts` (lockout window) |
| 2.5 | Session: auto-lock 5/10/15/30, Lock Now, unlock by password | **Done** | `security/session.ts`; `setup-auth.test.ts` (auto-lock) |
| 2.6 | RBAC: role grants, per-user deny wins, last-admin guard, enforcement in services | **Done** | `security.test.ts` (order-independent deny resolution) and `admin.test.ts` + `security-hardening.test.ts` (service- and router-level refusals, lock-out guard for the last administrator **and** the last account manager) |
| 2.7 | Destructive-action safeguards (typed phrase + password + pre-action backup) | **Done** | `admin-service.ts` (`RESTORE BACKUP`); `backup-audit.test.ts` |

## 3. Clinical

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 3.1 | Patients: register, search, filters, archive/restore, unique codes | **Done** (service) | `clinical.test.ts` (codes, archive) and `admin.test.ts` (custom range, archived hidden unless asked); the screen itself is reviewed in the E2E pass |
| 3.2 | Patient profile: counts, timeline, history tabs, balances | **Done** (service) | `admin.test.ts` merges visits, appointments, invoices and payments into one timeline; on-screen tabs are reviewed in the E2E pass |
| 3.3 | Visits: create, finalise, amend, immutable history | **Done** | `clinical.test.ts` |
| 3.4 | Dental chart (FDI, per-tooth entries tied to visits, history) | **Done** (service) | `clinical.test.ts`, `dental-ids-csv.test.ts`; on-screen interaction still to be reviewed in the E2E pass |
| 3.5 | Appointments with the full status set and rescheduling | **Done** | `clinical.test.ts` |
| 3.6 | Queue with priority, reorder and persistence | **Done** (ordering) | `clinical.test.ts`; restart-persistence assertion missing |
| 3.7 | Prescriptions: structured C/C, O/E, R/E, advice; multi-medicine rows; draft/final; void | **Done** (service) | `clinical.test.ts`: full medicine model, reorder, draft→final, status filter, void reason/date; the screen runs on the same channels |
| 3.8 | Referrals | **Done** | `clinical.test.ts` |
| 3.9 | Treatment catalogue and clinical option lists | **Done** | `admin.test.ts` (catalogue create/rename/deactivate/reactivate, clinical options added and retired) |
| 3.10 | Attachments with safe file handling | **Done** (service) | `admin.test.ts` (checksum, sanitised name, stored copy inside the data folder, disallowed type and oversized file refused) |

## 4. Billing and money

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 4.1 | Integer-minor-unit money everywhere | **Done** | `shared/money.ts` (+`fromDecimalString`); `money.test.ts` |
| 4.2 | Invoices: items, discounts, tax, round-off, void | **Done** | `billing.test.ts` |
| 4.3 | Payments: all methods, references, advances, void, patient balance | **Done** | `billing.test.ts` |
| 4.4 | Payment dashboard defaulting to today | **Done** | `reports.test.ts` (defaults to today, per-method totals, voided payments excluded and the invoice balance reopened) |
| 4.5 | Accounting: invoiced revenue vs received cash, expenses, cash flow | **Done** | `billing.test.ts` |
| 4.6 | Financial reports from real transactions | **Done** | `reports.test.ts` exercises all ten catalogue reports against real ledger rows (invoiced revenue separated from received cash, empty window still well-formed, permission refusal) and exports one to CSV through the real channel (`security-hardening.test.ts`); the generic CSV/JSON export path is asserted in `admin.test.ts` |
| 4.7 | Inventory: batches, expiry, low stock, immutable ledger | **Done** | `billing.test.ts` (stock, issue, low stock, over-issue, immutable ledger); the sweep raises both the low-stock and the expiring-batch notices with dedupe (`operations.test.ts`) |

## 5. Printing and PDF

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 5.1 | Prescription print layout with blank signature area ≥25 mm | **Done** | `printing.test.ts` asserts the clearance and that the signature block is the last content key (AT-D05); page rendering is a desktop test |
| 5.2 | Invoice print header limited to clinic name/logo/address/phone, no signature footer | **Partial** | Implemented; assertion missing |
| 5.3 | Preview window (`#/print/{jobId}`), print, save as PDF via `printToPDF` | **Done** (code) | `printing/print-host.ts`, `PrintDocumentView`; PDF fidelity has never been executed (no Electron in the sandbox) → AT-D06 |
| 5.4 | Paper sizes A4/A5/thermal 58/80 mm, printer profiles | **Partial** | `shared/printing/paper.ts` + profiles; the print matrix run is pending (AT-D07) |

## 6. Data safety

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 6.1 | Manual backup (manifest, checksums, config, attachments, README) | **Done** | `backup-audit.test.ts`; `scripts/verify-backup.mjs` verified a real backup and detected tampering |
| 6.2 | Automatic backup schedule and retention | **Done** | `backup-audit.test.ts` |
| 6.3 | Restore with pre-restore backup, verification and rollback | **Done** | `backup-audit.test.ts` |
| 6.4 | Data export / destructive data management | **Done** | `admin.test.ts` (CSV/JSON export, permission refusal), `reports.test.ts` (report CSV), `operations.test.ts` (typed phrase + password + verified pre-action backup, full reset that keeps the audit trail, CSV patient import with dry run, duplicates, per-row errors and refusals) |

## 7. Interface

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| 7.1 | App shell: header (notifications, lock, user menu), collapsible sidebar with four groups | **Done** (code) | `app/Shell.tsx`, `app/routes.tsx`; E2E assertions written, first run pending |
| 7.2 | Design system, balanced grids, reusable modal/drawer | **Done** (code) | `components/ui.tsx`, `styles/design-system.css`; component tests missing (AT-G02) |
| 7.3 | Empty / loading / error states on every list | **Partial** | Present per screen; not systematically asserted |
| 7.4 | Unsaved-changes warnings | **Partial** | Implemented in the form screens; not asserted |
| 7.5 | Keyboard shortcuts and global search | **Partial** | Implemented; shortcut E2E missing (AT-G04) |
| 7.6 | Prescriptions screen against the real channels | **Done** | Screen uses `prescriptions.*`, `patients.lookup`, `clinical.options` and `print.build`/`print.job`; exercised through the real router in the preview harness (create → finalise → print build → void) |
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
| 8.9 | Release readiness document | **Done** | `docs/release/RELEASE_READINESS.md` — verdict, gate table, pending Windows evidence, and the documented deviations (mobile out of scope, activation limitation, DPI/uninstall evidence outstanding) |
| 8.10 | 14 pre-release audits (master §113) | **Done** | `npm run audit:prerelease` (12 pass, the two Windows-only audits report a reasoned skip), wired into the CI maintenance job and the release workflow; the requirements traceability matrix is regenerated and freshness-checked |
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
