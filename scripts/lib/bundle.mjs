/**
 * Loader for maintenance tools.
 *
 * The application code is TypeScript with path aliases, while the tools in `scripts/` are plain Node
 * `.mjs` files. This helper bundles a small TypeScript entry point (plus whatever application modules it
 * imports) into a temporary ESM file that lives inside `node_modules/.cache`, so Node resolves
 * dependencies such as `better-sqlite3` exactly as it does for the packaged application.
 *
 * Nothing is re-implemented here: the tools run the same migrations, repositories and services the
 * product runs.
 */

import { build } from 'esbuild'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '..', '..')
const cacheDir = join(repoRoot, 'node_modules', '.cache', 'dentiva-tools')

/**
 * Bundle and import a TypeScript entry point from this repository.
 * @param {string} relativeEntry path relative to the repository root, e.g. 'scripts/tasks/seed-stress.ts'
 * @returns {Promise<Record<string, unknown>>} the module exports
 */
export async function loadTypeScriptEntry(relativeEntry) {
  mkdirSync(cacheDir, { recursive: true })
  const outfile = join(cacheDir, `${relativeEntry.replace(/[^a-zA-Z0-9]+/g, '-')}.mjs`)
  rmSync(outfile, { force: true })

  await build({
    absWorkingDir: repoRoot,
    entryPoints: [relativeEntry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    tsconfig: join(repoRoot, 'tsconfig.node.json'),
    // Native and Electron modules must stay external: better-sqlite3 loads a .node binary and electron
    // only exists inside the packaged application.
    external: ['better-sqlite3', 'electron'],
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
    },
    logLevel: 'warning',
    sourcemap: false
  })

  return import(`${pathToFileURL(outfile).href}?v=${Date.now()}`)
}
