/**
 * Browser preview harness (development tool — never shipped inside the application).
 *
 * It serves the production renderer bundle (`npm run build:app` first) and runs the *real* main-process
 * stack behind it: the same service container, the same channel registry and the same router the desktop
 * app uses. The page gets a small shim that behaves like the preload bridge (`window.dentiva`) and talks
 * to `/api/invoke`, so every screen, every validation rule, every permission check and every database
 * write is the production code path.
 *
 * What the browser cannot do (and reports honestly instead of pretending):
 *   • printing to a printer or exporting a PDF — those need Chromium's desktop print pipeline;
 *   • native Save/Open dialogs — file picking is done with a browser file input that uploads the chosen
 *     files into the data root, so attachment handling still works end to end.
 */

import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createInvoker } from '@main/ipc/router'
import { createRegistry } from '@main/ipc/registry'
import { createHeadlessHost } from '@main/services/headless'
import { buildPrintDocument } from '@main/printing/build-document'
import { Logger } from '@main/logging/logger'
import { APP_INFO } from '@shared/constants'
import type { AppEvent, LogBundle, RuntimeInfo } from '@shared/ipc'
import type { PrintDocument } from '@shared/printing/model'
import type { JobProgress, PrinterInfo } from '@shared/types'
import type { RegistryHost } from '@main/ipc/registry'
import type { Services } from '@main/services/container'

export interface PreviewServerOptions {
  /** Data root for the preview database (a throwaway folder is the right choice). */
  root: string
  /** Built renderer folder (defaults to out/renderer). */
  rendererDir: string
  host: string
  port: number
  /** Activation code, when the preview should complete the setup wizard automatically. */
  activationCode?: string
  /** Password for the preview administrator (generated when omitted). */
  adminPassword?: string
  log?: (message: string) => void
}

export interface PreviewServer {
  url: string
  close: () => Promise<void>
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8'
}

/**
 * The shim the page loads before the application bundle. It mirrors `src/preload/index.ts` exactly:
 * one `invoke`, one `subscribe` and the platform string.
 */
const BRIDGE_SCRIPT = `
(() => {
  const listeners = new Set();
  async function invoke(channel, payload) {
    if (channel === 'system.openDialog') {
      // The browser cannot open a native dialog: pick files with an <input type="file"> and upload them
      // into the data root, then answer with the saved paths exactly like the desktop app does.
      if (payload && payload.directory) {
        return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Choosing a folder needs the desktop application.' } };
      }
      const paths = await window.__dentivaPickFiles(payload || {});
      return { ok: true, data: paths };
    }
    const response = await fetch('/api/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, payload })
    });
    return await response.json();
  }
  window.__dentivaPickFiles = async (options) => {
    return await new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = options.multiple !== false;
      if (Array.isArray(options.filters) && options.filters.length > 0) {
        const extensions = options.filters.flatMap((filter) => filter.extensions || []);
        if (extensions.length > 0) input.accept = extensions.map((extension) => '.' + extension).join(',');
      }
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const files = Array.from(input.files || []);
        input.remove();
        const saved = [];
        for (const file of files) {
          const response = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'x-dentiva-filename': encodeURIComponent(file.name) },
            body: file
          });
          if (response.ok) {
            const body = await response.json();
            if (body && body.path) saved.push(body.path);
          }
        }
        resolve(saved);
      });
      input.click();
    });
  };
  window.dentiva = {
    platform: 'win32',
    invoke,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  const events = new EventSource('/api/events');
  events.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data);
      for (const listener of listeners) listener(event);
    } catch (error) {
      console.error('Could not read a preview event', error);
    }
  };
})();
`

function readBody(request: IncomingMessage, limitBytes = 64 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limitBytes) {
        reject(new Error('The uploaded data is too large for the preview harness.'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload)
  })
  response.end(payload)
}

