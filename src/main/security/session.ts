/**
 * Session manager — the authoritative source of "who is using the application right now".
 *
 * The session lives in the main process only. The renderer receives a *snapshot* (user identity +
 * permission list) used purely for UI affordances; every privileged channel is re-checked against this
 * manager. Auto-lock is timer based, driven by real user activity reported by the renderer.
 */

import { EventEmitter } from 'node:events'
import type { PermissionCode } from '@shared/permissions'
import { resolvePermissions, type PermissionOverride } from '@shared/permissions'
import type { SessionSnapshot, SessionUser, SessionState } from '@shared/types'
import { AppError, forbidden, sessionLocked, unauthenticated } from '@shared/errors'

export interface SessionManagerEvents {
  'session:changed': (snapshot: SessionSnapshot) => void
  'session:locked': (snapshot: SessionSnapshot) => void
  'session:unlocked': (snapshot: SessionSnapshot) => void
  'session:logged-out': () => void
}

interface AuthenticatedUser {
  user: SessionUser
  permissions: Set<PermissionCode>
  rolePermissions: PermissionCode[]
  overrides: PermissionOverride[]
}

export interface SessionManagerOptions {
  autoLockMinutes: number
  /** Supplies the activation timestamp shown to the UI (injected because it lives in the database). */
  activationInfo?: () => { activatedAt: string | null }
  /** Injected for tests (defaults to Date.now). */
  now?: () => number
  /** Injected for tests (defaults to setInterval timers). */
  scheduler?: {
    setInterval: (handler: () => void, ms: number) => unknown
    clearInterval: (handle: unknown) => void
  }
}

const DEFAULT_SCHEDULER = {
  setInterval: (handler: () => void, ms: number) => setInterval(handler, ms),
  clearInterval: (handle: unknown) => clearInterval(handle as NodeJS.Timeout)
}

export class SessionManager extends EventEmitter {
  private state: SessionState = 'unauthenticated'
  private current: AuthenticatedUser | null = null
  private lastActivityEpochMs = 0
  private autoLockMs: number
  private timer: unknown = null
  private readonly now: () => number
  private readonly scheduler: NonNullable<SessionManagerOptions['scheduler']>
  private readonly activationInfo: () => { activatedAt: string | null }

  constructor(options: SessionManagerOptions) {
    super()
    this.autoLockMs = Math.max(1, options.autoLockMinutes) * 60_000
    this.now = options.now ?? (() => Date.now())
    this.activationInfo = options.activationInfo ?? (() => ({ activatedAt: null }))
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER
    this.startAutoLockTimer()
  }

  private startAutoLockTimer(): void {
    if (this.timer !== null) this.scheduler.clearInterval(this.timer)
    this.timer = this.scheduler.setInterval(() => this.checkIdle(), 15_000)
  }

  /** Called by the timer; locks the application when the idle window elapsed. */
  checkIdle(): void {
    if (this.state !== 'authenticated') return
    if (this.now() - this.lastActivityEpochMs >= this.autoLockMs) {
      this.lock('idle-timeout')
    }
  }

  setAutoLockMinutes(minutes: number): void {
    this.autoLockMs = Math.max(1, minutes) * 60_000
    this.lastActivityEpochMs = this.now()
    this.emitChanged()
  }

  get autoLockMinutes(): number {
    return Math.round(this.autoLockMs / 60_000)
  }

  get sessionState(): SessionState {
    return this.state
  }

  get user(): SessionUser | null {
    return this.current?.user ?? null
  }

  get userId(): number | null {
    return this.current?.user.id ?? null
  }

  get username(): string | null {
    return this.current?.user.username ?? null
  }

  snapshot(): SessionSnapshot {
    return {
      state: this.state,
      user: this.current?.user ?? null,
      permissions: this.current ? [...this.current.permissions] : [],
      autoLockMinutes: this.autoLockMinutes,
      activatedAt: this.activationInfo().activatedAt
    }
  }

  private emitChanged(): void {
    this.emit('session:changed', this.snapshot())
  }

  /** Establish an authenticated session after a successful login. */
  signIn(
    user: SessionUser,
    rolePermissions: PermissionCode[],
    overrides: PermissionOverride[] = []
  ): SessionSnapshot {
    this.current = {
      user,
      rolePermissions,
      overrides,
      permissions: resolvePermissions({ rolePermissions, overrides })
    }
    this.state = 'authenticated'
    this.touch()
    this.emitChanged()
    return this.snapshot()
  }

  /** Refresh permissions after a role/permission change without re-authenticating. */
  refreshPermissions(rolePermissions: PermissionCode[], overrides: PermissionOverride[] = []): void {
    if (!this.current) return
    this.current = {
      ...this.current,
      rolePermissions,
      overrides,
      permissions: resolvePermissions({ rolePermissions, overrides })
    }
    this.emitChanged()
  }

  signOut(): void {
    this.current = null
    this.state = 'unauthenticated'
    this.emit('session:logged-out')
    this.emitChanged()
  }

  lock(reason = 'manual'): void {
    if (this.state !== 'authenticated') return
    this.state = 'locked'
    this.emit('session:locked', { ...this.snapshot(), reason } as SessionSnapshot & { reason: string })
    this.emitChanged()
  }

  /** Called after the password has been verified by the auth service. */
  unlock(): void {
    if (this.state !== 'locked') return
    this.state = 'authenticated'
    this.touch()
    this.emit('session:unlocked', this.snapshot())
    this.emitChanged()
  }

  /** Record user activity (any privileged call or explicit renderer activity event). */
  touch(): void {
    this.lastActivityEpochMs = this.now()
  }

  shutdown(): void {
    if (this.timer !== null) {
      this.scheduler.clearInterval(this.timer)
      this.timer = null
    }
    this.removeAllListeners()
  }

  /**
   * Guard used by the IPC router: throws when the caller is not allowed to use a channel.
   * Order of checks is deliberate — "locked" is reported before "unauthenticated" so the UI can show the
   * lock screen with the correct context.
   */
  assertUsable(): void {
    if (this.state === 'locked') throw sessionLocked()
    if (this.state === 'unauthenticated' || !this.current) throw unauthenticated()
  }

  assertPermission(code: PermissionCode): void {
    this.assertUsable()
    if (!this.current) throw unauthenticated()
    if (!this.current.permissions.has(code)) {
      throw forbidden(`Your role does not include the "${code}" permission.`)
    }
  }

  hasPermission(code: PermissionCode): boolean {
    if (this.state !== 'authenticated' || !this.current) return false
    return this.current.permissions.has(code)
  }

  /** Re-authentication support for destructive actions. */
  verifyReauthentication(passwordCheck: (password: string) => boolean, password: string): void {
    this.assertUsable()
    if (!passwordCheck(password)) {
      throw new AppError('FORBIDDEN', 'The password you entered is not correct.')
    }
    this.touch()
  }
}
