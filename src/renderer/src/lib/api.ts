/**
 * Renderer side of the IPC bridge.
 *
 * Every call goes through `window.dentiva.invoke`, which the preload exposes. Errors coming back from the
 * main process are turned into `AppError` instances so screens can show field-level messages.
 */

import type { IpcChannel, IpcPayload, IpcResultOf, AppEvent } from '@shared/ipc'
import type { AppErrorShape, ErrorCode } from '@shared/errors'

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly fields: { field: string; message: string }[]
  readonly reference: string | undefined

  constructor(shape: AppErrorShape) {
    super(shape.message)
    this.name = 'ApiError'
    this.code = shape.code
    this.fields = shape.fields ?? []
    this.reference = shape.reference
  }

  /** Field-level message produced by the main process, if any. */
  fieldError(field: string): string | null {
    return this.fields.find((entry) => entry.field === field)?.message ?? null
  }

  get isForbidden(): boolean {
    return this.code === 'FORBIDDEN'
  }

  get isSessionProblem(): boolean {
    return (
      this.code === 'UNAUTHENTICATED' || this.code === 'SESSION_LOCKED' || this.code === 'ACTIVATION_REQUIRED'
    )
  }
}

function bridge(): Window['dentiva'] {
  if (typeof window === 'undefined' || !window.dentiva) {
    throw new Error('The Dentiva bridge is unavailable. Restart Dentiva Pro.')
  }
  return window.dentiva
}

export async function invoke<C extends IpcChannel>(
  channel: C,
  payload?: IpcPayload<C>
): Promise<IpcResultOf<C>> {
  const result = await bridge().invoke(channel, payload as IpcPayload<C>)
  if (!result.ok) throw new ApiError(result.error)
  return result.data as IpcResultOf<C>
}

export function subscribe(listener: (event: AppEvent) => void): () => void {
  return bridge().subscribe(listener)
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (isApiError(error)) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}
