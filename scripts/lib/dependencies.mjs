/**
 * Dependency helpers shared by the audit and the third-party-notice generator.
 *
 * The renderer and the main process are bundled, so "shipped dependencies" are not the same thing as the
 * `dependencies` block: real application code imports React, Zod, lucide-react and friends, which are
 * installed as dev dependencies and compiled into `out/`. This helper therefore starts from what the
 * source actually imports, adds the declared runtime dependencies, and then follows each package's own
 * runtime dependencies, so the report describes exactly what ends up in the product.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname as pathDirname, join } from 'node:path'

const BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib'
])

/** `@scope/pkg/sub/path` → `@scope/pkg`; `pkg/sub` → `pkg`. */
export function packageNameOf(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return null
  if (specifier.startsWith('node:')) return null
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null
  return parts[0] ?? null
}

export function isBuiltin(specifier) {
  const name = specifier.startsWith('node:') ? specifier.slice(5) : specifier
  return BUILTINS.has(name.split('/')[0])
}

function walkSource(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walkSource(path, files)
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) files.push(path)
  }
  return files
}

/** Package names imported directly by the application source under `src/`. */
export function importedPackages(repoRoot, directories = ['src']) {
  const names = new Set()
  const patterns = [
    /import\s+[^'"]*from\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // `(?<![.\w])` keeps the application's own `this.require('permission.code')` out of the results.
    /(?<![.\w])require\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
  for (const directory of directories) {
    const absolute = join(repoRoot, directory)
    if (!existsSync(absolute)) continue
    for (const file of walkSource(absolute)) {
      const contents = readFileSync(file, 'utf8')
      for (const pattern of patterns) {
        pattern.lastIndex = 0
        let match = pattern.exec(contents)
        while (match) {
          const name = packageNameOf(match[1])
          // Project-internal aliases are not third-party packages.
          if (name && !isBuiltin(match[1]) && !name.startsWith('@shared/') && !name.startsWith('@main/')) {
            names.add(name)
          }
          match = pattern.exec(contents)
        }
      }
    }
  }
  return names
}

function readPackageJson(directory) {
  const file = join(directory, 'package.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Every package that ships, with the runtime dependency closure. */
export function shippedPackages(repoRoot) {
  const require = createRequire(join(repoRoot, 'package.json'))
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const roots = new Set([...importedPackages(repoRoot), ...Object.keys(manifest.dependencies ?? {})])
  // Build-time tools that never end up in the product.
  const excluded = new Set(['electron', 'electron-builder', 'sharp', 'png-to-ico', 'vitest', 'eslint'])

  const found = new Map()
  const queue = [...roots]
  while (queue.length > 0) {
    const name = queue.shift()
    if (!name || found.has(name) || excluded.has(name)) continue
    let directory
    try {
      directory = pathDirname(require.resolve(`${name}/package.json`))
    } catch {
      directory = join(repoRoot, 'node_modules', name)
    }
    const pkg = readPackageJson(directory)
    if (!pkg) {
      found.set(name, { name, version: 'unknown', license: 'UNKNOWN', directory: null, dependencyOf: null })
      continue
    }
    found.set(name, {
      name: pkg.name ?? name,
      version: pkg.version ?? 'unknown',
      license: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN'),
      author: typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name ?? null),
      homepage: pkg.homepage ?? null,
      directory,
      dependencyOf: null
    })
    for (const dependency of Object.keys(pkg.dependencies ?? {})) queue.push(dependency)
  }
  return found
}

/** First licence file found in a package directory (LICENSE, LICENSE.md, COPYING …). */
export function readLicenseText(directory) {
  if (!directory || !existsSync(directory)) return null
  const candidates = readdirSync(directory).filter((entry) => /^(licen[cs]e|copying|notice)/i.test(entry))
  for (const candidate of candidates) {
    const file = join(directory, candidate)
    try {
      const text = readFileSync(file, 'utf8')
      if (text.trim().length > 0) return { file: candidate, text }
    } catch {
      // binary or unreadable: try the next candidate
    }
  }
  return null
}

export const COPYLEFT_PATTERN = /\b(AGPL|GPL-3|GPL-2|GPLV|SSPL|BUSL|BSL-1\.1|Commons-Clause|EUPL|OSL-3)/i
export const PERMISSIVE_PATTERN =
  /\b(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|Unlicense|CC0-1\.0|BlueOak-1\.0\.0|Python-2\.0|Zlib|MPL-2\.0|CC-BY-4\.0|OFL-1\.1|Artistic-2\.0)\b/i
