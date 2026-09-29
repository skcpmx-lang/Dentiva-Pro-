# Dentiva Pro — Functional Requirements (normative requirement IDs)

Every requirement below is traced to implementation and tests in
`docs/requirements/REQUIREMENT_TRACEABILITY.md` and verified in
`docs/testing/ACCEPTANCE_TEST_CHECKLIST.md`. IDs are stable and referenced by code comments, tests and the
project state files.

## Setup, activation, shell

| ID | Requirement |
|---|---|
| REQ-ACT-001 | The application requires a one-time offline activation code; the code is verified without network access and never stored/compared as plaintext (see ADR-0004). |
| REQ-ACT-002 | Activation handles correct, incorrect, empty, whitespace, Bengali-digit and repeated-attempt inputs; throttling and audit entries are produced. |
| REQ-ACT-003 | Local activation state is tamper-evident; manual edits are detected and re-activation is requested with an audit entry. |
| REQ-SETUP-001 | First launch shows a multi-step setup wizard: activation → clinic → dentist(s) → administrator → data location → summary. |
| REQ-SETUP-002 | Clinic step captures name, logo, address, phone(s), email, extra info, footer message; currency defaults to BDT (৳) and is shown as such. |
| REQ-SETUP-003 | Dentist step captures full name, multiple designations, multiple qualifications, multiple certifications, registration info, phone, email, active state, optional signature image; multiple dentists supported. |
| REQ-SETUP-004 | Administrator step validates username uniqueness, password strength, confirmation match; password is stored only as a scrypt hash. |
| REQ-SETUP-005 | Setup validates required fields, image files, directory permissions/writability, storage paths, and database creation; errors are specific; back/next preserves entered data; cancellation is safe; the app is never left half-configured. |
| REQ-SHELL-001 | Header shows product name, clinic name, current date, logged-in user, notifications, user menu, lock, quick actions. |
| REQ-SHELL-002 | Sidebar contains Practice (Dashboard, Patients, Appointments, Queue), Clinical (Treatments, Prescriptions), Billing (Invoice, Payments, Inventory, Accounting), Administration (Staff & Users, Backup & Restore, Settings, About); it is collapsible, usable when collapsed, with correct icon/text alignment and no text overflow. |
| REQ-SHELL-003 | Window behaviour: maximise/restore/resize/minimise, DPI changes, multi-monitor movement, remembered bounds validated to remain on-screen. |

## Patients and clinical records

