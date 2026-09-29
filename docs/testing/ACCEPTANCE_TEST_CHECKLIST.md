# Dentiva Pro — Acceptance Test Checklist

**Document ID:** TEST-ACC-001 · **Version:** 1.0.0 (status reviewed 2026-09-29)
Each row maps a master-spec requirement to an executable test. `Automated:` U = unit, I = integration,
C = component, E = end-to-end (Playwright/Electron on Windows). Status values: **Pass**, **Fail**,
**Pending**.

**Status rules used here (no over-claiming):**

* **Pass** — an automated test exists, has been executed, and passed in the current tree. The test file is
  named in the row.
* **Pending (test written)** — the test exists but has never been executed anywhere yet (the Electron
  end-to-end suites need `windows-latest`; they cannot run in the development sandbox, which has no
  Electron binary).
* **Pending** — no automated test exists yet for that requirement. It is not "probably fine".

Evidence for automated cases is the test name in CI output. Manual evidence (screenshots, PDFs, printed
sheets) belongs in `test-results/` or `docs/release/evidence/` and is listed in `RELEASE_READINESS.md`.

Test locations: `tests/unit/**`, `tests/integration/**`, `tests/e2e/**`.

## Summary

| Group | Pass | Pending (test written) | Pending |
|---|---|---|---|
| A. Installer, activation, setup | 2 | 2 | 3 |
| B. Session, lock, RBAC, audit | 4 | 1 | 4 |
| C. Patients, visits, chart | 8 | 0 | 3 |
| D. Printing, invoices, payments | 4 | 0 | 4 |
| E. Inventory, staff, settings, data | 1 | 0 | 8 |
| F. Backup, restore, recovery | 4 | 0 | 2 |
| G. UI/UX, DPI, accessibility | 0 | 1 | 5 |
| H. Performance, security, packaging | 2 | 1 | 2 |
| I. Critical end-to-end workflow | 0 | 1 | 0 |
| **Total** | **25** | **6** | **31** |

## A. Installer, activation, setup (master prompt §7–§9, §91–§93, §98–§99)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-A01 | REQ-ACT-001 | U/I | Correct code activates; verifier stored, no plaintext in DB/config/logs | **Pass** — `setup-auth.test.ts` (activation verifier, stored verifier) |
| AT-A02 | REQ-ACT-002 | U | Wrong, empty, whitespace, Bengali-digit, hyphenated inputs handled; repeated failures throttled and audited | **Pass** — `setup-auth.test.ts` (throttle after the limit) |
| AT-A03 | REQ-ACT-003 | I | Tampered activation state detected on startup → re-activation required + audit entry | **Pending** |
| AT-A04 | REQ-SETUP-005 | I | Setup validates required fields, logo file type/size, writability of data root, DB creation; failure leaves no half-configured state | **Pending** (only the “no account before activation” path is covered) |
| AT-A05 | REQ-SETUP-002/003/004 | E | Wizard stores clinic, multiple dentists (multi-value designations/qualifications/certifications), admin; password only as scrypt hash | **Pending (test written)** — `tests/e2e/setup-wizard.e2e.ts` |
| AT-A06 | Installer | E | NSIS installer installs on clean Windows 11, creates shortcuts, no admin required, uninstall removes binaries and preserves `%APPDATA%\Dentiva Pro` | **Pending** (windows-latest; `release.yml` + clean-machine checklist) |
| AT-A07 | REQ-ABOUT-001 | E | About shows product, author, email, version, build, commit, third-party notices | **Pending (test written)** — `tests/e2e/setup-wizard.e2e.ts` |

