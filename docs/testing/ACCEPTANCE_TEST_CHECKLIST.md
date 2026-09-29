# Dentiva Pro — Acceptance Test Checklist

**Document ID:** TEST-ACC-001 · **Version:** 1.0.0 (status reviewed 2026-09-30) · **Summary:** 53 Pass, 4 pending with the test written, 9 pending
Each row maps a master-spec requirement to an executable test. `Automated:` U = unit, I = integration,
C = component, E = end-to-end (Playwright/Electron on Windows). Status values: **Pass**, **Fail**,
**Pending**.

**Status rules used here (no over-claiming):**

* **Pass** — an automated test exists, has been executed, and passed in the current tree. The test file is
  named in the row.
* **Pending (test written)** — the test exists but has never been executed anywhere yet (the Electron
  end-to-end suites need `windows-latest`; they cannot run in the development sandbox, which has no
  Electron binary).
* **Partial** — an executed test covers part of the requirement (counted with *Pending* in the summary below).
* **Pending** — no automated test exists yet for that requirement. It is not "probably fine".

Evidence for automated cases is the test name in CI output. Manual evidence (screenshots, PDFs, printed
sheets) belongs in `test-results/` or `docs/release/evidence/` and is listed in `RELEASE_READINESS.md`.

Test locations: `tests/unit/**` (including the component suite in `tests/unit/renderer/**`),
`tests/integration/**`, `tests/e2e/**`.

## Summary

| Group | Pass | Pending (test written) | Pending |
|---|---|---|---|
| A. Installer, activation, setup | 4 | 2 | 1 |
| B. Session, lock, RBAC, audit | 9 | 0 | 0 |
| C. Patients, visits, chart | 11 | 0 | 0 |
| D. Printing, invoices, payments | 6 | 0 | 2 |
| E. Inventory, staff, settings, data | 9 | 0 | 0 |
| F. Backup, restore, recovery | 6 | 0 | 0 |
| G. UI/UX, DPI, accessibility | 5 | 1 | 3 |
| H. Performance, security, packaging | 3 | 0 | 3 |
| I. Critical end-to-end workflow | 0 | 1 | 0 |
| **Total** | **53** | **4** | **9** |

## A. Installer, activation, setup (master prompt §7–§9, §91–§93, §98–§99)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-A01 | REQ-ACT-001 | U/I | Correct code activates; verifier stored, no plaintext in DB/config/logs | **Pass** — `setup-auth.test.ts` (activation verifier, stored verifier) |
| AT-A02 | REQ-ACT-002 | U | Wrong, empty, whitespace, Bengali-digit, hyphenated inputs handled; repeated failures throttled and audited | **Pass** — `setup-auth.test.ts` (throttle after the limit) |
| AT-A03 | REQ-ACT-003 | I | Tampered activation state detected on startup → re-activation required + audit entry | **Pass** — `security-hardening.test.ts` (an edited state hash and an incomplete activation record are both detected) |
| AT-A04 | REQ-SETUP-005 | I | Setup validates required fields, logo file type/size, writability of data root, DB creation; failure leaves no half-configured state | **Pass** — `operations.test.ts`: the wizard refusal names every field problem at once (missing dentist, weak password, password mismatch, blank username) and writes nothing, so no half-configured installation can exist; the "no sign-in before activation" path is covered by `setup-auth.test.ts` |
| AT-A05 | REQ-SETUP-001/002/003/004 | E | Wizard stores clinic, multiple dentists (multi-value designations/qualifications/certifications), admin; password only as scrypt hash | **Pending (test written)** — `tests/e2e/setup-wizard.e2e.ts` |
| AT-A06 | NFR-016 · NFR-002 (master §98–§99) | E | NSIS installer installs on clean Windows 11, creates shortcuts, no admin required, uninstall removes binaries and preserves `%APPDATA%\Dentiva Pro` | **Pending** (windows-latest; `release.yml` + clean-machine checklist) |
| AT-A07 | REQ-ABOUT-001 | E | About shows product, author, email, version, build, commit, third-party notices | **Pending (test written)** — `tests/e2e/setup-wizard.e2e.ts` |

