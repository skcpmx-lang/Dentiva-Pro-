/**
 * Structured application logging (REQ §66).
 *
 * JSON-lines files under `<DataRoot>/Logs/` with daily rotation and retention, plus an in-memory ring
 * buffer used by the diagnostics screen. Secrets and clinical free text are never logged: values whose key
 * matches the redaction list are replaced and long free-text fields are summarised.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  at: string
  level: LogLevel
  message: string
  scope?: string
  data?: Record<string, unknown>
}

const REDACT_KEYS = [
  'password',
  'token',
  'secret',
  'activation',
  'hash',
  'authorization',
  'cookie',
  'passphrase'
]
const FREE_TEXT_KEYS = ['before_json', 'after_json', 'note', 'notes', 'summary']

export interface LoggerOptions {
  directory: string
  /** Days of logs kept on disk. */
  retentionDays?: number
  /** Ring buffer size for the diagnostics screen. */
  bufferSize?: number
  minLevel?: LogLevel
  consoleOutput?: boolean
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export class Logger {
  private readonly directory: string
  private readonly retentionDays: number
  private readonly bufferSize: number
  private readonly minLevel: LogLevel
  private readonly consoleOutput: boolean
  private buffer: LogEntry[] = []
  private currentFile: string | null = null
  private currentDate = ''

  constructor(options: LoggerOptions) {
    this.directory = options.directory
    this.retentionDays = options.retentionDays ?? 30
    this.bufferSize = options.bufferSize ?? 500
    this.minLevel = options.minLevel ?? 'info'
    this.consoleOutput = options.consoleOutput ?? false
    try {
      mkdirSync(this.directory, { recursive: true })
    } catch {
      // Logging must never prevent the application from starting.
    }
  }

  private fileFor(dateIso: string): string {
    return join(this.directory, `dentiva-${dateIso}.jsonl`)
  }

  private rotateIfNeeded(): string {
    const today = new Date().toISOString().slice(0, 10)
    if (this.currentDate !== today || this.currentFile === null) {
      this.currentDate = today
      this.currentFile = this.fileFor(today)
      this.pruneOldFiles()
    }
    return this.currentFile
  }

  private pruneOldFiles(): void {
    try {
      const cutoff = Date.now() - this.retentionDays * 86_400_000
      for (const file of readdirSync(this.directory)) {
        if (!file.startsWith('dentiva-') || !file.endsWith('.jsonl')) continue
        const fullPath = join(this.directory, file)
        try {
          if (statSync(fullPath).mtimeMs < cutoff) unlinkSync(fullPath)
        } catch {
          // ignore individual file errors
        }
      }
    } catch {
      // directory may not exist yet
    }
  }

  private sanitize(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!data) return undefined
    const output: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      const lower = key.toLowerCase()
      if (REDACT_KEYS.some((needle) => lower.includes(needle))) {
        output[key] = '[redacted]'
      } else if (FREE_TEXT_KEYS.some((needle) => lower.includes(needle))) {
        output[key] = typeof value === 'string' ? `[text:${value.length} chars]` : '[text]'
      } else if (value instanceof Error) {
        output[key] = { name: value.name, message: value.message }
      } else if (typeof value === 'object' && value !== null) {
        try {
          output[key] = JSON.parse(JSON.stringify(value))
        } catch {
          output[key] = String(value)
        }
      } else {
        output[key] = value
      }
    }
    return output
  }

  log(level: LogLevel, message: string, data?: Record<string, unknown>, scope?: string): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return
    const entry: LogEntry = {
      at: new Date().toISOString(),
      level,
      message,
      ...(scope ? { scope } : {}),
      ...(data ? { data: this.sanitize(data) } : {})
    }
    this.buffer.push(entry)
    if (this.buffer.length > this.bufferSize) this.buffer.splice(0, this.buffer.length - this.bufferSize)

    if (this.consoleOutput) {
      const line = `[${entry.at}] ${level.toUpperCase()} ${scope ? `(${scope}) ` : ''}${message}`
      if (level === 'error') process.stderr.write(`${line}\n`)
      else process.stdout.write(`${line}\n`)
    }

    try {
      const file = this.rotateIfNeeded()
      appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
    } catch {
      // Never throw from the logger.
    }
  }

  debug(message: string, data?: Record<string, unknown>, scope?: string): void {
    this.log('debug', message, data, scope)
  }

  info(message: string, data?: Record<string, unknown>, scope?: string): void {
    this.log('info', message, data, scope)
  }

  warn(message: string, data?: Record<string, unknown>, scope?: string): void {
    this.log('warn', message, data, scope)
  }

  error(message: string, data?: Record<string, unknown>, scope?: string): void {
    this.log('error', message, data, scope)
  }

  /** Recent entries for the diagnostics screen (no file access). */
  recent(limit = 200): LogEntry[] {
    return this.buffer.slice(-limit)
  }

  get logDirectory(): string {
    return this.directory
  }

  get activeFile(): string {
    return this.currentFile ?? this.fileFor(new Date().toISOString().slice(0, 10))
  }

  fileExists(file: string): boolean {
    return existsSync(file)
  }
}

let globalLogger: Logger | null = null

export function setGlobalLogger(logger: Logger): void {
  globalLogger = logger
}

export function getLogger(): Logger {
  if (!globalLogger) {
    throw new Error('Logger has not been initialised yet')
  }
  return globalLogger
}

export function hasLogger(): boolean {
  return globalLogger !== null
}
