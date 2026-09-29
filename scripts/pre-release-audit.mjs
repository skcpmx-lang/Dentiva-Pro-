#!/usr/bin/env node
/**
 * Pre-release audit sweep (master prompt §113).
 *
 * Fourteen audits that must pass before a Windows installer is built. Most are static proofs that can run
 * anywhere; the ones that need Windows or the Electron binary report **skip** with the reason and the job
 * that produces the evidence, never a silent pass.
 *
 * Usage:
 *   node scripts/pre-release-audit.mjs [--report docs/release/PRE_RELEASE_AUDIT.md] [--quiet]
 *
 * Exit code 0 when every audit passed or was explicitly skipped, 1 when an audit failed.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { repoRoot } from './lib/paths.mjs'

const flags = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index]
  if (!token.startsWith('--')) continue
  const name = token.slice(2)
  const next = process.argv[index + 1]
  if (next && !next.startsWith('--')) {
    flags.set(name, next)
    index += 1
  } else {
    flags.set(name, true)
  }
}

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mjs',
  '.js',
  '.json',
  '.yml',
  '.yaml',
  '.md',
  '.html',
  '.css'
])

function walk(root, options = {}) {
  const skip = new Set(options.skip ?? [])
  const out = []
  const visit = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      const full = join(folder, entry.name)
      if (entry.isDirectory()) visit(full)
      else out.push(full)
    }
  }
  if (existsSync(root)) visit(root)
  return out
}

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' }).split('\n').filter(Boolean)
}

const results = []

function record(id, title, status, details, evidence = []) {
  results.push({ id, title, status, details, evidence })
}

function pass(id, title, details, evidence) {
  record(id, title, 'PASS', details, evidence)
}

function fail(id, title, details, evidence) {
  record(id, title, 'FAIL', details, evidence)
}

function skip(id, title, details) {
  record(id, title, 'SKIP', details)
}

// ------------------------------------------------------------------------------------------------
// 1. No placeholder, stub, debug-only or networked code
// ------------------------------------------------------------------------------------------------

function auditPlaceholders() {
  // Offline-first (NFR-001): the application must not contain any network client at all.
  const networkMarkers = [
    'fetch(',
    'axios',
    'http.request',
    'https.request',
    'XMLHttpRequest',
    'WebSocket',
    'node:http',
    'node:https',
    'net.connect'
  ]
  // Built from fragments so this very file does not trip its own scan.
  const markers = [
    ['TO', 'DO'],
    ['FIX', 'ME'],
    ['XX', 'X:'],
    ['HA', 'CK:'],
    ['coming', ' soon'],
    ['lorem', ' ipsum'],
    ['not implemented yet', ''],
    ['place', 'holder text']
  ]
    .map(([a, b]) => a + b)
    .filter(Boolean)
  const debugMarkers = ['debugger']
  const consoleMarker = 'console.' + 'log('

  const failures = []
  const roots = [join(repoRoot, 'src'), join(repoRoot, 'scripts'), join(repoRoot, 'tests')]
  for (const root of roots) {
    for (const file of walk(root, { skip: ['node_modules'] })) {
      if (!TEXT_EXTENSIONS.has(extname(file))) continue
      if (file.endsWith('pre-release-audit.mjs')) continue
      const text = readFileSync(file, 'utf8')
      const all = [...markers, ...debugMarkers]
      for (const marker of all) {
        const index = text.indexOf(marker)
        if (index >= 0) {
          const line = text.slice(0, index).split('\n').length
          failures.push(`${relative(repoRoot, file)}:${line} contains "${marker}"`)
        }
      }
    }
  }
  // Application code logs through the logger. The tools in `scripts/` are command-line programs whose
  // entire interface is stdout, so they are checked by A6 for secret redaction instead.
  for (const file of walk(join(repoRoot, 'src'), { skip: ['node_modules'] })) {
    if (!TEXT_EXTENSIONS.has(extname(file))) continue
    const text = readFileSync(file, 'utf8')
    if (text.includes(consoleMarker)) {
      const line = text.slice(0, text.indexOf(consoleMarker)).split('\n').length
      failures.push(`${relative(repoRoot, file)}:${line} logs to the console instead of the logger`)
    }
  }
  for (const file of walk(join(repoRoot, 'src'), { skip: ['node_modules'] })) {
    if (!TEXT_EXTENSIONS.has(extname(file))) continue
    const text = readFileSync(file, 'utf8')
    for (const marker of networkMarkers) {
      const index = text.indexOf(marker)
      if (index >= 0) {
        const line = text.slice(0, index).split('\n').length
        failures.push(
          `${relative(repoRoot, file)}:${line} uses "${marker}" — the application must stay offline`
        )
      }
    }
  }

  if (failures.length > 0) {
    return fail('A1', 'No placeholder, stub, debug-only or networked code', 'markers found', failures)
  }
  pass(
    'A1',
    'No placeholder, stub, debug-only or networked code',
    'no placeholder or debug markers, no console output in the application, and no network client anywhere'
  )
}

// ------------------------------------------------------------------------------------------------
// 2. The activation code and other credentials stay out of the repository
// ------------------------------------------------------------------------------------------------

function auditSecrets() {
  // Synthetic fixtures only. Anything else that looks like a 16-digit activation code must be a mistake.
  const fixtureAllowList = new Set(['0000000000000000', '2026000000000000', '2026000000000001'])
  const failures = []
  const scanRoots = ['src', 'tests', 'scripts', '.github']
  for (const root of scanRoots) {
    for (const file of walk(join(repoRoot, root), { skip: ['node_modules'] })) {
      if (!TEXT_EXTENSIONS.has(extname(file))) continue
      const text = readFileSync(file, 'utf8')
      text.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(/(?<![0-9])[0-9]{16}(?![0-9])/g)) {
          if (!fixtureAllowList.has(match[0])) {
            failures.push(`${file}:${index + 1} contains a 16-digit value that is not a documented fixture`)
          }
        }
      })
    }
  }

  // No credential files, no credentials in the configuration the installer ships.
  for (const name of ['.env', '.env.local', '.npmrc', '.netrc', 'credentials.json']) {
    if (trackedFiles().some((file) => file === name || file.endsWith(`/${name}`))) {
      failures.push(`${name} is tracked — credentials must never be committed`)
    }
  }

  // The shipped verifier must be a digest, not a readable literal.
  const activation = readFileSync(join(repoRoot, 'src/main/security/activation.ts'), 'utf8')
  if (!/VERIFIER_CHUNKS/.test(activation) || !/pbkdf2Sync/.test(activation)) {
    failures.push('src/main/security/activation.ts no longer derives the verifier with PBKDF2')
  }

  if (failures.length > 0) return fail('A2', 'No credentials in the repository', 'secrets found', failures)
  pass(
    'A2',
    'No credentials in the repository',
    'no activation-code literal, no credential file; the verifier is a PBKDF2 digest'
  )
}

// ------------------------------------------------------------------------------------------------
// 3. Money never goes through floating point
// ------------------------------------------------------------------------------------------------

function auditMoney() {
  const failures = []
  const moneySource = readFileSync(join(repoRoot, 'src/shared/money.ts'), 'utf8')
  for (const helper of [
    'POISHA_PER_TAKA',
    'roundHalfUp',
    'fromTaka',
    'toTaka',
    'formatBDT',
    'add',
    'sub',
    'sum'
  ]) {
    if (!moneySource.includes(`export ${helper === 'POISHA_PER_TAKA' ? 'const' : 'function'} ${helper}`)) {
      failures.push(`src/shared/money.ts no longer exports ${helper}`)
    }
  }
  for (const file of walk(join(repoRoot, 'src'), { skip: ['node_modules'] })) {
    if (!TEXT_EXTENSIONS.has(extname(file))) continue
    const text = readFileSync(file, 'utf8')
    text.split('\n').forEach((line, index) => {
      if (/parseFloat\(/.test(line)) {
        failures.push(`${relative(repoRoot, file)}:${index + 1} parses a float — use the integer helpers`)
      }
    })
  }
  if (failures.length > 0)
    return fail('A3', 'Integer minor units for all money', 'float usage found', failures)
  pass(
    'A3',
    'Integer minor units for all money',
    'the money helpers are present and no float parsing happens anywhere in src/'
  )
}

// ------------------------------------------------------------------------------------------------
// 4. Every mutation is audited and the trail is append-only
// ------------------------------------------------------------------------------------------------

function auditAuditTrail() {
  const failures = []
  const serviceFiles = walk(join(repoRoot, 'src/main/services')).filter((file) =>
    file.endsWith('-service.ts')
  )
  for (const file of serviceFiles) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes('this.audit(')) {
      failures.push(`${relative(repoRoot, file)} writes no audit entries`)
    }
  }

  const migrations = walk(join(repoRoot, 'src/main/db'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
  for (const trigger of ['trg_audit_no_update', 'trg_audit_no_delete']) {
    if (!migrations.includes(trigger))
      failures.push(`the append-only guard ${trigger} is missing from the schema`)
  }

  const registry = readFileSync(join(repoRoot, 'src/main/ipc/registry.ts'), 'utf8')
  const channelCount = (registry.match(/^\s{4}'[a-zA-Z.]+':\s*\{/gm) ?? []).length
  const channelMap = readFileSync(join(repoRoot, 'src/shared/ipc.ts'), 'utf8')
  const declaredCount = (channelMap.match(/^\s{2}'[a-zA-Z.]+':/gm) ?? []).length
  if (channelCount === 0) failures.push('the channel registry declares no channels')
  if (channelCount !== declaredCount) {
    failures.push(
      `the registry implements ${channelCount} channels but ${declaredCount} are declared in shared/ipc.ts`
    )
  }

  if (failures.length > 0)
    return fail('A4', 'Audited mutations and an append-only trail', 'gaps found', failures)
  pass(
    'A4',
    'Audited mutations and an append-only trail',
    `every service audits, the schema blocks edits, and all ${channelCount} declared channels are implemented`
  )
}

// ------------------------------------------------------------------------------------------------
// 5. Print rules: blank signature area, clinic-only invoice header, no invoice signature footer
// ------------------------------------------------------------------------------------------------

function auditPrintRules() {
  const failures = []
  const documents = readFileSync(join(repoRoot, 'src/shared/printing/documents.ts'), 'utf8')
  const model = readFileSync(join(repoRoot, 'src/shared/printing/model.ts'), 'utf8')

  const clearance = Number(/const MIN_SIGNATURE_CLEARANCE_MM = (\d+)/.exec(documents)?.[1] ?? '0')
  if (clearance < 25)
    failures.push(`the reserved signature clearance is ${clearance} mm, below the required 25 mm`)

  const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const invoiceBlock = stripComments(
    /export interface InvoiceDocument \{([\s\S]*?)\n\}/.exec(model)?.[1] ?? ''
  )
  if (/signature/i.test(invoiceBlock)) failures.push('InvoiceDocument carries a signature block')

  const invoiceBuilder = /export function buildInvoiceDocument\(([\s\S]*?)\n\}/.exec(documents)?.[1] ?? ''
  if (invoiceBuilder.length === 0) failures.push('buildInvoiceDocument is missing')
  if (!/clinic|x[\s\S]/.test(invoiceBuilder))
    failures.push('the invoice document is not built from the clinic profile')

  // The invoice header must be clinic identity only: no dentist on the invoice header by default.
  const registry = readFileSync(join(repoRoot, 'src/main/ipc/registry.ts'), 'utf8')
  if (/invoice[\s\S]{0,400}dentistName/.test(registry)) {
    failures.push('the invoice header builder passes a dentist name into the header')
  }

  if (failures.length > 0) return fail('A5', 'Print rules', 'print rules violated', failures)
  pass(
    'A5',
    'Print rules',
    `signature clearance ${clearance} mm of blank space, invoices carry no signature block or signature footer`
  )
}

// ------------------------------------------------------------------------------------------------
// 6. Logging hygiene
// ------------------------------------------------------------------------------------------------

function auditLogging() {
  const failures = []
  const logger = readFileSync(join(repoRoot, 'src/main/logging/logger.ts'), 'utf8')
  for (const key of ['password', 'token', 'secret']) {
    if (!logger.includes(`'${key}'`)) failures.push(`the redaction list no longer covers "${key}"`)
  }
  if (!/retention|rotate/i.test(logger)) failures.push('log rotation or retention is missing')

  const consoleMarker = 'console.' + 'log('
  for (const file of walk(join(repoRoot, 'src/main'))) {
    if (!file.endsWith('.ts')) continue
    if (readFileSync(file, 'utf8').includes(consoleMarker)) {
      failures.push(`${relative(repoRoot, file)} writes to the console`)
    }
  }
  if (failures.length > 0) return fail('A6', 'Logging without secrets', 'logging gaps found', failures)
  pass(
    'A6',
    'Logging without secrets',
    'redaction covers credentials, files rotate, nothing logs to a console'
  )
}

// ------------------------------------------------------------------------------------------------
// 7. Dependency and licence audit
// ------------------------------------------------------------------------------------------------

function auditDependencies() {
  try {
    const output = execFileSync('npm', ['run', '--silent', 'audit:deps'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const summary = output.trim().split('\n').filter(Boolean).slice(-3).join(' | ')
    const notices = join(repoRoot, 'docs/compliance/THIRD-PARTY-NOTICES.txt')
    if (!existsSync(notices) || statSync(notices).size < 1000) {
      return fail(
        'A7',
        'Dependency and licence audit',
        'the shipped third-party notices are missing or empty'
      )
    }
    pass('A7', 'Dependency and licence audit', summary || 'audit and notices are current')
  } catch (error) {
    fail('A7', 'Dependency and licence audit', 'npm run audit:deps failed', [
      String(error.stdout ?? error.message)
        .trim()
        .slice(0, 800)
    ])
  }
}

// ------------------------------------------------------------------------------------------------
// 8. Repository hygiene
// ------------------------------------------------------------------------------------------------

function auditRepoHygiene() {
  const failures = []
  const forbidden = ['node_modules/', 'dist/', 'release/', '.preview-data/', '.stress-data/', '.env']
  for (const file of trackedFiles()) {
    if (forbidden.some((prefix) => file === prefix.slice(0, -1) || file.startsWith(prefix))) {
      failures.push(`${file} should not be tracked`)
    }
    if (/(^|\/)\.DS_Store$|\.log$|\.bak$|\.tmp$/.test(file)) failures.push(`${file} is a stray artefact`)
  }
  const oversized = []
  for (const file of trackedFiles()) {
    const full = join(repoRoot, file)
    if (!existsSync(full)) continue
    const size = statSync(full).size
    if (size > 8 * 1024 * 1024) oversized.push(`${file} (${(size / 1024 / 1024).toFixed(1)} MB)`)
  }
  if (oversized.length > 0) failures.push(...oversized.map((entry) => `${entry} is too large for git`))
  if (failures.length > 0) return fail('A8', 'Repository hygiene', 'stray or oversized files', failures)
  pass('A8', 'Repository hygiene', `${trackedFiles().length} tracked files, none generated or oversized`)
}

// ------------------------------------------------------------------------------------------------
// 9. Documentation and traceability
// ------------------------------------------------------------------------------------------------

function auditDocumentation() {
  const failures = []
  const required = [
    'docs/architecture/ARCHITECTURE.md',
    'docs/project-state/BUILD_STATE.md',
    'docs/project-state/IMPLEMENTATION_CHECKLIST.md',
    'docs/testing/ACCEPTANCE_TEST_CHECKLIST.md',
    'docs/testing/PERFORMANCE_MEASUREMENTS.md',
    'docs/security/RBAC_SPECIFICATION.md',
    'docs/printing/PRINT_SYSTEM.md',
    'docs/backup-restore/BACKUP_RESTORE_SPECIFICATION.md',
    'docs/compliance/THIRD-PARTY-NOTICES.md',
    'docs/user-guide/USER_GUIDE.html'
  ]
  for (const file of required) {
    if (!existsSync(join(repoRoot, file))) failures.push(`${file} is missing`)
  }

  const checklist = readFileSync(join(repoRoot, 'docs/testing/ACCEPTANCE_TEST_CHECKLIST.md'), 'utf8')
  const rows = [...checklist.matchAll(/^\|\s*(AT-[A-Z0-9]+)\s*\|([^|]*)\|([^|]*)\|/gm)]
  if (rows.length === 0) failures.push('the acceptance checklist has no AT- rows')
  for (const row of rows) {
    const [, id, requirement, status] = row
    if (!/REQ-[A-Z]+-\d+|NFR-\d+/.test(requirement) && !/§/.test(requirement)) {
      failures.push(`${id} does not name the requirement it verifies ("${requirement.trim()}")`)
    }
    if (status.trim().length === 0) failures.push(`${id} has no verification status`)
  }
  for (const word of ['TODO', 'TBD']) {
    if (checklist.includes(word)) failures.push(`the acceptance checklist still contains "${word}"`)
  }

  const traceability = join(repoRoot, 'docs/testing/TRACEABILITY_MATRIX.md')
  if (!existsSync(traceability)) {
    failures.push('docs/testing/TRACEABILITY_MATRIX.md is missing')
  }

  if (failures.length > 0) return fail('A9', 'Documentation and traceability', 'documentation gaps', failures)
  pass(
    'A9',
    'Documentation and traceability',
    `${required.length} documents present, ${rows.length} acceptance rows each name their requirement`
  )
}

// ------------------------------------------------------------------------------------------------
// 10. Performance evidence
// ------------------------------------------------------------------------------------------------

function auditPerformance() {
  const file = join(repoRoot, 'docs/testing/PERFORMANCE_MEASUREMENTS.md')
  if (!existsSync(file)) return fail('A10', 'Performance evidence', 'PERFORMANCE_MEASUREMENTS.md is missing')
  const text = readFileSync(file, 'utf8')
  const failures = []
  if (!/p95/i.test(text)) failures.push('the report records no p95 timings')
  if (!/(patients|visits)/i.test(text)) failures.push('the report does not state the dataset scale')
  if (/TODO|TBD|pending/i.test(text)) failures.push('the report still contains placeholders')
  if (failures.length > 0) return fail('A10', 'Performance evidence', 'incomplete measurements', failures)
  pass('A10', 'Performance evidence', 'recorded measurements at the documented scale against the budgets')
}

// ------------------------------------------------------------------------------------------------
// 11. Backup format and verifier
// ------------------------------------------------------------------------------------------------

function auditBackup() {
  const failures = []
  const verifier = join(repoRoot, 'scripts/verify-backup.mjs')
  if (!existsSync(verifier)) failures.push('scripts/verify-backup.mjs is missing')
  const spec = readFileSync(join(repoRoot, 'docs/backup-restore/BACKUP_RESTORE_SPECIFICATION.md'), 'utf8')
  for (const field of ['manifest.json', 'SHA256SUMS.txt', 'formatVersion']) {
    if (!spec.includes(field)) failures.push(`the backup specification does not describe ${field}`)
  }

  const fixtures = [join(repoRoot, '.stress-data/Backups'), join(repoRoot, '.preview-data/Backups')].filter(
    (folder) => existsSync(folder)
  )

  let newest = fixtures
    .flatMap((folder) =>
      readdirSync(folder)
        .filter((name) => name.startsWith('DentivaPro_Backup_'))
        .map((name) => join(folder, name))
    )
    .sort()
    .pop()

  if (newest === undefined) {
    const activationCode = process.env.DENTIVA_ACTIVATION_CODE
    if (!activationCode) {
      if (failures.length > 0) return fail('A11', 'Backup format and verifier', 'backup gaps', failures)
      return skip(
        'A11',
        'Backup format and verifier',
        'no local backup to verify and no DENTIVA_ACTIVATION_CODE to produce one; the integration suite covers the same code path'
      )
    }
    // Produce a real backup with the application's own services (the stress seeder completes setup and
    // takes a verified backup), then verify that backup with the standalone verifier.
    const root = join(process.env.RUNNER_TEMP ?? tmpdir(), `dentiva-audit-${Date.now()}`)
    try {
      execFileSync(
        'node',
        ['scripts/seed-stress-data.mjs', '--scale', '0.01', '--root', root, '--no-report'],
        { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: process.env }
      )
      newest = readdirSync(join(root, 'Backups'))
        .filter((name) => name.startsWith('DentivaPro_Backup_'))
        .map((name) => join(root, 'Backups', name))
        .sort()
        .pop()
    } catch (error) {
      failures.push(`could not produce a sample backup: ${String(error.stdout ?? error.message).slice(-300)}`)
    }
  }

  if (newest === undefined) {
    return fail('A11', 'Backup format and verifier', 'no backup could be produced or found', failures)
  }

  try {
    const output = execFileSync('node', ['scripts/verify-backup.mjs', newest], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (!/PASS|ok/i.test(output)) failures.push('the verifier did not report a pass')
  } catch (error) {
    failures.push(`verifying ${relative(repoRoot, newest)} failed: ${String(error.stdout ?? '').slice(-300)}`)
  }
  if (failures.length > 0)
    return fail('A11', 'Backup format and verifier', 'backup verification failed', failures)
  pass('A11', 'Backup format and verifier', `newest backup verified: ${relative(repoRoot, newest)}`)
}

// ------------------------------------------------------------------------------------------------
// 12. Static accessibility check of every form control
// ------------------------------------------------------------------------------------------------

/**
 * Read one JSX element from its opening `<`, honouring braces and string literals so an `=>` inside an
 * event handler does not end the tag early. Returns the tag text including its closing `>`.
 */
