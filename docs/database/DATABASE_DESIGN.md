# Dentiva Pro — Database Design

**Document ID:** DB-001 · **Version:** 1.0.0 · **Status:** Approved
**Engine:** SQLite 3.53 (bundled with better-sqlite3 13, N-API) · **File:** `<DataRoot>/Database/dentiva.db`

---

## 1. Conventions

* **Money:** `INTEGER` poisha (`_poisha` suffix). 1 BDT = 100 poisha. Never floating point (ADR-0002).
* **Quantities:** `INTEGER` milli-units (`_milli` suffix) where fractional values are possible.
* **Dates:** civil dates as `TEXT 'YYYY-MM-DD'` (local clinic date, unambiguous, sortable).
  **Timestamps:** `TEXT 'YYYY-MM-DD HH:MM:SS'` in local time **plus** an integer `*_epoch_ms` where
  ordering across DST/clock changes matters (audit, payments). ISO-8601-with-offset is stored for
  interchange fields (`created_at_iso`).
* **Soft delete:** clinical and financial records are never hard-deleted; `deleted_at` / `voided_at`
  with reason columns and audit rows instead.
* **Foreign keys:** `PRAGMA foreign_keys = ON` for every connection. Deletes are restricted by default.
* **Timestamps audit columns:** `created_at`, `created_by`, `updated_at`, `updated_by` on mutable
  business tables.
* **Everything is paged at the repository level** (`LIMIT/OFFSET` with deterministic `ORDER BY`), so no
  table is ever fully loaded into memory.
* **Connection PRAGMAs:** `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`,
  `busy_timeout=8000`, `temp_store=MEMORY`, `cache_size=-16000`, `wal_autocheckpoint=512`,
  `trusted_schema=OFF`, `recursive_triggers=OFF`.

---

## 2. Entity overview

```
users ─┬─< user_permissions >── permissions ──< role_permissions >── roles
       └─< audit_log (actor)

patients ─┬─< visits ─┬─< visit_treatments >── treatment_catalog
          │           ├─< visit_chart_snapshots
          │           └─< referrals
          ├─< dental_chart_entries (current + historical per visit)
          ├─< prescriptions ──< prescription_items
          ├─< appointments ──< queue_entries
          ├─< invoices ──< invoice_items ──(treatment_catalog | inventory_items)
          │        └─< payments
          ├─< attachments            (also linkable to visits/payments/expenses)
          ├─< patient_notes
          └─< notifications (entity reference)

dentists ─< dentist_designations | dentist_qualifications | dentist_certifications | dentist_schedules
staff | suppliers | inventory_items ──< inventory_batches ──< inventory_transactions
expense_categories ──< expenses
clinical_options | dental_conditions | payment_methods   (system defaults, admin-editable)
printer_profiles | backups | settings | clinic_profile | app_meta | counters
```

---

## 3. Table catalogue (54 tables)

### 3.1 Platform

| Table | Purpose / key columns | Constraints & indexes |
|---|---|---|
| `schema_migrations` | `version PK, name, checksum, applied_at, duration_ms` | append-only, checked at startup |
| `app_meta` | `key PK, value, updated_at` — install id, activation state, data format version, first run, last startup, last backup, integrity report | singleton keys |
| `counters` | `name PK, value` — patient code, invoice no, receipt no, expense no, visit no sequences | updated inside the owning transaction |
| `settings` | `key PK, value_json, category, updated_at, updated_by` | typed accessors in `SettingsService` |
| `clinic_profile` | singleton row: name, `name_bn`, logo_path, address, phone1/2, email, website, footer_quote, invoice footer, currency, patient/invoice prefixes, registration no | `CHECK(id = 1)` |
| `notifications` | category, priority, title, body, entity refs, `dedupe_key UNIQUE`, read_at, dismissed_at | index `(read_at, created_at)` |
| `backups` | file_name, path, size_bytes, sha256, trigger, status, app_version, schema_version, data_format_version, includes_attachments, error_message | index `(created_at DESC)` |
| `printer_profiles` | name, document_type, printer_name, paper_size, custom dims, orientation, margins_json, scale, copies, thermal_json, is_default | unique `(document_type, name)`; one default per document type (partial unique index) |

### 3.2 Identity, security, audit

| Table | Purpose / key columns | Constraints & indexes |
|---|---|---|
| `users` | username, display_name, `password_hash` (scrypt), role_id, is_active, must_change_password, failed_attempts, locked_until, last_login_at, + audit cols | `username UNIQUE COLLATE NOCASE`, `CHECK(length(username) >= 3)`, FK role `ON DELETE RESTRICT` |
| `roles` | code UNIQUE, name, description, is_system | system roles cannot be deleted |
| `permissions` | code UNIQUE, module, action, description | seeded from the code-level catalog (single source of truth) |
| `role_permissions` | `(role_id, permission_id) PK` | cascade on role delete |
| `user_permissions` | `(user_id, permission_id) PK`, `effect ('allow'|'deny')` | deny wins over role |
| `login_attempts` | username, success, reason, attempted_at, attempt_epoch_ms | index `(username, attempt_epoch_ms DESC)`; brute-force throttling |
| `audit_log` | at, `at_epoch_ms`, actor_user_id, actor_username, action, entity_type, entity_id, summary, before_json, after_json, severity, app_version, `hash`, `prev_hash` | append-only; index `(at_epoch_ms DESC)`, `(entity_type, entity_id)`, `(action)`; `hash` verified by chain |