## B. Authentication, session, auto-lock, RBAC (master §36, §41–§45, §106–§107)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-B01 | Login | I | Correct login creates main-process session; wrong password fails with generic error; both audited | **Pass** — `setup-auth.test.ts` |
| AT-B02 | Lockout | I | 5 failures → lockout window; further attempts rejected until expiry; attempts recorded | **Pass** — `setup-auth.test.ts` |
| AT-B03 | Password hashing | U | scrypt hash format, verify true/false, timing-safe compare, policy rejects weak passwords | **Pending** (unit test not written yet) |
| AT-B04 | REQ-RBAC-001 | U/I | Permission resolution: role grants, per-user deny wins, catalogue integrity, lock-out invariants | **Pending** (only catalogue/role seeding is covered today) |
| AT-B05 | REQ-FIN-001 | I | Every financial channel rejects a user without the permission **at the service layer** with `FORBIDDEN` and returns no rows | **Pending** |
| AT-B06 | REQ-LOCK-001 | I/E | Auto-lock at configured idle time; lock screen shows no protected data; unlock requires password; manual Lock Now | **Pass** (integration: auto-lock) — `setup-auth.test.ts`; UI lock/unlock is in the E2E suite |
| AT-B07 | REQ-AUDIT-001 | I | Audit chain validates; tampering a row fails verification; every sensitive action writes an entry | **Pass** — `backup-audit.test.ts` (chain, external rewrite detected, append-only) |
| AT-B08 | Brute force / tamper | I | Tampered config/DB activation state and forged audit rows are detected | **Pending** (audit tamper is covered; activation-state tamper is not) |
| AT-B09 | Destructive re-auth | I | Restore/purge/delete-all require permission **and** password + typed phrase | **Pass** — `backup-audit.test.ts` (phrase and password refusals) |

## C. Patients, visits, chart, timeline (master §15–§23, §80–§81)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-C01 | REQ-PAT-001/004 | I | Create patients; unique codes generated atomically; duplicate code rejected by DB + service | **Pass** — `clinical.test.ts` |
| AT-C02 | REQ-PAT-002 | I | All seven date filters return correct sets, newest first by default | **Pending** |
| AT-C03 | REQ-PAT-005/006 | I/E | Search by code/name/phone/alt phone; profile aggregates counts, balances, timeline, attachments | **Pass** — `clinical.test.ts` (search by code, name, phone; profile counts) |
| AT-C04 | REQ-PAT-007 | I | Timeline merges and labels every event type chronologically | **Pending** |
| AT-C05 | REQ-VISIT-001/002/003 | I | Unlimited visits per patient; finalisation freezes record, stores chart snapshot; amendment creates audited version | **Pass** (finalisation and chart linkage) — `clinical.test.ts`; amendment audit detail still pending |
| AT-C06 | REQ-CHART-001/002 | C/I | Chart: FDI permanent + primary numbering, multi-select, mark/clear conditions, per-tooth notes, legend, persistence and per-visit history | **Pass** (service level) — `clinical.test.ts`, `dental-ids-csv.test.ts`; on-screen interaction pending |
| AT-C07 | REQ-APPT-001/002/003 | I | Appointment CRUD + all nine statuses, reschedule chains, filters by dentist/date/status | **Pass** — `clinical.test.ts` |
| AT-C08 | REQ-QUEUE-001/002 | I | Arrival → queue position → in-treatment → completed; priority and reorder permission; state survives restart; estimated wait | **Pass** (ordering and transitions) — `clinical.test.ts`; restart persistence pending |
| AT-C09 | REQ-RX-001/002/003 | I | Prescription from profile/visit/section; multiple medicines with all fields; rows add/remove/reorder; structured C/C, O/E, R/E, advice + custom | **Pass** (service) — `clinical.test.ts`; screen reorder/UX pending |
| AT-C10 | REQ-REF-001 | I | Referral recorded, listed on profile, status transitions | **Pass** — `clinical.test.ts` |
| AT-C11 | REQ-PAT-008 | I | Financial history totals reconcile with invoice/payment rows; denied without permission | **Pass** (reconciliation) — `billing.test.ts`; permission denial pending |