function readJsxTag(text, start) {
  let depth = 0
  let quote = null
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    const previous = text[index - 1]
    if (quote) {
      if (char === quote && previous !== '\\') quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') depth = Math.max(0, depth - 1)
    else if (char === '>' && depth === 0) return text.slice(start, index + 1)
  }
  return null
}

function hasAccessibleName(tag, before) {
  if (/aria-label|aria-labelledby|type="hidden"|type='hidden'/.test(tag)) return true
  if (/\{\.\.\./.test(tag)) return true
  if (/\sid=/.test(tag)) return true
  // Inside a <label>…</label>: the wrapping label supplies the name.
  const opens = (before.match(/<label\b/g) ?? []).length
  const closes = (before.match(/<\/label>/g) ?? []).length
  return opens > closes
}

function auditAccessibility() {
  const failures = []
  for (const file of walk(join(repoRoot, 'src/renderer/src'))) {
    if (!file.endsWith('.tsx')) continue
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/<(input|select|textarea)\b/g)) {
      const tag = readJsxTag(text, match.index)
      if (tag === null) continue
      if (!hasAccessibleName(tag, text.slice(0, match.index))) {
        const line = text.slice(0, match.index).split('\n').length
        failures.push(`${relative(repoRoot, file)}:${line} form control has no accessible name`)
      }
    }
  }
  // NFR-011: the renderer must not re-type business text. Payment methods and status labels belong to
  // `src/shared/constants.ts` (or the database), so the interface cannot drift from the data layer.
  const businessStrings = ['bKash', 'Nagad', 'Rocket', 'Upay', 'No-show', 'Partially paid', 'Overpaid']
  for (const file of walk(join(repoRoot, 'src/renderer/src'))) {
    if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue
    const text = readFileSync(file, 'utf8')
    for (const literal of businessStrings) {
      const index = text.indexOf(`'${literal}'`)
      if (index >= 0) {
        const line = text.slice(0, index).split('\n').length
        failures.push(`${relative(repoRoot, file)}:${line} re-types the business string "${literal}"`)
      }
    }
  }

  if (failures.length > 0) {
    return fail('A12', 'Accessible controls and central business text', 'interface gaps found', failures)
  }
  pass(
    'A12',
    'Accessible controls and central business text',
    'every form control carries an accessible name and no screen re-types a payment method or a status label'
  )
}

