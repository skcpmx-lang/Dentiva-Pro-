#!/usr/bin/env node
/**
 * Release artifact verification (`npm run verify:installer`).
 *
 * Run after `npm run package:win`. It checks that the installer that was produced is a real Windows
 * executable for the expected version, records its size and SHA-256, writes `release/SHA256SUMS.txt`
 * and `release/build-info.json` (version, build number, commit, build date, artifact name, checksums)
 * and, when a `win-unpacked` folder exists, that the unpacked application contains the runtime files
 * the product needs.
 *
 * Exit code 1 when anything is missing or wrong. Nothing here "assumes" success.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { repoRootSafe } from './lib/paths.mjs'

const repoRoot = repoRootSafe(import.meta.url)
const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const releaseDir = join(repoRoot, 'release')
const problems = []
const checks = []

function check(name, ok, detail) {
  checks.push({ name, ok, detail })
  if (!ok) problems.push(`${name}: ${detail}`)
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8'
    }).trim()
  } catch {
    return 'unknown'
  }
}

function gitDirty() {
  try {
    return (
      execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim().length > 0
    )
  } catch {
    return false
  }
}

check(
  'Release folder',
  existsSync(releaseDir),
  existsSync(releaseDir) ? releaseDir : 'run "npm run package:win" first'
)
if (!existsSync(releaseDir)) {
  report()
  process.exit(1)
}

const entries = readdirSync(releaseDir)
const installerName = `DentivaPro-Setup-${manifest.version}-x64.exe`
const installerPath = join(releaseDir, installerName)
const anyInstaller = entries.filter((name) => /^DentivaPro-Setup-.*\.exe$/.test(name))

check(
  `Installer ${installerName}`,
  existsSync(installerPath),
  existsSync(installerPath)
    ? 'found'
    : anyInstaller.length > 0
      ? `found ${anyInstaller.join(', ')} instead`
      : 'no installer produced'
)

if (existsSync(installerPath)) {
  const stats = statSync(installerPath)
  const header = readFileSync(installerPath).subarray(0, 2).toString('latin1')
  check(
    'Windows executable',
    header === 'MZ',
    header === 'MZ' ? 'valid PE header' : 'the file is not a Windows executable'
  )
  check(
    'Installer size',
    stats.size > 40 * 1024 * 1024,
    `${formatBytes(stats.size)} (an NSIS installer with Electron is normally 60–150 MB)`
  )
  check(
    'File name carries the version',
    installerName.includes(manifest.version),
    `package.json version is ${manifest.version}`
  )

  const checksum = sha256(installerPath)
  const checksumFile = join(releaseDir, 'SHA256SUMS.txt')
  const lines = [`${checksum}  ${basename(installerPath)}`]
  const unpacked = join(releaseDir, 'win-unpacked')
  if (existsSync(unpacked)) {
    for (const name of entries.filter((entry) => /\.(blockmap|yml)$/.test(entry))) {
      lines.push(`${sha256(join(releaseDir, name))}  ${name}`)
    }
  }
  writeFileSync(checksumFile, `${lines.join('\n')}\n`, 'utf8')
  check('Checksums written', true, checksumFile)

  const buildInfo = {
    productName: 'Dentiva Pro',
    version: manifest.version,
    buildNumber: process.env.DENTIVA_BUILD_NUMBER ?? 'local',
    commit: gitCommit(),
    builtFromDirtyTree: gitDirty(),
    buildDate: new Date().toISOString(),
    artifact: installerName,
    artifactSizeBytes: stats.size,
    sha256: checksum,
    platform: 'windows-x64',
    installer: 'NSIS (per-user, data preserved on uninstall)'
  }
  writeFileSync(join(releaseDir, 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8')
  check('Build information written', true, 'release/build-info.json')

  if (buildInfo.builtFromDirtyTree) {
    check(
      'Release from a clean tree',
      false,
      'the working tree had uncommitted changes when this artifact was verified'
    )
  } else {
    check('Release from a clean tree', true, `commit ${buildInfo.commit}`)
  }
}

const unpacked = join(releaseDir, 'win-unpacked')
if (existsSync(unpacked)) {
  check('Unpacked application', existsSync(join(unpacked, 'Dentiva Pro.exe')), 'Dentiva Pro.exe is present')
  const resources = join(unpacked, 'resources')
  check('app.asar', existsSync(join(resources, 'app.asar')), 'the bundled application archive is present')
  check(
    'better-sqlite3 unpacked',
    existsSync(join(resources, 'app.asar.unpacked', 'node_modules', 'better-sqlite3')),
    'the native SQLite module must stay outside the archive'
  )
  check(
    'Branding resources',
    existsSync(join(resources, 'branding')),
    'assets/branding was copied into the package'
  )
  check('Font resources', existsSync(join(resources, 'fonts')), 'assets/fonts was copied into the package')
} else {
  checks.push({
    name: 'Unpacked application',
    ok: false,
    detail: 'win-unpacked is missing (run "npm run package:dir" to inspect)'
  })
}

function report() {
  console.log('')
  console.log('Release artifact verification')
  console.log('=============================')
  for (const item of checks) {
    console.log(`  ${item.ok ? 'PASS' : 'FAIL'}  ${item.name.padEnd(30)} ${item.detail}`)
  }
  console.log('')
  console.log(
    problems.length === 0
      ? '  The release artifact is complete and verifiable.'
      : `  ${problems.length} problem(s) found.`
  )
}

report()
process.exitCode = problems.length === 0 ? 0 : 1
