# Dentiva Pro — Acceptance Test Checklist

**Document ID:** TEST-ACC-001 · **Version:** 1.0.0
Each row maps a master-spec requirement to an executable test. `Automated:` U = unit, I = integration,
C = component, E = end-to-end (Playwright/Electron on Windows). Status values: **Pass**, **Fail**, **Pending**.
Evidence for automated cases is the test id in CI output; for manual cases, screenshots/PDF artifacts in
`test-results/` or `docs/release/evidence/`.

Legend of test-file locations: `tests/unit/**`, `tests/integration/**`, `tests/e2e/**`.

## A. Installer, activation, setup (master prompt §7–§9, §91–§93, §98–§99)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-A01 | REQ-ACT-001 | U/I | Correct code activates; verifier stored, no plaintext in DB/config/logs | Pass |
| AT-A02 | REQ-ACT-002 | U | Wrong, empty, whitespace, Bengali-digit, hyphenated inputs handled; repeated failures throttled and audited | Pass |
| AT-A03 | REQ-ACT-003 | I | Tampered activation state detected on startup → re-activation required + audit entry | Pass |
| AT-A04 | REQ-SETUP-005 | I | Setup validates required fields, logo file type/size, writability of data root, DB creation; failure leaves no half-configured state | Pass |
| AT-A05 | REQ-SETUP-002/003/004 | E | Wizard stores clinic, multiple dentists (multi-value designations/qualifications/certifications), admin; password only as scrypt hash | Pass |
| AT-A06 | Installer | E | NSIS installer installs on clean Windows 11, creates shortcuts, no admin required, uninstall removes binaries and preserves `%APPDATA%\Dentiva Pro` | Pending (CI windows-latest) |
| AT-A07 | REQ-ABOUT-001 | E | About shows product, author, email, version, build, commit, third-party notices | Pass |

## B. Authentication, session, auto-lock, RBAC (master §36, §41–§45, §106–§107)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-B01 | Login | I | Correct login creates main-process session; wrong password fails with generic error; both audited | Pass |
| AT-B02 | Lockout | I | 5 failures → lockout window; further attempts rejected until expiry; attempts recorded | Pass |
| AT-B03 | Password hashing | U | scrypt hash format, verify true/false, timing-safe compare, policy rejects weak passwords | Pass |
| AT-B04 | REQ-RBAC-001 | U/I | Permission resolution: role grants, per-user deny wins, catalogue integrity, lock-out invariants | Pass |
| AT-B05 | REQ-FIN-001 | I | Every financial channel rejects a user without the permission **at the service layer** with `FORBIDDEN` and returns no rows | Pass |
| AT-B06 | REQ-LOCK-001 | I/E | Auto-lock at configured idle time; lock screen shows no protected data; unlock requires password; manual Lock Now | Pass |
| AT-B07 | REQ-AUDIT-001 | I | Audit chain validates; tampering a row fails verification; every sensitive action writes an entry | Pass |
| AT-B08 | Brute force / tamper | I | Tampered config/DB activation state and forged audit rows are detected | Pass |
| AT-B09 | Destructive re-auth | I | Restore/purge/delete-all require permission **and** password + typed phrase | Pass |

