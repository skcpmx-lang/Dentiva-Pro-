#!/usr/bin/env node
/**
 * Requirements traceability matrix generator (`docs/testing/TRACEABILITY_MATRIX.md`).
 *
 * Every functional and non-functional requirement in `docs/requirements/` is mapped to the design record
 * that specifies it, the modules that implement it and the acceptance rows that verify it. The mapping is
 * derived from the documents themselves, so it cannot drift: `--check` fails when the file on disk is not
 * what the current requirements and acceptance checklist produce (CI runs it, exactly like the
 * third-party notices freshness check).
 *
 * Usage:
 *   node scripts/generate-traceability-matrix.mjs            # write the matrix
 *   node scripts/generate-traceability-matrix.mjs --check    # fail if it is out of date
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './lib/paths.mjs'

const FRD = 'docs/requirements/FUNCTIONAL_REQUIREMENTS.md'
const NFRD = 'docs/requirements/NON_FUNCTIONAL_REQUIREMENTS.md'
const CHECKLIST = 'docs/testing/ACCEPTANCE_TEST_CHECKLIST.md'
const MATRIX = 'docs/testing/TRACEABILITY_MATRIX.md'

const read = (relative) => readFileSync(join(repoRoot, relative), 'utf8')

/** Where each requirement family lives: the design record and the implementing modules. */
const FAMILY_HOMES = {
  ACT: [
    'ADR-0004, `docs/security/SECURITY_SPECIFICATION.md`',
    '`src/main/security/activation.ts`, `src/main/services/setup-service.ts`'
  ],
  SETUP: [
    '`docs/ux/DESIGN_SYSTEM.md`, ADR-0001',
    '`src/main/services/setup-service.ts`, `src/renderer/src/features/setup/*`'
  ],
  SHELL: ['`docs/ux/DESIGN_SYSTEM.md`', '`src/renderer/src/app/Shell.tsx`, `src/main/window/*`'],
  PAT: [
    '`docs/database/DATABASE_DESIGN.md`',
    '`src/main/services/clinical-service.ts`, `src/renderer/src/features/patients/*`'
  ],
  VISIT: [
    '`docs/database/DATABASE_DESIGN.md`',
    '`src/main/services/clinical-service.ts`, `src/renderer/src/features/patients/*`'
  ],
  CHART: ['`docs/ux/DESIGN_SYSTEM.md`', '`src/shared/dental.ts`, `src/renderer/src/features/patients/*`'],
  APPT: [
    '`docs/database/DATABASE_DESIGN.md`',
    '`src/main/services/clinical-service.ts`, `src/renderer/src/features/appointments/*`'
  ],
  QUEUE: [
    '`docs/database/DATABASE_DESIGN.md`',
    '`src/main/services/clinical-service.ts`, `src/renderer/src/features/queue/*`'
  ],
  TREAT: [
    '`docs/database/DATABASE_DESIGN.md`',
    '`src/main/services/clinical-service.ts`, `src/renderer/src/features/treatments/*`'
  ],
  RX: [
    '`docs/printing/PRINT_SYSTEM.md`',
    '`src/main/services/clinical-service.ts`, `src/shared/printing/*`, `src/renderer/src/features/prescriptions/*`'
  ],
  REF: ['`docs/database/DATABASE_DESIGN.md`', '`src/main/services/clinical-service.ts`'],
  INV: [
    '`docs/printing/PRINT_SYSTEM.md`',
    '`src/main/services/billing-service.ts`, `src/shared/printing/documents.ts`'
  ],
  PAY: ['ADR-0002', '`src/main/services/billing-service.ts`, `src/renderer/src/features/payments/*`'],
  FIN: [
    '`docs/database/DATABASE_DESIGN.md`',
    '`src/main/services/billing-service.ts`, `src/main/services/reports.ts`'
  ],
  INVT: [
    '`docs/database/DATABASE_DESIGN.md`',
    '`src/main/services/billing-service.ts`, `src/renderer/src/features/inventory/*`'
  ],
  STAFF: [
    '`docs/database/DATABASE_DESIGN.md`',
    '`src/main/services/admin-service.ts`, `src/renderer/src/features/staff/*`'
  ],
  USER: [
    '`docs/security/RBAC_SPECIFICATION.md`',
    '`src/main/services/auth-service.ts`, `src/renderer/src/features/staff/*`'
  ],
  RBAC: [
    'ADR-0006, `docs/security/RBAC_SPECIFICATION.md`',
    '`src/shared/permissions.ts`, `src/main/security/session.ts`, `src/main/ipc/registry.ts`'
  ],
  LOCK: ['`docs/security/SECURITY_SPECIFICATION.md`', '`src/main/security/session.ts`'],
  AUDIT: ['ADR-0006', '`src/main/security/*`, `src/main/db/repositories-core.ts`'],
  SAFE: ['`docs/backup-restore/BACKUP_RESTORE_SPECIFICATION.md`', '`src/main/services/admin-service.ts`'],
  SET: [
    '`docs/ux/DESIGN_SYSTEM.md`',
    '`src/shared/constants.ts`, `src/main/services/admin-service.ts`, `src/renderer/src/features/settings/*`'
  ],
  DATA: [
    '`docs/backup-restore/BACKUP_RESTORE_SPECIFICATION.md`',
    '`src/main/services/admin-service.ts`, `src/shared/csv.ts`'
  ],
  BKP: [
    '`docs/backup-restore/BACKUP_RESTORE_SPECIFICATION.md`',
    '`src/main/services/admin-service.ts`, `scripts/verify-backup.mjs`'
  ],
  RST: ['`docs/backup-restore/BACKUP_RESTORE_SPECIFICATION.md`', '`src/main/services/admin-service.ts`'],
  RPT: [
    '`docs/architecture/ARCHITECTURE.md` §9',
    '`src/main/services/reports.ts`, `src/renderer/src/features/reports/*`'
  ],
  ATT: [
    '`docs/security/SECURITY_SPECIFICATION.md`',
    '`src/main/services/billing-service.ts`, `src/main/storage/*`'
  ],
  NOTIF: [
    '`docs/ux/DESIGN_SYSTEM.md`',
    '`src/main/services/clinical-service.ts`, `src/renderer/src/app/Shell.tsx`'
  ],
  SEARCH: ['`docs/ux/DESIGN_SYSTEM.md`', '`src/main/ipc/registry.ts`, `src/renderer/src/app/Shell.tsx`'],
  KB: ['`docs/ux/DESIGN_SYSTEM.md`', '`src/renderer/src/app/Shell.tsx`'],
  ABOUT: [
    '`docs/compliance/THIRD-PARTY-NOTICES.md`',
    '`src/main/services/third-party.ts`, `src/renderer/src/features/about/*`'
  ],
  UI: ['`docs/ux/DESIGN_SYSTEM.md`', '`src/renderer/src/components/ui.tsx`, `src/renderer/src/styles/*`'],
  ACC: ['`docs/ux/DESIGN_SYSTEM.md`', '`src/renderer/src/components/ui.tsx`']
}

