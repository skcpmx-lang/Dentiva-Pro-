/**
 * Print host: renders a `PrintDocument` in an offscreen window and either prints it on a real printer
 * or writes a PDF with embedded fonts (so Bengali text stays intact).
 *
 * The same document object drives the on-screen preview and the printed output — there is exactly one
 * layout implementation (in the renderer), so "what you see is what prints".
 */

import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PrintDocument } from '@shared/printing/model'
import type { PrintJobResult } from '@shared/printing/model'
import { paperCssSize } from '@shared/printing/paper'
import type { Logger } from '../logging/logger'

export interface PrintHostOptions {
  /** Renderer URL (dev server) or file URL of the built index.html. */
  rendererBase: string
  preloadPath: string
  logger: Logger
}

const READY_TIMEOUT_MS = 15_000
const PX_PER_MM = 3.7795275591

export class PrintHost {
  private readonly options: PrintHostOptions
  private readonly documents = new Map<string, PrintDocument>()
  private readonly waiters = new Map<string, () => void>()

  constructor(options: PrintHostOptions) {
    this.options = options
  }

  /** Keep a document so the print window can fetch it through `print.ready`. */
  register(document: PrintDocument): string {
    const jobId = randomUUID()
    this.documents.set(jobId, document)
    return jobId
  }

  /** Called by the router when the print window requests the document of its job. */
  documentForJob(jobId: string): PrintDocument | null {
    const document = this.documents.get(jobId)
    if (document) {
      const waiter = this.waiters.get(jobId)
      if (waiter) {
        this.waiters.delete(jobId)
        waiter()
      }
    }
    return document ?? null
  }

  private waitForWindow(jobId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.set(jobId, resolve)
      setTimeout(() => {
        if (this.waiters.delete(jobId)) resolve()
      }, READY_TIMEOUT_MS)
    })
  }

  private createWindow(document: PrintDocument, show: boolean): BrowserWindow {
    const widthMm = document.paper.widthMm
    const heightMm = document.paper.heightMm ?? 297
    return new BrowserWindow({
      show,
      width: Math.min(2400, Math.round(widthMm * PX_PER_MM) + 40),
      height: Math.min(1600, Math.round(heightMm * PX_PER_MM) + 80),
      autoHideMenuBar: true,
      title: document.title,
      webPreferences: {
        preload: this.options.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
  }

  private async loadPrintView(window: BrowserWindow, jobId: string, document: PrintDocument): Promise<void> {
    const base = this.options.rendererBase.replace(/#.*$/, '')
    const separator = base.includes('?') ? '&' : '?'
    await window.loadURL(`${base}${separator}#/print/${jobId}`)
    await this.waitForWindow(jobId)
    this.options.logger.debug(`Print window ready for job ${jobId} (${paperCssSize(document.paper)})`)
  }

  /**
   * Render a document and either print it, save it as PDF, or return it for preview.
   * `printerName` empty means "ask the user": a visible window opens the system print dialog.
   */
  async run(request: {
    document: PrintDocument
    mode: 'preview' | 'print' | 'pdf'
    printerName: string | null
    copies: number
    targetPath: string | null
  }): Promise<PrintJobResult> {
    const { document, mode } = request
    const jobId = this.register(document)

    if (mode === 'preview') {
      // A real preview window showing the exact sheet that will print (same route, same component).
      // The document stays registered until the window is closed so `print.ready` can serve it.
      const preview = this.createWindow(document, true)
      preview.on('closed', () => {
        this.documents.delete(jobId)
        this.waiters.delete(jobId)
      })
      try {
        await this.loadPrintView(preview, jobId, document)
        return { ok: true, mode, filePath: null, pages: null, message: 'Preview opened.' }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.options.logger.error(`Print preview failed: ${message}`)
        this.documents.delete(jobId)
        this.waiters.delete(jobId)
        if (!preview.isDestroyed()) preview.destroy()
        return {
          ok: false,
          mode,
          filePath: null,
          pages: null,
          message: `The preview could not be opened: ${message}`
        }
      }
    }

    const showWindow = mode === 'print' && !request.printerName
    const window = this.createWindow(document, showWindow)
    try {
      await this.loadPrintView(window, jobId, document)

      if (mode === 'pdf') {
        if (!request.targetPath) {
          return {
            ok: false,
            mode,
            filePath: null,
            pages: null,
            message: 'Choose where to save the PDF first.'
          }
        }
        const data = await window.webContents.printToPDF({
          printBackground: true,
          pageSize: request.document.paper.heightMm
            ? {
                width: request.document.paper.widthMm / 25.4,
                height: request.document.paper.heightMm / 25.4
              }
            : undefined,
          margins: { marginType: 'none' }
        })
        mkdirSync(dirname(request.targetPath), { recursive: true })
        writeFileSync(request.targetPath, data)
        return {
          ok: true,
          mode,
          filePath: request.targetPath,
          pages: null,
          message: `PDF saved to ${request.targetPath}`
        }
      }

      const printed = await new Promise<{ success: boolean; failureReason?: string }>((resolve) => {
        window.webContents.print(
          {
            silent: Boolean(request.printerName),
            printBackground: true,
            deviceName: request.printerName ?? undefined,
            copies: Math.max(1, Math.min(50, request.copies))
          },
          (success, failureReason) => resolve({ success, failureReason })
        )
      })

      if (!printed.success) {
        return {
          ok: false,
          mode,
          filePath: null,
          pages: null,
          message: printed.failureReason ?? 'The printer rejected the job. Check the printer and try again.'
        }
      }
      return { ok: true, mode, filePath: null, pages: null, message: 'Sent to the printer.' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.options.logger.error(`Print job failed: ${message}`)
      return { ok: false, mode, filePath: null, pages: null, message: `Printing failed: ${message}` }
    } finally {
      this.documents.delete(jobId)
      this.waiters.delete(jobId)
      if (!window.isDestroyed()) window.destroy()
    }
  }
}
