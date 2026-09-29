# Dentiva Pro

**Advanced offline dental clinic management system for Windows** — a complete, commercial-grade practice
management product for dental clinics. No cloud. No subscription. No internet required to run a clinic.

Built by **Shohan Khan** · <helloiamshohan@gmail.com>

---

## Highlights

* **Fully offline** — patients, visits, dental chart, appointments, queue, prescriptions, invoices,
  payments, inventory, accounting, reports, backup/restore and printing all work with the network cable
  unplugged.
* **Premium printed output** — prescriptions and invoices on A4/A5/A6/58 mm/80 mm, Windows printers,
  Wi-Fi/Bluetooth devices, and identical save-as-PDF with embedded **Bengali + English** fonts.
* **Real clinical records** — unlimited patients and visits, FDI adult & pediatric dental chart with
  per-visit snapshots, structured prescriptions (C/C, O/E, R/E, advice + multiple medicines), referrals,
  attachments and a unified patient timeline.
* **Money you can trust** — integer poisha arithmetic (no floating point), partial/over payments,
  voiding instead of deleting, generated balances that can never drift from invoices and payments.
* **Granular RBAC enforced in the business layer** — administrators, dentists, receptionists, accountants,
  assistants and auditors, with per-user allow/deny overrides and tamper-evident audit trail.
* **Data safety** — verified backups with manifests and SHA-256 checksums, automatic 7/15/30-day backups,
  validated atomic restore with mandatory pre-restore backup, crash-safe SQLite (WAL + transactions) and
  schema migrations.
* **Windows-native delivery** — NSIS installer (no admin rights needed), Start Menu/desktop shortcuts,
  data-preserving uninstall, remembered window state, high-DPI aware.

## Documentation

| Document | Path |
|---|---|
| Architecture (stack decision, layers, budgets) | `docs/architecture/ARCHITECTURE.md` |
| Requirement IDs | `docs/requirements/FUNCTIONAL_REQUIREMENTS.md`, `docs/requirements/NON_FUNCTIONAL_REQUIREMENTS.md` |
| Product requirements | `docs/requirements/PRD.md` |
| Database design | `docs/database/DATABASE_DESIGN.md` |
| RBAC specification | `docs/security/RBAC_SPECIFICATION.md` |
| Security specification | `docs/security/SECURITY_SPECIFICATION.md` |
| Design system | `docs/ux/DESIGN_SYSTEM.md` |
| Print & PDF system | `docs/printing/PRINT_SYSTEM.md` |
| Backup & restore | `docs/backup-restore/BACKUP_RESTORE_SPECIFICATION.md` |
| Testing strategy | `docs/testing/TESTING_STRATEGY.md` |
| Acceptance tests | `docs/testing/ACCEPTANCE_TEST_CHECKLIST.md` |
| Traceability matrix | `docs/requirements/REQUIREMENT_TRACEABILITY.md` |
| Release specification | `docs/release/RELEASE_SPECIFICATION.md` |
| Dependency & licence audit | `docs/compliance/DEPENDENCY_AUDIT.md`, `docs/compliance/THIRD-PARTY-NOTICES.md` |
| User guide | `docs/user-guide/USER_GUIDE.md` |
| Architecture decisions | `docs/decisions/ADR-0001…0006` |
| Project state (resume protocol) | `docs/project-state/BUILD_STATE.md`, `docs/project-state/IMPLEMENTATION_CHECKLIST.md` |

## System requirements (tested)

| Item | Minimum | Notes |
|---|---|---|
| OS | Windows 10 22H2 (64-bit) | Windows 11 23H2+ also supported and tested |
| CPU | Dual-core 2.0 GHz | |
| RAM | 4 GB | 8 GB recommended for very large databases |
| Disk | 500 MB free for the application + space for clinic data | Data folder grows with attachments/backups |
| Display | 1366×768, 100 % scaling | 100–200 % DPI supported, up to 3840×2160 |
| Printer | Any Windows-installed printer | A4/A5/A6/Letter; 58 mm and 80 mm thermal; network/Bluetooth printers supported |
| Permissions | Standard user (no administrator rights required) | Data is stored in the user's AppData folder, or a clinic-chosen data folder |

