/**
 * Explicit, ordered, checksummed database migrations (REQ §90).
 *
 * Rules:
 *  - migrations are append-only; an applied migration is never edited (the checksum aborts startup instead)
 *  - every migration runs inside a transaction together with its `schema_migrations` row
 *  - migrations must be deterministic and preserve existing data
 */

export interface Migration {
  version: number
  name: string
  sql: string
}

const S = (): void => undefined // keeps the SQL templates readable

S()

const MIGRATION_0001 = `
-- ============================================================================================
-- 0001_initial_schema — core platform, identity, clinical, billing, inventory, accounting
-- ============================================================================================

CREATE TABLE schema_migrations (
  version      INTEGER PRIMARY KEY,
  name         TEXT    NOT NULL,
  checksum     TEXT    NOT NULL,
  applied_at   TEXT    NOT NULL,
  duration_ms  INTEGER NOT NULL,
  app_version  TEXT    NOT NULL
);

CREATE TABLE app_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL CHECK (value >= 0)
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'general',
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE clinic_profile (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  name            TEXT NOT NULL,
  name_bn         TEXT,
  logo_path       TEXT,
  address         TEXT NOT NULL,
  city            TEXT,
  postal_code     TEXT,
  country         TEXT NOT NULL DEFAULT 'Bangladesh',
  phone1          TEXT NOT NULL,
  phone2          TEXT,
  email           TEXT,
  website         TEXT,
  registration_no TEXT,
  footer_quote    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT,
  updated_by  TEXT
);

CREATE TABLE permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  label       TEXT NOT NULL,
  description TEXT,
  is_destructive INTEGER NOT NULL DEFAULT 0 CHECK (is_destructive IN (0, 1)),
  is_financial   INTEGER NOT NULL DEFAULT 0 CHECK (is_financial IN (0, 1))
);

CREATE TABLE role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name         TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  password_algo        TEXT NOT NULL DEFAULT 'scrypt',
  password_changed_at  TEXT,
  role_id              INTEGER NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  failed_attempts      INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until_epoch   INTEGER,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL,
  created_by           TEXT,
  updated_at           TEXT NOT NULL,
  updated_by           TEXT,
  CHECK (length(username) >= 3)
);

CREATE TABLE user_permissions (
  user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  effect        TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  granted_at    TEXT NOT NULL,
  granted_by    TEXT,
  PRIMARY KEY (user_id, permission_id)
);

CREATE TABLE login_attempts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL,
  success         INTEGER NOT NULL CHECK (success IN (0, 1)),
  reason          TEXT,
  attempted_at    TEXT NOT NULL,
  attempt_epoch_ms INTEGER NOT NULL
);

CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  at              TEXT NOT NULL,
  at_epoch_ms     INTEGER NOT NULL,
  actor_user_id   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  actor_username  TEXT,
  action          TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       TEXT,
  summary         TEXT NOT NULL,
  before_json     TEXT,
  after_json      TEXT,
  severity        TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  app_version     TEXT NOT NULL,
  hash            TEXT NOT NULL,
  prev_hash       TEXT
);

CREATE TABLE dentists (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name      TEXT NOT NULL,
  phone          TEXT,
  email          TEXT,
  registration_no TEXT,
  signature_path TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT
);

CREATE TABLE dentist_designations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  dentist_id INTEGER NOT NULL REFERENCES dentists (id) ON DELETE CASCADE,
  value      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (dentist_id, value)
);

CREATE TABLE dentist_qualifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  dentist_id INTEGER NOT NULL REFERENCES dentists (id) ON DELETE CASCADE,
  value      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (dentist_id, value)
);

CREATE TABLE dentist_certifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  dentist_id INTEGER NOT NULL REFERENCES dentists (id) ON DELETE CASCADE,
  value      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (dentist_id, value)
);

CREATE TABLE dentist_schedules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  dentist_id INTEGER NOT NULL REFERENCES dentists (id) ON DELETE CASCADE,
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL
);

CREATE TABLE staff (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  age               INTEGER CHECK (age IS NULL OR (age >= 14 AND age <= 90)),
  gender            TEXT CHECK (gender IS NULL OR gender IN ('male', 'female', 'other')),
  address           TEXT,
  blood_group       TEXT,
  identification_no TEXT,
  photo_path        TEXT,
  phone             TEXT NOT NULL,
  position          TEXT NOT NULL,
  department        TEXT,
  salary_poisha     INTEGER CHECK (salary_poisha IS NULL OR salary_poisha >= 0),
  joining_date      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_leave', 'inactive', 'terminated')),
  notes             TEXT,
  created_at        TEXT NOT NULL,
  created_by        TEXT,
  updated_at        TEXT NOT NULL,
  updated_by        TEXT,
  deleted_at        TEXT
);

CREATE TABLE treatment_catalog (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT UNIQUE,
  name              TEXT NOT NULL,
  name_bn           TEXT,
  category          TEXT NOT NULL,
  description       TEXT,
  default_fee_poisha INTEGER NOT NULL DEFAULT 0 CHECK (default_fee_poisha >= 0),
  duration_minutes  INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_system_default INTEGER NOT NULL DEFAULT 0 CHECK (is_system_default IN (0, 1)),
  notes             TEXT,
  created_at        TEXT NOT NULL,
  created_by        TEXT,
  updated_at        TEXT NOT NULL,
  updated_by        TEXT
);

CREATE TABLE clinical_options (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  list_code         TEXT NOT NULL,
  value             TEXT NOT NULL,
  value_bn          TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_system_default INTEGER NOT NULL DEFAULT 0 CHECK (is_system_default IN (0, 1)),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (list_code, value)
);

CREATE TABLE dental_conditions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  color             TEXT NOT NULL DEFAULT '#ffffff',
  text_color        TEXT NOT NULL DEFAULT '#0f172a',
  category          TEXT NOT NULL CHECK (category IN ('condition', 'treatment', 'restoration')),
  applies_to        TEXT NOT NULL DEFAULT 'both' CHECK (applies_to IN ('permanent', 'primary', 'both')),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_system_default INTEGER NOT NULL DEFAULT 0 CHECK (is_system_default IN (0, 1))
);

CREATE TABLE payment_methods (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  name_bn           TEXT,
  requires_reference INTEGER NOT NULL DEFAULT 0 CHECK (requires_reference IN (0, 1)),
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_system_default INTEGER NOT NULL DEFAULT 0 CHECK (is_system_default IN (0, 1)),
  sort_order        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE expense_categories (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  name_bn           TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_system_default INTEGER NOT NULL DEFAULT 0 CHECK (is_system_default IN (0, 1)),
  sort_order        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE suppliers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  contact_person TEXT,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  notes          TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE patients (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT NOT NULL UNIQUE,
  full_name           TEXT NOT NULL,
  full_name_bn        TEXT,
  date_of_birth       TEXT,
  age_years           INTEGER CHECK (age_years IS NULL OR (age_years >= 0 AND age_years <= 130)),
  gender              TEXT CHECK (gender IS NULL OR gender IN ('male', 'female', 'other')),
  blood_group         TEXT,
  phone               TEXT NOT NULL,
  phone_alt           TEXT,
  email               TEXT,
  address             TEXT,
  address_bn          TEXT,
  city                TEXT,
  occupation          TEXT,
  marital_status      TEXT,
  national_id         TEXT,
  guardian_name       TEXT,
  emergency_name      TEXT,
  emergency_phone     TEXT,
  relationship        TEXT,
  referral_source     TEXT,
  chief_complaint     TEXT,
  medical_history     TEXT,
  dental_history      TEXT,
  allergies           TEXT,
  current_medications TEXT,
  notes               TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at          TEXT NOT NULL,
  created_by          TEXT,
  updated_at          TEXT NOT NULL,
  updated_by          TEXT,
  deleted_at          TEXT
);

CREATE TABLE patient_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  note       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE visits (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id          INTEGER NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  visit_no            INTEGER NOT NULL CHECK (visit_no >= 1),
  visit_date          TEXT NOT NULL,
  visit_time          TEXT NOT NULL,
  dentist_id          INTEGER NOT NULL REFERENCES dentists (id) ON DELETE RESTRICT,
  appointment_id      INTEGER,
  chief_complaint     TEXT,
  symptoms            TEXT,
  examination         TEXT,
  diagnosis           TEXT,
  treatment_summary   TEXT,
  advice              TEXT,
  follow_up_date      TEXT,
  notes               TEXT,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'amended')),
  finalized_at        TEXT,
  finalized_by        TEXT,
  amendment_of_visit_id INTEGER REFERENCES visits (id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL,
  created_by          TEXT,
  updated_at          TEXT NOT NULL,
  updated_by          TEXT,
  deleted_at          TEXT,
  UNIQUE (patient_id, visit_no)
);

CREATE TABLE visit_treatments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id       INTEGER NOT NULL REFERENCES visits (id) ON DELETE CASCADE,
  treatment_id   INTEGER REFERENCES treatment_catalog (id) ON DELETE SET NULL,
  treatment_name TEXT NOT NULL,
  teeth_json     TEXT NOT NULL DEFAULT '[]',
  fee_poisha     INTEGER NOT NULL DEFAULT 0 CHECK (fee_poisha >= 0),
  note           TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE dental_chart_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id     INTEGER NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  visit_id       INTEGER REFERENCES visits (id) ON DELETE SET NULL,
  tooth_number   TEXT NOT NULL,
  dentition      TEXT NOT NULL CHECK (dentition IN ('permanent', 'primary')),
  condition_code TEXT NOT NULL,
  treatment_code TEXT,
  surfaces_json  TEXT NOT NULL DEFAULT '[]',
  status         TEXT NOT NULL DEFAULT 'existing' CHECK (status IN ('existing', 'planned', 'completed')),
  note           TEXT,
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT
);

CREATE TABLE visit_chart_snapshots (
  visit_id      INTEGER PRIMARY KEY REFERENCES visits (id) ON DELETE CASCADE,
  patient_id    INTEGER NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  snapshot_json TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE prescriptions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id            INTEGER NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  visit_id              INTEGER REFERENCES visits (id) ON DELETE SET NULL,
  dentist_id            INTEGER NOT NULL REFERENCES dentists (id) ON DELETE RESTRICT,
  prescription_date     TEXT NOT NULL,
  chief_complaints_json TEXT NOT NULL DEFAULT '[]',
  on_examination_json   TEXT NOT NULL DEFAULT '[]',
  diagnosis             TEXT,
  advice_json           TEXT NOT NULL DEFAULT '[]',
  follow_up_date        TEXT,
  notes                 TEXT,
  status                TEXT NOT NULL DEFAULT 'final' CHECK (status IN ('draft', 'final', 'void')),
  printed_count         INTEGER NOT NULL DEFAULT 0 CHECK (printed_count >= 0),
  last_printed_at       TEXT,
  created_at            TEXT NOT NULL,
  created_by            TEXT,
  updated_at            TEXT NOT NULL,
  updated_by            TEXT
);

CREATE TABLE prescription_items (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_id         INTEGER NOT NULL REFERENCES prescriptions (id) ON DELETE CASCADE,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  medicine_name           TEXT NOT NULL,
  medicine_type           TEXT,
  strength                TEXT,
  dose                    TEXT,
  morning                 TEXT,
  noon                    TEXT,
  night                   TEXT,
  timing                  TEXT,
  duration_value          INTEGER,
  duration_unit           TEXT,
  quantity                TEXT,
  instruction             TEXT,
  conditional_instruction TEXT,
  notes                   TEXT,
  UNIQUE (prescription_id, sort_order)
);

CREATE TABLE referrals (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id            INTEGER NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  visit_id              INTEGER REFERENCES visits (id) ON DELETE SET NULL,
  referral_date         TEXT NOT NULL,
  referring_dentist_id  INTEGER REFERENCES dentists (id) ON DELETE SET NULL,
  referred_to_name      TEXT NOT NULL,
  referred_to_institution TEXT,
  referred_to_phone     TEXT,
  reason                TEXT NOT NULL,
  notes                 TEXT,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'completed', 'cancelled')),
  follow_up_date        TEXT,
  outcome               TEXT,
  created_at            TEXT NOT NULL,
  created_by            TEXT,
  updated_at            TEXT NOT NULL,
  updated_by            TEXT
);

CREATE TABLE appointments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id       INTEGER NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  dentist_id       INTEGER NOT NULL REFERENCES dentists (id) ON DELETE RESTRICT,
  appointment_date TEXT NOT NULL,
  start_time       TEXT NOT NULL,
  end_time         TEXT,
  type_code        TEXT,
  reason           TEXT,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled','confirmed','arrived','in_queue','in_treatment','completed','cancelled','no_show','rescheduled')),
  rescheduled_from_id INTEGER REFERENCES appointments (id) ON DELETE SET NULL,
  cancelled_reason TEXT,
  created_at       TEXT NOT NULL,
  created_by       TEXT,
  updated_at       TEXT NOT NULL,
  updated_by       TEXT,
  deleted_at       TEXT
);

CREATE TABLE queue_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id     INTEGER NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  appointment_id INTEGER REFERENCES appointments (id) ON DELETE SET NULL,
  dentist_id     INTEGER REFERENCES dentists (id) ON DELETE SET NULL,
  queue_date     TEXT NOT NULL,
  position       INTEGER NOT NULL CHECK (position >= 0),
  priority       TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'emergency')),
  status         TEXT NOT NULL DEFAULT 'waiting'
                 CHECK (status IN ('waiting','called','in_treatment','completed','left','cancelled')),
  arrived_at     TEXT NOT NULL,
  called_at      TEXT,
  started_at     TEXT,
  completed_at   TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT
);

CREATE TABLE inventory_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT UNIQUE,
  name                TEXT NOT NULL,
  category            TEXT,
  supplier_id         INTEGER REFERENCES suppliers (id) ON DELETE SET NULL,
  unit                TEXT NOT NULL DEFAULT 'piece',
  quantity_milli      INTEGER NOT NULL DEFAULT 0 CHECK (quantity_milli >= 0),
  min_stock_milli     INTEGER NOT NULL DEFAULT 0 CHECK (min_stock_milli >= 0),
  purchase_price_poisha INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price_poisha >= 0),
  sell_price_poisha   INTEGER CHECK (sell_price_poisha IS NULL OR sell_price_poisha >= 0),
  location            TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes               TEXT,
  created_at          TEXT NOT NULL,
  created_by          TEXT,
  updated_at          TEXT NOT NULL,
  updated_by          TEXT
);

CREATE TABLE inventory_batches (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id                INTEGER NOT NULL REFERENCES inventory_items (id) ON DELETE RESTRICT,
  batch_no               TEXT,
  expiry_date            TEXT,
  quantity_in_milli      INTEGER NOT NULL DEFAULT 0 CHECK (quantity_in_milli >= 0),
  quantity_remaining_milli INTEGER NOT NULL DEFAULT 0 CHECK (quantity_remaining_milli >= 0),
  purchase_price_poisha  INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price_poisha >= 0),
  purchase_date          TEXT NOT NULL,
  supplier_id            INTEGER REFERENCES suppliers (id) ON DELETE SET NULL,
  reference_no           TEXT,
  created_at             TEXT NOT NULL,
  created_by             TEXT
);

CREATE TABLE inventory_transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id        INTEGER NOT NULL REFERENCES inventory_items (id) ON DELETE RESTRICT,
  batch_id       INTEGER REFERENCES inventory_batches (id) ON DELETE SET NULL,
  txn_type       TEXT NOT NULL CHECK (txn_type IN ('opening','purchase','usage','adjustment_in','adjustment_out','wastage','return','expired')),
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli <> 0),
  unit_cost_poisha INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_poisha >= 0),
  reason         TEXT,
  reference_type TEXT,
  reference_id   INTEGER,
  at             TEXT NOT NULL,
  at_epoch_ms    INTEGER NOT NULL,
  user_name      TEXT,
  notes          TEXT
);

CREATE TABLE invoices (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no         TEXT NOT NULL UNIQUE,
  patient_id         INTEGER NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  visit_id           INTEGER REFERENCES visits (id) ON DELETE SET NULL,
  invoice_date       TEXT NOT NULL,
  due_date           TEXT,
  subtotal_poisha    INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_poisha >= 0),
  discount_poisha    INTEGER NOT NULL DEFAULT 0 CHECK (discount_poisha >= 0),
  discount_percent_x100 INTEGER NOT NULL DEFAULT 0 CHECK (discount_percent_x100 >= 0),
  tax_poisha         INTEGER NOT NULL DEFAULT 0 CHECK (tax_poisha >= 0),
  round_off_poisha   INTEGER NOT NULL DEFAULT 0,
  total_poisha       INTEGER NOT NULL DEFAULT 0 CHECK (total_poisha >= 0),
  paid_poisha        INTEGER NOT NULL DEFAULT 0 CHECK (paid_poisha >= 0),
  balance_poisha     INTEGER GENERATED ALWAYS AS (total_poisha - paid_poisha) STORED,
  status             TEXT NOT NULL DEFAULT 'unpaid'
                     CHECK (status IN ('unpaid','partial','paid','overpaid','void')),
  notes              TEXT,
  voided_at          TEXT,
  voided_by          TEXT,
  void_reason        TEXT,
  created_at         TEXT NOT NULL,
  created_by         TEXT,
  updated_at         TEXT NOT NULL,
  updated_by         TEXT
);

CREATE TABLE invoice_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id       INTEGER NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  item_type        TEXT NOT NULL DEFAULT 'treatment' CHECK (item_type IN ('treatment','product','service','other')),
  treatment_id     INTEGER REFERENCES treatment_catalog (id) ON DELETE SET NULL,
  inventory_item_id INTEGER REFERENCES inventory_items (id) ON DELETE SET NULL,
  description      TEXT NOT NULL,
  quantity_milli   INTEGER NOT NULL DEFAULT 1000 CHECK (quantity_milli > 0),
  unit_price_poisha INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_poisha >= 0),
  discount_poisha  INTEGER NOT NULL DEFAULT 0 CHECK (discount_poisha >= 0),
  line_total_poisha INTEGER NOT NULL DEFAULT 0 CHECK (line_total_poisha >= 0),
  note             TEXT,
  UNIQUE (invoice_id, sort_order)
);

CREATE TABLE payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no      TEXT NOT NULL UNIQUE,
  patient_id      INTEGER NOT NULL REFERENCES patients (id) ON DELETE RESTRICT,
  invoice_id      INTEGER REFERENCES invoices (id) ON DELETE SET NULL,
  kind            TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment','advance','refund')),
  amount_poisha   INTEGER NOT NULL CHECK (amount_poisha > 0),
  method_code     TEXT NOT NULL,
  reference_no    TEXT,
  received_at     TEXT NOT NULL,
  received_at_epoch_ms INTEGER NOT NULL,
  received_by     TEXT,
  notes           TEXT,
  voided_at       TEXT,
  voided_by       TEXT,
  void_reason     TEXT,
  created_at      TEXT NOT NULL,
  created_by      TEXT
);

CREATE TABLE expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_no    TEXT NOT NULL UNIQUE,
  category_id   INTEGER NOT NULL REFERENCES expense_categories (id) ON DELETE RESTRICT,
  expense_date  TEXT NOT NULL,
  amount_poisha INTEGER NOT NULL CHECK (amount_poisha > 0),
  method_code   TEXT NOT NULL,
  paid_to       TEXT,
  reference_no  TEXT,
  description   TEXT NOT NULL,
  attachment_id INTEGER,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  voided_at     TEXT,
  voided_by     TEXT,
  void_reason   TEXT
);

CREATE TABLE attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id    INTEGER REFERENCES patients (id) ON DELETE CASCADE,
  visit_id      INTEGER REFERENCES visits (id) ON DELETE SET NULL,
  entity_type   TEXT NOT NULL DEFAULT 'patient',
  entity_id     INTEGER,
  original_name TEXT NOT NULL,
  stored_path   TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256        TEXT,
  title         TEXT,
  category      TEXT,
  notes         TEXT,
  uploaded_at   TEXT NOT NULL,
  uploaded_by   TEXT,
  deleted_at    TEXT,
  deleted_by    TEXT
);

CREATE TABLE notifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  category       TEXT NOT NULL CHECK (category IN ('appointment','queue','inventory','billing','backup','restore','security','system')),
  priority       TEXT NOT NULL DEFAULT 'info' CHECK (priority IN ('info','warning','critical')),
  title          TEXT NOT NULL,
  body           TEXT,
  entity_type    TEXT,
  entity_id      INTEGER,
  action_type    TEXT,
  action_payload_json TEXT,
  dedupe_key     TEXT UNIQUE,
  created_at     TEXT NOT NULL,
  read_at        TEXT,
  dismissed_at   TEXT
);

CREATE TABLE backups (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name              TEXT NOT NULL,
  path                   TEXT NOT NULL,
  size_bytes             INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  sha256                 TEXT,
  created_at             TEXT NOT NULL,
  created_by             TEXT,
  trigger                TEXT NOT NULL CHECK (trigger IN ('manual','auto','pre_restore','pre_destructive')),
  status                 TEXT NOT NULL CHECK (status IN ('success','failed','verified')),
  includes_attachments   INTEGER NOT NULL DEFAULT 1 CHECK (includes_attachments IN (0, 1)),
  app_version            TEXT NOT NULL,
  schema_version         INTEGER NOT NULL,
  data_format_version    INTEGER NOT NULL,
  encrypted              INTEGER NOT NULL DEFAULT 0 CHECK (encrypted IN (0, 1)),
  error_message          TEXT,
  notes                  TEXT
);

CREATE TABLE printer_profiles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  document_type   TEXT NOT NULL CHECK (document_type IN ('prescription','invoice','report')),
  printer_name    TEXT,
  paper_size      TEXT NOT NULL CHECK (paper_size IN ('A4','A5','A6','Letter','thermal58','thermal80','custom')),
  custom_width_mm REAL,
  custom_height_mm REAL,
  orientation     TEXT NOT NULL DEFAULT 'portrait' CHECK (orientation IN ('portrait','landscape')),
  margin_top_mm   REAL NOT NULL DEFAULT 12,
  margin_right_mm REAL NOT NULL DEFAULT 12,
  margin_bottom_mm REAL NOT NULL DEFAULT 14,
  margin_left_mm  REAL NOT NULL DEFAULT 12,
  scale_percent   INTEGER NOT NULL DEFAULT 100 CHECK (scale_percent BETWEEN 50 AND 200),
  copies          INTEGER NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 20),
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (document_type, name)
);
`