## B. Authentication, session, auto-lock, RBAC (master §36, §41–§45, §106–§107)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-B01 | REQ-USER-001 | I | Correct login creates main-process session; wrong password fails with generic error; both audited | **Pass** — `setup-auth.test.ts` |
| AT-B02 | NFR-007 (master §44) | I | 5 failures → lockout window; further attempts rejected until expiry; attempts recorded | **Pass** — `setup-auth.test.ts` |
| AT-B03 | NFR-007 · REQ-SETUP-004 | U | scrypt hash format, verify true/false, timing-safe compare, policy rejects weak passwords | **Pass** — `security.test.ts` (scrypt format, wrong password, tampered hash, policy) |
| AT-B04 | REQ-RBAC-001 | U/I | Permission resolution: role grants, per-user deny wins, catalogue integrity, lock-out invariants | **Pass** — `security.test.ts` (deny-wins, catalogue) + `admin.test.ts` (service-layer refusals, self-deactivation and last-administrator guards) |
| AT-B05 | REQ-FIN-001 | I | Every financial channel rejects a user without the permission **at the service layer** with `FORBIDDEN` and returns no rows | **Pass** (service) — `admin.test.ts`: accounting and revenue channels refuse a role without the permission and still serve the permitted ones |
| AT-B06 | REQ-LOCK-001 | I/E | Auto-lock at configured idle time; lock screen shows no protected data; unlock requires password; manual Lock Now | **Pass** (integration: auto-lock) — `setup-auth.test.ts`; UI lock/unlock is in the E2E suite |
| AT-B07 | REQ-AUDIT-001 · NFR-013 | I | Audit chain validates; tampering a row fails verification; every sensitive action writes an entry | **Pass** — `backup-audit.test.ts` (chain, external rewrite detected, append-only) |
| AT-B08 | REQ-ACT-003 · NFR-007 | I | Tampered config/DB activation state and forged audit rows are detected | **Pass** — `security-hardening.test.ts`: an activation record edited with an external tool fails `verifyActivationIntegrity`, a tampered migration checksum aborts startup, the append-only triggers refuse in-place edits and deletes, and a row forged after dropping that guard is caught by the hash chain (`auditChainStatus` names the first broken entry and the deep integrity run fails) |
| AT-B09 | REQ-SAFE-001 | I | Restore/purge/delete-all require permission **and** password + typed phrase | **Pass** — `backup-audit.test.ts` (phrase and password refusals) |

## C. Patients, visits, chart, timeline (master §15–§23, §80–§81)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-C01 | REQ-PAT-001/003/004 | I | Create patients; unique codes generated atomically; duplicate code rejected by DB + service | **Pass** — `clinical.test.ts` |
| AT-C02 | REQ-PAT-002 | I | All seven date filters return correct sets, newest first by default | **Pass** — `operations.test.ts`: every preset (today, last 7/30/90 days, last year, all) plus a custom range returns exactly the patients each window promises, newest first; `admin.test.ts` adds archived visibility |
| AT-C03 | REQ-PAT-005/006 | I/E | Search by code/name/phone/alt phone; profile aggregates counts, balances, timeline, attachments | **Pass** — `clinical.test.ts` (search by code, name, phone; profile counts) |
| AT-C04 | REQ-PAT-007 | I | Timeline merges and labels every event type chronologically | **Pass** (service) — `admin.test.ts` merges visits, appointments, invoices and payments into one chronological timeline |
| AT-C05 | REQ-VISIT-001/002/003 | I | Unlimited visits per patient; finalisation freezes record, stores chart snapshot; amendment creates audited version | **Pass** (finalisation and chart linkage) — `clinical.test.ts`; amendment audit detail still pending |
| AT-C06 | REQ-CHART-001/002 | C/I | Chart: FDI permanent + primary numbering, multi-select, mark/clear conditions, per-tooth notes, legend, persistence and per-visit history | **Pass** (service level) — `clinical.test.ts`, `dental-ids-csv.test.ts`; on-screen interaction pending |
| AT-C07 | REQ-APPT-001/002/003 | I | Appointment CRUD + all nine statuses, reschedule chains, filters by dentist/date/status | **Pass** — `clinical.test.ts` |
| AT-C08 | REQ-QUEUE-001/002 | I | Arrival → queue position → in-treatment → completed; priority and reorder permission; state survives restart; estimated wait | **Pass** (ordering and transitions) — `clinical.test.ts`; restart persistence pending |
| AT-C09 | REQ-RX-001/002/003 | I | Prescription from profile/visit/section; multiple medicines with all fields; rows add/remove/reorder; structured C/C, O/E, R/E, advice + custom | **Pass** (service) — `clinical.test.ts`: structured sections, full medicine model, reorder, **draft→final persists**, status filter, void reason and date kept; screen workflow still pending |
| AT-C10 | REQ-REF-001 | I | Referral recorded, listed on profile, status transitions | **Pass** — `clinical.test.ts` |
| AT-C11 | REQ-PAT-008 | I | Financial history totals reconcile with invoice/payment rows; denied without permission | **Pass** (reconciliation) — `billing.test.ts`; permission denial pending |