## Install

1. Run `DentivaPro-Setup-<version>-x64.exe`.
2. Choose the install directory (per-user install, no admin rights).
3. Launch Dentiva Pro and complete the setup wizard: activation code → clinic details → dentist(s) →
   administrator account → data folder.
4. Start working. Automatic backups can be configured in **Administration → Backup & Restore**.

Uninstalling removes the application only — the clinic data folder is preserved and the uninstaller says so.

## Build from source

```bash
npm install            # installs Electron + dependencies
npm run build          # typecheck + build main/preload/renderer bundles
npm run package:win    # Windows NSIS installer + portable exe  -> release/
npm test               # unit + integration tests (Vitest)
npm run test:e2e       # end-to-end acceptance suite (Playwright + Electron, Windows)
npm run verify         # lint + typecheck + tests with coverage
```

Requirements for building: Node.js ≥ 20 and npm. No Visual Studio toolchain is required — the SQLite
driver ships N-API prebuilt binaries for Windows x64.

## Test

```bash
npm run lint          # ESLint, zero warnings
npm run typecheck     # TypeScript strict (node + web projects)
npm test              # unit + integration suites
npm run test:coverage # coverage report
npm run test:e2e      # Playwright Electron acceptance tests (Windows)
npm run audit:deps    # dependency + licence audit
```

The activation verifier is bound to a fixed offline secret, so the integration and end-to-end suites
need that secret to run:

```bash
DENTIVA_ACTIVATION_CODE=... npm run test:integration
```

Without it those tests are **reported as skipped**, and `.github/workflows/ci.yml` refuses to run the
integration and end-to-end jobs, so a green pipeline can never mean "the tests were skipped".
The code itself is deliberately not stored in the repository; for CI add it as the repository secret
`DENTIVA_ACTIVATION_CODE` (Settings -> Secrets and variables -> Actions -> New repository secret).

## Release

```bash
# on a clean checkout of the release tag/branch
npm ci
npm run verify
npm run package:win
node scripts/verify-release-artifact.mjs
```

Artifacts land in `release/` (installer, portable exe, `latest.yml`, `SHA256SUMS.txt`) and are published by
`.github/workflows/release.yml` to a GitHub Release; when publication is not possible the same artifacts are
committed to `dist/`. Final status, test evidence and artifact locations are recorded in
`RELEASE_READINESS.md`.

## Printing

Printers are configured in **Administration → Settings → Printing** (profiles for prescription, invoice and
report documents; paper size, orientation, margins, scale, copies). Every print job is previewed with the
exact layout that will be printed. Prescriptions reserve at least 25 mm of clear space for a handwritten
signature with nothing printed under it; invoices print clinic header information only, with no signature
block.

## Troubleshooting

| Symptom | Resolution |
|---|---|
| Printer not listed | Install the printer in Windows first; Bluetooth printers must be paired and switched on |
| Bengali text prints as boxes | Use a printer driver with Unicode support (most modern drivers); PDF export always embeds fonts |
| Backup fails ("destination unavailable") | The chosen backup folder/drive is missing or read-only — reconnect it or pick another folder in Settings → Backup |
| Forgotten administrator password | Another administrator can reset it in **Administration → Staff & Users**; if the only admin password is lost, restore a backup from when it was known |
| Application asks to re-activate | The activation record was modified or the data folder was moved; re-enter the activation code |
| Data looks empty after reinstall | Your data was not deleted — point Settings → Data Location at the previous data folder |

## Licence & dependencies

The product is commercially licensed (see `LICENSE`). All bundled third-party components are open source
with commercially compatible licences (MIT/ISC/Apache-2.0/BSD/OFL); the complete inventory with versions,
purposes and licences is in `docs/compliance/THIRD-PARTY-NOTICES.md`, generated from the lockfile by
`npm run licenses` and verified by `npm run audit:deps`.

Copyright © 2026 Shohan Khan. All rights reserved.
