#!/usr/bin/env node
/**
 * Browser preview harness — a development tool, never part of the shipped application.
 *
 * It serves the production renderer build and runs the real main-process stack (services, channel
 * registry, router, database) behind it, so the whole application can be reviewed in a browser without
 * packaging an installer. See `docs/testing/PREVIEW_HARNESS.md`.
 *
 * Usage:
 *   npm run build:app                     # builds out/renderer
 *   node scripts/preview-server.mjs [--port 4173] [--root <folder>] [--no-setup]
 *
 * Environment:
 *   DENTIVA_ACTIVATION_CODE  when set, the setup wizard is completed automatically for the preview
 *                            database (the code is never written to the repository)
 *   DENTIVA_PREVIEW_PASSWORD password for the preview administrator
 */

import { join } from 'node:path'
import { loadTypeScriptEntry, repoRoot } from './lib/bundle.mjs'

function readFlags(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const name = token.slice(2)
    if (name === 'no-setup' || name === 'help') {
      flags[name] = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`Flag --${name} needs a value.`)
    flags[name] = value
    index += 1
  }
  return flags
}

async function main() {
  const flags = readFlags(process.argv.slice(2))
  if (flags.help) {
    console.log(
      [
        'Dentiva Pro browser preview (development tool)',
        '',
        '  --port <n>     port to listen on (default 4173)',
        '  --host <addr>  address to bind (default 0.0.0.0)',
        '  --root <dir>   data root for the preview database (default <repo>/.preview-data)',
        '  --no-setup     do not complete the setup wizard automatically',
        '',
        'Build the renderer first: npm run build:app'
      ].join('\n')
    )
    return
  }

  const module = await loadTypeScriptEntry('scripts/tasks/preview-server.ts')
  const port = Number(flags.port ?? 4173)
  const host = String(flags.host ?? '0.0.0.0')
  const root = flags.root ? String(flags.root) : join(repoRoot, '.preview-data')
  const activationCode = flags['no-setup'] ? undefined : process.env.DENTIVA_ACTIVATION_CODE || undefined

  const preview = await module.startPreviewServer({
    root,
    rendererDir: join(repoRoot, 'out', 'renderer'),
    host,
    port,
    activationCode,
    adminPassword: process.env.DENTIVA_PREVIEW_PASSWORD || undefined,
    log: (message) => console.log(`  ${message}`)
  })

  console.log('')
  console.log(`  Dentiva Pro preview ready on ${preview.url}`)
  if (preview.credentials) {
    console.log(`  Sign in with: ${preview.credentials}`)
  } else if (!activationCode) {
    console.log('  The setup wizard will run in the browser (set DENTIVA_ACTIVATION_CODE to skip it).')
  }
  console.log('  Printing and PDF export are desktop-only; everything else runs the real application code.')
  console.log('')

  const shutdown = () => {
    void preview.close().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error(`preview-server failed: ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
})
