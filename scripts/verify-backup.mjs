#!/usr/bin/env node
/**
 * Standalone backup verifier (`npm run verify:backup -- <backup folder> [--extract <folder>]`).
 *
 * Runs the application's own verification code against a backup folder: manifest format, database
 * checksum, SHA256SUMS.txt, SQLite integrity, foreign keys and the audit hash chain, plus a row-count
 * comparison with the manifest. Use it when a clinic cannot open the application, or to confirm that a
 * copied backup file (USB stick, network drive) is intact.
 */

import { mkdirSync } from 'node:fs'
import { loadTypeScriptEntry } from './lib/bundle.mjs'

function usage() {
  console.log(
    [
      'Dentiva Pro backup verifier',
      '',
      '  node scripts/verify-backup.mjs <backup folder> [--extract <folder>]',
      '',
      'Exit code 0 when the backup verifies, 1 when it does not.'
    ].join('\n')
  )
}

async function main() {
  const args = process.argv.slice(2)
  const extractIndex = args.indexOf('--extract')
  const extractTo = extractIndex >= 0 ? args[extractIndex + 1] : undefined
  const extractValueIndex = extractIndex >= 0 ? extractIndex + 1 : -1
  const folder = args.find((value, index) => !value.startsWith('--') && index !== extractValueIndex)

  if (!folder || args.includes('--help')) {
    usage()
    process.exitCode = folder ? 0 : 1
    return
  }
  if (extractIndex >= 0) {
    if (!extractTo) throw new Error('--extract needs a folder.')
    mkdirSync(extractTo, { recursive: true })
  }

  const module = await loadTypeScriptEntry('scripts/tasks/verify-backup.ts')
  const result = module.verifyBackupFolder({
    folder,
    extractTo,
    log: (message) => console.log(`  ${message}`)
  })
  console.log('')
  console.log(module.formatVerifyReport(result))
  if (!result.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(`verify-backup failed: ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
})