### 3.3 Clinical master data

| Table | Purpose / key columns |
|---|---|
| `dentists` | full_name, phone, email, signature_path, is_active, sort_order, notes |
| `dentist_designations` / `dentist_qualifications` / `dentist_certifications` | `(dentist_id, value, sort_order)` — multiple values per dentist (REQ §8) |
| `dentist_schedules` | `(dentist_id, weekday, start_time, end_time)` — consultation timing for prescription footer |
| `treatment_catalog` | code UNIQUE, name, `name_bn`, category, description, default_fee_poisha, duration_minutes, is_active, is_system_default |
| `clinical_options` | list_code, value, `value_bn`, sort_order, is_active, is_system_default — C/C, O/E, advice, medicine types, instructions, duration units, appointment types, treatment categories |
| `dental_conditions` | code, name, colour, text_colour, category (condition/treatment/restoration), applies_to (permanent/primary/both), sort_order, is_active, is_system_default |
| `payment_methods` | code, name, `name_bn`, requires_reference, is_active, is_system_default, sort_order |
| `expense_categories` | code, name, `name_bn`, is_active, is_system_default |
| `suppliers` | name, contact_person, phone, email, address, notes, is_active |

### 3.4 Patients and clinical history

| Table | Purpose / key columns | Constraints & indexes |
|---|---|---|
| `patients` | code, full_name, `full_name_bn`, dob, age_years, sex, blood_group, phone, phone_alt, email, address, `address_bn`, city, occupation, marital_status, national_id, guardian_name, emergency_name/phone, chief_complaint, medical_history, dental_history, allergies, current_medications, notes, is_active, `deleted_at`, audit cols | `code UNIQUE`, indexes on `full_name`, `phone`, `phone_alt`, `(created_at DESC)`, `(deleted_at)` |
| `patient_notes` | patient_id, note, created_at, created_by | timeline feed |
| `visits` | patient_id, `visit_no` (per patient), visit_date, visit_time, dentist_id, appointment_id NULL, chief_complaint, symptoms, examination, diagnosis, treatment_summary, advice, follow_up_date, notes, status (`draft/final/amended`), finalized_at/by, `amendment_of_visit_id` | `UNIQUE(patient_id, visit_no)`; index `(patient_id, visit_date DESC)`, `(visit_date)`; previous visits never overwritten (REQ §19) |
| `visit_treatments` | visit_id, treatment_id, tooth_refs_json, fee_poisha, note | used for invoices and treatment-revenue reporting |
| `dental_chart_entries` | patient_id, visit_id NULL, tooth_number, dentition, condition_code, treatment_code, surfaces_json, status, note, audit cols | index `(patient_id, dentition, tooth_number)`; current chart = rows with `visit_id IS NULL`, per-visit history = rows with `visit_id` |
| `visit_chart_snapshots` | `visit_id PK`, snapshot_json, created_at | frozen chart state at visit finalisation (REQ §22) |
| `prescriptions` | patient_id, visit_id NULL, dentist_id, prescription_date, chief_complaints_json, on_examination_json, diagnosis (R/E), advice_json, follow_up_date, notes, status, printed_count, last_printed_at, audit cols | index `(patient_id, prescription_date DESC)`, `(prescription_date)` |
| `prescription_items` | prescription_id, sort_order, medicine_name, medicine_type, strength, dose, morning/noon/night, timing, duration_value, duration_unit, quantity, instruction, conditional_instruction, notes | `UNIQUE(prescription_id, sort_order)` |
| `referrals` | patient_id, visit_id NULL, referral_date, referring_dentist_id, referred_to_name, referred_to_institution, referred_to_phone, reason, notes, status, follow_up_date, outcome, audit cols | index `(patient_id, referral_date DESC)`, `(status)` |
| `appointments` | patient_id, dentist_id, appointment_date, start_time, end_time, type_code, reason, notes, status, rescheduled_from_id NULL, cancelled_reason, audit cols | index `(appointment_date, start_time)`, `(patient_id, appointment_date DESC)`, `(dentist_id, appointment_date)`; status CHECK in the 9 canonical states |
| `queue_entries` | patient_id, appointment_id NULL, dentist_id NULL, queue_date, position, priority, status, arrived_at, called_at, started_at, completed_at, notes, audit cols | `UNIQUE(queue_date, patient_id, status IN active set)` enforced in service; index `(queue_date, status, position)`; survives restart (REQ §24) |
| `attachments` | patient_id NULL, visit_id NULL, entity_type/entity_id, original_name, stored_path, mime_type, size_bytes, sha256, title, category, notes, uploaded_at/by, deleted_at/by | index `(patient_id, uploaded_at DESC)`, `(entity_type, entity_id)` |

