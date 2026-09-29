# Dentiva Pro — Architecture

**Document ID:** ARCH-001
**Version:** 1.0.0
**Status:** Approved (implementation contract)
**Owner:** Principal Software Architect
**Related:** ADR-0001 … ADR-0006 (`docs/decisions/`), `docs/database/DATABASE_DESIGN.md`,
`docs/security/SECURITY_SPECIFICATION.md`

---

## 1. Product summary

Dentiva Pro is a **fully offline, single-machine, multi-user Windows desktop application** for dental
clinic management, targeted at clinics in Bangladesh. It is sold as a commercial product, is installed
from a Windows installer, requires a one-time offline activation code, and then runs a complete clinic:
patients, visits, dental chart, appointments, queue, prescriptions, invoices, payments, inventory,
accounting, staff, users/RBAC, audit log, attachments, notifications, backup/restore, printing and PDF.

There is **no cloud dependency, no paid service, no telemetry and no network requirement** for any
clinic workflow. Currency is BDT (৳) with a safe monetary representation. The UI language is English;
Bengali Unicode is fully supported for all user-entered content and all rendered output (screen, print,
PDF).

---

## 2. Technology selection and rationale

| Layer | Choice | Version | Why this choice (evaluation criteria) |
|---|---|---|---|
| Application shell | **Electron** | 38.x | Mature, LTS-grade, best-in-class printing (`webContents.print`, `printToPDF`, printer enumeration, per-call paper/device options), Chromium rendering gives reliable high-DPI + Unicode/Bengali shaping, huge ecosystem, NSIS installer tooling, works fully offline. Alternatives rejected: Tauri (WebView2 print/PDF surface is weaker and less predictable for A4/A5/thermal documents; WebView2 runtime dependency on clean machines), .NET/WPF (Bengali complex-script shaping is significantly harder; PDF generation would pull commercial or heavy libraries). |
| Language | **TypeScript** 5.9 (strict) | 5.9 | Single language across main/preload/renderer; compile-time contracts between layers; strict mode everywhere. |
| Build tooling | **electron-vite** (Vite 7 + esbuild) | 5.0 | First-class Electron main/preload/renderer build, fast HMR in development, correct CJS/ESM handling, deterministic production bundles. |
| UI | **React 19** | 19.3 | Component model required by the design system, huge verified ecosystem, no runtime network needs. |
| Styling | **Hand-built CSS design system** (CSS variables + layered component CSS) | — | No CSS framework: full control over premium clinical visual identity, no unused framework weight, no dependency/licence risk, no "generic Bootstrap dashboard" look (explicit product requirement). |
| Icons | **lucide-react** | 1.x | ISC licence, tree-shakeable, consistent 24px grid (no mixed icon metrics). |
| Database | **SQLite via better-sqlite3** | 13.x | Embedded, transactional (ACID), single-file, WAL for crash recovery, foreign keys enforced, commercial-friendly licence (MIT), **N-API prebuilt binaries for win32-x64 shipped inside the npm package** (no compiler, no post-install download → reproducible offline-friendly CI and clean-machine installs). |
| Validation | **zod** 4 | 4.6 | Single schema source used for IPC payload validation, form validation and error messages; no runtime network. |
| Money | Custom `Money` module (integer poisha) | — | Deterministic arithmetic, no floating point in any financial path. |
| Logging | Custom structured JSON-lines logger (main process) | — | Rotation, redaction, no dependency; logs never contain secrets or patient clinical payloads. |
| Tests | **Vitest** + Testing Library + **Playwright (Electron)** | 5 / 16 / 1.6x | Unit + integration run in Node against a real SQLite database; E2E drives the real packaged Electron app on Windows in CI. |
| Installer | **electron-builder** (NSIS, per-user, changeable directory) + `build/installer.nsh` | 26.x | Professional Windows installer, uninstaller, shortcuts, data-preserving uninstall, no admin elevation required. |
| CI/CD | **GitHub Actions** (`ubuntu-latest` + `windows-latest`) | — | Lint, typecheck, unit, integration, build, package, E2E, dependency/licence audit, artifact validation, GitHub Release. |

### 2.1 Alternatives considered and rejected

* **Tauri + Rust**: smaller binaries and strong security model, but document printing (A4/A5/thermal with
  precise control), `printToPDF` with embedded fonts, and printer enumeration are markedly weaker than
  Chromium's print pipeline, and WebView2 is an extra runtime dependency on clean machines.
* **.NET 8 + WPF**: excellent Windows integration, but complex-script (Bengali) text shaping and PDF
  generation require additional commercial/heavy components, and the developer velocity for a
  60+ screen product is lower than with the web stack.
