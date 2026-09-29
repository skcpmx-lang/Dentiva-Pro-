# Dentiva Pro — Release Readiness

**Document ID:** REL-READY-001 · **Version:** 1.0.0 · **Status reviewed:** 2026-09-30
**Branch:** `main` (session work branches off it) · **Commits reviewed:** see the table in *Build identity* below.

This document is the honest answer to one question: **can this commit be shipped to a clinic today?**
It is written by the person who ran the gates, records what was actually executed (and where), lists every
gate that has **not** been executed yet, and states the deviations from the specification with their
justification. Nothing here is inferred from a green compile.

Reading order: *Verdict* → *Gates* → *Pending evidence* → *Known deviations* → *Release checklist*.

## Verdict

| Question | Answer |
|---|---|
| Is the source complete for the agreed scope? | **Yes** — every feature in `docs/requirements/` is implemented, reachable from the interface and covered by the traceability matrix. |
| Are the automated gates green? | **Locally yes** (lint, typecheck, build, unit, integration, maintenance tools, pre-release audits), and on GitHub the quality, maintenance and integration jobs are green — the integration job runs the whole suite with the activation secret instead of skipping it. The Windows end-to-end job now executes the Electron suite; it is failing and its output is published as a job annotation while the failures are worked through. The first windows-latest run of the *fast* suites (release run 36639642068, "Tests" step) failed with 12 EBUSY errors; the root cause (a leaked read-only backup-verification connection, see correction 13 in `BUILD_STATE.md`) is fixed with a regression test, and a `windows-tests` CI job now runs those suites on windows-latest on every push. |
| Has a Windows installer been built and installed on a clean machine? | **No — this has never been executed.** The development sandbox has no Windows host, no Wine and no Electron binary, so packaging, install, print, PDF, DPI and Electron end-to-end evidence can only be produced by the `windows-latest` jobs of `.github/workflows/ci.yml` / `release.yml`. |
| Is there a releasable artefact? | **Not yet.** Until the Windows jobs run, `release/` is empty and `scripts/verify-release-artifact.mjs` fails by design. |
| Release decision | **Not releasable yet.** The remaining work is *evidence*, not code: run the Windows jobs, then re-check the tables below. |

## Gates

| Gate | Command | Where it ran | Result |
|---|---|---|---|
| Lint | `npm run lint` (eslint, `--max-warnings 0`) | local + CI quality job | **Pass** |
| Types | `npm run typecheck` (`tsconfig.node.json` + `tsconfig.web.json`) | local + CI quality job | **Pass** |
| Build | `npm run build` (electron-vite: main, preload, renderer) | local + CI quality job | **Pass** (renderer ≈ 1.45 MB JS + 49 kB CSS) |
| Unit tests | `npx vitest run tests/unit` | local + CI | **Pass** — 9 files / 138 tests (including the component suite) |
| Integration tests | `DENTIVA_ACTIVATION_CODE=… npx vitest run tests/integration` | local + CI | **Pass** — 8 files / 110 tests; the GitHub Actions `integration` job runs the same command with the repository secret and is green |
| Without the activation secret | `npx vitest run tests/integration` | local + CI | **Pass by skip** — activation-dependent suites report as skipped, never as passed |
| Maintenance tools | `npm run audit:deps`, `npm run licenses`, `node scripts/verify-backup.mjs`, stress seeder (reduced scale) | local + CI maintenance job | **Pass** |
| Pre-release audits (§113) | `npm run audit:prerelease` | local | **Pass** — 14 audits, all 12 host-independent ones pass (including a real backup produced and verified on the spot); the two Windows-only audits report a reasoned skip. The CI maintenance job runs the same command and uploads `pre-release-audit.md` as an artifact |
| Traceability | `node scripts/generate-traceability-matrix.mjs --check` | local + CI maintenance job | **Pass** — all 70 functional and 18 non-functional requirements are mapped to acceptance rows |
| Dependency and licence audit | `npm run audit:deps` | local + CI | **Pass** — 11 components, permissive licences only, `npm audit --omit=dev` clean |
| Performance (NFR-003) | `node scripts/seed-stress-data.mjs --scale 1` | local | **Pass** — see `docs/testing/PERFORMANCE_MEASUREMENTS.md` |
| Backup integrity | `node scripts/verify-backup.mjs <folder>` | local (stress-folder backup) + integration suite | **Pass**; a tampered backup fails with exit 1 |
| Windows packaging | `npm run package:win` | **never executed** | **Pending (windows-latest)** |
| Installer validation | `npm run verify:installer` | **never executed** | **Pending (windows-latest)** |
| Electron end-to-end | `npm run test:e2e` | **never executed** | **Pending (windows-latest)** |
| Clean-machine install / uninstall | `docs/release/` checklist | **never executed** | **Pending** |