## D. Printing, PDF, invoices, payments (master §29–§35, §60–§62, §105)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-D01 | REQ-INV-002 | U/I | Invoice totals: line totals, percent/absolute discounts, tax, round-off, subtotal/total/paid/due reconciliation; no floating point | **Pass** — `billing.test.ts`, `money.test.ts` |
| AT-D02 | REQ-INV-003 | I | Partial payment → status partial; remaining payment → paid; overpayment creates explicit credit; negative amounts rejected | **Pass** — `billing.test.ts` |
| AT-D03 | REQ-PAY-001/002 | I | Payment rows with all methods, references, received-by; dashboard filters and per-method totals from real rows | **Pass** (rows, references, advance) — `billing.test.ts`; per-method dashboard totals pending |
| AT-D04 | REQ-INV-004 | I | Void preserves history; invoice edit audited; totals cannot drift from items/payments | **Pass** — `billing.test.ts` |
| AT-D05 | Print model | U | Document builders produce correct structures for empty/long/multi-page/Bengali/many-item cases; signature clearance ≥ 25 mm and nothing below it | **Pending** |
| AT-D06 | PDF fidelity | I | `printToPDF` output has expected page size/count, embedded fonts, extractable Bengali and Latin text; invoice header has no doctor info by default and no signature block | **Pending** (needs Windows E2E) |
| AT-D07 | Print matrix | I/E | A4/A5/A6/58 mm/80 mm prescription and invoice render without clipping (geometry assertions + visual artifacts) | **Pending** |
| AT-D08 | REQ-ACC-001/002, REQ-RPT-001 | I | Expense entry, categories, filters; all ten reports compute from transaction rows and export CSV | **Pass** (expenses, accounting summary) — `billing.test.ts`; the ten reports pending |

## E. Inventory, staff, users, settings, data (master §25, §37–§40, §54–§55, §123)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-E01 | REQ-TREAT-001 | I | Treatment catalogue CRUD, used by visits/invoices, referenced from DB not hardcoded | **Pending** |
| AT-E02 | REQ-INVT-001/002/003 | I | Purchase → stock +batch+ledger; usage/adjustment; no negative stock; low-stock and expiry notifications; expired visibility; history immutable | **Pass** (stock-in, issue, ledger, low stock, over-issue refusal) — `billing.test.ts`; expiry notifications pending |
| AT-E03 | REQ-STAFF-001 | I | Staff CRUD with photo/identification/salary; sensitive fields permission-gated | **Pending** |
| AT-E04 | REQ-USER-001 | I | Admin creates users, roles assigned, activation toggled, last-login recorded; self-deactivation/last-admin rules enforced | **Pending** |
| AT-E05 | REQ-SET-001 | I | Clinic, doctors, designations, qualifications, clinical options, payment methods, paper sizes, printer profiles, currency/date formats, notifications, backups, auto-lock, security settings persist and take effect, each audited | **Pending** |
| AT-E06 | REQ-DATA-001 | I | Export CSV/JSON per permission; import validation; delete selected/all/business data with typed confirmation, audit and pre-action backup | **Pending** |
| AT-E07 | REQ-ATT-001/002 | I | Attachment add/preview/rename/export/delete; malicious names and oversized/malformed files rejected safely; metadata recorded; path traversal blocked | **Pending** (attachments are created in the stress run; validation is not yet asserted) |
| AT-E08 | REQ-SEARCH-001 | I | Global search finds patients/codes/phones/appointments/visits/prescriptions/invoices/payments/treatments/inventory/staff/users with filters; p95 within budget at stress dataset | **Pending** (patient search is covered and timed; the other entity types are not asserted) |
| AT-E09 | REQ-NOTIF-001 | I | Notifications for the nine categories with dedupe, read/unread, priority, action target | **Pending** |