* **Node + embedded webview without Electron**: no reliable Windows installer + printing story.
* **Web/cloud SPA**: violates the offline-first product requirement outright.

---

## 3. Process architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Electron main process (Node.js, privileged)                                  │
│                                                                              │
│  index.ts            app lifecycle, single-instance lock, window state,      │
│                      crash guards, auto-lock timer, auto-backup scheduler     │
│  ipc/router.ts       ── THE ONLY ENTRY POINT FROM THE RENDERER ──            │
│                      • channel allow-list    • zod payload validation        │
│                      • session/permission gate (business layer)              │
│                      • error translation     • audit hooks                   │
│  services/*.ts       business logic (authorization lives HERE)               │
│  repositories/*.ts   SQL, transactions, row→domain mapping                   │
│  db/*.ts             connection, PRAGMAs, migrations, integrity checks        │
│  printing/*.ts       print window, device enumeration, printToPDF            │
│  backup/*.ts         backup/restore engine, verification, scheduling          │
│  security/*.ts       password hashing, activation verification, lock manager  │
│  storage/*.ts        managed file system layout, path safety, attachments     │
└───────────────────────────────▲──────────────────────────────────────────────┘
                                │  contextBridge (single, typed, whitelisted API)
┌───────────────────────────────┴──────────────────────────────────────────────┐
│ Preload (sandboxed, no Node integration)                                     │
│  window.dentiva = { invoke(channel, payload), on(event, cb), app: {...} }     │
│  • no ipcRenderer exposure • no fs • no require • no remote module             │
└───────────────────────────────▲──────────────────────────────────────────────┘
                                │  promise-based request/response + events
┌───────────────────────────────┴──────────────────────────────────────────────┐
│ Renderer (React 19 SPA, contextIsolation, sandbox, CSP, no nodeIntegration)   │
│  design system → layout shell → feature modules → hooks → api client          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Why a single `invoke` channel

The renderer can only call `dentiva.invoke(channel, payload)`. In the main process, `ipc/router.ts`
holds the **registry of every legal channel** with its zod schema, required permission, audit policy and
handler. Anything not registered is rejected and logged as a security event. This gives one auditable
place to review the entire renderer→main attack surface, prevents "hidden" endpoints, and satisfies the
requirement that authorization is enforced in the business layer rather than in the UI.

### 3.2 Business-layer authorization (REQ: §36, §42)

Every route declares `permission: 'patients.view'` (or `null` for pre-auth routes such as setup and
login). The router resolves the **current session** in the main process — the renderer cannot pass a
user id, role or "I am admin" flag. Permission resolution order:

1. user is authenticated and active, session not locked
2. role permissions (`role_permissions`)
3. per-user overrides (`user_permissions` with `allow` / `deny`, deny wins)
4. destructive/financial routes additionally require the specific granular permission

A denied call returns `{ ok: false, error: { code: 'FORBIDDEN' } }` **before** any repository is
touched, so no protected data can be read through any UI path, keyboard shortcut, crafted IPC payload
or direct component call. Repositories are never reachable from the renderer.

---

## 4. Threading, responsiveness and startup

* Main process is single-threaded but never blocks the renderer: all SQL runs in the main process on a
  synchronous better-sqlite3 connection, which is fast (µs–ms) and executed inside IPC handlers, so the
  renderer (a separate process) is never blocked; UI shows loading states.
* Long-running operations (backup, restore, export, PDF rendering, stress seed) report progress through
  `dentiva.on('job:progress')` and are cancellable where safe.
* Startup path: `app.whenReady()` → create window immediately with a **splash/first-run gate** → open DB
  → run migrations → initialize session state. Typical cold start target < 3 s (see §9 performance
  budget). Migrations run in a transaction; failures leave the previous schema intact and show a
  recovery dialog.
* Windows are created with `backgroundColor` matching the app background (no white flash),
  `show: false` + `ready-to-show` (no blank flash), remembered bounds, and always on-screen validation.

---

## 5. Data storage layout (managed, predictable, portable)

The application never writes into the installation directory (Program Files is read-only in practice).
The single data root is chosen at setup and stored in `%APPDATA%\Dentiva Pro\config\app-config.json`
(portable: a `data-root.txt` next to the executable is honoured if present, enabling clinic-managed
storage on a specific drive).

```
<DataRoot>/                            default: %APPDATA%\Dentiva Pro\data
├── Database/
│   ├── dentiva.db                     SQLite (WAL, FK on, synchronous=FULL checkpoints)
│   ├── dentiva.db-wal / -shm
│   └── integrity/                     integrity check reports
├── Attachments/
│   └── Patients/<PatientCode>/<uuid>-<sanitized-name>.<ext>
├── Backups/
│   ├── DentivaPro_Backup_YYYY-MM-DD_HH-mm-ss/
│   │   ├── manifest.json              version, schema, counts, per-file sha256
│   │   ├── DentivaPro.db
│   │   ├── attachments/               (copied tree, only referenced files)
│   │   └── config/                    clinic/print/notification settings snapshot
│   └── restore-log.jsonl
├── Exports/
├── Logs/                              app-YYYY-MM-DD.jsonl (rotating, 30 days / 10 MB)
├── Temp/                              scratch; purged at startup
└── Config/                            app-config.json, print-profiles fallback, window-state.json
```

All file paths stored in the database are **relative to the data root**. Attachment names are
sanitised, de-duplicated by UUID, and every resolved path is validated to stay inside the data root
(path-traversal prevention, REQ §87). Unreferenced files are never deleted implicitly.

---

## 6. Printing and PDF architecture

The print engine is a **document model → layout → Chromium print** pipeline (see
`docs/printing/PRINT_SYSTEM.md`):

1. A service builds a typed `PrintDocument` (header/patient/clinical/medicine/footer nodes) from the
   database — never from renderer-supplied HTML.
2. The renderer renders the document model into an isolated print surface
   (`PrintHost` screen with mm-accurate page CSS) so **print preview is the same code path as print**.
3. `printing/print-service.ts` sends the preview page to a dedicated offscreen `BrowserWindow` and calls
   `printToPDF` (Save as PDF, with embedded fonts) or `webContents.print(..., { deviceName, pageSize,
   margins, scale, copies })` for physical printers, honouring the selected `printer_profiles` row.
4. Paper adapts by CSS page size (`A4`, `A5`, `A6`, `Letter`, `58 mm`, `80 mm`, custom width in mm);
   thermal profiles switch to a single-column, large-type layout. No per-printer hardcoded layout.
5. Jobs are logged (device, paper, document type, page count, success/failure) — never patient content.

Fonts: Inter (Latin) and Noto Sans Bengali (Bengali) are bundled OFL font files inside the application
(`@fontsource` packages copied into the renderer bundle), loaded with `@font-face` in both screen and
print CSS so PDF output embeds them and Bengali never falls back to a missing glyph.

---

## 7. Security model (summary, details in `docs/security/`)

* Passwords: **scrypt** (Node `crypto.scryptSync`, N=2^15, r=8, p=1, 32-byte key, 16-byte random salt),
  stored as `scrypt$N$r$p$salt$hash`, constant-time comparison, no plaintext anywhere.
* Lockout: after 5 consecutive failures the username is locked for 5 minutes (configurable); every
  attempt is audited, including failures.
* Auto-lock: idle timer 5/10/15/30 min (configurable) → session marked locked, renderer shows lock
  screen with **no protected data**, main process rejects every non-unlock channel until re-auth.
* Renderer hardening: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `webSecurity: true`, strict CSP (`default-src 'self'`), no `eval`, no remote content, `will-navigate`
  and `setWindowOpenHandler` blocked, `webviewTag: false`.
* SQL: every statement is parameterised; no string concatenation of user input. Dynamic sort/filter
  columns are validated against allow-lists.
* Audit log: append-only table protected by a **SHA-256 hash chain** (`hash`, `prev_hash`) plus a
  sensitive-action guard in the router; there is no delete/update route for audit rows.
* Activation: the fixed offline activation code is never stored or compared as plaintext. Verification
  uses a **PBKDF2-SHA512 derived verifier** (see ADR-0004) and the activation state is itself
  hash-chained with machine-independent installation data, so tampering is detected (documented as
  casual-extraction resistance, **not** unbreakable secrecy).

---

## 8. Reliability, error handling, crash recovery

* **Global guards**: `process.on('uncaughtException')` / `unhandledRejection` in main → log, show a
  safe dialog, keep the app alive where possible; renderer has a React error boundary per route plus a
  global boundary.
* **Every IPC handler** returns a discriminated result `{ ok: true, data } | { ok: false, error }`, so a
  subsystem failure can never take down the window; the UI renders an error state with a retry action.
* **Database**: WAL journaling, `foreign_keys=ON`, `busy_timeout`, `synchronous=NORMAL` (WAL) with
  `wal_checkpoint(TRUNCATE)` on clean shutdown, `PRAGMA integrity_check` after restore and on demand.
* **Transactions**: all multi-row writes (invoice+items+payment, stock movement+batch+ledger, visit
  finalisation+chart snapshot, restore) run inside explicit transactions; a forced kill mid-transaction
  rolls back and leaves a consistent database (tested).
* **Backup/restore**: backup uses SQLite's online backup API (consistent even with an open WAL), then
  verifies the copy with `integrity_check` + per-file SHA-256 manifest; restore always creates a
  **pre-restore backup** and is atomic (validate → stage → swap → verify) with rollback on failure.
* **Logging**: structured JSON lines with rotation; secrets, passwords, activation material and clinical
  free text are never logged.

---

## 9. Performance budget and strategy

| Operation | Target (mid-range clinic PC) | Strategy |
|---|---|---|
| Cold start to login | ≤ 3.0 s | minimal main bundle, DB open + migration check only |
| Warm start | ≤ 1.5 s | single connection, no re-scan |
| Patient list page (25 rows) | ≤ 120 ms | server-side (main-process) paging, covering indexes |
| Global search | ≤ 250 ms @ 50k patients | indexed LIKE prefix search + UNION over entity types, limit 10/type |
| Patient profile (counts+timeline page) | ≤ 300 ms | aggregated counts query + paged timeline |
| Prescription editor open | ≤ 200 ms | lazy route, catalog cached in memory |
| Invoice creation w/ 20 items | ≤ 250 ms | single transaction, computed totals |
| Print preview first paint | ≤ 600 ms | same-code-path preview, fonts preloaded |
| Backup (5 GB data) | ≤ 60 s | SQLite online backup + streaming copy with progress |
| Restore (5 GB data) | ≤ 90 s | staged validation then atomic swap |

Stress datasets used for verification: 5,000 patients, 20,000 visits, 20,000 appointments,
15,000 prescriptions, 15,000 invoices, 25,000 payments, 5,000 inventory transactions, 3,000 audit rows,
200 attachments (`scripts/seed-stress-data.mjs`). Indexes and paging were designed for this scale.

---

## 10. Build, packaging and release

* `npm run build` → typecheck + `electron-vite build` → `out/{main,preload,renderer}`.
* `npm run package:win` → `electron-builder --win` → NSIS installer
  `release/DentivaPro-Setup-<version>-x64.exe` + portable `.exe` + `latest.yml` + `SHA256SUMS`.
* Packaging keeps `better-sqlite3` unpacked (`asarUnpack`) so its N-API `.node` binary loads.
* GitHub Actions (`.github/workflows/ci.yml`, `release.yml`): on `ubuntu-latest` run lint, typecheck,
  unit, integration, dependency/licence audit; on `windows-latest` run build, package, artifact +
  installer validation, E2E acceptance workflow, then publish artifacts to a GitHub Release. If GitHub
  Release publication is unavailable, the same artifacts are committed/uploaded to `dist/`.
* Release artifacts are recorded with version, build number, commit SHA, build date and SHA-256
  checksums in `RELEASE_READINESS.md`.

---

## 11. Development-only web harness (explicitly non-shipping)

To allow UI/UX verification and previews in environments without a Windows GUI, `scripts/preview-server.mjs`
serves the renderer through Vite and proxies the exact same `invoke(channel, payload)` contract to a
Node host that runs the **real** main-process router, services and SQLite database. The renderer's web
bridge is activated **only** when `import.meta.env.VITE_DENTIVA_WEB_HARNESS === '1'`, which is set
exclusively by that script; the packaged application always uses the preload bridge. This exists for
design QA and demonstration and is not part of the production runtime path.

---

## 12. Architecture decision records

| ADR | Decision |
|---|---|
| ADR-0001 | Electron + TypeScript + React + SQLite (better-sqlite3) stack |
| ADR-0002 | Money as integer poisha; quantities as integer milli-units |
| ADR-0003 | HTML/CSS document model + Chromium print pipeline for print/PDF |
| ADR-0004 | Offline activation: PBKDF2-derived verifier + hash-chained activation state |
| ADR-0005 | Managed data root with relative paths, attachments keyed by patient code |
| ADR-0006 | Audit log as append-only hash chain; business-layer authorization |

---

## 13. Traceability

Requirement identifiers used by `docs/requirements/` are the contract; implementation status for each is
tracked in `docs/project-state/IMPLEMENTATION_CHECKLIST.md`, and verification in
`docs/testing/ACCEPTANCE_TEST_CHECKLIST.md` with the matrix in
`docs/requirements/REQUIREMENT_TRACEABILITY.md`.