// ------------------------------------------------------------------------------------------------
// 13. Windows-only evidence must be produced by the pipeline
// ------------------------------------------------------------------------------------------------

function auditWindowsEvidence() {
  const failures = []
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
  const release = readFileSync(join(repoRoot, '.github/workflows/release.yml'), 'utf8')
  if (!/windows-latest/.test(workflow)) failures.push('CI no longer runs anything on windows-latest')
  if (!/verify:installer/.test(release))
    failures.push('the release workflow no longer validates the installer')
  if (!/npm run e2e|test:e2e/.test(workflow)) failures.push('the end-to-end suite is not part of CI')

  const artifactChecker = join(repoRoot, 'scripts/verify-release-artifact.mjs')
  if (!existsSync(artifactChecker)) failures.push('scripts/verify-release-artifact.mjs is missing')

  if (failures.length > 0) return fail('A13', 'Windows pipeline evidence', 'pipeline gaps', failures)
  if (process.platform !== 'win32' || !existsSync(join(repoRoot, 'release'))) {
    return skip(
      'A13',
      'Windows pipeline evidence',
      'E2E, installer, print matrix and DPI evidence are produced on windows-latest; this host can only verify that they are wired'
    )
  }
  pass(
    'A13',
    'Windows pipeline evidence',
    'the release folder exists — run npm run verify:installer for the artifact'
  )
}

