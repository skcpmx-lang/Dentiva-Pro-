/**
 * Headless host: the complete main-process stack (database, migrations, session manager, services)
 * without Electron.
 *
 * The maintenance tools — the stress-data seeder, the standalone backup verifier and the browser
 * preview harness — must run against exactly the same code the application runs: the same migrations,
 * the same repositories, the same services and the same permission model. Duplicating any of that in a
 * script would mean testing a copy instead of the product, so this module builds the stack the same way
 * `src/main/index.ts` does and hands it over.
 *
 * It is deliberately Electron-free: nothing here imports `electron`, so a plain Node process can use it.
 */

import { join } from 'node:path'
import { closeDatabase, openDatabase, type SqliteDatabase } from '../db/connection'
import { applyInitialDefaults, createServices, type Services } from './container'
import { SessionManager } from '../security/session'
import { SettingsRepository } from '../db/repositories-core'
import { countThirdPartyComponents, repositoryNoticeFile } from './third-party'
import { activationStateHash, createInstallId, verifyActivationCode } from '../security/activation'
import { ensureLayout, resolveLayout, type DataLayout } from '../storage/paths'
import type { JobProgress } from '@shared/types'

export interface BuildInfo {
  version: string
  buildNumber: string
  commit: string
  buildDate: string
}

export interface HeadlessHostOptions {
  /** Data root: the folder that holds Database/, Backups/, Attachments/ … */
  root: string
  buildInfo?: BuildInfo
  autoLockMinutes?: number
  /** Injected clock (milliseconds since epoch) for deterministic tooling and tests. */
  now?: () => number
  scheduler?: {
    setInterval: (handler: () => void, ms: number) => unknown
    clearInterval: (handle: unknown) => void
  }
  onProgress?: (progress: JobProgress) => void
  /** Set to false to leave the session manager alone (for read-only tooling). */
  manageSession?: boolean
}

export interface HeadlessHost {
  db: SqliteDatabase
  layout: DataLayout
  session: SessionManager
  services: Services
  /** Close the database and stop the session timers. */
  dispose: () => void
  /** Re-open the connection after the database file was swapped by a restore. */
  reopen: () => SqliteDatabase
  /** Rebuild the service container on the current connection (what the IPC host does after a restore). */
  rebuild: () => void
}

export const DEFAULT_BUILD_INFO: BuildInfo = {
  version: '1.0.0',
  buildNumber: 'dev',
  commit: 'unknown',
  buildDate: 'unknown'
}

/** Settings are stored as JSON in `value_json`; the repository is the only supported reader. */
function readAutoLockMinutes(db: SqliteDatabase, fallback: number): number {
  const minutes = new SettingsRepository(db).get().autoLockMinutes
  return Number.isFinite(minutes) && minutes > 0 ? minutes : fallback
}

export function createHeadlessHost(options: HeadlessHostOptions): HeadlessHost {
  const buildInfo = options.buildInfo ?? DEFAULT_BUILD_INFO
  const layout = resolveLayout(options.root)
  ensureLayout(layout)

  let db = openDatabase(layout.databaseFile, { appVersion: buildInfo.version })
  // Idempotent: system meta values plus any setting that does not exist yet.
  applyInitialDefaults(db, buildInfo.version)

  const session = new SessionManager({
    autoLockMinutes: options.autoLockMinutes ?? readAutoLockMinutes(db, 10),
    activationInfo: () => ({
      activatedAt:
        (
          db.prepare("SELECT value FROM app_meta WHERE key = 'activated_at'").get() as
            { value: string } | undefined
        )?.value ?? null
    }),
    ...(options.now ? { now: options.now } : {}),
    ...(options.scheduler ? { scheduler: options.scheduler } : {})
  })

  function containerOptions(connection: SqliteDatabase): Parameters<typeof createServices>[0] {
    return {
      db: connection,
      layout,
      session,
      appVersion: buildInfo.version,
      buildInfo,
      runtime: {
        electron: 'n/a (headless)',
        chrome: 'n/a (headless)',
        node: process.versions.node,
        sqlite: String((connection.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v),
        thirdPartyCount: countThirdPartyComponents({
          noticeFiles: [repositoryNoticeFile(process.cwd())],
          manifestFile: join(process.cwd(), 'package.json')
        })
      },
      activation: {
        activated: Boolean(
          (
            connection.prepare("SELECT value FROM app_meta WHERE key = 'activated_at'").get() as
              { value: string } | undefined
          )?.value
        ),
        verify: (code: string) => verifyActivationCode(code),
        // The setup service records the activation timestamp itself; this hook only exists for symmetry.
        markActivated: () => undefined,
        activationStateHash: () => {
          const row = connection.prepare("SELECT value FROM app_meta WHERE key = 'install_id'").get() as
            { value: string } | undefined
          return activationStateHash(row?.value ?? createInstallId())
        }
      },
      closeDb: () => closeDatabase(connection),
      reopenDb: () => {
        db = openDatabase(layout.databaseFile, { appVersion: buildInfo.version })
        return db
      },
      listSystemPrinters: async () => [],
      ...(options.onProgress ? { onProgress: options.onProgress } : {})
    }
  }

  let services = createServices(containerOptions(db))

  // The same idempotent seed the application runs before the window opens.
  const seed = db.transaction(() => {
    services.permissions.syncCatalogue()
    services.catalogue.seedDefaults()
    services.catalogue.seedRoles()
  })
  seed()

  return {
    get db() {
      return db
    },
    layout,
    session,
    get services() {
      return services
    },
    dispose: () => {
      try {
        session.shutdown()
      } catch {
        // already stopped
      }
      closeDatabase(db)
    },
    reopen: () => {
      db = openDatabase(layout.databaseFile, { appVersion: buildInfo.version })
      return db
    },
    rebuild: () => {
      services = createServices(containerOptions(db))
    }
  }
}