### 3.5 Billing, payment, inventory, accounting

| Table | Purpose / key columns | Constraints |
|---|---|---|
| `invoices` | invoice_no UNIQUE, patient_id, visit_id NULL, invoice_date, due_date, subtotal_poisha, discount_poisha, discount_percent_x100, tax_poisha, round_off_poisha, total_poisha, paid_poisha, `balance_poisha GENERATED STORED AS (total_poisha - paid_poisha)`, status, notes, voided_at/by/reason, audit cols | `CHECK(total_poisha >= 0)`, `CHECK(paid_poisha >= 0)`, `CHECK(subtotal_poisha >= 0)`; indexes `(patient_id, invoice_date DESC)`, `(status)`, `(invoice_date)` |
| `invoice_items` | invoice_id, sort_order, item_type, treatment_id NULL, inventory_item_id NULL, description, quantity_milli, unit_price_poisha, discount_poisha, line_total_poisha, note | `CHECK(quantity_milli > 0)`, `CHECK(unit_price_poisha >= 0)`, `CHECK(line_total_poisha >= 0)` |
| `payments` | receipt_no UNIQUE, patient_id, invoice_id NULL, kind (payment/refund/advance), amount_poisha, method_code, reference_no, received_at, received_at_epoch_ms, received_by, notes, voided_at/by/reason, created_at/by | `CHECK(amount_poisha > 0)`; indexes `(received_at)`, `(patient_id, received_at DESC)`, `(invoice_id)`, `(method_code)` |
| `inventory_items` | code UNIQUE, name, category, supplier_id NULL, unit, quantity_milli, min_stock_milli, purchase_price_poisha, sell_price_poisha, location, is_active, notes, audit cols | `CHECK(quantity_milli >= 0)`, `CHECK(min_stock_milli >= 0)` |
| `inventory_batches` | item_id, batch_no, expiry_date, quantity_in_milli, quantity_remaining_milli, purchase_price_poisha, purchase_date, supplier_id NULL, invoice_ref | `CHECK(quantity_remaining_milli >= 0)`; index `(item_id, expiry_date)` |
| `inventory_transactions` | item_id, batch_id NULL, txn_type, quantity_milli (signed), unit_cost_poisha, reason, reference_type/id, at, at_epoch_ms, user_id, notes | immutable ledger; index `(item_id, at_epoch_ms DESC)`, `(txn_type)`, `(at_epoch_ms)` |
| `expenses` | expense_no UNIQUE, category_id, expense_date, amount_poisha, method_code, paid_to, reference_no, description, attachment_id NULL, voided_at/by/reason, audit cols | `CHECK(amount_poisha > 0)`; index `(expense_date)`, `(category_id, expense_date)` |

---

## 4. Integrity rules enforced by the database

* Foreign keys on every child table with `ON DELETE RESTRICT` (or `CASCADE` only for pure child rows such
  as `invoice_items`, `prescription_items`, `role_permissions`).
* Non-negative money and stock; positive payment/expense amounts.
* `UNIQUE` on patient code, invoice number, receipt number, expense number, username, role code,
  permission code, treatment code, inventory code, `(patient_id, visit_no)`, `(prescription_id, sort_order)`,
  `notifications.dedupe_key`.
* Generated `balance_poisha` keeps invoice balance always consistent with `total - paid`.
* Application-level validation on top: overpayment must be explicitly confirmed (creates a credit
  balance shown in patient financials); stock consumption may not exceed `quantity_milli` (no negative
  stock); invoice items must exist; visit finalisation requires a patient and a dentist.

## 5. Migrations

* Explicit, ordered, deterministic SQL migrations in `src/main/db/migrations/`:
  `0001_initial_schema.sql`, `0002_seed_defaults.sql`, `0003_indexes.sql`, …
* Each migration runs inside a transaction, is recorded in `schema_migrations` with a checksum, and is
  idempotent-safe (checksum mismatch aborts startup with a clear recovery message rather than mutating
  data).
* Schema version is stored in `app_meta.data_schema_version` and embedded in every backup manifest
  (REQ §89, §90). Restores from a newer schema version are refused; restores from older versions run the
  migration chain after the pre-restore backup.

## 6. Verification

* `db/integrity.ts`: `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, orphan scans, invoice/balance
  reconciliation, stock reconciliation (ledger sum vs cached quantity), audit chain verification. Exposed
  in Settings → Data Management → *Run integrity check* and executed automatically after restore and
  before backup.
* Integration tests cover every constraint (duplicate codes, FK violations, negative amounts, orphan
  prevention, generated balance correctness, transactional rollback).