## Test coverage summary

| Suite | Files | Tests | Notes |
|---|---|---|---|
| Unit | 8 | 126 | money, date, ids/dental/csv, printing, security/RBAC, validation, session/activation, window state |
| Integration | 8 | 110 | setup/auth, clinical, billing, admin, backup/audit, security hardening (router boundary, migrations, transactions, activation/audit tamper, global search), reports (payment dashboard, all ten reports, CSV export), operations (destructive safeguards, reset, patient filters, every notification category, setup validation, CSV import) |
| End-to-end (Playwright + Electron) | 3 | written, not executed | setup wizard, critical 101-step flow — **requires windows-latest** |

`docs/testing/ACCEPTANCE_TEST_CHECKLIST.md` carries the per-requirement detail: **53 Pass**, **4 pending
with the test written** and **9 pending** (every remaining pending row is Windows/Electron evidence, a
manual DPI/timing measurement, or packaging/CI infrastructure).

## Pending evidence (what is not yet proven)

1. **Windows installer** — build, PE architecture, embedded version/build/commit, checksums
   (`release.yml` → `package:win` → `verify:installer`). Blocks `AT-A06`, `AT-H03`, `AT-H04`. Status: the
   release job now passes checkout/install/lint/typecheck/secret gate on windows-latest; its "Tests" step
   (first vitest run on Windows) failed in run 36639642068 with 12 EBUSY teardown errors caused by the
   `closeDatabase` handle leak (fixed, regression-tested). The tag is being re-pointed to the fix commit
   and the next tag-triggered run must be green end to end before the installer can be claimed. The GitHub
   release, when it exists, must stay a **DRAFT** until every gate in this document is verified.
2. **Install / uninstall / data preservation on a clean machine** — blocks `AT-A06`.
3. **Electron end-to-end suites** (setup wizard, critical flow, keyboard shortcuts, empty/loading/error
   states) — blocks `AT-A07`, `AT-G01`, `AT-G02`, `AT-G03`, `AT-G04`, `AT-I01`.
4. **Print matrix and PDF fidelity** — A4/A5/A6/58 mm/80 mm paper, embedded Bengali fonts, preview equals
   print, Bluetooth/wireless device selection — blocks `AT-D06`, `AT-D07`.
5. **Multi-DPI and responsive screenshots** (100/125/150/175/200 % at 1366×768 … 3840×2160) — blocks
   `AT-G06`.
6. **Usability timings** (receptionist < 60 s, dentist < 90 s) — blocks `AT-G09`.
7. **Repository secret `DENTIVA_ACTIVATION_CODE`** — without it the `integration` and `e2e-windows` jobs fail
   at an explicit gate step. This is deliberate: a green build in which 40 integration tests and every
   Electron test were skipped would be a false claim. Blocks `AT-H06` and every CI-side row above.
8. **Component-level accessibility evidence** — the static audit proves every form control has an
   accessible name and that no screen re-types business text; screen-reader walkthrough and contrast
   measurements are manual and still outstanding (`AT-G05`).

## Known deviations and scope decisions

