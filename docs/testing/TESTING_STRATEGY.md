# Dentiva Pro — Testing Strategy

**Document ID:** TEST-001 · **Version:** 1.0.0 · **Status:** Approved
**Evidence:** test files under `tests/`, CI runs in `.github/workflows/ci.yml`, reports in `test-results/`

---

## 1. Test levels

| Level | Tooling | Location | Runs on |
|---|---|---|---|
| Unit | Vitest (node env) | `tests/unit/**` | all platforms, every push |
| Integration (real SQLite) | Vitest (node env, temp data root) | `tests/integration/**` | all platforms, every push |
| Component/UI | Vitest + jsdom + Testing Library | `tests/unit/renderer/**` | all platforms, every push |
| End-to-end (real Electron app) | Playwright `_electron` | `tests/e2e/**.e2e.ts` | `windows-latest`, every push + release |
| Stress/performance | Vitest + seeded dataset | `tests/integration/performance.test.ts` | CI (reduced dataset) and release (full dataset) |
| Print/PDF fidelity | Vitest + PDF fixture assertions | `tests/integration/print.test.ts` | CI |
| Pre-release audits (REQ §113) | Node script over the real repository | `scripts/pre-release-audit.mjs` | all platforms, every push (maintenance job) |
| Traceability freshness | Node script comparing the generated matrix | `scripts/generate-traceability-matrix.mjs --check` | all platforms, every push (maintenance job) |
| Packaging/installer | GitHub Actions step + `scripts/verify-release-artifact.mjs` | `release.yml` | `windows-latest` on release |

## 2. What must be covered (REQ §100)

**Unit:** money arithmetic (add/sub/percent/discount/allocate/rounding/parse/format), quantity milli-units,
date & age calculation, patient-code/invoice-number generation format, validation schemas (zod) for every
entity, permission resolution & catalogue integrity, password policy & hashing (scrypt round-trip, timing-safe
compare, wrong password), activation verifier (correct/incorrect/empty/whitespace/Bengali digits/repeated),
audit hash-chain computation, backup manifest computation, inventory calculations (stock levels, expiry
windows, low-stock thresholds), invoice totals (discounts, tax, round-off, partial/overpaid), receipt
numbering, printer paper geometry, clinical option normalisation, path-safety sanitiser, CSV escaping.

**Integration:** patient → visit → chart snapshot → prescription → invoice → payment chains; invoice
totals against payments (partial/full/overpay/void); inventory purchase → usage → adjustment with ledger
reconciliation and no negative stock; expense creation and reporting aggregates; RBAC enforcement per
channel (deny cases), user/role management invariants; audit chain verification and tamper detection;
backup/restore round-trip, corrupt/truncated/checksum-tampered backups rejected, pre-restore backup
guaranteed, encrypted round-trip; attachment lifecycle (add/preview-metadata/rename/delete/export,
malicious names, oversized files, malformed content); settings changes audited and effective; global
search across entities with filters; notifications generation and dedupe (with deduplication, read/unread and
dismissal); the operational rules around data management (typed-phrase + password destructive actions, the
verified pre-action backup, the full reset that keeps the audit trail, and the all-or-nothing CSV patient
import with its per-row validation, duplicate detection, dry run and permission refusal); migrations from an
empty database and from a v1 fixture; crash-recovery (a write that throws mid-transaction and a transaction
abandoned by a second connection both roll back); performance budgets with the seeded dataset.

**E2E (real app, Windows):** the acceptance workflow in `docs/testing/ACCEPTANCE_TEST_CHECKLIST.md`
(install → activate → setup → login → patient → visit → chart → prescription → print/PDF → appointment →
invoice → partial payment → balance payment → inventory → expense → reports → attachment → global search →
lock/unlock → backup → restore → audit log → restart → data verification), plus permission-restricted
scenarios, auto-lock timing, keyboard shortcuts, empty/loading/error states, and DPI/layout checks.

## 3. Test data policy

* Unit/integration tests build data through the real services (never raw INSERTs) so business rules are
  exercised; no production seed contains demo patients (REQ §119).
* `scripts/seed-stress-data.mjs` creates a large dataset **only** into a temporary/approved data root and is
  never run against a clinic database; it is used for performance verification.
* Fixtures for migrations live in `tests/fixtures/`, are committed, and are versioned with the schema.

## 4. Quality gates (CI must pass before release)

1. `npm run lint` (0 warnings), `npm run typecheck` (node + web), `npm run format:check`.
2. `npm run test:coverage` — all tests green; coverage reported for main/shared (targets: money, validation,
   auth, RBAC, backup = 100 % of branches; services ≥ 80 %).
3. `npm run build` (renderer/main/preload bundles produced).
4. `npm run package:win` on Windows → NSIS installer + portable exe produced.
5. `scripts/verify-release-artifact.mjs` — artifact exists, non-empty, PE x64, version/checksum recorded.
6. E2E acceptance suite on Windows against the built app.
7. `npm run audit:deps` + `npm run licenses` — no high/critical advisories, all licences compatible.
8. Manual audits: functional, UI/UX/visual, database, security, print matrix, performance, dependency,
   installer, backup/restore, release (results in `RELEASE_READINESS.md`).
9. `npm run audit:prerelease` — the fourteen automated pre-release audits of REQ §113. The two that need a
   packaged Windows build (A13 pipeline evidence, A14 release artefacts) report **skipped** off Windows and
   must be green before a release; a skip is never reported as a pass.
10. `npm run docs:traceability` — the requirements matrix (`docs/testing/TRACEABILITY_MATRIX.md`) is
   regenerated from the specification, the acceptance checklist and the design records, and
   `--check` fails the build when it drifts.

## 5. Defect handling

A failing test blocks release. Fixes trigger the affected suite plus the neighbouring regression suites
(the full unit/integration suite always runs, it is fast). UI defects are verified visually via the
harness/E2E screenshots before being closed. No test is disabled to make the build green; quarantining is
not used (REQ §112).
