# ADR-0006 — Append-only hash-chained audit log and business-layer authorization

* **Status:** Accepted
* **Date:** 2026-09-29

## Context

The product stores clinical and financial records for multiple users with different privileges. It must
record security-sensitive actions immutably (REQ §45) and must prevent unauthorized access to protected
data through *any* path — not merely by hiding UI controls (REQ §36, §42).

## Decision

1. **Authorization is enforced in the main process business layer.** The IPC router resolves the session
   server-side and checks `hasPermission(session, code)` before invoking any service. The preload bridge
   exposes a single `invoke` function over an allow-listed channel registry. The renderer holds only a
   *reflection* of permissions for UI affordances (disabled buttons, hidden menus); hiding is cosmetic,
   blocking is authoritative. No service is reachable without passing the router gate, and the router is
   the only consumer of services from outside the main process.
2. **Channel registry is the attack-surface inventory.** Each channel declares
   `{ permission, schema, audit, handler, sensitive }`. Unregistered channels are rejected and logged as
   `security.unknown_channel`.
3. **Audit log is append-only and tamper-evident.** `audit_log` rows contain `hash = SHA-256(prev_hash ||
   canonical_json(row))` and are written inside the *same transaction* as the mutation they describe, so
   an action cannot be recorded without its effect or vice versa. There is no update/delete service for
   audit rows; the repository exposes only `append`, `list`, `verifyChain`. `verifyChain()` detects any
   modification of history and is run after every restore and on demand from Settings (with result
   recorded).
4. **Sensitive routes require a re-authentication proof** for destructive classes (restore, purge,
   delete-all-data, delete patient, permission changes): the UI must submit the acting user's password
   with the confirmation phrase; the router verifies it before executing.
5. **Audit retention** is unlimited by default; archiving/export is an admin action with its own audit
   entry.

## Consequences

* A renderer compromise cannot bypass permissions or forge history without breaking the hash chain.
* Every domain mutation path must funnel through an audited service method; code review rule and tests
  (`tests/integration/authorization.test.ts`) enforce this.