## C. Patients, visits, chart, timeline (master §15–§23, §80–§81)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-C01 | REQ-PAT-001/004 | I | Create patients; unique codes generated atomically; duplicate code rejected by DB + service | Pass |
| AT-C02 | REQ-PAT-002 | I | All seven date filters return correct sets, newest first by default | Pass |
| AT-C03 | REQ-PAT-005/006 | I/E | Search by code/name/phone/alt phone; profile aggregates counts, balances, timeline, attachments | Pass |
| AT-C04 | REQ-PAT-007 | I | Timeline merges and labels every event type chronologically | Pass |
| AT-C05 | REQ-VISIT-001/002/003 | I | Unlimited visits per patient; finalisation freezes record, stores chart snapshot; amendment creates audited version | Pass |
| AT-C06 | REQ-CHART-001/002 | C/I | Chart: FDI permanent + primary numbering, multi-select, mark/clear conditions, per-tooth notes, legend, persistence and per-visit history | Pass |
| AT-C07 | REQ-APPT-001/002/003 | I | Appointment CRUD + all nine statuses, reschedule chains, filters by dentist/date/status | Pass |
| AT-C08 | REQ-QUEUE-001/002 | I | Arrival → queue position → in-treatment → completed; priority and reorder permission; state survives restart; estimated wait | Pass |
| AT-C09 | REQ-RX-001/002/003 | I | Prescription from profile/visit/section; multiple medicines with all fields; rows add/remove/reorder; structured C/C, O/E, R/E, advice + custom | Pass |
| AT-C10 | REQ-REF-001 | I | Referral recorded, listed on profile, status transitions | Pass |
| AT-C11 | REQ-PAT-008 | I | Financial history totals reconcile with invoice/payment rows; denied without permission | Pass |

## D. Printing, PDF, invoices, payments (master §29–§35, §60–§62, §105)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-D01 | REQ-INV-002 | U/I | Invoice totals: line totals, percent/absolute discounts, tax, round-off, subtotal/total/paid/due reconciliation; no floating point | Pass |
| AT-D02 | REQ-INV-003 | I | Partial payment → status partial; remaining payment → paid; overpayment creates explicit credit; negative amounts rejected | Pass |
| AT-D03 | REQ-PAY-001/002 | I | Payment rows with all methods, references, received-by; dashboard filters and per-method totals from real rows | Pass |
| AT-D04 | REQ-INV-004 | I | Void preserves history; invoice edit audited; totals cannot drift from items/payments | Pass |
| AT-D05 | Print model | U | Document builders produce correct structures for empty/long/multi-page/Bengali/many-item cases; signature clearance ≥ 25 mm and nothing below it | Pass |
| AT-D06 | PDF fidelity | I | `printToPDF` output has expected page size/count, embedded fonts, extractable Bengali and Latin text; invoice header has no doctor info by default and no signature block | Pass |
| AT-D07 | Print matrix | I/E | A4/A5/A6/58 mm/80 mm prescription and invoice render without clipping (geometry assertions + visual artifacts) | Pass |
| AT-D08 | REQ-ACC-001/002, REQ-RPT-001 | I | Expense entry, categories, filters; all ten reports compute from transaction rows and export CSV | Pass |

## E. Inventory, staff, users, settings, data (master §25, §37–§40, §54–§55, §123)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-E01 | REQ-TREAT-001 | I | Treatment catalogue CRUD, used by visits/invoices, referenced from DB not hardcoded | Pass |
| AT-E02 | REQ-INVT-001/002/003 | I | Purchase → stock +batch+ledger; usage/adjustment; no negative stock; low-stock and expiry notifications; expired visibility; history immutable | Pass |
| AT-E03 | REQ-STAFF-001 | I | Staff CRUD with photo/identification/salary; sensitive fields permission-gated | Pass |
| AT-E04 | REQ-USER-001 | I | Admin creates users, roles assigned, activation toggled, last-login recorded; self-deactivation/last-admin rules enforced | Pass |
| AT-E05 | REQ-SET-001 | I | Clinic, doctors, designations, qualifications, clinical options, payment methods, paper sizes, printer profiles, currency/date formats, notifications, backups, auto-lock, security settings persist and take effect, each audited | Pass |
| AT-E06 | REQ-DATA-001 | I | Export CSV/JSON per permission; import validation; delete selected/all/business data with typed confirmation, audit and pre-action backup | Pass |
| AT-E07 | REQ-ATT-001/002 | I | Attachment add/preview/rename/export/delete; malicious names and oversized/malformed files rejected safely; metadata recorded; path traversal blocked | Pass |
| AT-E08 | REQ-SEARCH-001 | I | Global search finds patients/codes/phones/appointments/visits/prescriptions/invoices/payments/treatments/inventory/staff/users with filters; p95 within budget at stress dataset | Pass |
| AT-E09 | REQ-NOTIF-001 | I | Notifications for the nine categories with dedupe, read/unread, priority, action target | Pass |

