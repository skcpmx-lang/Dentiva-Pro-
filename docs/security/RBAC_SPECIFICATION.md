# Dentiva Pro — RBAC Specification

**Document ID:** SEC-RBAC-001 · **Version:** 1.0.0 · **Status:** Approved
**Related:** ADR-0006, `docs/security/SECURITY_SPECIFICATION.md`, `src/shared/permissions.ts` (catalog is
the single source of truth; the database is seeded from it and verified at startup)

---

## 1. Model

`user → (role) → role_permissions → permissions`, plus per-user overrides
(`user_permissions.effect = allow | deny`). **Deny always wins.** Permissions are strings
`<module>.<action>`; there is no implicit hierarchy (no "admin bypass" flag anywhere in code — the
Administrator role simply holds all permission codes, so removing a permission from the role really does
remove the capability).

Authorization is evaluated **in the main-process business layer** before any repository call. The
renderer receives a permission snapshot only to render UI affordances.

## 2. Permission catalogue

| Module | Codes |
|---|---|
| Dashboard | `dashboard.view`, `dashboard.configure` |
| Patients | `patients.view`, `patients.create`, `patients.edit`, `patients.delete`, `patients.attachments.view`, `patients.attachments.manage`, `patients.export` |
| Appointments | `appointments.view`, `appointments.create`, `appointments.edit`, `appointments.cancel`, `appointments.delete` |
| Queue | `queue.view`, `queue.manage`, `queue.reorder`, `queue.priority` |
| Clinical | `visits.view`, `visits.create`, `visits.edit`, `visits.finalize`, `visits.amend`, `visits.delete`, `chart.view`, `chart.edit`, `treatments.view`, `treatments.manage`, `prescriptions.view`, `prescriptions.create`, `prescriptions.edit`, `prescriptions.delete`, `prescriptions.print` |
| Billing | `invoices.view`, `invoices.create`, `invoices.edit`, `invoices.void`, `invoices.print`, `payments.view`, `payments.create`, `payments.void`, `payments.print` |
| Finance | `reports.financial.view`, `reports.financial.export`, `accounting.view`, `accounting.manage`, `accounting.export` |
| Inventory | `inventory.view`, `inventory.manage`, `inventory.adjust`, `inventory.export` |
| People | `staff.view`, `staff.manage`, `users.view`, `users.manage`, `roles.manage` |
| System | `settings.view`, `settings.manage`, `printers.manage`, `backup.create`, `backup.restore`, `backup.configure`, `audit.view`, `audit.export`, `data.export`, `data.import`, `data.destructive`, `notifications.view`, `notifications.manage` |

`src/shared/permissions.ts` defines the catalogue with labels, module grouping and a `destructive` flag.
The seeder inserts any missing permission at startup (forward-compatible) and never deletes.

## 3. System roles (seeded; editable afterwards)

| Role | Intent | Key permissions |
|---|---|---|
| **Administrator** | Owner / clinic admin — full control | all codes, including `data.destructive`, `backup.restore`, `users.manage`, `roles.manage`, `settings.manage`, `audit.view`, `reports.financial.view`, `accounting.*` |
| **Dentist** | Clinical work, no financial reports | all patient/clinical/appointment/queue, `invoices.create` + `invoices.view` + `invoices.print`, `payments.create`, `chart.*`, `prescriptions.*`, `treatments.view`, `reports.financial.view` **off by default** (explicitly grantable), no `data.destructive`, no `settings.manage`, no `users.manage` |
| **Receptionist** | Front desk | `patients.view/create/edit`, `appointments.*` (except delete), `queue.*`, `invoices.view/create/print`, `payments.view/create/print`, `notifications.*`, `patients.attachments.view`; **no** clinical editing, **no** `reports.financial.view`, **no** accounting |
| **Accountant** | Finance | `invoices.*` (view/print/void), `payments.*`, `accounting.*`, `reports.financial.*`, `inventory.view`, `patients.view` (limited: no clinical), `data.export`; no clinical or destructive permissions |
| **Assistant / Nurse** | Chair-side help | `patients.view`, `appointments.view`, `queue.view/manage`, `chart.view`, `visits.view`, `prescriptions.view`, `inventory.view`, `inventory.manage` |
| **Auditor (read-only)** | Compliance review | `*.view` set + `audit.view`, `audit.export`, `reports.financial.view`; **no** create/edit/delete anywhere |

Roles are data, not code: an administrator can create custom roles, clone system roles, and change any
permission except the invariant `*` safety rules below.

## 4. Invariant safety rules (enforced in the service layer)

1. A user may not delete or deactivate their own account, nor remove `users.manage` from the role they
   themselves hold if they are the **last** user with that permission (prevents lock-out).
2. The last active Administrator cannot be deactivated, deleted or stripped of administrative
   permissions.
3. `data.destructive`, `backup.restore`, `users.manage` and `roles.manage` require re-authentication
   (password) in addition to the permission.
4. Every permission change, role change, user creation/activation change and failed authorization is
   audited with before/after values.
5. Financial data access (`reports.financial.view`, `accounting.view`, `invoices.*`, `payments.*`) is
   **never** granted implicitly by another module's permission.

## 5. Enforcement points

| Layer | Enforcement |
|---|---|
| IPC router (`src/main/ipc/router.ts`) | `permission` per channel; denies before handler; logs `security.forbidden` |
| Services | re-check for compound operations (e.g. invoicing a visit requires `invoices.create` **and** `patients.view`) |
| Repositories | no permission logic (pure data access, unreachable from renderer) |
| Renderer | `usePermission()` for affordances only; every mutation still server-checked |
| Reports/exports | export channels declare their own permissions (`*.export`); CSV/PDF export of financial data requires the financial export permission |

## 6. Verification

* `tests/unit/permissions.test.ts` — catalogue integrity, resolve order (deny wins), invariants.
* `tests/integration/authorization.test.ts` — every protected channel is called by a user **without** the
  permission and must fail with `FORBIDDEN` and zero data leakage (asserted at the service layer, not
  just the UI); tables of channel → permission are generated from the router registry so new channels
  cannot ship unprotected.
* `tests/integration/audit.test.ts` — hash chain integrity, tamper detection, required audit entries for
  each sensitive operation.