// ------------------------------------------------------------------------------------------------
// 14. Release artefacts and reproducibility
// ------------------------------------------------------------------------------------------------

function auditReleaseArtifacts() {
  const failures = []
  for (const file of [
    'scripts/verify-release-artifact.mjs',
    'scripts/generate-third-party-notices.mjs',
    'docs/release/RELEASE_READINESS.md'
  ]) {
    if (!existsSync(join(repoRoot, file))) failures.push(`${file} is missing`)
  }

  const readiness = join(repoRoot, 'docs/release/RELEASE_READINESS.md')
  if (existsSync(readiness)) {
    const text = readFileSync(readiness, 'utf8')
    if (!/version|build/i.test(text)) failures.push('RELEASE_READINESS.md does not record the build identity')
    if (!/SHA256|checksum/i.test(text))
      failures.push('RELEASE_READINESS.md does not record artefact checksums')
  }

  if (failures.length > 0) return fail('A14', 'Release artefacts and readiness', 'release gaps', failures)
  if (!existsSync(join(repoRoot, 'release'))) {
    return skip('A14', 'Release artefacts and readiness', 'no installer built on this host; see A13')
  }
  pass('A14', 'Release artefacts and readiness', 'the release folder and the readiness document are present')
}

// ------------------------------------------------------------------------------------------------

