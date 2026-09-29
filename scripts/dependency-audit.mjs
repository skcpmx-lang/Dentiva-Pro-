#!/usr/bin/env node
/**
 * Dependency and licence audit.
 *
 * Checks, in this order:
 *   1. every package the application actually ships (imported by `src/` plus its runtime closure) is
 *      installed and has a licence we are allowed to redistribute;
 *   2. no shipped dependency is copyleft, unlicensed or missing a licence file;
 *   3. `npm audit` is run against the registry for known advisories — when the machine is offline the
 *      step is reported as "skipped", never as "passed".
 *
 * Exit code 1 when something is wrong. `--strict` also fails when the registry could not be reached.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COPYLEFT_PATTERN,
  PERMISSIVE_PATTERN,
  importedPackages,
  readLicenseText,
  repoRootSafe,
  shippedPackages
} from './lib/paths.mjs'

const repoRoot = repoRootSafe(import.meta.url)
const strict = process.argv.includes('--strict')

const problems = []
const warnings = []

function section(title) {
  console.log(`\n${title}`)
  console.log('-'.repeat(title.length))
}

const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const packages = [...shippedPackages(repoRoot).values()].sort((left, right) =>
  left.name.localeCompare(right.name)
)

section(`Shipped dependencies (${packages.length})`)
for (const pkg of packages) {
  const licenceText = readLicenseText(pkg.directory)
  const licence = pkg.license || 'UNKNOWN'
  const flags = []
  if (licence === 'UNKNOWN' || licence === '') flags.push('unknown licence')
  else if (COPYLEFT_PATTERN.test(licence)) flags.push('copyleft licence')
  else if (!PERMISSIVE_PATTERN.test(licence)) flags.push('licence needs review')
  if (!licenceText) flags.push('no licence file installed')

  console.log(`  ${pkg.name.padEnd(24)} ${pkg.version.padEnd(12)} ${licence.padEnd(14)} ${flags.join(', ')}`)
  if (flags.length > 0) problems.push(`${pkg.name}@${pkg.version}: ${flags.join(', ')}`)
}

section('Declared dependencies')
for (const name of Object.keys(manifest.dependencies ?? {})) {
  const installed = packages.find((pkg) => pkg.name === name)
  if (!installed) problems.push(`${name} is declared in package.json but was not found in node_modules`)
}
const importedRoots = [...importedPackages(repoRoot)].sort()
console.log(`  imported directly by src/: ${importedRoots.length} packages`)
console.log(`  runtime dependencies declared: ${Object.keys(manifest.dependencies ?? {}).length}`)

section('Bundled fonts')
const fontPackages = ['@fontsource/inter', '@fontsource/noto-sans-bengali']
for (const name of fontPackages) {
  const directory = join(repoRoot, 'node_modules', name)
  const text = readLicenseText(directory)
  const licence = text ? 'OFL-1.1' : 'missing'
  console.log(`  ${name.padEnd(32)} ${licence}`)
  if (!text) problems.push(`${name}: the font licence file is missing`)
}

section('Known advisories (npm audit)')
try {
  const output = execFileSync('npm', ['audit', '--json', '--omit=dev'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const report = JSON.parse(output)
  const total = report.metadata?.vulnerabilities?.total ?? 0
  console.log(`  registry reachable — ${total} advisory(ies) affecting production dependencies`)
  if (total > 0) problems.push(`npm audit reported ${total} vulnerability(ies)`)
} catch (error) {
  const stdout = typeof error.stdout === 'string' ? error.stdout : ''
  if (stdout.trim().startsWith('{')) {
    try {
      const report = JSON.parse(stdout)
      const total = report.metadata?.vulnerabilities?.total ?? 0
      console.log(`  registry reachable — ${total} advisory(ies) affecting production dependencies`)
      if (total > 0) problems.push(`npm audit reported ${total} vulnerability(ies)`)
    } catch {
      console.log('  npm audit returned an unreadable report')
      warnings.push('npm audit output could not be parsed')
    }
  } else {
    console.log('  registry not reachable — the advisory check was SKIPPED (not passed)')
    if (strict) problems.push('the advisory check could not run (offline) and --strict was requested')
    else warnings.push('advisory check skipped because the registry was unreachable')
  }
}

section('Result')
for (const warning of warnings) console.log(`  WARN  ${warning}`)
for (const problem of problems) console.log(`  FAIL  ${problem}`)
if (problems.length === 0) {
  console.log('  PASS  dependency and licence audit found no blocking problems')
} else {
  console.log(`  ${problems.length} problem(s) must be fixed`)
}

process.exitCode = problems.length === 0 ? 0 : 1