const NFR_HOMES = {
  'NFR-001': ['ADR-0001', '`src/main/**` — no HTTP client anywhere'],
  'NFR-002': ['NFR document', '`electron-builder.yml`, `build/installer.nsh`'],
  'NFR-003': [
    '`docs/architecture/ARCHITECTURE.md` §9',
    '`scripts/seed-stress-data.mjs`, `docs/testing/PERFORMANCE_MEASUREMENTS.md`'
  ],
  'NFR-004': ['`docs/database/DATABASE_DESIGN.md`', '`src/main/db/repositories-*.ts` — paging everywhere'],
  'NFR-005': ['ADR-0001', '`src/main/db/connection.ts`, renderer error boundaries'],
  'NFR-006': [
    '`docs/database/DATABASE_DESIGN.md`',
    '`src/main/db/migrations.ts`, `src/main/db/integrity.ts`'
  ],
  'NFR-007': [
    'ADR-0006, `docs/security/SECURITY_SPECIFICATION.md`',
    '`src/main/security/*`, `src/main/ipc/registry.ts`'
  ],
  'NFR-008': ['`docs/ux/DESIGN_SYSTEM.md`', 'every renderer feature screen'],
  'NFR-009': ['`docs/ux/DESIGN_SYSTEM.md`', '`src/renderer/src/styles/*`'],
  'NFR-010': ['`docs/ux/DESIGN_SYSTEM.md`', '`src/renderer/src/components/ui.tsx`'],
  'NFR-011': ['`docs/ux/DESIGN_SYSTEM.md`', '`@fontsource/noto-sans-bengali`, `src/shared/constants.ts`'],
  'NFR-012': ['NFR document', '`tsconfig*.json`, `eslint.config.mjs`, `scripts/pre-release-audit.mjs`'],
  'NFR-013': ['`docs/security/SECURITY_SPECIFICATION.md`', '`src/main/logging/logger.ts`'],
  'NFR-014': [
    '`docs/backup-restore/BACKUP_RESTORE_SPECIFICATION.md`',
    '`src/main/services/admin-service.ts`'
  ],
  'NFR-015': ['`docs/printing/PRINT_SYSTEM.md`', '`src/shared/printing/*`, `src/main/printing/*`'],
  'NFR-016': [
    'NFR document',
    '`electron-builder.yml`, `.github/workflows/release.yml`, `scripts/verify-release-artifact.mjs`'
  ],
  'NFR-017': [
    '`docs/compliance/THIRD-PARTY-NOTICES.md`',
    '`scripts/dependency-audit.mjs`, `scripts/generate-third-party-notices.mjs`'
  ],
  'NFR-018': ['`docs/testing/TESTING_STRATEGY.md`', '`tests/**`, `.github/workflows/ci.yml`']
}

