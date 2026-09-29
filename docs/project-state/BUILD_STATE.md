# Dentiva Pro — Build State (resume protocol)

> **If you are resuming this project: read this file first, then inspect the repository
> (`git log --oneline -10`, `git status`, run the test suite, check CI status). Finish the
> in-progress task before starting the next one. Never redo completed work.**

```yaml
project: Dentiva Pro
current_phase: 4 - Feature implementation (core platform complete, feature surface in progress)
branch: arena/01a0ee4f-dentiva-pro
last_updated: 2026-09-29
```

## Status

| Area | State |
|---|---|
| Requirements, architecture, ADRs, DB design, RBAC, design system, print, backup, testing docs | **Complete** |
| Project scaffolding (Electron + TS + React + SQLite + electron-builder + CI) | **Complete** |
| Database schema + migrations + repositories | In progress |
| Services + IPC router (business-layer authorization) | In progress |
| Renderer design system + shell | In progress |
| Feature modules (patients, visits, chart, appointments, queue, prescriptions, invoices, payments, inventory, accounting, reports, staff, users, attachments, search, notifications, backup/restore, settings) | In progress |
| Tests (unit / integration / component / E2E) | In progress |
| GitHub Actions CI + packaging | Workflows authored, first run pending |
| Windows installer build + E2E on windows-latest | Pending |
| Release (GitHub Release or `dist/`) | Pending |

## Machine-readable task state

```yaml
current_task: DB schema + core repositories and services
next_task: Patients + visits + chart services and UI
completed:
  - docs/* (requirements, architecture, ADRs, database, security, ux, printing, backup-restore, testing, release, compliance plan, project-state)
  - package.json, tsconfig(s), electron.vite.config.ts, vitest.config.ts, eslint, prettier, electron-builder.yml, installer.nsh, playwright.config
  - .gitignore, README.md
in_progress:
  - src/shared/** (money, quantity, dates, permissions, validation, constants, printing models)
  - src/main/db/** (connection, migrations, integrity)
failed_tests: []
known_issues: []
pending_fixes: []
last_successful_build: not yet (first build pending)
last_successful_test: not yet (first test run pending)
```

## Environment notes (important for resuming)

* The sandbox has **no Windows, no Wine and no access to GitHub release assets**
  (`release-assets.githubusercontent.com` is blocked), therefore:
  * The Electron binary cannot be downloaded here. `npm install` in the sandbox must be run with
    `ELECTRON_SKIP_BINARY_DOWNLOAD=1` (the Electron *npm package* and all tooling install fine).
    Electron runs only in GitHub Actions (`windows-latest`), where the binary downloads normally.
  * `better-sqlite3@13` ships N-API prebuilds inside the npm package (including `win32-x64`), so no
    compilation or binary download is needed anywhere.
* UI/UX verification and live previews in the sandbox use the development web harness
  (`npm run preview:harness`), which serves the renderer through Vite and proxies the real
  `invoke(channel, payload)` contract to the real main-process router and services over a local Node host
  with a real SQLite database. This harness is development-only and never active in packaged builds
  (`VITE_DENTIVA_WEB_HARNESS`).
* `node_modules/` is not preserved between sessions — re-run
  `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install` before working.

## How to resume in 5 steps

1. `git log --oneline -8 && git status` — confirm the branch and latest commit.
2. Read the `Machine-readable task state` block above (`in_progress` → finish it first).
3. `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install` then `npm run verify` to see the current test state.
4. Continue with `next_task`, maintaining this file at the end of the turn.
5. Update `docs/project-state/IMPLEMENTATION_CHECKLIST.md` and, when release gates pass,
   `RELEASE_READINESS.md`.
