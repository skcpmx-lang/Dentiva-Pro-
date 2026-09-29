/**
 * Error model shared by the main process and the renderer.
 *
 * Every IPC call returns `IpcResult<T>`; failures carry a stable code, a user-friendly message, optional
 * field-level validation details and a reference id that can be found in the application log. Technical
 * details (stack, SQL) stay in the log and are never shown to clinic staff.
 */

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'DUPLICATE',
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'SESSION_LOCKED',
  'ACTIVATION_REQUIRED',
  'ACTIVATION_INVALID',
  'ACTIVATION_THROTTLED',
  'SETUP_REQUIRED',
  'SETUP_ALREADY_COMPLETED',
  'LOCKED_OUT',
  'PASSWORD_WEAK',
  'INTEGRITY_ERROR',
  'BACKUP_ERROR',
  'RESTORE_ERROR',
  'PRINT_ERROR',
  'FILE_ERROR',
  'UNSUPPORTED_FORMAT',
  'LIMIT_EXCEEDED',
  'JOB_CANCELLED',
  'BUSY',
  'NOT_IMPLEMENTED',
  'INTERNAL'
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface FieldIssue {
  field: string
  message: string
}

export interface AppErrorShape {
  code: ErrorCode
  message: string
  fields?: FieldIssue[]
  /** Reference id also written to the log, e.g. "ERR-7F3A21". */
  reference?: string
  details?: Record<string, string | number | boolean | null>
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly fields?: FieldIssue[]
  readonly reference?: string
  readonly details?: Record<string, string | number | boolean | null>
  /** True when the message is already user-friendly and safe to display verbatim. */
  readonly safeToDisplay: boolean

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      fields?: FieldIssue[]
      reference?: string
      details?: Record<string, string | number | boolean | null>
      safeToDisplay?: boolean
      cause?: unknown
    } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'AppError'
    this.code = code
    this.fields = options.fields
    this.reference = options.reference
    this.details = options.details
    this.safeToDisplay = options.safeToDisplay ?? true
  }

  toShape(): AppErrorShape {
    return {
      code: this.code,
      message: this.message,
      ...(this.fields ? { fields: this.fields } : {}),
      ...(this.reference ? { reference: this.reference } : {}),
      ...(this.details ? { details: this.details } : {})
    }
  }
}

export const validationError = (message: string, fields?: FieldIssue[]): AppError =>
  new AppError('VALIDATION_ERROR', message, { fields })

export const notFound = (entity: string, id?: string | number): AppError =>
  new AppError('NOT_FOUND', id ? `${entity} ${id} was not found.` : `${entity} was not found.`)

export const conflict = (message: string): AppError => new AppError('CONFLICT', message)

export const duplicate = (message: string, field?: string): AppError =>
  new AppError('DUPLICATE', message, { fields: field ? [{ field, message }] : undefined })

export const forbidden = (message = 'Your role does not allow this action.'): AppError =>
  new AppError('FORBIDDEN', message)

export const unauthenticated = (message = 'Please sign in to continue.'): AppError =>
  new AppError('UNAUTHENTICATED', message)

export const sessionLocked = (
  message = 'The application is locked. Enter your password to continue.'
): AppError => new AppError('SESSION_LOCKED', message)

export const internalError = (message = 'Something went wrong. Please try again.'): AppError =>
  new AppError('INTERNAL', message, { safeToDisplay: true })

export interface IpcSuccess<T> {
  ok: true
  data: T
}

export interface IpcFailure {
  ok: false
  error: AppErrorShape
}

export type IpcResult<T> = IpcSuccess<T> | IpcFailure

export function ipcOk<T>(data: T): IpcSuccess<T> {
  return { ok: true, data }
}

export function ipcFail(error: AppErrorShape): IpcFailure {
  return { ok: false, error }
}

/** Convert any thrown value into a user-safe error shape (technical detail stays in the log). */
export function toErrorShape(error: unknown, reference?: string): AppErrorShape {
  if (error instanceof AppError) {
    return { ...error.toShape(), reference: error.reference ?? reference }
  }
  if (error instanceof Error) {
    return {
      code: 'INTERNAL',
      message: 'An unexpected error occurred. The details were written to the application log.',
      reference
    }
  }
  return {
    code: 'INTERNAL',
    message: 'An unexpected error occurred. The details were written to the application log.',
    reference
  }
}

export function isIpcFailure<T>(result: IpcResult<T>): result is IpcFailure {
  return result.ok === false
}

export function isIpcSuccess<T>(result: IpcResult<T>): result is IpcSuccess<T> {
  return result.ok === true
}