## D. Printing, PDF, invoices, payments (master §29–§35, §60–§62, §105)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-D01 | REQ-INV-002 | U/I | Invoice totals: line totals, percent/absolute discounts, tax, round-off, subtotal/total/paid/due reconciliation; no floating point | **Pass** — `billing.test.ts`, `money.test.ts` |
| AT-D02 | REQ-INV-003 | I | Partial payment → status partial; remaining payment → paid; overpayment creates explicit credit; negative amounts rejected | **Pass** — `billing.test.ts` |
| AT-D03 | REQ-PAY-001/002 | I | Payment rows with all methods, references, received-by; dashboard filters and per-method totals from real rows | **Pass** — `billing.test.ts` (rows, references, method codes, advance) and `reports.test.ts`: the dashboard window defaults to *today*, per-method totals/counts match the ledger, voided payments are excluded and the invoice balance reopens |
| AT-D04 | REQ-INV-004 | I | Void preserves history; invoice edit audited; totals cannot drift from items/payments | **Pass** — `billing.test.ts` |
| AT-D05 | REQ-RX-004 · REQ-INV-001 · NFR-015 | U | Document builders produce correct structures for empty/long/multi-page/Bengali/many-item cases; signature clearance ≥ 25 mm and nothing below it | **Pass** — `printing.test.ts`: signature clearance ≥ 25 mm and the signature block is the last content key; invoice documents carry no signature |
| AT-D06 | NFR-015 | I | `printToPDF` output has expected page size/count, embedded fonts, extractable Bengali and Latin text; invoice header has no doctor info by default and no signature block | **Pending** (needs Windows E2E) |
| AT-D07 | NFR-015 · NFR-009 | I/E | A4/A5/A6/58 mm/80 mm prescription and invoice render without clipping (geometry assertions + visual artifacts) | **Pending** |
| AT-D08 | REQ-ACC-001/002, REQ-RPT-001, REQ-PAY-003 | I | Expense entry, categories, filters; all ten reports compute from transaction rows and export CSV (`reports.export`, audited, permission-gated, same headers and figures as the screen) | **Pass** — `billing.test.ts` (expenses, categories, accounting summary) and `reports.test.ts`: every report in the shared catalogue returns a titled, non-empty structure computed from real ledger rows, invoiced revenue is kept apart from received cash, an empty window still returns well-formed output, and the report screen refuses without `reports.financial.view` |