## F. Backup/restore, crash recovery (master §50–§53, §67, §88–§90)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-F01 | REQ-BKP-001 | I | Manual backup produces manifest + DB + attachments + config + checksums; backup DB passes integrity check; counts match source | Pass |
| AT-F02 | REQ-BKP-002 | I | Automatic backup scheduling (7/15/30 d); failure (unwritable destination) creates notification + audit + failed row, never a false success | Pass |
| AT-F03 | REQ-RST-001 | I | Restore validates manifest/checksums/version; refuses corrupt/newer backups; automatic pre-restore backup exists; deep-equal data after restore | Pass |
| AT-F04 | Restore failure | I | Failure during staging or swap leaves current data intact (rollback proven) | Pass |
| AT-F05 | Crash recovery | I | Simulated abort during multi-row transaction leaves consistent DB (no orphans, no partial invoice) | Pass |
| AT-F06 | Migrations | I | Migration chain runs from empty DB and from v1 fixture; checksum mismatch aborts safely; backup records schema version | Pass |

## G. UI/UX, DPI, accessibility, shortcuts (master §10–§13, §63–§64, §74–§86, §111)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-G01 | REQ-SHELL-002 | C/E | Sidebar structure/groups, collapse/expand, icon alignment, no text overflow at 1366 px and 200 % DPI | Pass |
| AT-G02 | REQ-UI-001 | C | Every list has empty, loading and error states; grids balanced (auto-fill, no orphan rows); modal/drawer focus trap + ESC + scroll | Pass |
| AT-G03 | REQ-UI-002/003 | C | Form validation (required/format/duplicate/cross-field) inline + on submit; unsaved-changes guard only when changed | Pass |
| AT-G04 | Keyboard | E | Shortcuts: Ctrl+K search, Ctrl+N patient, Ctrl+Shift+A appointment, Ctrl+Shift+V visit, Ctrl+Shift+P prescription, Ctrl+Shift+I invoice, Ctrl+P print, Ctrl+L lock, Ctrl+S save, Esc close, sidebar navigation | Pass |
| AT-G05 | Accessibility | C | Focus visible, ARIA roles on tabs/dialogs/tables, labels on icon buttons, no colour-only status | Pass |
| AT-G06 | DPI/responsive | Manual/E | Screens verified at 100/125/150/175/200 % at 1366×768 and 1920×1080 (screenshot artifacts) | Pending (Windows E2E) |

## H. Performance, security, packaging (master §71, §94–§99, §102–§104, §113–§114)

| ID | Requirement | Type | Steps / assertion | Status |
|---|---|---|---|---|
| AT-H01 | NFR-003/004 | I | Stress dataset (5k patients / 20k visits / 15k invoices / 25k payments): paged list, global search, profile load, reports and backup meet budgets | Pass |
| AT-H02 | NFR-007 | I | SQL injection vectors neutralised; unknown IPC channel rejected; renderer has no Node access; CSP present; path traversal blocked | Pass |
| AT-H03 | Packaging | E | `npm run package:win` produces installer + portable exe; PE x64 verified; version/build/commit embedded; SHA-256 recorded | Pending (CI windows-latest) |
| AT-H04 | Release | E | Artifacts published to GitHub Release, otherwise present in `dist/`; `RELEASE_READINESS.md` complete and truthful | Pending |
| AT-H05 | Dependency audit | Script | All dependencies MIT/ISC/Apache/BSD/OFL-compatible; no high/critical advisories; third-party notices generated | Pass |

## I. Critical end-to-end workflow (master §101)

| ID | Requirement | Type | Steps | Status |
|---|---|---|---|---|
| AT-I01 | Full workflow | E | Install → activate → setup clinic → create dentists → admin → staff user → login → patient → profile → visit → mark teeth → prescription (multiple medicines) → preview/print/PDF → appointment → treatment → invoice → partial payment → remaining payment → patient financial history → inventory add/consume → expense → reports → attachment → global search → lock/unlock → backup → restore → audit log → restart → verify data | Pending (Windows E2E) |
