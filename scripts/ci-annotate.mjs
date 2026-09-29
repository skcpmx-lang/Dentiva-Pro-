#!/usr/bin/env node
/**
 * Publishes the outcome of a CI step as GitHub annotations.
 *
 * Why this exists: when a Windows job fails, the useful part of the story is in the runner log, but the log
 * archive is served from a signed URL that is not always reachable (and never reachable from a restricted
 * network). Job annotations travel with the ordinary REST API, so the workflow pipes the runner output into
 * a file and turns it into two annotations:
 *
 *   1. a compact summary — one line per failing test plus its error message, read from the machine-readable
 *      report when the tool produced one, otherwise from the console output;
 *   2. the tail of the console output, where the tool prints its final verdict.
 *
 * Usage: node scripts/ci-annotate.mjs <console-log> [title] [json-report]
 */

import { existsSync, readFileSync } from 'node:fs'

const [logFile, title = 'Failure', reportFile] = process.argv.slice(2)
if (!logFile) {
  console.error('Usage: node scripts/ci-annotate.mjs <console-log> [title] [json-report]')
  process.exit(2)
}

// Built with fromCharCode so the script itself contains no control characters (a regex with a literal
// escape byte fails the project's lint rules, and rightly so).
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')

/** Annotations travel as a single line: percent signs and newlines have to be escaped. */
function escapeAnnotation(value) {
  return value.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A')
}

function emit(name, message) {
  const text = message.length > 8000 ? `${message.slice(0, 8000)}\n…(truncated)` : message
  process.stdout.write(`::error title=${escapeAnnotation(name)}::${escapeAnnotation(text.trim())}\n`)
}

/** Every failure recorded by a Playwright JSON report, flattened to one line each. */
function failuresFromReport(path) {
  if (!path || !existsSync(path)) return []
  let report
  try {
    report = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
  const failures = []
  const walk = (suite, trail) => {
    const name = trail ? `${trail} › ${suite.title}` : suite.title
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          if (result.status === 'passed' || result.status === 'skipped') continue
          const message = String(result.error?.message ?? result.status)
            .replace(ANSI, '')
            .split('\n')
            .filter((line) => line.trim() !== '')
            .slice(0, 4)
            .join(' | ')
          failures.push(`${name} › ${spec.title} [${result.status}] — ${message}`)
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child, name)
  }
  for (const suite of report.suites ?? []) walk(suite, '')
  return failures
}

/** Fallback for tools without a machine-readable report: the numbered failure blocks. */
function failuresFromConsole(text) {
  const lines = text.replace(ANSI, '').split('\n')
  const failures = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (!/^\s{0,3}\d+\)\s/.test(line)) continue
    failures.push(
      lines
        .slice(index, index + 12)
        .filter((entry) => entry.trim() !== '')
        .join(' | ')
    )
  }
  return failures
}

const consoleText = readFileSync(logFile, 'utf8')
const reported = failuresFromReport(reportFile ?? '')
const failures = reported.length > 0 ? reported : failuresFromConsole(consoleText)

if (failures.length > 0) {
  emit(`${title} (${failures.length} failure(s))`, failures.join('\n'))
}
emit(`${title} — end of output`, consoleText.slice(-2500))