const MIGRATION_0002 = `
-- ============================================================================================
-- 0002_indexes — query performance for paged lists, search and reports
-- ============================================================================================

CREATE INDEX idx_patients_name            ON patients (full_name COLLATE NOCASE);
CREATE INDEX idx_patients_name_bn         ON patients (full_name_bn);
CREATE INDEX idx_patients_phone           ON patients (phone);
CREATE INDEX idx_patients_phone_alt       ON patients (phone_alt);
CREATE INDEX idx_patients_created         ON patients (created_at DESC);
CREATE INDEX idx_patients_deleted         ON patients (deleted_at);
CREATE INDEX idx_patients_name_search     ON patients (full_name COLLATE NOCASE, code);

CREATE INDEX idx_visits_patient_date      ON visits (patient_id, visit_date DESC, id DESC);
CREATE INDEX idx_visits_date              ON visits (visit_date DESC);
CREATE INDEX idx_visits_dentist_date      ON visits (dentist_id, visit_date DESC);
CREATE INDEX idx_visit_treatments_visit   ON visit_treatments (visit_id);
CREATE INDEX idx_visit_treatments_treat   ON visit_treatments (treatment_id);

CREATE INDEX idx_chart_patient_tooth      ON dental_chart_entries (patient_id, dentition, tooth_number);
CREATE INDEX idx_chart_visit              ON dental_chart_entries (visit_id);

CREATE INDEX idx_prescriptions_patient    ON prescriptions (patient_id, prescription_date DESC, id DESC);
CREATE INDEX idx_prescriptions_date       ON prescriptions (prescription_date DESC);
CREATE INDEX idx_prescriptions_visit      ON prescriptions (visit_id);
CREATE INDEX idx_prescription_items_rx    ON prescription_items (prescription_id, sort_order);

CREATE INDEX idx_referrals_patient        ON referrals (patient_id, referral_date DESC);
CREATE INDEX idx_referrals_status         ON referrals (status);

CREATE INDEX idx_appointments_date_time   ON appointments (appointment_date, start_time);
CREATE INDEX idx_appointments_patient     ON appointments (patient_id, appointment_date DESC);
CREATE INDEX idx_appointments_dentist     ON appointments (dentist_id, appointment_date);
CREATE INDEX idx_appointments_status      ON appointments (appointment_date, status);

CREATE INDEX idx_queue_date_status_pos    ON queue_entries (queue_date, status, position);
CREATE INDEX idx_queue_patient            ON queue_entries (patient_id, queue_date DESC);

CREATE INDEX idx_invoices_patient_date    ON invoices (patient_id, invoice_date DESC, id DESC);
CREATE INDEX idx_invoices_date            ON invoices (invoice_date DESC);
CREATE INDEX idx_invoices_status          ON invoices (status);
CREATE INDEX idx_invoice_items_invoice    ON invoice_items (invoice_id, sort_order);

CREATE INDEX idx_payments_received        ON payments (received_at DESC, id DESC);
CREATE INDEX idx_payments_received_epoch  ON payments (received_at_epoch_ms DESC);
CREATE INDEX idx_payments_patient         ON payments (patient_id, received_at DESC);
CREATE INDEX idx_payments_invoice         ON payments (invoice_id);
CREATE INDEX idx_payments_method          ON payments (method_code, received_at);

CREATE INDEX idx_inventory_items_name     ON inventory_items (name COLLATE NOCASE);
CREATE INDEX idx_inventory_items_category ON inventory_items (category);
CREATE INDEX idx_inventory_batches_item   ON inventory_batches (item_id, expiry_date);
CREATE INDEX idx_inventory_txn_item       ON inventory_transactions (item_id, at_epoch_ms DESC);
CREATE INDEX idx_inventory_txn_type       ON inventory_transactions (txn_type, at_epoch_ms DESC);
CREATE INDEX idx_inventory_txn_at         ON inventory_transactions (at_epoch_ms DESC);

CREATE INDEX idx_expenses_date            ON expenses (expense_date DESC);
CREATE INDEX idx_expenses_category        ON expenses (category_id, expense_date);
CREATE INDEX idx_expenses_method          ON expenses (method_code, expense_date);

CREATE INDEX idx_attachments_patient      ON attachments (patient_id, uploaded_at DESC);
CREATE INDEX idx_attachments_entity       ON attachments (entity_type, entity_id);
CREATE INDEX idx_attachments_visit        ON attachments (visit_id);

CREATE INDEX idx_notifications_read       ON notifications (read_at, created_at DESC);
CREATE INDEX idx_notifications_category   ON notifications (category, created_at DESC);

CREATE INDEX idx_audit_at                 ON audit_log (at_epoch_ms DESC, id DESC);
CREATE INDEX idx_audit_entity             ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_action             ON audit_log (action, at_epoch_ms DESC);
CREATE INDEX idx_audit_actor             ON audit_log (actor_user_id, at_epoch_ms DESC);

CREATE INDEX idx_login_attempts_user      ON login_attempts (username, attempt_epoch_ms DESC);

CREATE INDEX idx_staff_name               ON staff (name COLLATE NOCASE);
CREATE INDEX idx_users_role               ON users (role_id);

CREATE INDEX idx_backups_created          ON backups (created_at DESC);
CREATE INDEX idx_treatment_catalog_active ON treatment_catalog (is_active, category, name COLLATE NOCASE);
CREATE INDEX idx_clinical_options_list    ON clinical_options (list_code, is_active, sort_order);
`

const MIGRATION_0003 = `
-- ============================================================================================
-- 0003_audit_immutability — the audit log is append-only, enforced by the database itself
-- ============================================================================================

CREATE TRIGGER trg_audit_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: updates are not permitted');
END;

CREATE TRIGGER trg_audit_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: deletes are not permitted');
END;

CREATE TRIGGER trg_schema_migrations_no_update
BEFORE UPDATE ON schema_migrations
BEGIN
  SELECT RAISE(ABORT, 'schema_migrations is append-only');
END;

CREATE TRIGGER trg_schema_migrations_no_delete
BEFORE DELETE ON schema_migrations
BEGIN
  SELECT RAISE(ABORT, 'schema_migrations is append-only');
END;
`

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '0001_initial_schema', sql: MIGRATION_0001 },
  { version: 2, name: '0002_indexes', sql: MIGRATION_0002 },
  { version: 3, name: '0003_audit_immutability', sql: MIGRATION_0003 }
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0
