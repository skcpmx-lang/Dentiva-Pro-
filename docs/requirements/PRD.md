# Dentiva Pro — Product Requirements Document

**Document ID:** PRD-001 · **Version:** 1.0.0 · **Status:** Approved

---

## 1. Product

**Dentiva Pro** — an offline-first, all-in-one dental clinic management system for Windows, built for
dental clinics in Bangladesh and sold as a commercial product.

* **Markets:** Bangladesh (primary). BDT (৳) is the only currency; English UI with complete Bengali
  Unicode support in data and output.
* **Deployment:** single Windows PC in the clinic, installed from a signed-off NSIS installer, activated
  once offline.
* **Business model:** one-time purchase; no subscription, no cloud, no paid third-party services, works
  with the internet permanently disconnected.

## 2. Problem

Bangladeshi dental clinics mostly run on paper registers and disconnected spreadsheets: patient histories
are lost, prescriptions are illegible, dues are forgotten, stock expires unnoticed, and revenue is
unknowable. Cloud practice-management products are unusable because clinics have unreliable internet,
cannot pay monthly USD fees, and cannot send patient data abroad. Clinics need premium software that runs
entirely on their own machine and prints on the printers they already own (including cheap thermal and
Bluetooth devices).

## 3. Users and roles

| Persona | Needs |
|---|---|
| Clinic owner / dentist (Administrator) | See the whole practice: revenue, dues, stock, staff, audit trail; control users and data |
| Dentist (clinical) | Fast patient records, dental chart, visits, prescriptions that print beautifully, appointments, queue |
| Receptionist | Register patients, schedule appointments, manage the queue, raise invoices, take payments |
| Accountant | Payments, expenses, financial reports, exports |
| Assistant / nurse | Chair-side: queue, chart view, stock usage |
| Auditor (read-only) | Inspect records and audit log without the ability to change anything |

## 4. Success criteria

1. A clinic can run its entire day (patients, appointments, queue, visits, prescriptions, invoices,
   payments, stock, expenses) without internet and without paper registers.
2. Printed prescriptions and invoices look like premium practice stationery (Bengali included) on A4/A5
   and thermal printers, and export identically to PDF.
3. No financial or clinical data is reachable by a user without the corresponding permission, at any layer.
4. Data survives power loss, crashes, reinstalls and machine changes (backup/restore + migration).
5. The installer works on a clean Windows machine with no prerequisites and no admin rights.
6. Nothing in the product is fake: no placeholder statistics, no inert buttons, no mock records.

## 5. Scope

**In scope (v1.0):** activation, setup wizard, dashboard, patients + profile + timeline, visits, dental
chart, appointments, queue, treatment catalogue, prescriptions (+ templates of clinical options), printing
and PDF for prescriptions/invoices/reports, invoices, payments, inventory, accounting, financial reports,
staff, users/roles/RBAC, auto-lock, audit log, attachments, global search, notifications, backup/restore,
settings, data management, exports, About, keyboard shortcuts, accessibility, Windows installer.

**Out of scope (documented, not implemented, not faked):** multi-branch cloud sync, patient portal, SMS/email
reminders, online payment gateways, insurance claim clearing, imaging (X-ray) acquisition hardware
integration, mobile apps, statutory tax filing formats. These are deliberately excluded because they
require network/paid services or third-party integration; the data model leaves room for them.

## 6. Constraints

* Offline only; no telemetry; no paid services (REQ §3, §70).
* Bangladeshi clinics use low-to-mid-range Windows PCs (4 GB RAM, HDD, 1366×768 to 1920×1080, 100–200 % DPI).
* Printers are typically entry-level inkjet/laser plus 58/80 mm thermal and Bluetooth devices.
* Data volumes: thousands of patients, tens of thousands of visits over years, growing attachments.

## 7. Acceptance

The product is accepted when every requirement in `docs/requirements/FUNCTIONAL_REQUIREMENTS.md` passes its
acceptance test in `docs/testing/ACCEPTANCE_TEST_CHECKLIST.md`, the release gates in
`docs/release/RELEASE_SPECIFICATION.md` are met, and `RELEASE_READINESS.md` is complete and truthful.
