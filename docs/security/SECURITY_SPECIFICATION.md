# Dentiva Pro — Security Specification

**Document ID:** SEC-001 · **Version:** 1.0.0 · **Status:** Approved

---

## 1. Threat model (offline clinic desktop)

| Threat | Mitigation |
|---|---|
| Unauthorized person at an unattended machine | Auto-lock (5/10/15/30 min) + manual lock; lock screen exposes no data; unlock requires password; `data.destructive` actions re-authenticate |
| Clinic staff exceeding their role (e.g. receptionist reading financial reports or staff salaries) | Business-layer RBAC on every channel; per-user deny overrides; audit of denials; UI reflects permissions but never is the control |
| Credential theft from the database file | scrypt hashing (N=2^15, r=8, p=1, 32-byte key, 16-byte salt), constant-time verify, no plaintext, no reversible storage |
| Brute force on login | 5 attempts → 5-minute lockout (configurable), audited, exponential delay, generic error message (no user enumeration) |
| Data tampering / forged history | Append-only hash-chained audit log; generated invoice balance; immutable inventory ledger; verification command |
| Local privilege/tamper (edited DB or config) | Activation state hash-checked; audit chain verified; integrity check (FK orphans, reconciliation) available and run after restore |
| Path traversal / malicious file names | Path safety module: sanitisation, reserved-name blocking, `assertInsideRoot` on every file operation |
| Malformed/oversized attachments | Type allow-list + extension check + MIME sniff, size limit (default 25 MB, configurable), SHA-256 recorded, copy into managed storage (never opened in place), invalid files rejected safely with a clear message |
| SQL injection | 100% parameterised statements; no string-built SQL with user input; sort/filter columns validated against allow-lists |
| Renderer compromise (XSS via pasted content) | React escaping, strict CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'`, no `dangerouslySetInnerHTML` with user content, no remote navigation, `sandbox: true`, `contextIsolation: true` |
| IPC abuse from a compromised renderer | Single allow-listed `invoke` channel registry with zod schemas + session resolution in main; unknown channels rejected and audited as `security.unknown_channel` |
| Secrets in logs | Logger redaction (`password`, `token`, `activation`, `secret`, `hash`, `authorization` keys dropped) + no clinical free-text logging |
| Supply-chain risk | Dependency + licence audit script, lockfile committed, `npm audit` in CI, no post-install network fetches required at runtime |

**Documented non-goals:** protection against an attacker with full OS-level administration rights,
memory-dumping, or physical disk access (full-disk encryption is the OS's responsibility). No claim of
regulatory certification is made anywhere in the product or documentation.

## 2. Authentication

* Login by username + password; unknown user and wrong password produce the same message and timing
  class; attempts recorded in `login_attempts`.
* Password policy (enforced at creation/change): ≥ 10 characters, must contain at least 3 of
  {lowercase, uppercase, digit, symbol}, must not be a common weak password from an embedded blocklist,
  must not equal the username; strength meter shown live in the UI.
* Passwords are changed through a service that verifies the current password and audits the change.
* Setup wizard creates the first Administrator and requires confirmation + strength validation.
* Session lives in the main process only (`SessionManager`); the renderer never receives the hash or the
  user record beyond a safe view model.

## 3. Session & lock

* Session states: `unauthenticated → authenticated → locked → authenticated`, plus `expired`.
* Auto-lock timer resets on real user activity reported by the renderer (`session:activity`) and on
  privileged IPC calls; when the timer fires, main sets state to `locked`, broadcasts `session:locked`,
  refuses every non-unlock channel (`SESSION_LOCKED`), and the renderer replaces the UI with the lock
  screen.
* "Lock Now" (Ctrl+L) is always available to an authenticated user.
* Unsaved-work safety: forms autosave drafts to local component state and warn on unlock-triggered
  navigation; the lock screen never shows clinical/financial content (no patient names, no amounts).
* Logout clears the in-memory session and returns to login.

## 4. Data at rest

* The SQLite database is a normal file protected by OS permissions (per-user app data folder).
* Backups contain the full clinical dataset; they are stored where the clinic chooses and are **not
  encrypted by default** (documented clearly in the UI and user guide, with guidance to keep backups on
  controlled media). An optional password-protected backup (AES-256-GCM with scrypt KDF over the archive)
  is available and configurable in Settings → Backup; the restore flow detects encrypted backups and asks
  for the password.
* No patient data leaves the machine: no telemetry, no analytics, no crash upload, no cloud sync.

## 5. Audit requirements

Every entry contains: timestamp (text + epoch ms), actor user id/username, action code, entity type/id,
human summary, before/after JSON (**redacted** — never password hashes, never activation material), app
version, severity, and the hash chain fields. Mandatory audited actions: login success/failure/logout,
lock/unlock, user create/edit/activate/deactivate/delete, password change, role/permission change, patient
create/edit/delete, attachment add/delete/export, visit create/edit/finalize/amend, chart edits summary,
prescription create/edit/print/void, invoice create/edit/void/print, payment create/void, inventory
purchase/adjust/usage/wastage, expense create/void, settings change, printer profile change, backup
create/fail/verify, restore start/success/fail, integrity check, export, import, activation success/fail,
and every destructive action with its confirmation method.

## 6. Security testing (see `docs/testing/TESTING_STRATEGY.md`)

Wrong password, lockout, permission bypass attempts at every layer, path traversal, malicious filenames,
oversized/malformed attachments, SQL injection vectors, tampered activation state and config, tampered
audit rows (chain verification must fail), restore of corrupt backup, and unauthorized destructive-action
attempts are all automated.