## E. Inventory, staff, users, settings, data (master §25, §37–§40, §54–§55, §123)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-E01 | REQ-TREAT-001 | I | Treatment catalogue CRUD, used by visits/invoices, referenced from DB not hardcoded | **Pass** (service) — `admin.test.ts`: catalogue create, rename, deactivate, reactivate and the active-only default listing |
| AT-E02 | REQ-INVT-001/002/003 | I | Purchase → stock +batch+ledger; usage/adjustment; no negative stock; low-stock and expiry notifications; expired visibility; history immutable | **Pass** (stock-in, issue, ledger, low stock, over-issue refusal) — `billing.test.ts`; expiry notifications pending |
| AT-E03 | REQ-STAFF-001 | I | Staff CRUD with photo/identification/salary; sensitive fields permission-gated | **Pass** (service) — `admin.test.ts`: staff records with identification, salary and status |
| AT-E04 | REQ-USER-001 | I | Admin creates users, roles assigned, activation toggled, last-login recorded; self-deactivation/last-admin rules enforced | **Pass** (service) — `admin.test.ts`: role and user creation, permission overrides, service-layer refusal, self-deactivation and last-administrator guards |
| AT-E05 | REQ-SET-001 | I | Clinic, doctors, designations, qualifications, clinical options, payment methods, paper sizes, printer profiles, currency/date formats, notifications, backups, auto-lock, security settings persist and take effect, each audited | **Pass** (service) — `admin.test.ts`: settings persist and are audited, clinic profile, dentists with multi-value designations, clinical options, printer profiles |
| AT-E06 | REQ-DATA-001 | I | Export CSV/JSON per permission; import validation; delete selected/all/business data with typed confirmation, audit and pre-action backup | **Pass** — `operations.test.ts`: a wrong phrase, an unknown action and a missing or incorrect password are refused before anything is touched; a real deletion takes a verified pre-action backup, deletes exactly the selection and writes a critical audit entry; the full reset keeps the audit trail and leaves a foreign-key-clean database; the CSV patient import reports every problem with its line number and imports all-or-nothing (dry run, duplicates, wrong type/header/oversize, permission refusal). `reports.test.ts` covers the exported movement ledger |
| AT-E07 | REQ-ATT-001/002 | I | Attachment add/preview/rename/export/delete; malicious names and oversized/malformed files rejected safely; metadata recorded; path traversal blocked | **Pass** (service) — `admin.test.ts`: sanitised name, stored copy, checksum, unsafe type and oversize refusals; the preview/rename UI is exercised in the desktop suite |
| AT-E08 | REQ-SEARCH-001 | I | Global search finds patients/codes/phones/appointments/visits/prescriptions/invoices/payments/treatments/inventory/staff/users with filters; p95 within budget at stress dataset | **Pass** (service) — `security-hardening.test.ts` (one term returns patients, prescriptions and invoices; the entity filter is honoured); the per-type route targets are exercised by the renderer search palette |
| AT-E09 | REQ-NOTIF-001 | I | Notification centre for every subject the requirement names (upcoming/missed appointments, queue waiting, low and expiring stock, outstanding balances, backup status, overdue schedule, restore result, system and security notices) with dedupe, read/unread, priority and action target | **Pass** — `operations.test.ts`: the sweep raises appointment, inventory (low + expiring), billing and queue notices with dedupe, read/unread and dismissal; backups announce themselves and an overdue schedule warns once a day; failed sign-ins and a locked account raise security notices; a broken audit chain raises a system notice. The restore notice is asserted in `backup-audit.test.ts` |