function buildPreview(options: PreviewServerOptions): {
  server: ReturnType<typeof createServer>
  close: () => Promise<void>
  /** Complete the setup wizard on this data root, returning the credentials to sign in with. */
  autoSetup: (activationCode: string) => string
  status: () => ReturnType<Services['setup']['status']>
} {
  const log = options.log ?? (() => undefined)
  const rendererDir = resolve(options.rendererDir)
  const indexHtmlPath = join(rendererDir, 'index.html')
  if (!existsSync(indexHtmlPath)) {
    throw new Error(
      `The renderer build was not found in ${rendererDir}. Run "npm run build:app" (electron-vite build) first.`
    )
  }

  const host = createHeadlessHost({ root: options.root })
  const logger = new Logger({
    directory: host.layout.logsDir,
    retentionDays: 7,
    bufferSize: 200,
    minLevel: 'warn',
    consoleOutput: false
  })
  const appVersion = '1.0.0'
  const jobs = new Map<string, JobProgress>()
  const clients = new Set<ServerResponse>()

  const broadcast = (event: AppEvent): void => {
    const payload = `data: ${JSON.stringify(event)}\n\n`
    for (const client of clients) client.write(payload)
  }

  const registryHost: RegistryHost = {
    setupStatus: () => host.services.setup.status({ defaultDataRoot: host.layout.root }),
    defaultDataRoot: () => host.layout.root,
    listPrinters: async (): Promise<PrinterInfo[]> => [],
    buildDocument: (payload) => buildPrintDocument(host.services, payload),
    print: async (payload) => ({
      ok: false,
      mode: payload.mode,
      filePath: null,
      pages: null,
      message:
        'Printing and PDF export need the desktop application. Everything else in this preview runs the real application code.'
    }),
    documentForJob: (): PrintDocument | null => null,
    saveWindowState: () => undefined,
    pickFiles: async () => [],
    pickFolder: async () => null,
    pickSavePath: async () => null,
    openPath: async () => undefined,
    copyBackupTo: (folderPath, destinationParent) => {
      const target = join(destinationParent, folderPath.split(/[\\/]/).filter(Boolean).pop() ?? 'Backup')
      mkdirSync(target, { recursive: true })
      return target
    },
    rebuildContainer: () => {
      host.rebuild()
      logger.info('Preview container rebuilt after a restore.')
    },
    setTerminalUnauthenticated: () => {
      host.session.signOut()
      broadcast({ type: 'session:changed', payload: host.session.snapshot() })
    },
    recentLogs: (): LogBundle => ({ entries: [], files: [] }),
    exportLogs: async () => null,
    dataRoot: () => host.layout.root,
    userGuidePath: () => join(process.cwd(), 'docs', 'user-guide'),
    thirdPartyNotices: () => join(process.cwd(), 'docs', 'compliance', 'THIRD-PARTY-NOTICES.md'),
    runtimeInfo: (): RuntimeInfo => ({
      productName: APP_INFO.productName,
      version: appVersion,
      buildNumber: 'preview',
      commit: 'preview',
      buildDate: new Date().toISOString().slice(0, 10),
      electron: 'n/a (browser preview)',
      chrome: process.versions.node,
      node: process.versions.node,
      sqlite: String((host.db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v),
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      dataRoot: host.layout.root,
      thirdPartyCount: 0
    }),
    startWorker: async (kind) => {
      const jobId = randomUUID()
      const progress: JobProgress = {
        jobId,
        kind,
        phase: 'start',
        current: 0,
        total: 1,
        message: `Starting the ${kind} job…`,
        done: false,
        failed: false
      }
      jobs.set(jobId, progress)
      broadcast({ type: 'job:progress', payload: progress })
      setTimeout(() => {
        let done: JobProgress
        try {
          if (kind === 'integrity') {
            const report = host.services.admin.runIntegrity(true)
            done = {
              ...progress,
              phase: 'done',
              current: 1,
              done: true,
              message: report.ok ? 'Integrity check passed.' : 'Integrity check found problems.'
            }
          } else if (kind === 'backup') {
            done = {
              ...progress,
              phase: 'done',
              current: 1,
              done: true,
              message: 'Backup started from the browser preview is not supported.'
            }
          } else {
            done = {
              ...progress,
              phase: 'done',
              current: 1,
              done: true,
              message: `${kind} jobs run in the desktop application.`
            }
          }
        } catch (error) {
          done = { ...progress, phase: 'failed', done: true, failed: true, message: String(error) }
        }
        jobs.set(jobId, done)
        broadcast({ type: 'job:progress', payload: done })
      }, 10)
      return { jobId, message: `Started the ${kind} job.` }
    },
    workerProgress: (jobId) => jobs.get(jobId) ?? null
  }

  const invoker = createInvoker({
    registry: createRegistry(),
    session: host.session,
    services: () => host.services,
    host: registryHost,
    logger,
    appVersion,
    onTerminalUnauthenticated: () => {
      host.session.signOut()
      broadcast({ type: 'session:changed', payload: host.session.snapshot() })
    }
  })

  host.session.on('session:changed', () =>
    broadcast({ type: 'session:changed', payload: host.session.snapshot() })
  )
  host.session.on('session:locked', () =>
    broadcast({ type: 'session:changed', payload: host.session.snapshot() })
  )

  const server = createServer((request, response) => {
    void handle(request, response)
  })

  const uploadsDir = join(host.layout.tempDir, 'preview-uploads')

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

    if (url.pathname === '/api/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive'
      })
      response.write('retry: 2000\n\n')
      clients.add(response)
      request.on('close', () => clients.delete(response))
      return
    }

    if (url.pathname === '/api/invoke' && request.method === 'POST') {
      try {
        const body = JSON.parse((await readBody(request)).toString('utf8')) as {
          channel?: unknown
          payload?: unknown
        }
        const result = await invoker.invoke(body.channel, body.payload)
        sendJson(response, 200, result)
      } catch (error) {
        sendJson(response, 200, {
          ok: false,
          error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }
        })
      }
      return
    }

    if (url.pathname === '/api/upload' && request.method === 'POST') {
      try {
        const rawName = String(request.headers['x-dentiva-filename'] ?? 'upload.bin')
        const safeName = decodeURIComponent(rawName)
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .slice(-120)
        mkdirSync(uploadsDir, { recursive: true })
        const target = join(uploadsDir, `${Date.now()}-${safeName}`)
        writeFileSync(target, await readBody(request))
        log(`preview upload: ${target}`)
        sendJson(response, 200, { path: target })
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end()
      return
    }

    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const candidate = resolve(join(rendererDir, normalize(relative)))
    const insideRenderer = candidate === rendererDir || candidate.startsWith(rendererDir + sep)
    const filePath =
      insideRenderer && existsSync(candidate) && statSync(candidate).isFile() ? candidate : null

    if (!filePath) {
      // Single-page application: unknown paths render the app, which routes them itself.
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(rendererHtml(indexHtmlPath))
      return
    }

    if (filePath === indexHtmlPath) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(rendererHtml(indexHtmlPath))
      return
    }

    response.writeHead(200, {
      'content-type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store'
    })
    createReadStream(filePath).pipe(response)
  }

  function rendererHtml(file: string): string {
    const html = readFileSync(file, 'utf8')
    return html.replace(
      '<head>',
      `<head>\n    <script>${BRIDGE_SCRIPT}</script>\n    <script>window.__DENTIVA_PREVIEW__ = true;</script>`
    )
  }

  return {
    server,
    close: async () => {
      for (const client of clients) client.end()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      host.dispose()
    },
    status: () => host.services.setup.status({ defaultDataRoot: host.layout.root }),
    autoSetup: (activationCode: string) => {
      const activation = host.services.setup.activate(activationCode)
      if (!activation.activated) {
        throw new Error(`Activation failed: ${activation.message}`)
      }
      const password = options.adminPassword ?? `Preview-${randomUUID().slice(0, 8)}#1`
      host.services.setup.complete({
        clinic: {
          name: 'Preview Dental Care',
          nameBn: 'প্রিভিউ ডেন্টাল কেয়ার',
          address: '12 Preview Road, Dhaka',
          city: 'Dhaka',
          postalCode: '1205',
          country: 'Bangladesh',
          phone1: '+8801700000000',
          phone2: null,
          email: 'preview@example.com',
          website: null,
          registrationNo: 'PREVIEW-001',
          footerQuote: null
        },
        dentists: [
          {
            fullName: 'Dr. Preview Dentist',
            designations: ['Consultant'],
            qualifications: ['BDS'],
            certifications: [],
            phone: null,
            email: null,
            registrationNo: null,
            signaturePath: null,
            notes: null,
            isActive: true,
            sortOrder: 0,
            schedules: [{ weekday: 6, startTime: '10:00', endTime: '14:00' }]
          }
        ],
        admin: {
          username: 'admin',
          displayName: 'Preview Administrator',
          password,
          confirmPassword: password
        },
        activationCode
      })
      return password
    }
  }
}

/**
 * Start the preview: build the stack, optionally complete the setup wizard so the clinic can be reviewed
 * immediately, then serve the renderer bundle.
 */
export async function startPreviewServer(
  options: PreviewServerOptions
): Promise<PreviewServer & { credentials: string | null }> {
  const log = options.log ?? (() => undefined)
  const preview = buildPreview(options)
  await new Promise<void>((resolve, reject) => {
    preview.server.once('error', reject)
    preview.server.listen(options.port, options.host, () => resolve())
  })

  let credentials: string | null = null
  if (options.activationCode) {
    // Complete the wizard so the clinic can be reviewed immediately; the wizard itself is covered by the
    // automated setup tests, and the preview always runs the real setup service.
    const status = preview.status()
    if (status.setupRequired) {
      const password = preview.autoSetup(options.activationCode)
      credentials = `admin / ${password}`
      log(`preview setup completed — sign in with admin / ${password}`)
    }
  }
  log(`preview listening on http://${options.host}:${options.port}`)
  return {
    url: `http://${options.host}:${options.port}`,
    close: preview.close,
    credentials
  }
}