| ID | Requirement |
|---|---|
| REQ-PAT-001 | Unlimited patients (no artificial caps); list sorted newest-first by default. |
| REQ-PAT-002 | Date filters: Today, Last 7 days, Last 30 days, Last 90 days, Last 1 year, Custom range, All. |
| REQ-PAT-003 | Fields: patient code, full name (+ Bengali), age/dob, gender, blood group, address, phone, emergency contact, current complaint, past problems, notes, created/updated metadata (user + timestamps), plus occupation, allergies, medical history, dental history. |
| REQ-PAT-004 | Unique patient code generated atomically with configurable prefix; duplicates prevented at DB and service level. |
| REQ-PAT-005 | Search by code, name (English/Bengali), phone, alternate phone, national id. |
| REQ-PAT-006 | Patient profile: demographics, contacts, medical/dental notes, dental chart, clinical timeline, visits, appointments, treatments, prescriptions, invoices, payments, outstanding balance, referrals, attachments, notes, audit info; unlimited history. |
| REQ-PAT-007 | Chronological timeline distinguishes registration, visits, diagnoses, treatments, prescriptions, appointments, invoices, payments, referrals, attachments and notes. |
| REQ-PAT-008 | Patient financial history: total invoiced, total paid, current due, payment history with methods and dates, settlement history — RBAC-gated. |
| REQ-VISIT-001 | Unlimited visits per patient; each visit is a separate immutable historical record (with controlled, audited amendment). |
| REQ-VISIT-002 | Visit captures date/time, dentist, chief complaint, symptoms, examination, assessment/diagnosis, treatment performed, prescription link, advice, dental chart state, follow-up, referral, notes, invoice/payment links, attachments. |
| REQ-VISIT-003 | New Visit flow available from the patient profile; finalisation freezes the record and stores a dental-chart snapshot. |
| REQ-CHART-001 | Interactive dental chart: adult (FDI permanent) and pediatric (FDI primary) dentitions, individual and multi-tooth selection, condition/treatment marking, surfaces, per-tooth notes, visual legend. |
| REQ-CHART-002 | Chart is genuinely interactive (selection, marking, clearing), with historical per-visit snapshots and current-state persistence. |
| REQ-APPT-001 | Appointment scheduling from patient profile with date, time, dentist, type, reason, notes, status. |
| REQ-APPT-002 | Statuses: Scheduled, Confirmed, Arrived, In Queue, In Treatment, Completed, Cancelled, No-show, Rescheduled. |
| REQ-APPT-003 | Appointment list views: upcoming, today, past, completed, no-show, cancelled, rescheduled; actions: new, edit, reschedule, cancel, mark arrived/completed/no-show; filters: search, dentist, date range. |
| REQ-QUEUE-001 | Real queue: today's queue, arrival, position, dentist assignment, waiting/in-treatment/completed statuses, priority, permission-gated reordering, estimated wait. |
| REQ-QUEUE-002 | Queue state persists across restarts. |
| REQ-TREAT-001 | Treatment catalogue (name, category, description, default fee, duration, active state, notes) used by visits, invoices and reports; not hardcoded in UI. |
| REQ-RX-001 | Prescriptions can be created from patient profile, from a visit, and from the Prescriptions section. |
| REQ-RX-002 | Multiple medicines per prescription; each with name, type, strength, dose, morning/noon/night, before/after food, duration, quantity, additional instruction, conditional instruction and custom instruction; rows can be added, removed and reordered. |
| REQ-RX-003 | Structured clinical sections: C/C, O/E, R/E, Advice with selectable common options plus custom entries; all editable in Settings. |
| REQ-RX-004 | Print/PDF layout as specified in `docs/printing/PRINT_SYSTEM.md` §4 including signature clearance rule. |
| REQ-REF-001 | Referral management: patient, date, referring dentist, referred-to doctor, institution, reason, notes, status, follow-up; shown in the profile. |

## Billing, payments, inventory, accounting

| ID | Requirement |
|---|---|
| REQ-INV-001 | Invoice header contains clinic name, logo, address, phone only (doctor info only if configured); no footer signature section. |
| REQ-INV-002 | Invoice body: invoice number, patient info, date, line items (treatment/service, quantity, unit price, discount), tax/adjustment if configured, subtotal, total, paid, due, payment status. |
| REQ-INV-003 | Full, partial and unpaid states supported; overpayment handled explicitly as a credit (never silently). |
| REQ-INV-004 | Invoices are editable while unpaid/partial with audit; voiding preserves history; totals always reconcile with line items and payments. |
| REQ-PAY-001 | Payments record amount, date/time, patient, invoice, method (Cash, Bank, Card, bKash, Nagad, Rocket, Upay, Other), reference, received-by, notes. |
| REQ-PAY-002 | Payment dashboard defaults to today with filters (Today, 7/30/90 days, 1 year, custom, all) and shows totals per method, outstanding, and the transaction list. |
| REQ-PAY-003 | All financial totals are computed from real transaction rows. |
| REQ-FIN-001 | Financial data is protected in the business layer (not only by hidden UI); unauthorized retrieval returns no data. |
| REQ-INVT-001 | Inventory items with name, category, supplier, purchase date, quantities, unit, purchase/sell price, batch number, expiry, minimum stock, location, notes. |
| REQ-INVT-002 | Stock in, adjustment, usage, history, low-stock alerts, expiry alerts and expired-stock visibility; history is never silently deleted. |
| REQ-INVT-003 | Stock may not go negative; every movement writes an immutable ledger row and keeps the cached quantity consistent. |
| REQ-ACC-001 | Expenses with category, date, amount, payment method, paid-to, reference, description, notes; income/expense distinction from invoice revenue is explicit. |
| REQ-ACC-002 | Accounting lists support category/date filters, totals and reports. |
| REQ-RPT-001 | Reports: daily income, expense summary, net cash flow, outstanding dues, payment-method breakdown, treatment revenue, invoice summary, expense categories, inventory purchases, period reports — all from real transactions, exportable to CSV/PDF where permitted. |