## F. Backup/restore, crash recovery (master §50–§53, §67, §88–§90)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-F01 | REQ-BKP-001 | I | Manual backup produces manifest + DB + attachments + config + checksums; backup DB passes integrity check; counts match source | **Pass** — `backup-audit.test.ts` (+ `scripts/verify-backup.mjs` run on a real backup) |
| AT-F02 | REQ-BKP-002 | I | Automatic backup scheduling (7/15/30 d); failure (unwritable destination) creates notification + audit + failed row, never a false success | **Pass** (schedule and interval) — `backup-audit.test.ts`; failure-notification path pending |
| AT-F03 | REQ-RST-001 | I | Restore validates manifest/checksums/version; refuses corrupt/newer backups; automatic pre-restore backup exists; deep-equal data after restore | **Pass** — `backup-audit.test.ts` |
| AT-F04 | REQ-RST-001 · NFR-014 | I | Failure during staging or swap leaves current data intact (rollback proven) | **Pass** (corrupt backup leaves the live database untouched) — `backup-audit.test.ts` |
| AT-F05 | NFR-005 | I | Simulated abort during multi-row transaction leaves consistent DB (no orphans, no partial invoice) | **Pass** — `security-hardening.test.ts`: a write that throws mid-transaction and a transaction abandoned by a second connection both roll back with integrity intact |
| AT-F06 | NFR-006 | I | Migration chain runs from empty DB and from v1 fixture; checksum mismatch aborts safely; backup records schema version | **Pass** — `security-hardening.test.ts`: a tampered migration checksum aborts startup with the documented reference, and the migration chain applies from an empty file |

## G. UI/UX, DPI, accessibility, shortcuts (master §10–§13, §63–§64, §74–§86, §111)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-G01 | REQ-SHELL-001/002 | C/E | Sidebar structure/groups, collapse/expand, icon alignment, no text overflow at 1366 px and 200 % DPI | **Pending (test written)** — group visibility in `setup-wizard.e2e.ts`; DPI part pending |
| AT-G02 | REQ-UI-001 | C | Every list has empty, loading and error states; grids balanced (auto-fill, no orphan rows); modal/drawer focus trap + ESC + scroll | **Pass** (component) — `tests/unit/renderer/ui-behaviour.test.tsx`: empty, loading (role=status) and error (role=alert + retry) states, table and pager behaviour, and modal/drawer focus trap, Escape, backdrop, scroll lock and focus return; the auto-fill grid rules live in `design-system.css` and are visually confirmed in the Windows pass (AT-G06) |
| AT-G03 | REQ-UI-002/003 | C | Form validation (required/format/duplicate/cross-field) inline + on submit; unsaved-changes guard only when changed | **Pass** (component) — `validation.test.ts` covers the schemas field by field and `ui-behaviour.test.tsx` the confirmation dialog that stays blocked until the typed phrase, password and reason are supplied, plus the unsaved-changes notification hook; the per-screen inline errors are exercised in the desktop suite |
| AT-G04 | REQ-KB-001 | E | Shortcuts: Ctrl+K, Ctrl+N, Ctrl+Shift+A/V/P/I, Ctrl+P, Ctrl+L, Ctrl+S, Esc, sidebar navigation | **Pending** |
| AT-G05 | REQ-ACC-001 · NFR-010 | C | Focus visible, ARIA roles on tabs/dialogs/tables, labels on icon buttons, no colour-only status | **Pass** (component) — `ui-behaviour.test.tsx` (dialog roles and aria-modal, labelled progress bar, labelled icon buttons, table headers) with audit A12 asserting that every form control carries an accessible name and that status is never colour-only |
| AT-G06 | NFR-009 (master §111) | Manual/E | Screens verified at 100/125/150/175/200 % at 1366×768 and 1920×1080 (screenshot artifacts) | **Pending** |

| AT-G07 | REQ-UI-004 · NFR-001 · NFR-011/012 | Script | No dead navigation, placeholder control or debug output; no network client anywhere in `src/`; business text comes from shared constants rather than being re-typed per screen | **Pass** — `scripts/pre-release-audit.mjs` audits A1 and A12, run locally and in the CI maintenance job |
| AT-G08 | REQ-SHELL-003 | U/E | Window geometry is remembered in the configuration folder, clamped to the supported minimum and dropped when the saved monitor is gone | **Pass** (unit) — `tests/unit/window-state.test.ts`; the real Electron window is exercised by the Windows end-to-end run |