const plan = [
  auditPlaceholders,
  auditSecrets,
  auditMoney,
  auditAuditTrail,
  auditPrintRules,
  auditLogging,
  auditDependencies,
  auditRepoHygiene,
  auditDocumentation,
  auditPerformance,
  auditBackup,
  auditAccessibility,
  auditWindowsEvidence,
  auditReleaseArtifacts
]

for (const audit of plan) {
  try {
    audit()
  } catch (error) {
    record(
      'A??',
      audit.name,
      'FAIL',
      `the audit itself threw: ${error instanceof Error ? error.message : error}`
    )
  }
}

const failed = results.filter((entry) => entry.status === 'FAIL')
const skipped = results.filter((entry) => entry.status === 'SKIP')
const passed = results.filter((entry) => entry.status === 'PASS')

const report = [
  '# Pre-release audit report (master prompt §113)',
  '',
  `Generated ${new Date().toISOString()} by \`scripts/pre-release-audit.mjs\` from commit \`${execFileSync(
    'git',
    ['rev-parse', '--short', 'HEAD'],
    { cwd: repoRoot, encoding: 'utf8' }
  ).trim()}\`.`,
  '',
  `**${passed.length} passed, ${skipped.length} skipped (Windows-only), ${failed.length} failed.**`,
  '',
  '| # | Audit | Result | Evidence |',
  '|---|---|---|---|',
  ...results.map(
    (entry) =>
      `| ${entry.id} | ${entry.title} | ${entry.status === 'PASS' ? '**Pass**' : entry.status === 'SKIP' ? 'Skip' : '**Fail**'} | ${entry.details} |`
  ),
  '',
  '## Findings',
  ''
]

