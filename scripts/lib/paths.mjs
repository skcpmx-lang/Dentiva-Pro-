/** Shared paths for the maintenance scripts (no esbuild, so light tools stay light). */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, derived from this file's location. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Repository root for a script that lives in `scripts/` and passes its own `import.meta.url`. */
export function repoRootSafe(importMetaUrl) {
  return resolve(dirname(fileURLToPath(importMetaUrl)), '..')
}

export {
  packageNameOf,
  importedPackages,
  shippedPackages,
  readLicenseText,
  COPYLEFT_PATTERN,
  PERMISSIVE_PATTERN
} from './dependencies.mjs'
