# Dentiva Pro — Non-Functional Requirements

**Document ID:** NFR-001 · **Version:** 1.0.0 · **Status:** Approved · **Measurement:** see §9 targets

| ID | Category | Requirement |
|---|---|---|
| NFR-001 | Offline | 100 % of clinic workflows function with no network adapter present. No runtime HTTP requests. |
| NFR-002 | Platform | Windows 10 22H2 (19045) and Windows 11 23H2+ x64. NSIS per-user install, no admin rights, 500 MB free disk (plus data growth). |
| NFR-003 | Performance | Meet the budget in `docs/architecture/ARCHITECTURE.md` §9 at the documented stress dataset; no UI freeze > 100 ms from a synchronous operation; long jobs stream progress. |
| NFR-004 | Scale | Unlimited patients/visits/prescriptions/invoices/payments/attachments/audit rows (architecture-level, bounded only by disk). No artificial caps; paging everywhere (25–100 rows per page). |
| NFR-005 | Reliability | No crash from a malformed file, invalid input, missing printer or unavailable backup destination; database remains consistent across forced termination (WAL + transactions); error boundaries per route. |
| NFR-006 | Data integrity | FK enforcement, unique business keys, non-negative money/stock, generated invoice balance, immutable ledgers, integrity + chain verification commands. |
| NFR-007 | Security | scrypt password hashing, lockout, auto-lock, session in main process, business-layer RBAC, parameterised SQL, strict CSP, sandboxed renderer, path-traversal protection, redacted logs, tamper-evident audit chain. |
| NFR-008 | Usability | A receptionist can register a patient and book an appointment in < 60 s; a dentist can produce a printed prescription in < 90 s from a patient profile with keyboard only. |
| NFR-009 | Visual quality | Compliant with `docs/ux/DESIGN_SYSTEM.md`; verified at 1366×768, 1600×900, 1920×1080, 2560×1440, 3840×2160 and 100/125/150/175/200 % DPI; no clipping/overflow, no orphan grid rows, grid mathematically balanced. |
| NFR-010 | Accessibility | Keyboard-complete operation, visible focus, ≥ 4.5:1 text contrast, ARIA on composite widgets, screen-reader labels, no colour-only status, logical tab order. |
| NFR-011 | Localization readiness | All UI strings come from a central string module (no inline business-logic strings); Bengali input/print/PDF first-class; date/number/currency formats configurable. |
| NFR-012 | Maintainability | TypeScript strict; layered architecture; one component per design-system element; no dead code, TODO markers, debug logs or unused dependencies in the release; ESLint clean. |
| NFR-013 | Observability | Structured JSON logs with rotation/retention, correlation of errors with user-visible reference codes, never logging secrets or clinical payloads. |
| NFR-014 | Backup/Restore | Verified backups with manifest + SHA-256; restore is validated, atomic and reversible; automatic backups 7/15/30 days with explicit failure surfacing. |
| NFR-015 | Printing | A4/A5/A6/Letter/58 mm/80 mm supported for prescription and invoice; preview equals print; PDF embeds fonts; print failures never lose documents or crash the app. |
| NFR-016 | Packaging | Reproducible build with version, build number and commit SHA embedded; NSIS installer + portable exe; data preserved on uninstall; artifacts checksummed and published (GitHub Release or `dist/`). |
| NFR-017 | Compliance/Privacy | No telemetry, no cloud, patient data stays local; no unverified legal-compliance claims; dependency licences audited and documented in third-party notices. |
| NFR-018 | Testability | Unit, integration, component and E2E suites as per `docs/testing/TESTING_STRATEGY.md`, all green in CI before release. |