/**
 * Expand the shorthand the checklist uses, e.g. `REQ-SETUP-002/003/004` → three ids, `NFR-003/004`
 * → two ids, and `REQ-ACC-001 · NFR-010` → two ids.
 */
export function expandRequirementRefs(cell) {
  const ids = new Set()
  for (const chunk of cell.split(/[·,]/)) {
    const match = /([A-Z]+-(?:[A-Z]+-)?\d+(?:\.\d+)?)((?:\s*\/\s*\d+)*)/.exec(chunk)
    if (!match) continue
    const head = match[1]
    ids.add(head)
    const prefix = head.replace(/\d+$/, '')
    for (const suffix of match[2].split('/')) {
      const digits = suffix.trim()
      if (/^\d+$/.test(digits)) ids.add(`${prefix}${digits}`)
    }
  }
  return [...ids]
}

function parseRequirements() {
  const frd = read(FRD)
  const nfr = read(NFRD)
  const functional = [...frd.matchAll(/^\|\s*(REQ-[A-Z]+-\d+)\s*\|([^|]*)\|/gm)].map(([, id, text]) => ({
    id,
    text: text.trim()
  }))
  const nonFunctional = [...nfr.matchAll(/^\|\s*(NFR-\d+)\s*\|\s*([^|]*)\|\s*([^|]*)\|/gm)].map((match) => ({
    id: match[1],
    area: match[2].trim(),
    text: match[3].trim()
  }))
  return { functional, nonFunctional }
}

