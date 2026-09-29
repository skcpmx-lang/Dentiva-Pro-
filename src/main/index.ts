/**
 * Dentiva Pro — main process entry point.
 *
 * Responsibilities: resolve the data folder, open and migrate the database, build the service container,
 * create the window, register the single IPC channel, run the schedulers (notifications, automatic
 * backups) and shut everything down cleanly. No business logic lives here — it delegates to services.
 */

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  session as electronSession,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { APP_INFO } from '@shared/constants'
import type { AppEvent, IpcPayload, LogBundle, RuntimeInfo } from '@shared/ipc'
import type { JobProgress, PrinterInfo } from '@shared/types'
import { nowSql } from '@shared/date'
import { verifyActivationCode, activationStateHash, createInstallId } from './security/activation'

import { closeDatabase, openDatabase, type SqliteDatabase } from './db/connection'
import { Logger, setGlobalLogger } from './logging/logger'
import { SessionManager } from './security/session'
import { PrintHost } from './printing/print-host'
import { applyInitialDefaults, createServices, type Services } from './services/container'
import { countThirdPartyComponents, noticeFileCandidates } from './services/third-party'
import { SettingsRepository } from './db/repositories-core'
import { createRegistry, type Registry, type RegistryHost } from './ipc/registry'
import { createInvoker } from './ipc/router'
import { loadAppConfig, loadWindowState, saveWindowState, type PersistedWindowState } from './window-state'
import { configRoot, defaultDataRoot, ensureLayout, resolveLayout, type DataLayout } from './storage/paths'

const IPC_CHANNEL = 'dentiva:invoke'
const EVENT_CHANNEL = 'dentiva:event'

interface BuildInformation {
  version: string
  buildNumber: string
  commit: string
  buildDate: string
}

const BUILD_INFO: BuildInformation = readBuildInfo()

let logger: Logger | null = null
let database: SqliteDatabase | null = null
let layout: DataLayout | null = null
let configDir = ''
let defaultRoot = ''
let services: Services | null = null
let sessionManager: SessionManager | null = null
let printHost: PrintHost | null = null
let registry: Registry | null = null
let mainWindow: BrowserWindow | null = null
let notificationTimer: NodeJS.Timeout | null = null
let backupTimer: NodeJS.Timeout | null = null
let isShuttingDown = false
const jobs = new Map<string, JobProgress>()

// -----------------------------------------------------------------------------------------------
// Startup helpers
// -----------------------------------------------------------------------------------------------

function readBuildInfo(): BuildInformation {
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, 'build-info.json') : null,
    join(app.getAppPath(), 'build-info.json'),
    join(__dirname, '../../build-info.json')
  ].filter((entry): entry is string => entry !== null)
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as Partial<BuildInformation>
      return {
        version: parsed.version ?? app.getVersion(),
        buildNumber: parsed.buildNumber ?? '1',
        commit: parsed.commit ?? 'development',
        buildDate: parsed.buildDate ?? new Date().toISOString().slice(0, 10)
      }
    } catch {
      // Ignore a malformed build-info file and try the next candidate.
    }
  }
  return {
    version: app.getVersion(),
    buildNumber: '1',
    commit: 'development',
    buildDate: new Date().toISOString().slice(0, 10)
  }
}