## Administration and system

| ID | Requirement |
|---|---|
| REQ-STAFF-001 | Staff records: name, age, address, blood group, identification number, photo, phone, position, department, salary, joining date, status, notes; sensitive fields are permission-gated. |
| REQ-USER-001 | Multiple users with username, secure password, display name, role, active state, last login, created date and permissions; admin can create/edit/deactivate users. |
| REQ-RBAC-001 | Granular RBAC per `docs/security/RBAC_SPECIFICATION.md`, including per-user allow/deny overrides and lock-out invariants. |
| REQ-LOCK-001 | Auto-lock after 5/10/15/30 minutes of inactivity (configurable), manual "Lock Now", password to resume, no protected data on the lock screen, unsaved work preserved where feasible. |
| REQ-AUDIT-001 | Immutable, hash-chained audit log of the actions listed in `docs/security/SECURITY_SPECIFICATION.md` §5 with timestamp, user, action, entity, id, summary, before/after, app version; the log is protected and verifiable. |
| REQ-ATT-001 | Attachments on the patient profile: add, preview, open, export, rename, delete (permission-gated), metadata (date, uploader, size, type, sha256); invalid files handled safely without crashes. |
| REQ-ATT-002 | Managed storage layout with validated relative paths, sanitised names, size/type limits and no path traversal. |
| REQ-SEARCH-001 | Global search across patients, codes, phones, appointments, visits, prescriptions, invoices, payments, treatments, inventory, staff and users with partial/exact matching, entity-type filter, status and date-range filters; performant on large datasets. |
| REQ-NOTIF-001 | Notification centre with upcoming/missed appointments, low stock, expiring stock, outstanding balances, backup status, restore warnings, system and security notices; read/unread, timestamp, category, priority and action. |
| REQ-BKP-001 | Manual and automatic backups (7/15/30 days) to a user-selected folder, timestamped folder names, integrity-verified, containing database + attachments + configuration. |
| REQ-BKP-002 | Automatic backup failures are surfaced (notification, audit, status), never silent. |
| REQ-RST-001 | Restore from one or many backups with inspection, validation, version compatibility checks, automatic pre-restore backup, atomic swap, post-restore verification and safe rollback on failure. |
| REQ-SAFE-001 | Destructive actions (delete patient, delete records, delete all data, reset database, restore) require permission, warning, explicit confirmation, typed phrase for irreversible operations, password re-authentication, audit entry and pre-action backup where applicable. |
| REQ-SET-001 | Comprehensive settings: clinic info, logo, doctors, designations, qualifications, prescription/invoice/print settings, printer profiles, paper sizes, currency, number/date formats, language-related settings, clinical option lists, treatment catalogue, payment methods, inventory settings, notifications, backups, auto-lock, users/roles, security, data management, destructive data controls. |
| REQ-DATA-001 | Data management: export (CSV/JSON/PDF where appropriate), import where safe, backup, restore, safe cleanup, delete selected records, delete all records, delete business data — all permission-gated and audited. |
| REQ-ABOUT-001 | About page identifies Dentiva Pro, author Shohan Khan, email helloiamshohan@gmail.com, version, build number, commit, copyright, third-party notices and licence information. |
| REQ-KB-001 | Keyboard shortcuts: global search, new patient/appointment/visit/prescription/invoice, print, lock, save, cancel, close modal, sidebar navigation; discoverable in a shortcut panel. |
| REQ-UI-001 | Design system per `docs/ux/DESIGN_SYSTEM.md`: reusable components, tokens, states (loading/empty/error/success), transitions that never block work, responsive grids without orphans, no overflowing widgets. |
| REQ-UI-002 | Forms validate required/length/format/numeric/date/phone/duplicate/cross-field rules inline and on submit. |
| REQ-UI-003 | Unsaved-changes warnings before losing data; no interruption when nothing changed. |
| REQ-UI-004 | No dead navigation, no fake controls: every visible control performs a real, persisted action. |
