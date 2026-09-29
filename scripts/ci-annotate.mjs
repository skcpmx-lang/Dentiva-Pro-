#!/usr/bin/env node
/**
 * Prints a GitHub Actions error annotation that carries the tail of a log file.
 *
 * Why this exists: when a Windows job fails, the useful part of the story is the last screenful of the
 * runner log. The log archive is served from a signed URL that is not always reachable (and is never
 * reachable from a restricted network), while job annotations are part of the ordinary REST API. So the
 * workflow pipes the runner output into a file and, on failure, turns its tail into an annotation that
 * anybody — or any agent — can read with `gh run view`.
 *
 * Usage: node scripts/ci-annotate.mjs <log-file> [title]
 */

import { readFileSync } from 'node:fs'

const [file, title = 'Failure'] = process.argv.slice(2)
if (!file) {
  console.error('Usage: node scripts/ci-annotate.mjs <log-file> [title]')
  process.exit(2)
}

/** Annotations travel as a single line: `%` and newlines have to be escaped. */
function escape(value) {
  return value.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A')
}

const raw = readFileSync(file, 'utf8')
// GitHub truncates very long annotations, so send the end of the log where the failure is reported.
const tail = raw.length > 6000 ? `…(earlier output omitted)\n${raw.slice(-6000)}` : raw
process.stdout.write(`::error title=${escape(title)}::${escape(tail.trim())}\n`)