function resolveDataRoot(): { root: string; config: string; fallback: string } {
  const appDataPath = app.getPath('appData')
  const fallback = defaultDataRoot(appDataPath, APP_INFO.defaultDataFolderName)
  const config = configRoot(appDataPath, APP_INFO.defaultDataFolderName)

  // 1. A `data-root.txt` next to the executable always wins (portable / clinic-server installs).
  try {
    const portable = join(process.execPath, '..', 'data-root.txt')
    if (existsSync(portable)) {
      const candidate = readFileSync(portable, 'utf8').trim()
      if (candidate.length > 0) {
        const absolute = resolve(candidate)
        mkdirSync(absolute, { recursive: true })
        return { root: absolute, config, fallback }
      }
    }
  } catch (error) {
    logger?.warn(`The portable data-root.txt could not be used: ${String(error)}`)
  }

  // 2. The folder the clinic chose in the setup wizard.
  const saved = loadAppConfig(config)
  if (saved.dataRoot && saved.dataRoot.trim().length > 0) {
    const absolute = resolve(saved.dataRoot.trim())
    try {
      mkdirSync(absolute, { recursive: true })
      return { root: absolute, config, fallback }
    } catch (error) {
      logger?.warn(`The configured data folder is not usable: ${String(error)}`)
    }
  }

  // 3. %APPDATA%\Dentiva Pro\data
  return { root: fallback, config, fallback }
}

function rendererLocation(): { url: string; isFile: boolean } {
  if (process.env.DENTIVA_DEV_SERVER_URL) {
    return { url: process.env.DENTIVA_DEV_SERVER_URL, isFile: false }
  }
  const file = join(__dirname, '../renderer/index.html')
  return { url: `file://${file.replace(/\\/g, '/')}`, isFile: true }
}

function applySecurityPreferences(): void {
  const development = Boolean(process.env.DENTIVA_DEV_SERVER_URL)
  const policy = development
    ? "default-src 'self' 'unsafe-inline' data: blob: http://localhost:* ws://localhost:*"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
      "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
        'X-Content-Type-Options': ['nosniff']
      }
    })
  })
  electronSession.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false)
  )
}

// -----------------------------------------------------------------------------------------------
// Events to the renderer
// -----------------------------------------------------------------------------------------------

function emit(event: AppEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(EVENT_CHANNEL, event)
  }
}

function emitSessionChanged(): void {
  if (!services) return
  emit({ type: 'session:changed', payload: services.session.snapshot() })
}

function emitSetupChanged(): void {
  if (!services || !layout) return
  emit({ type: 'setup:changed', payload: services.setup.status({ defaultDataRoot: defaultRoot }) })
}

// -----------------------------------------------------------------------------------------------
// Window
// -----------------------------------------------------------------------------------------------

function createWindow(saved: PersistedWindowState): BrowserWindow {
  const window = new BrowserWindow({
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#f1f5f9',
    title: APP_INFO.productName,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  if (saved.isMaximized) window.maximize()
  if (saved.isFullScreen) window.setFullScreen(true)
  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const dev = process.env.DENTIVA_DEV_SERVER_URL
    if (dev && url.startsWith(dev)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  const { url, isFile } = rendererLocation()
  if (isFile) {
    void window.loadFile(url.replace('file://', ''))
  } else {
    void window.loadURL(url)
  }
  return window
}

function persistWindowState(window: BrowserWindow): void {
  if (!configDir) return
  const bounds = window.getNormalBounds()
  saveWindowState(configDir, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: window.isMaximized(),
    isFullScreen: window.isFullScreen()
  })
}

// -----------------------------------------------------------------------------------------------
// Registry host — everything that needs Electron or the file system
// -----------------------------------------------------------------------------------------------

function requireServices(): Services {
  if (!services) throw new Error('The application is not ready yet.')
  return services
}

function buildPrintDocument(payload: IpcPayload<'print.build'>) {
  const current = requireServices()
  if (payload.documentType === 'prescription') {
    return current.admin.buildPrescriptionDocumentPrint(payload.entityId, payload.paper)
  }
  if (payload.documentType === 'invoice') {
    return current.admin.buildInvoiceDocumentPrint(payload.entityId, payload.paper)
  }
  if (!payload.reportRequest) {
    throw new Error('Printing a report needs the report definition.')
  }
  return current.admin.buildReportPrint(payload.reportRequest)
}

/**
 * Locate a file that ships as an `extraResource`.
 *
 * In the packaged application it lives in `resources/…`; in development the same file is taken from the
 * repository so the About page, the user guide and the licence notices work without a build step.
 */
function findResource(...relative: string[]): string {
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, ...relative) : null,
    join(app.getAppPath(), ...relative),
    join(app.getAppPath(), ...relative.slice(1)),
    join(process.cwd(), ...relative.slice(1))
  ].filter((entry): entry is string => entry !== null)
  return (
    candidates.find((candidate) => existsSync(candidate)) ?? (candidates[candidates.length - 1] as string)
  )
}