## F. Backup/restore, crash recovery (master §50–§53, §67, §88–§90)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-F01 | REQ-BKP-001 | I | Manual backup produces manifest + DB + attachments + config + checksums; backup DB passes integrity check; counts match source | **Pass** — `backup-audit.test.ts` (+ `scripts/verify-backup.mjs` run on a real backup) |
| AT-F02 | REQ-BKP-002 | I | Automatic backup scheduling (7/15/30 d); failure (unwritable destination) creates notification + audit + failed row, never a false success | **Pass** (schedule and interval) — `backup-audit.test.ts`; failure-notification path pending |
| AT-F03 | REQ-RST-001 | I | Restore validates manifest/checksums/version; refuses corrupt/newer backups; automatic pre-restore backup exists; deep-equal data after restore | **Pass** — `backup-audit.test.ts` |
| AT-F04 | Restore failure | I | Failure during staging or swap leaves current data intact (rollback proven) | **Pass** (corrupt backup leaves the live database untouched) — `backup-audit.test.ts` |
| AT-F05 | Crash recovery | I | Simulated abort during multi-row transaction leaves consistent DB (no orphans, no partial invoice) | **Pending** |
| AT-F06 | Migrations | I | Migration chain runs from empty DB and from v1 fixture; checksum mismatch aborts safely; backup records schema version | **Pending** (empty-DB chain runs in every integration test; the v1 fixture and checksum mismatch do not) |

## G. UI/UX, DPI, accessibility, shortcuts (master §10–§13, §63–§64, §74–§86, §111)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-G01 | REQ-SHELL-002 | C/E | Sidebar structure/groups, collapse/expand, icon alignment, no text overflow at 1366 px and 200 % DPI | **Pending (test written)** — group visibility in `setup-wizard.e2e.ts`; DPI part pending |
| AT-G02 | REQ-UI-001 | C | Every list has empty, loading and error states; grids balanced (auto-fill, no orphan rows); modal/drawer focus trap + ESC + scroll | **Pending** |
| AT-G03 | REQ-UI-002/003 | C | Form validation (required/format/duplicate/cross-field) inline + on submit; unsaved-changes guard only when changed | **Pending** |
| AT-G04 | Keyboard | E | Shortcuts: Ctrl+K, Ctrl+N, Ctrl+Shift+A/V/P/I, Ctrl+P, Ctrl+L, Ctrl+S, Esc, sidebar navigation | **Pending** |
| AT-G05 | Accessibility | C | Focus visible, ARIA roles on tabs/dialogs/tables, labels on icon buttons, no colour-only status | **Pending** |
| AT-G06 | DPI/responsive | Manual/E | Screens verified at 100/125/150/175/200 % at 1366×768 and 1920×1080 (screenshot artifacts) | **Pending** |

## H. Performance, security, packaging (master §71, §94–§99, §102–§104, §113–§114)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-H01 | NFR-003/004 | I | Stress dataset (5k patients / 20k visits / 15k invoices / 25k payments): paged list, global search, profile load, reports and backup meet budgets | **Pass** — `docs/testing/PERFORMANCE_MEASUREMENTS.md` (patient list p95 43 ms / 120, search 54 ms / 250, profile 2 ms / 300, backup 3.4 s for 40 MB); cold start, print paint and the 5 GB restore are listed as not measured |
| AT-H02 | NFR-007 | I | SQL injection vectors neutralised; unknown IPC channel rejected; renderer has no Node access; CSP present; path traversal blocked | **Pending** |
| AT-H03 | Packaging | E | `npm run package:win` produces installer + portable exe; PE x64 verified; version/build/commit embedded; SHA-256 recorded | **Pending** — `npm run verify:installer` is written and fails correctly when no artifact exists; the first real run is `release.yml` on windows-latest |
| AT-H04 | Release | E | Artifacts published to GitHub Release, otherwise present in `dist/`; `RELEASE_READINESS.md` complete and truthful | **Pending** |
| AT-H05 | Dependency audit | Script | All dependencies MIT/ISC/Apache/BSD/OFL-compatible; no high/critical advisories; third-party notices generated | **Pass** — `npm run audit:deps` (11 components, all permissive, 0 advisories) and `npm run licenses` (freshness enforced in CI) |

## I. Critical end-to-end workflow (master §101)

| ID | Requirement | Type | Steps | Status |
|---|---|---|---|---|
| AT-I01 | Full workflow | E | Activate → setup clinic → dentists → admin → login → patient → visit → prescription (multiple medicines) → print document build → invoice → partial payment → balance → backup from the screen → audit log | **Pending (test written)** — `tests/e2e/critical-flow.e2e.ts` (first run on windows-latest; the installer-restart part of the full flow is added with the packaging milestone) |

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