| # | Specification item | Status | Justification |
|---|---|---|---|
| D1 | Android/mobile application | **Out of scope (agreed)** | The deliverable is the Windows desktop product. Mobile support is achieved through paper-size-responsive print/PDF output (A4/A5/thermal), which is implemented and documented in `docs/printing/PRINT_SYSTEM.md`. |
| D2 | "Mathematically unrecoverable" activation secret | **Not claimed** | Activation is offline by design, so a determined reverse engineer can brute-force a fixed secret. The code is stored only as a PBKDF2-HMAC-SHA512 verifier (120 000 iterations, constant-time compare), it never appears in the repository, configuration, logs or the database, and the code literal was removed from the test fixtures that still contained it (audit A2 enforces this). ADR-0004 and the user guide state the limitation. |
| D3 | Windows version compatibility claims | **Not claimed** | Only Windows 10 22H2/Windows 11 x64 on `windows-latest` (or a real machine the clinic verifies) may be claimed. Nothing else has been tested. |
| D4 | Legal/regulatory compliance | **Not claimed** | No GDPR/HIPAA/ISO certificate is asserted. The product keeps all data local, ships no telemetry and documents its licence obligations; regulatory review is the clinic's responsibility. |
| D5 | Central UI string module (NFR-011, second half) | **Deviation** | Interface copy is English and written inline in the components. The verifiable half of the requirement is enforced instead: business enumerations (payment methods, statuses, genders, priorities, paper sizes, date formats) come from `src/shared/constants.ts` or the database, and audit A12 fails the build if a screen re-types a payment method or a status label. A string catalogue would add indirection without changing any user-visible behaviour; it stays a documented backlog item for future localisation. |
| D6 | Print preview *is* the print output | **Implemented, evidence pending** | The same `PrintDocument` model feeds preview, printer and PDF (`src/main/printing/build-document.ts`); the paper geometry assertions run in the unit suite. Visual equality is part of the Windows print-matrix evidence (item 4 above). |
| D7 | 84 permission codes in the original draft | **Superseded** | The implemented catalogue has 69 codes because several draft entries were duplicates of one another (`payments.print` folded into `payments.view` + print permission checks, `reports.financial.view` covering its own exports). `docs/security/RBAC_SPECIFICATION.md` lists the delivered catalogue and every service asserts its own code; the pre-release audit checks that every channel declared in `src/shared/ipc.ts` is implemented in the registry and permission-gated (159 at the time of writing). |

## Build identity

| Field | Value |
|---|---|
| Product | Dentiva Pro 1.0.0 |
| Author | Shohan Khan · helloiamshohan@gmail.com |
| Branch | `arena/01a0ee4f-dentiva-pro` |
| Commit / build number / date | recorded at build time in `build-info.json` inside the release folder (`scripts/verify-release-artifact.mjs` refuses to pass without it) |
| Artefacts | `release/DentivaPro-Setup-1.0.0-x64.exe` (+ portable, blockmap, `SHA256SUMS.txt`, `build-info.json`) — **not yet produced** |

## Release checklist (to be completed by the Windows run)

1. `gh secret set DENTIVA_ACTIVATION_CODE` so the integration and end-to-end jobs can execute.
2. Run the `CI` workflow on the release commit; all four jobs must be green.
3. Ensure `node scripts/generate-traceability-matrix.mjs --check` and `npm run audit:prerelease` are green in
   the maintenance job.
4. Dispatch the `Release` workflow (or push a `v1.0.0` tag); it packages with `DENTIVA_BUILD_NUMBER`, runs
   `npm run verify:installer`, and uploads the installer, blockmap, `SHA256SUMS.txt` and `build-info.json`.
5. Install the artefact on a clean Windows 11 machine (no admin rights), complete the setup wizard with the
   clinic's activation code, and walk the 101-step critical flow (`AT-I01`).
6. Install on a second machine, restore a backup taken on the first, and confirm the data matches.
7. Verify uninstall removes the binaries and preserves `%APPDATA%\Dentiva Pro` (user data survives).
8. Record every artefact hash, screenshot and print sample in `docs/release/evidence/` and update this
   document with the executed results — including failures.
