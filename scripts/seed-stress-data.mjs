#!/usr/bin/env node
/**
 * Stress-data generator and performance measurement (`npm run seed:stress`).
 *
 * Builds the documented stress dataset through the real migrations, repositories and services (see
 * `scripts/tasks/seed-stress.ts`), measures the operations the product promises to be fast at, and writes
 * `docs/testing/PERFORMANCE_MEASUREMENTS.md` with the numbers of this run plus the machine it ran on.
 *
 * Usage:
 *   node scripts/seed-stress-data.mjs [--root <folder>] [--reset] [--scale 0.1] [--no-report]
 *   node scripts/seed-stress-data.mjs --patients 5000 --visits 4 --appointments 20000 …
 */

import { join } from 'node:path'
import { loadTypeScriptEntry, repoRoot } from './lib/bundle.mjs'

const KNOWN_FLAGS = {
  root: 'string',
  scale: 'number',
  reset: 'boolean',
  'no-report': 'boolean',
  help: 'boolean',
  patients: 'number',
  visits: 'number',
  appointments: 'number',
  prescriptions: 'number',
  invoices: 'number',
  payments: 'number',
  items: 'number',
  transactions: 'number',
  attachments: 'number',
  queue: 'number'
}

function readFlags(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new Error(`Unexpected argument "${token}".`)
    const name = token.slice(2)
    const kind = KNOWN_FLAGS[name]
    if (!kind) throw new Error(`Unknown flag --${name}. Run with --help to see the options.`)
    if (kind === 'boolean') {
      flags[name] = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`Flag --${name} needs a value.`)
    flags[name] = kind === 'number' ? Number(value) : value
    index += 1
  }
  return flags
}

function usage() {
  console.log(
    [
      'Dentiva Pro stress dataset + performance measurement',
      '',
      '  --root <folder>     data root (default <repo>/.stress-data)',
      '  --reset             delete the data root before seeding (default)',
      '  --scale <n>         multiply the documented dataset (e.g. 0.1 for a quick run)',
      '  --no-report         measure only; do not write docs/testing/PERFORMANCE_MEASUREMENTS.md',
      '  --patients <n>      override the patient count',
      '  --visits <n>        visits per patient',
      '  --appointments <n>  override the appointment count',
      '  --prescriptions <n> override the prescription count',
      '  --invoices <n>      override the invoice count',
      '  --payments <n>      override the payment count',
      '  --items <n>         inventory items',
      '  --transactions <n>  inventory transactions',
      '  --attachments <n>   attachment files',
      '  --queue <n>         queue entries for the reported day',
      '',
      'The defaults are the dataset documented in docs/architecture/ARCHITECTURE.md §9:',
      '5,000 patients / 20,000 visits / 20,000 appointments / 15,000 prescriptions /',
      '15,000 invoices / 25,000 payments / 400 inventory items / 5,000 stock transactions.',
      '',
      'Exit code 1 when a documented performance budget is missed.'
    ].join('\n')
  )
}

/** A positive number as supplied (fractions allowed, used for --scale). */
function positiveFloat(value, name, fallback) {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number.`)
  return value
}

/** A positive whole count. */
function positive(value, name, fallback) {
  if (value === undefined) return fallback
  return Math.round(positiveFloat(value, name, fallback))
}

async function main() {
  let flags
  try {
    flags = readFlags(process.argv.slice(2))
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error))
    usage()
    process.exitCode = 1
    return
  }
  if (flags.help) {
    usage()
    return
  }

  const scale = positiveFloat(flags.scale, 'scale', 1)
  const scaled = (value) => Math.max(1, Math.round(value * scale))
  const root = flags.root ? String(flags.root) : join(repoRoot, '.stress-data')

  const module = await loadTypeScriptEntry('scripts/tasks/seed-stress.ts')
  const defaults = module.DEFAULT_STRESS_OPTIONS

  const options = {
    root,
    reset: flags.reset ?? true,
    patients: positive(flags.patients, 'patients', scaled(defaults.patients)),
    visitsPerPatient: positive(flags.visits, 'visits', defaults.visitsPerPatient),
    appointments: positive(flags.appointments, 'appointments', scaled(defaults.appointments)),
    prescriptions: positive(flags.prescriptions, 'prescriptions', scaled(defaults.prescriptions)),
    invoices: positive(flags.invoices, 'invoices', scaled(defaults.invoices)),
    payments: positive(flags.payments, 'payments', scaled(defaults.payments)),
    inventoryItems: positive(flags.items, 'items', defaults.inventoryItems),
    inventoryTransactions: positive(
      flags.transactions,
      'transactions',
      scaled(defaults.inventoryTransactions)
    ),
    attachments: positive(flags.attachments, 'attachments', scaled(defaults.attachments)),
    queueSize: positive(flags.queue, 'queue', defaults.queueSize),
    writeReport: !flags['no-report'],
    reportPath: join(repoRoot, 'docs', 'testing', 'PERFORMANCE_MEASUREMENTS.md'),
    log: (message) => console.log(`  ${message}`)
  }

  console.log('Dentiva Pro stress dataset')
  console.log(`  data root: ${root}`)
  console.log(
    `  target: ${options.patients.toLocaleString()} patients / ${options.appointments.toLocaleString()} appointments / ` +
      `${options.invoices.toLocaleString()} invoices / ${options.payments.toLocaleString()} payments\n`
  )

  const startedAt = Date.now()
  const report = await module.runStressSeed(options)

  console.log('\nDataset')
  for (const [key, value] of Object.entries(report.dataset)) {
    console.log(`  ${key.padEnd(22)} ${Number(value).toLocaleString()}`)
  }
  console.log(
    `  seeded in ${report.seed.seconds.toFixed(1)} s (${report.seed.operationsPerSecond.toLocaleString()} records/s)`
  )

  console.log('\nMeasured operations (real service calls, milliseconds)')
  for (const item of report.measurements) {
    const over = item.p95Ms > Number(String(item.target).replace(/[^0-9.]/g, ''))
    console.log(
      `  ${item.name.padEnd(38)} mean ${String(item.averageMs).padStart(7)}  p95 ${String(
        item.p95Ms
      ).padStart(7)}  max ${String(item.maxMs).padStart(7)}   target ${item.target}${over ? '  ← over' : ''}`
    )
  }

  console.log('\nDocumented budgets (measured p95 against the published target)')
  for (const row of report.budget) {
    console.log(
      `  ${row.passed ? 'PASS' : 'FAIL'}  ${row.name.padEnd(38)} ${String(row.measuredMs).padStart(6)} ms / ${row.targetMs} ms`
    )
  }

  console.log('\nBackup of the stress database')
  console.log(
    `  ${report.backup.folder} — ${(report.backup.sizeBytes / 1024 / 1024).toFixed(1)} MB written in ${report.backup.seconds.toFixed(1)} s`
  )
  console.log('\nMachine')
  for (const [key, value] of Object.entries(report.machine)) console.log(`  ${key.padEnd(16)} ${value}`)
  console.log('Environment')
  for (const [key, value] of Object.entries(report.environment)) console.log(`  ${key.padEnd(16)} ${value}`)

  const failed = report.budget.filter((row) => !row.passed)
  console.log(
    '\n' +
      (options.writeReport ? `Report written to ${options.reportPath}` : 'Report not written (--no-report).')
  )
  console.log(`Wall clock: ${((Date.now() - startedAt) / 1000).toFixed(1)} s`)
  if (failed.length > 0) {
    console.log(`\n${failed.length} documented budget(s) were missed — the report records the measurements.`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`seed-stress-data failed: ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
})