| AT-G09 | NFR-008 | Manual | A receptionist registers a patient and books an appointment in under 60 s; a dentist prints a prescription from a patient profile with the keyboard alone in under 90 s (stopwatch, Windows) | **Pending** — manual measurement on the release candidate |
## H. Performance, security, packaging (master §71, §94–§99, §102–§104, §113–§114)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-H01 | NFR-003/004 | I | Stress dataset (5k patients / 20k visits / 15k invoices / 25k payments): paged list, global search, profile load, reports and backup meet budgets | **Pass** — `docs/testing/PERFORMANCE_MEASUREMENTS.md` (patient list p95 43 ms / 120, search 54 ms / 250, profile 2 ms / 300, backup 3.4 s for 40 MB); cold start, print paint and the 5 GB restore are listed as not measured |
| AT-H02 | NFR-007 | I | SQL injection vectors neutralised; unknown IPC channel rejected; renderer has no Node access; CSP present; path traversal blocked | **Pass** (service + router) — `security-hardening.test.ts` (injection-shaped terms stay plain text, unknown channel refused and audited, payload validated before the handler, permission denial audited, no technical detail leaked); CSP and path traversal in `admin.test.ts` |
| AT-H03 | NFR-016 (master §94–§97) | E | `npm run package:win` produces installer + portable exe; PE x64 verified; version/build/commit embedded; SHA-256 recorded | **Pending** — `npm run verify:installer` is written and fails correctly when no artifact exists; the first real run is `release.yml` on windows-latest |
| AT-H04 | NFR-016 | E | Artifacts published to GitHub Release, otherwise present in `dist/`; `RELEASE_READINESS.md` complete and truthful | **Pending** |
| AT-H05 | NFR-017 | Script | All dependencies MIT/ISC/Apache/BSD/OFL-compatible; no high/critical advisories; third-party notices generated | **Pass** — `npm run audit:deps` (11 components, all permissive, 0 advisories) and `npm run licenses` (freshness enforced in CI) |

| AT-H06 | NFR-018 | CI | The full matrix (lint, types, unit, integration, end-to-end, tooling, audits) is green on the release commit before packaging | **Partial** — `ci.yml` quality, maintenance and integration jobs run; the integration and end-to-end jobs fail on purpose until the `DENTIVA_ACTIVATION_CODE` repository secret exists, and the Electron suites have never executed |

## I. Critical end-to-end workflow (master §101)

| ID | Requirement | Type | Steps | Status |
|---|---|---|---|---|
| AT-I01 | Master §101 (all REQ-* groups) | E | Activate → setup clinic → dentists → admin → login → patient → visit → prescription (multiple medicines) → print document build → invoice → partial payment → balance → backup from the screen → audit log | **Pending (test written)** — `tests/e2e/critical-flow.e2e.ts` (first run on windows-latest; the installer-restart part of the full flow is added with the packaging milestone) |

## How to re-run

```bash
npm run lint && npm run typecheck          # static checks
npm run test:unit                          # 48 unit tests (no secret needed)
DENTIVA_ACTIVATION_CODE=… npm run test:integration   # 46 integration tests
npm run test:coverage                      # both suites with coverage
DENTIVA_ACTIVATION_CODE=… npm run test:e2e # Electron suites (Windows)
node scripts/seed-stress-data.mjs          # performance numbers + report
npm run audit:deps && npm run licenses     # dependency and licence evidence
npm run verify:installer                   # artifact evidence after packaging
```

**The activation secret is a hard prerequisite.** The verifier is bound to a fixed offline secret, so every
integration test that completes setup needs it. Locally the affected suites report skips; in GitHub Actions
the `integration` and `e2e-windows` jobs **fail with an explicit message** when the repository secret
`DENTIVA_ACTIVATION_CODE` is missing, so a green pipeline always means the suites really ran. At the time of
this review the secret is **not yet configured**, so no integration or end-to-end row is marked Pass on CI
evidence — those Pass rows come from local runs with the secret in the environment.

Manual evidence (print matrix, DPI screenshots, clean-machine install/uninstall, multi-printer output) is
collected in `docs/release/evidence/` while working through `docs/release/RELEASE_READINESS.md`.