function createHost(): RegistryHost {
  return {
    setupStatus: () => requireServices().setup.status({ defaultDataRoot: defaultRoot }),
    defaultDataRoot: () => defaultRoot,
    listPrinters: async (): Promise<PrinterInfo[]> => {
      if (!mainWindow) return []
      const printers = await mainWindow.webContents.getPrintersAsync()
      return printers.map((printer) => {
        const options = (printer.options ?? {}) as Record<string, unknown>
        const isDefault = String(options['printer-is-default'] ?? 'false') === 'true'
        const stateCode = Number(options['printer-state'] ?? 0)
        return {
          name: printer.name,
          displayName: printer.displayName || printer.name,
          isDefault,
          status: Number.isFinite(stateCode) ? stateCode : 0
        }
      })
    },
    buildDocument: (payload) => buildPrintDocument(payload),
    print: async (payload) => {
      const current = requireServices()
      const document = buildPrintDocument({
        documentType: payload.documentType,
        entityId: payload.entityId,
        reportRequest: payload.reportRequest
      })
      const profile = payload.profileId
        ? (current.admin.printerProfiles().find((entry) => entry.id === payload.profileId) ?? null)
        : (current.admin
            .printerProfiles()
            .find((entry) => entry.documentType === payload.documentType && entry.isDefault) ?? null)
      if (!printHost) throw new Error('The print service is not available.')
      return printHost.run({
        document,
        mode: payload.mode,
        printerName: profile?.printerName ?? null,
        copies: payload.copies ?? 1,
        targetPath: payload.targetPath ?? null
      })
    },
    documentForJob: (jobId) => printHost?.documentForJob(jobId) ?? null,
    saveWindowState: (windowState) => {
      if (!mainWindow) return
      const bounds = mainWindow.getNormalBounds()
      saveWindowState(configDir, {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized: windowState.isMaximized,
        isFullScreen: windowState.isFullScreen
      })
    },
    pickFiles: async (input) => {
      if (!mainWindow) return []
      const result = await dialog.showOpenDialog(mainWindow, {
        title: input?.title ?? 'Choose a file',
        properties: input?.directory
          ? ['openDirectory', 'createDirectory']
          : input?.multiple
            ? ['openFile', 'multiSelections']
            : ['openFile'],
        filters: input?.filters
      })
      return result.canceled ? [] : result.filePaths
    },
    pickFolder: async (input) => {
      if (!mainWindow) return null
      const result = await dialog.showOpenDialog(mainWindow, {
        title: input?.title ?? 'Choose a folder',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: input?.suggestedName ? join(homedir(), input.suggestedName) : undefined
      })
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    },
    pickSavePath: async (input) => {
      if (!mainWindow) return null
      const result = await dialog.showSaveDialog(mainWindow, {
        title: input.title ?? 'Save file',
        defaultPath: input.suggestedName,
        filters: input.filters
      })
      return result.canceled || !result.filePath ? null : result.filePath
    },
    openPath: async (target) => {
      if (!existsSync(target)) throw new Error('That file or folder no longer exists.')
      const errorMessage = await shell.openPath(target)
      if (errorMessage) throw new Error(errorMessage)
    },
    copyBackupTo: (folderPath, destinationParent) => {
      mkdirSync(destinationParent, { recursive: true })
      const destination = join(
        destinationParent,
        folderPath.split(/[\\/]/).filter(Boolean).pop() ?? 'DentivaPro_Backup'
      )
      cpSync(folderPath, destination, { recursive: true, force: true })
      logger?.info(`Backup copied to ${destination}`)
      return destination
    },
    rebuildContainer: () => {
      if (!database || !layout || !sessionManager) return
      services = createServices(buildContainerOptions(database))
    },
    setTerminalUnauthenticated: () => {
      sessionManager?.signOut()
      emitSessionChanged()
    },
    recentLogs: (): LogBundle => {
      if (!logger) return { entries: [], files: [] }
      const files = (() => {
        try {
          return readdirSync(logger.logDirectory)
            .filter((entry) => entry.endsWith('.log'))
            .slice(-30)
            .map((name) => {
              const stats = statSync(join(logger!.logDirectory, name))
              return { name, sizeBytes: stats.size, modifiedAt: stats.mtime.toISOString() }
            })
            .reverse()
        } catch {
          return []
        }
      })()
      return {
        entries: logger.recent(300).map((entry) => ({
          at: entry.at,
          level: entry.level,
          message: entry.message,
          scope: entry.scope
        })),
        files
      }
    },
    exportLogs: async (input) => {
      if (!logger || !mainWindow) return null
      const result = await dialog.showSaveDialog(mainWindow, {
        title: input.title ?? 'Export logs',
        defaultPath: input.suggestedName ?? `DentivaPro-logs-${nowSql().replace(/[: ]/g, '-')}.log`,
        filters: [{ name: 'Log file', extensions: ['log', 'txt'] }]
      })
      if (result.canceled || !result.filePath) return null
      const body = logger
        .recent(1000)
        .map(
          (entry) =>
            `${entry.at} [${entry.level.toUpperCase()}]${entry.scope ? ` (${entry.scope})` : ''} ${entry.message}`
        )
        .join('\n')
      writeFileSync(result.filePath, body, 'utf8')
      return result.filePath
    },
    dataRoot: () => layout?.root ?? '',
    userGuidePath: () => findResource('user-guide', 'USER_GUIDE.html'),
    thirdPartyNotices: () => {
      // Packaged: resources/legal/THIRD-PARTY-NOTICES.txt. Development: docs/compliance/THIRD-PARTY-NOTICES.txt.
      const file = findResource('legal', 'THIRD-PARTY-NOTICES.txt')
      try {
        return existsSync(file) ? readFileSync(file, 'utf8') : ''
      } catch {
        return ''
      }
    },
    runtimeInfo: (): RuntimeInfo => {
      const current = requireServices()
      const sqlite = String((current.db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v)
      return {
        productName: APP_INFO.productName,
        version: BUILD_INFO.version,
        buildNumber: BUILD_INFO.buildNumber,
        commit: BUILD_INFO.commit,
        buildDate: BUILD_INFO.buildDate,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        sqlite,
        v8: process.versions.v8,
        platform: process.platform,
        arch: process.arch,
        dataRoot: layout?.root ?? '',
        thirdPartyCount: thirdPartyComponentCount()
      }
    },
    startWorker: async (kind) => {
      const current = requireServices()
      const jobId = randomUUID()
      const base: JobProgress = {
        jobId,
        kind,
        phase: 'start',
        current: 0,
        total: 1,
        message: `Starting the ${kind} job…`,
        done: false,
        failed: false
      }
      jobs.set(jobId, base)
      emit({ type: 'job:progress', payload: base })
      const finish = (patch: Partial<JobProgress>): void => {
        const next = { ...base, ...patch, done: true }
        jobs.set(jobId, next)
        emit({ type: 'job:progress', payload: next })
      }
      setTimeout(() => {
        try {
          if (kind === 'integrity') {
            const report = current.admin.runIntegrity(true)
            finish({
              phase: 'done',
              current: 1,
              message: report.ok
                ? 'Integrity check passed.'
                : 'Integrity check found problems — see the details.'
            })
          } else if (kind === 'backup') {
            void current.admin
              .createBackup('manual', { includeAttachments: true })
              .then((record) =>
                finish({ phase: 'done', current: 1, message: `Backup created: ${record.fileName}` })
              )
              .catch((error: unknown) =>
                finish({
                  phase: 'failed',
                  failed: true,
                  message: error instanceof Error ? error.message : String(error)
                })
              )
          } else {
            finish({ phase: 'done', current: 1, message: `The ${kind} job finished.` })
          }
        } catch (error) {
          finish({
            phase: 'failed',
            failed: true,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }, 0)
      return { jobId, message: `The ${kind} job started.` }
    },
    workerProgress: (jobId) => jobs.get(jobId) ?? null
  }
}

// -----------------------------------------------------------------------------------------------
// Menu and shortcuts
// -----------------------------------------------------------------------------------------------

function buildMenu(): void {
  const send = (command: string): void => emit({ type: 'command', payload: { command } })
  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: 'Dashboard', accelerator: 'Ctrl+1', click: () => send('navigate:dashboard') },
        { label: 'Patients', accelerator: 'Ctrl+2', click: () => send('navigate:patients') },
        { label: 'Appointments', accelerator: 'Ctrl+3', click: () => send('navigate:appointments') },
        { label: 'Queue', accelerator: 'Ctrl+4', click: () => send('navigate:queue') },
        { type: 'separator' },
        { label: 'New patient', accelerator: 'Ctrl+Shift+P', click: () => send('action:new-patient') },
        { label: 'New invoice', accelerator: 'Ctrl+Shift+I', click: () => send('action:new-invoice') },
        { label: 'Backup now', accelerator: 'Ctrl+Shift+B', click: () => send('action:backup') },
        { type: 'separator' },
        { label: 'Lock now', accelerator: 'Ctrl+L', click: () => send('action:lock') },
        { label: 'Sign out', click: () => send('action:logout') },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '&View',
      submenu: [
        { label: 'Global search', accelerator: 'Ctrl+K', click: () => send('action:search') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: '&Tools',
      submenu: [
        { label: 'Run integrity check', click: () => send('action:integrity') },
        { label: 'Notifications', accelerator: 'Ctrl+Shift+N', click: () => send('action:notifications') },
        { type: 'separator' },
        { label: 'Open data folder', click: () => void shell.openPath(layout?.root ?? '') },
        { label: 'Open log folder', click: () => void shell.openPath(logger?.logDirectory ?? '') }
      ]
    },
    {
      label: '&Help',
      submenu: [
        { label: 'About Dentiva Pro', click: () => send('navigate:about') },
        {
          label: 'User guide',
          click: () => {
            const guide = findResource('user-guide', 'USER_GUIDE.html')
            if (existsSync(guide)) void shell.openPath(guide)
            else send('navigate:about')
          }
        },
        { type: 'separator' },
        {
          label: `Contact the author (${APP_INFO.authorEmail})`,
          click: () => void shell.openExternal(`mailto:${APP_INFO.authorEmail}`)
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// -----------------------------------------------------------------------------------------------
// Schedulers
// -----------------------------------------------------------------------------------------------

function refreshNotifications(): void {
  if (!services || services.session.sessionState !== 'authenticated') return
  try {
    services.clinical.refreshNotifications()
    emit({ type: 'notifications:changed', payload: { unread: services.clinical.notificationCount() } })
  } catch (error) {
    logger?.warn(`Notification refresh failed: ${String(error)}`)
  }
}

function runAutomaticBackup(): void {
  if (!services || services.session.sessionState !== 'authenticated') return
  void services.admin
    .runAutoBackupIfDue()
    .then((record) => {
      if (record) {
        logger?.info(`Automatic backup created: ${record.fileName}`)
        emit({ type: 'notifications:changed', payload: { unread: services!.clinical.notificationCount() } })
      }
    })
    .catch((error: unknown) => {
      logger?.error(`Automatic backup failed: ${String(error)}`)
      emit({ type: 'notifications:changed', payload: { unread: services!.clinical.notificationCount() } })
    })
}

function startSchedulers(): void {
  notificationTimer = setInterval(refreshNotifications, 5 * 60_000)
  backupTimer = setInterval(runAutomaticBackup, 30 * 60_000)
  setTimeout(refreshNotifications, 15_000)
}

// -----------------------------------------------------------------------------------------------
// Container wiring
// -----------------------------------------------------------------------------------------------

/** How many third-party components ship in this build (read from the generated notices, never guessed). */
function thirdPartyComponentCount(): number {
  return countThirdPartyComponents({
    noticeFiles: noticeFileCandidates(process.resourcesPath ?? null, app.getAppPath()),
    manifestFile: join(app.getAppPath(), 'package.json')
  })
}

function buildContainerOptions(db: SqliteDatabase): Parameters<typeof createServices>[0] {
  if (!layout || !sessionManager) throw new Error('The application is not ready yet.')
  const current = layout
  return {
    db,
    layout: current,
    session: sessionManager,
    appVersion: BUILD_INFO.version,
    buildInfo: BUILD_INFO,
    runtime: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      sqlite: String((db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v),
      thirdPartyCount: thirdPartyComponentCount()
    },
    activation: {
      activated: Boolean(
        (
          db.prepare("SELECT value FROM app_meta WHERE key = 'activated_at'").get() as
            { value: string } | undefined
        )?.value
      ),
      verify: (code: string) => verifyActivationCode(code),
      markActivated: () => undefined,
      activationStateHash: () => {
        const row = db.prepare("SELECT value FROM app_meta WHERE key = 'install_id'").get() as
          { value: string } | undefined
        return activationStateHash(row?.value ?? createInstallId())
      }
    },
    // A restore swaps the database file underneath the running app. reopenDb() therefore has to adopt the
    // new connection as the module-level handle, otherwise rebuildContainer() (called right after the
    // restore) would wire every service to the connection that was just closed.
    closeDb: () => closeDatabase(db),
    reopenDb: () => {
      database = openDatabase(current.databaseFile, { appVersion: BUILD_INFO.version })
      return database
    },
    listSystemPrinters: async () => {
      if (!mainWindow) return []
      const printers = await mainWindow.webContents.getPrintersAsync()
      return printers.map((printer) => ({
        name: printer.name,
        displayName: printer.displayName || printer.name,
        isDefault:
          String(((printer.options ?? {}) as Record<string, unknown>)['printer-is-default'] ?? 'false') ===
          'true',
        status: Number(((printer.options ?? {}) as Record<string, unknown>)['printer-state'] ?? 0) || 0
      }))
    },
    onProgress: (progress) => {
      jobs.set(progress.jobId, progress)
      emit({ type: 'job:progress', payload: progress })
    }
  }
}

function bootstrap(): void {
  const resolved = resolveDataRoot()
  configDir = resolved.config
  defaultRoot = resolved.fallback
  mkdirSync(configDir, { recursive: true })

  layout = resolveLayout(resolved.root)
  ensureLayout(layout)

  logger = new Logger({
    directory: layout.logsDir,
    retentionDays: 30,
    bufferSize: 800,
    minLevel: process.env.DENTIVA_LOG_LEVEL === 'debug' ? 'debug' : 'info',
    consoleOutput: Boolean(process.env.DENTIVA_LOG_CONSOLE)
  })
  setGlobalLogger(logger)
  logger.info(`${APP_INFO.productName} ${BUILD_INFO.version} (build ${BUILD_INFO.buildNumber}) starting`, {
    dataRoot: layout.root,
    electron: process.versions.electron,
    node: process.versions.node
  })

  if (!layout.databaseFile) throw new Error('The data folder layout is incomplete.')

  database = openDatabase(layout.databaseFile, { appVersion: BUILD_INFO.version })
  // Idempotent: writes the system meta values and any setting that does not exist yet.
  applyInitialDefaults(database, BUILD_INFO.version)

  // Read through the repository: settings are stored as JSON in `value_json`, and the session manager needs
  // the configured auto-lock timeout before the service container exists.
  const autoLockMinutes = new SettingsRepository(database).get().autoLockMinutes

  sessionManager = new SessionManager({
    autoLockMinutes: Number.isFinite(autoLockMinutes) && autoLockMinutes > 0 ? autoLockMinutes : 10,
    activationInfo: () => ({
      activatedAt:
        (
          database!.prepare("SELECT value FROM app_meta WHERE key = 'activated_at'").get() as
            { value: string } | undefined
        )?.value ?? null
    })
  })

  services = createServices(buildContainerOptions(database))

  // System defaults are seeded once; all three operations are idempotent and must finish before the
  // setup wizard can create the first user (it needs the Administrator role to exist).
  const seed = database.transaction(() => {
    services!.permissions.syncCatalogue()
    services!.catalogue.seedDefaults()
    services!.catalogue.seedRoles()
  })
  seed()

  printHost = new PrintHost({
    rendererBase: rendererLocation().url,
    preloadPath: join(__dirname, '../preload/index.js'),
    logger
  })

  registry = createRegistry()
  const { invoke } = createInvoker({
    registry,
    session: sessionManager,
    // A getter, not the current value: after a restore the container is rebuilt and the router must use it.
    services: () => services!,
    host: createHost(),
    logger,
    appVersion: BUILD_INFO.version,
    onTerminalUnauthenticated: () => {
      sessionManager?.signOut()
      emitSessionChanged()
      emitSetupChanged()
    }
  })

  ipcMain.handle(IPC_CHANNEL, async (_event, channel: unknown, payload: unknown) => invoke(channel, payload))

  sessionManager.on('session:changed', () => emitSessionChanged())
  sessionManager.on('session:locked', () => emitSessionChanged())
  sessionManager.on('session:unlocked', () => emitSessionChanged())
  sessionManager.on('session:logged-out', () => emitSessionChanged())

  buildMenu()

  const saved = loadWindowState(configDir)
  mainWindow = createWindow(saved)
  mainWindow.on('resized', () => persistWindowState(mainWindow!))
  mainWindow.on('moved', () => persistWindowState(mainWindow!))
  mainWindow.on('maximize', () => persistWindowState(mainWindow!))
  mainWindow.on('unmaximize', () => persistWindowState(mainWindow!))
  mainWindow.on('close', () => {
    if (mainWindow) persistWindowState(mainWindow)
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  startSchedulers()
}

function shutdown(reason: string): void {
  if (isShuttingDown) return
  isShuttingDown = true
  if (notificationTimer) clearInterval(notificationTimer)
  if (backupTimer) clearInterval(backupTimer)
  notificationTimer = null
  backupTimer = null
  try {
    sessionManager?.shutdown()
  } catch (error) {
    logger?.error(`Failed to stop the session timer: ${String(error)}`)
  }
  logger?.info(`Shutting down (${reason})`)
  try {
    if (database) closeDatabase(database)
  } catch (error) {
    logger?.error(`Failed to close the database cleanly: ${String(error)}`)
  }
  database = null
}

// -----------------------------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------------------------

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'light'
    app.setAppUserModelId(APP_INFO.appId)
    try {
      applySecurityPreferences()
      bootstrap()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger?.error(`Startup failed: ${message}`)
      dialog.showErrorBox(
        `${APP_INFO.productName} could not start`,
        `${message}\n\nYour data has not been changed. If this keeps happening, restore a backup of your data folder.`
      )
      app.exit(1)
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(loadWindowState(configDir))
    }
  })

  app.on('before-quit', () => shutdown('application quit'))

  process.on('uncaughtException', (error) => {
    logger?.error(`Uncaught exception: ${error.message}`, {
      stack: error.stack?.split('\n').slice(0, 4).join(' | ')
    })
  })
  process.on('unhandledRejection', (reason) => {
    logger?.error(`Unhandled promise rejection: ${String(reason)}`)
  })
}