function parseAcceptanceRows() {
  const checklist = read(CHECKLIST)
  return [...checklist.matchAll(/^\|\s*(AT-[A-Z0-9]+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/gm)].map(
    (match) => ({
      id: match[1],
      requirements: expandRequirementRefs(match[2]),
      type: match[3].trim(),
      expected: match[4].trim(),
      status: match[5].trim()
    })
  )
}

function stateOf(status) {
  if (/\*\*Pass\*\*/.test(status)) return 'Pass'
  if (/Partial/.test(status)) return 'Partial'
  return 'Pending'
}

function summarise(text, limit = 150) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`
}

export function buildMatrix() {
  const { functional, nonFunctional } = parseRequirements()
  const rows = parseAcceptanceRows()

  const byRequirement = new Map()
  for (const row of rows) {
    for (const id of row.requirements) {
      if (!byRequirement.has(id)) byRequirement.set(id, [])
      byRequirement.get(id).push(row)
    }
  }

  const statusFor = (id) => {
    const evidence = byRequirement.get(id) ?? []
    if (evidence.length === 0) return { status: 'Not covered by an acceptance row', evidence: '—' }
    const cells = evidence.map((row) => `\`${row.id}\``).join(', ')
    if (evidence.some((row) => stateOf(row.status) === 'Pass')) return { status: 'Covered', evidence: cells }
    if (evidence.some((row) => stateOf(row.status) === 'Partial'))
      return { status: 'Partly covered', evidence: cells }
    return { status: 'Pending (Windows/Electron evidence)', evidence: cells }
  }

  const out = [
    '# Dentiva Pro — Requirements Traceability Matrix',
    '',
    '**Document ID:** TEST-TRC-001 · **Version:** 1.0.0',
    '',
    'Generated by `scripts/generate-traceability-matrix.mjs` from `docs/requirements/*` and',
    '`docs/testing/ACCEPTANCE_TEST_CHECKLIST.md`. CI regenerates it and fails when the committed file is out',
    'of date, and `scripts/pre-release-audit.mjs` (audit A9) fails when a requirement is missing here — so the',
    'matrix cannot silently drift from the requirements or from the tests.',
    '',
    'The file deliberately carries no generation timestamp: the freshness check compares the committed text',
    'with a fresh generation, so a timestamp would make the check fail on the next day even when nothing',
    'changed.',
    '',
    `* Functional requirements: **${functional.length}**`,
    `* Non-functional requirements: **${nonFunctional.length}**`,
    `* Acceptance rows: **${rows.length}**`,
    '',
    'Status values: **Covered** (an executed, passing acceptance row exists), **Partly covered** (the row',
    'covers part of the requirement), **Pending (Windows/Electron evidence)** (the row is written but has not',
    'executed on a machine with the Electron binary), **Not covered by an acceptance row** (a gap, listed in',
    '`docs/release/RELEASE_READINESS.md`).',
    '',
    '## Functional requirements',
    '',
    '| Requirement | Requirement summary | Design / decision record | Implementation | Status | Acceptance rows |',
    '|---|---|---|---|---|---|'
  ]
  for (const requirement of functional) {
    const family = requirement.id.split('-')[1]
    const [design, implementation] = FAMILY_HOMES[family] ?? ['—', '—']
    const { status, evidence } = statusFor(requirement.id)
    out.push(
      `| \`${requirement.id}\` | ${summarise(requirement.text)} | ${design} | ${implementation} | ${status} | ${evidence} |`
    )
  }

  out.push(
    '',
    '## Non-functional requirements',
    '',
    '| Requirement | Area | Requirement summary | Design / decision record | Implementation | Status | Acceptance rows |',
    '|---|---|---|---|---|---|---|'
  )
  for (const requirement of nonFunctional) {
    const [design, implementation] = NFR_HOMES[requirement.id] ?? ['—', '—']
    const { status, evidence } = statusFor(requirement.id)
    out.push(
      `| \`${requirement.id}\` | ${requirement.area} | ${summarise(requirement.text)} | ${design} | ${implementation} | ${status} | ${evidence} |`
    )
  }

  const uncovered = [
    ...functional.map((entry) => entry.id),
    ...nonFunctional.map((entry) => entry.id)
  ].filter((id) => !byRequirement.has(id))

  out.push('', '## Gaps', '')
  if (uncovered.length === 0) {
    out.push('Every requirement is referenced by at least one acceptance row.')
  } else {
    out.push(
      `${uncovered.length} requirement(s) have no acceptance row yet. Each one is a known gap and is tracked`
    )
    out.push('in `docs/release/RELEASE_READINESS.md` rather than being quietly ignored:')
    out.push('')
    for (const id of uncovered) {
      const summary =
        functional.find((entry) => entry.id === id)?.text ??
        nonFunctional.find((entry) => entry.id === id)?.text
      out.push(`* \`${id}\` — ${summarise(summary ?? '', 110)}`)
    }
  }

  return `${out.join('\n')}\n`
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const generated = buildMatrix()
  const check = process.argv.includes('--check')
  const target = join(repoRoot, MATRIX)
  if (check) {
    let current
    try {
      current = readFileSync(target, 'utf8')
    } catch {
      current = ''
    }
    if (current !== generated) {
      console.error(
        '  The traceability matrix is out of date. Run: node scripts/generate-traceability-matrix.mjs'
      )
      process.exitCode = 1
    } else {
      console.log('  Traceability matrix is up to date.')
    }
  } else {
    writeFileSync(target, generated, 'utf8')
    console.log(`  Wrote ${MATRIX}`)
  }
}
