/**
 * IPC router: the single entry point for every renderer request.
 *
 * Order of checks: known channel → session usable → payload schema → permission → handler.
 * A failure never leaks a stack trace to the renderer; every refusal that matters (unknown channel,
 * denied permission) is written to the audit log so it can be reviewed later.
 */

import { ZodError } from 'zod'
import {
  AppError,
  forbidden,
  toErrorShape,
  validationError,
  type AppErrorShape,
  type IpcResult
} from '@shared/errors'
import type { Logger } from '../logging/logger'
import type { SessionManager } from '../security/session'
import type { Services } from '../services/container'
import type { ChannelHandler, HandlerContext, Registry, RegistryHost } from './registry'

export interface RouterOptions {
  registry: Registry
  session: SessionManager
  services: Services
  host: RegistryHost
  logger: Logger
  appVersion: string
  /** Called when a restore replaced the database and the session must end. */
  onTerminalUnauthenticated?: () => void
}

function zodIssues(error: ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : 'payload',
    message: issue.message
  }))
}

function serializeError(error: unknown, logger: Logger, channel: string): AppErrorShape {
  if (error instanceof AppError) return toErrorShape(error)
  if (error instanceof ZodError) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'The information sent to the application was not valid.',
      fields: zodIssues(error)
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  logger.error(`Unhandled failure in channel ${channel}: ${message}`, {
    channel,
    stack: error instanceof Error ? error.stack?.split('\n').slice(0, 4).join(' | ') : undefined
  })
  return {
    code: 'INTERNAL',
    message:
      'Something went wrong inside the application. The details were written to the log file. If it keeps happening, restart Dentiva Pro.'
  }
}

export function createInvoker(options: RouterOptions): {
  invoke: (channel: unknown, payload: unknown) => Promise<IpcResult<unknown>>
  context: HandlerContext
} {
  const { registry, session, services, host, logger, appVersion } = options
  const context: HandlerContext = {
    services,
    session,
    host,
    setTerminalUnauthenticated: () => options.onTerminalUnauthenticated?.()
  }

  const audit = (action: string, summary: string, severity: 'info' | 'warning' | 'critical'): void => {
    try {
      services.audit.append({
        actorUserId: session.userId,
        actorUsername: session.username,
        action,
        entityType: 'security',
        entityId: null,
        summary,
        severity,
        appVersion
      })
    } catch (error) {
      logger.warn(`Could not write audit entry for ${action}: ${String(error)}`)
    }
  }

  const invoke = async (channel: unknown, payload: unknown): Promise<IpcResult<unknown>> => {
    if (typeof channel !== 'string' || !(channel in registry)) {
      logger.warn('Blocked a call to an unknown IPC channel', {
        channel: typeof channel === 'string' ? channel.slice(0, 60) : typeof channel
      })
      if (session.sessionState === 'authenticated') {
        audit('security.unknown_channel', 'Blocked a call to an unknown application channel', 'warning')
      }
      return {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'That action is not available in this version of the application.'
        }
      }
    }

    const entry = registry[channel as keyof Registry] as ChannelHandler<never, unknown>
    try {
      if (entry.requiresSession !== false) {
        session.assertUsable()
      }

      let validated = payload as never
      if (entry.schema) {
        const parsed = entry.schema.safeParse(payload ?? undefined)
        if (!parsed.success) {
          throw validationError(
            'Some of the information was not valid. Check the highlighted fields.',
            zodIssues(parsed.error)
          )
        }
        validated = parsed.data as never
      }

      if (entry.permission && !session.hasPermission(entry.permission)) {
        audit(
          'security.permission_denied',
          `Refused "${channel}" because the signed-in role does not include "${entry.permission}"`,
          'warning'
        )
        throw forbidden('Your role does not allow this action. Ask an administrator for access.')
      }

      const result = (await entry.handler(context, validated)) as unknown
      session.touch()
      return { ok: true, data: result }
    } catch (error) {
      return { ok: false, error: serializeError(error, logger, channel as string) }
    }
  }

  return { invoke, context }
}
