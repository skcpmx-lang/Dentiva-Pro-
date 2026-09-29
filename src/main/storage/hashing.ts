/**
 * File hashing used by the backup format.
 *
 * Backups carry a SHA-256 for every file they contain, so a damaged or tampered backup can be detected
 * without opening the database. Hashing reads whole files (attachments are capped well below memory
 * limits) and is deliberately dependency-free.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
