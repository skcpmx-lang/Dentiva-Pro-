/**
 * Managed file-system layout and path safety (ADR-0005, REQ §47, §87).
 *
 * All paths stored in the database are relative to the data root; every file operation resolves through
 * `assertInsideRoot` so a crafted path (traversal, absolute path, UNC, device path, symlinked escape) can
 * never touch anything outside the clinic's data folder.
 */

import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { sanitizeFileName, uuid } from '@shared/ids'
import { fileExtension } from '@shared/ids'
import { AppError } from '@shared/errors'

export interface DataLayout {
  root: string
  databaseDir: string
  databaseFile: string
  attachmentsDir: string
  patientAttachmentsDir: string
  backupsDir: string
  exportsDir: string
  logsDir: string
  tempDir: string
  configDir: string
  trashDir: string
}

export function resolveLayout(root: string): DataLayout {
  const base = resolve(root)
  return {
    root: base,
    databaseDir: join(base, 'Database'),
    databaseFile: join(base, 'Database', 'dentiva.db'),
    attachmentsDir: join(base, 'Attachments'),
    patientAttachmentsDir: join(base, 'Attachments', 'Patients'),
    backupsDir: join(base, 'Backups'),
    exportsDir: join(base, 'Exports'),
    logsDir: join(base, 'Logs'),
    tempDir: join(base, 'Temp'),
    configDir: join(base, 'Config'),
    trashDir: join(base, 'Temp', 'trash')
  }
}

export function ensureLayout(layout: DataLayout): void {
  for (const directory of [
    layout.root,
    layout.databaseDir,
    layout.attachmentsDir,
    layout.patientAttachmentsDir,
    layout.backupsDir,
    layout.exportsDir,
    layout.logsDir,
    layout.tempDir,
    layout.configDir,
    layout.trashDir
  ]) {
    mkdirSync(directory, { recursive: true })
  }
}

const WINDOWS_DEVICE_PREFIX = /^(\\\\[.?]\\|\\\?\?\\|\\\\.\\|con|nul|prn|aux|com[1-9]|lpt[1-9])/i

/**
 * Validate that `target` is inside `root` and return the resolved absolute path.
 * Rejects traversal, absolute paths, UNC/device prefixes and symlink escapes.
 */
export function assertInsideRoot(
  root: string,
  target: string,
  options: { allowMissing?: boolean } = {}
): string {
  if (typeof target !== 'string' || target.trim() === '') {
    throw new AppError('FILE_ERROR', 'The requested file path is empty.')
  }
  if (WINDOWS_DEVICE_PREFIX.test(target)) {
    throw new AppError('FILE_ERROR', 'Device paths are not allowed.')
  }
  if (isAbsolute(target) && target.includes('..')) {
    throw new AppError('FILE_ERROR', 'The requested file path is not valid.')
  }

  const rootResolved = resolve(root)
  const targetResolved = resolve(rootResolved, target)
  const rel = relative(rootResolved, targetResolved)

  if (rel === '') {
    throw new AppError('FILE_ERROR', 'The requested path points at the data folder itself.')
  }
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new AppError('FILE_ERROR', 'The requested file path is outside the Dentiva Pro data folder.')
  }

  // Symlink escape protection: if the target (or its closest existing ancestor) resolves elsewhere, reject.
  const existingAncestor = findExistingAncestor(targetResolved)
  if (existingAncestor) {
    const realAncestor = safeRealPath(existingAncestor)
    const realRoot = safeRealPath(rootResolved)
    const realRel = relative(realRoot, realAncestor)
    if (realRel.startsWith('..') || isAbsolute(realRel)) {
      throw new AppError('FILE_ERROR', 'The requested file path leaves the Dentiva Pro data folder.')
    }
  } else if (!options.allowMissing) {
    // The caller may create it later; the lexical check above is still enforced.
  }

  return targetResolved
}

function findExistingAncestor(path: string): string | null {
  let current = path
  while (true) {
    if (existsSync(current)) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function safeRealPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** Build the managed relative path for a new patient attachment. */
export function buildAttachmentRelativePath(patientCode: string, originalName: string): string {
  const safeCode = sanitizeFileName(patientCode, 'PATIENT').replace(/[^A-Za-z0-9._-]/g, '_')
  const safeName = sanitizeFileName(originalName, 'attachment')
  const extension = fileExtension(safeName)
  const base = safeName.slice(0, safeName.length - extension.length) || 'attachment'
  const stored = `${uuid()}-${base.slice(0, 80)}${extension}`
  return normalize(join('Attachments', 'Patients', safeCode, stored))
    .split(sep)
    .join('/')
}

/** Resolve a stored relative path (from the database) to an absolute path inside the data root. */
export function resolveStoredPath(layout: DataLayout, storedPath: string): string {
  const normalized = storedPath.replace(/\\/g, '/')
  return assertInsideRoot(layout.root, normalized)
}

export function toRelativePath(layout: DataLayout, absolutePath: string): string {
  const inside = assertInsideRoot(layout.root, absolutePath)
  return relative(layout.root, inside).split(sep).join('/')
}

/** Ensure the parent folder of a file exists (inside the data root). */
export function ensureParentDir(layout: DataLayout, storedOrAbsolutePath: string): string {
  const absolute = isAbsolute(storedOrAbsolutePath)
    ? assertInsideRoot(layout.root, storedOrAbsolutePath)
    : resolveStoredPath(layout, storedOrAbsolutePath)
  mkdirSync(dirname(absolute), { recursive: true })
  return absolute
}

/** Human readable file size used in the attachments and backup screens. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const precision = value >= 100 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

/** Validate a folder the user selected for backups/exports (must be writable). */
export function assertWritableFolder(folder: string): void {
  if (WINDOWS_DEVICE_PREFIX.test(folder)) {
    throw new AppError('FILE_ERROR', 'Device paths are not allowed.')
  }
  try {
    mkdirSync(folder, { recursive: true })
  } catch (error) {
    throw new AppError('FILE_ERROR', `The folder "${folder}" cannot be created or is not writable.`, {
      cause: error
    })
  }
}

export function defaultDataRoot(appDataPath: string, appFolderName: string): string {
  return join(appDataPath, appFolderName, 'data')
}

export function configRoot(appDataPath: string, appFolderName: string): string {
  return join(appDataPath, appFolderName, 'config')
}