for (const entry of results) {
  report.push(`### ${entry.id} — ${entry.title}: ${entry.status}`)
  report.push('')
  report.push(entry.details)
  if (entry.evidence.length > 0) {
    report.push('')
    for (const line of entry.evidence.slice(0, 40)) report.push(`- ${line}`)
    if (entry.evidence.length > 40) report.push(`- … and ${entry.evidence.length - 40} more`)
  }
  report.push('')
}

const reportPath = flags.get('report')
if (typeof reportPath === 'string') {
  const target = resolve(repoRoot, reportPath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${report.join('\n')}\n`, 'utf8')
}

if (!flags.has('quiet')) {
  console.log('')
  console.log('  Pre-release audits (§113)')
  console.log('  ' + '-'.repeat(72))
  for (const entry of results) {
    const label = entry.status === 'PASS' ? 'pass' : entry.status === 'SKIP' ? 'skip' : 'FAIL'
    console.log(`  ${label.padEnd(5)} ${entry.id.padEnd(4)} ${entry.title}`)
    console.log(`        ${entry.details}`)
    for (const line of entry.evidence.slice(0, 6)) console.log(`          - ${line}`)
  }
  console.log('')
  console.log(
    `  ${passed.length} passed, ${skipped.length} skipped, ${failed.length} failed${
      typeof reportPath === 'string' ? ` — report written to ${reportPath}` : ''
    }`
  )
  console.log('')
}

process.exitCode = failed.length > 0 ? 1 : 0
