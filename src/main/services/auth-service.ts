/**
 * Authentication, session and user/role management (business layer).
 *
 * All permission decisions for this module happen here, not in the UI: the router calls these methods
 * only with a valid session, and the methods themselves enforce the invariants that protect the clinic
 * from locking itself out.
 */

import { nowEpochMs, nowSql } from '@shared/date'
import { AppError, conflict, duplicate, forbidden, notFound, validationError } from '@shared/errors'
import { LOGIN_POLICY } from '@shared/constants'
import type { PermissionCode } from '@shared/permissions'
import { CRITICAL_PERMISSIONS } from '@shared/permissions'
import type { LoginResult, RoleSummary, SessionSnapshot, UserInput, UserSummary } from '@shared/types'
import type { SqliteDatabase } from '../db/connection'
import type { RoleRepository, UserRepository } from '../db/repositories-core'
import type { AuditRepository, NotificationRepository } from '../db/repositories-clinical'
import { passwordIssues, verifyPassword } from '../security/password'
import type { SessionManager } from '../security/session'

export interface AuthServiceDeps {
  db: SqliteDatabase
  users: UserRepository
  roles: RoleRepository
  audit: AuditRepository
  notifications: NotificationRepository
  session: SessionManager
  appVersion: string
}

export interface AuthenticatedActor {
  userId: number | null
  username: string | null
}

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  private actor(): AuthenticatedActor {
    return { userId: this.deps.session.userId, username: this.deps.session.username }
  }

  private audit(
    action: string,
    summary: string,
    options: {
      entityType?: string | null
      entityId?: string | number | null
      before?: unknown
      after?: unknown
      severity?: 'info' | 'warning' | 'critical'
      actor?: AuthenticatedActor
    } = {}
  ): void {
    const actor = options.actor ?? this.actor()
    this.deps.audit.append({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action,
      entityType: options.entityType ?? null,
      entityId: options.entityId ?? null,
      summary,
      before: options.before,
      after: options.after,
      severity: options.severity ?? 'info',
      appVersion: this.deps.appVersion
    })
  }

  /** Login attempt. Always audits, including failures, and never reveals which part was wrong. */
  login(username: string, password: string): LoginResult {
    const trimmedUsername = username.trim()
    const user = this.deps.users.findByUsername(trimmedUsername)

    if (!user) {
      this.deps.users.registerFailedAttempt(
        trimmedUsername,
        'unknown-user',
        LOGIN_POLICY.maxFailedAttempts,
        LOGIN_POLICY.lockoutMinutes
      )
      this.audit('security.login_failed', `Failed sign-in attempt for "${trimmedUsername}"`, {
        severity: 'warning',
        actor: { userId: null, username: trimmedUsername },
        entityType: 'user',
        entityId: null
      })
      throw new AppError('UNAUTHENTICATED', 'The username or password is not correct.')
    }

    if (!user.isActive) {
      this.audit('security.login_inactive', `Sign-in attempted for inactive account "${user.username}"`, {
        severity: 'warning',
        actor: { userId: user.id, username: user.username }
      })
      throw new AppError('FORBIDDEN', 'This account is deactivated. Ask an administrator to enable it.')
    }

    if (user.lockedUntilEpoch && user.lockedUntilEpoch > nowEpochMs()) {
      const minutes = Math.ceil((user.lockedUntilEpoch - nowEpochMs()) / 60_000)
      this.audit('security.login_locked_out', `Sign-in to locked account "${user.username}" was refused`, {
        severity: 'warning',
        actor: { userId: user.id, username: user.username }
      })
      this.notify({
        category: 'security',
        priority: 'critical',
        title: `Account locked: ${user.username}`,
        body: `Sign-in was refused for ${minutes} more minute(s) after too many failed attempts.`,
        dedupeKey: `security-locked-${user.username}-${user.lockedUntilEpoch}`
      })
      throw new AppError('LOCKED_OUT', `Too many failed attempts. Try again in ${minutes} minute(s).`)
    }

    if (!verifyPassword(password, user.passwordHash)) {
      this.deps.users.registerFailedAttempt(
        user.username,
        'bad-password',
        LOGIN_POLICY.maxFailedAttempts,
        LOGIN_POLICY.lockoutMinutes
      )
      this.audit('security.login_failed', `Failed sign-in attempt for "${user.username}"`, {
        severity: 'warning',
        actor: { userId: user.id, username: user.username }
      })
      const state = this.deps.db
        .prepare('SELECT failed_attempts, locked_until_epoch FROM users WHERE id = ?')
        .get(user.id) as { failed_attempts: number; locked_until_epoch: number | null } | undefined
      const attempts = state?.failed_attempts ?? 1
      const locked = Boolean(state?.locked_until_epoch && state.locked_until_epoch > nowEpochMs())
      this.notify({
        category: 'security',
        priority: locked ? 'critical' : 'warning',
        title: `Failed sign-in for ${user.username}`,
        body: locked
          ? `Attempt ${attempts} of ${LOGIN_POLICY.maxFailedAttempts} — the account is locked for ${LOGIN_POLICY.lockoutMinutes} minute(s).`
          : `Attempt ${attempts} of ${LOGIN_POLICY.maxFailedAttempts} before the account is locked.`,
        dedupeKey: `security-login-failed-${user.username}-${attempts}`
      })
      throw new AppError('UNAUTHENTICATED', 'The username or password is not correct.')
    }

    const rolePermissions = this.deps.roles.permissionsForRole(user.roleId)
    const overrides = user.overrides
    const loginAt = nowSql()
    this.deps.users.registerSuccessfulLogin(user.username, loginAt)
    const snapshot = this.deps.session.signIn(
      {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        roleId: user.roleId,
        roleCode: this.deps.roles.findById(user.roleId)?.code ?? 'custom',
        roleName: user.roleName,
        isActive: true,
        lastLoginAt: loginAt
      },
      rolePermissions,
      overrides
    )
    this.audit('security.login', `Signed in as ${user.username}`, { entityType: 'user', entityId: user.id })
    return { snapshot, mustChangePassword: user.mustChangePassword }
  }

  /**
   * Raises a notification about an authentication event. Sign-in must never fail because a courtesy notice
   * could not be stored, so failures are swallowed here.
   */
  private notify(input: Parameters<NotificationRepository['create']>[0]): void {
    try {
      this.deps.notifications.create(input)
    } catch {
      // Ignored on purpose: the audit entry is the authoritative record of what happened.
    }
  }

  logout(): void {
    const actor = this.actor()
    if (actor.userId) {
      this.audit('security.logout', `Signed out ${actor.username}`)
    }
    this.deps.session.signOut()
  }

  lock(): void {
    if (this.deps.session.sessionState === 'authenticated') {
      this.audit('security.lock', `Application locked by ${this.deps.session.username ?? 'unknown'}`)
      this.deps.session.lock('manual')
    }
  }

  unlock(password: string): SessionSnapshot {
    const username = this.deps.session.username
    if (!username) throw new AppError('UNAUTHENTICATED', 'Please sign in again.')
    const user = this.deps.users.findByUsername(username)
    if (!user || !verifyPassword(password, user.passwordHash)) {
      this.audit('security.unlock_failed', `Failed unlock attempt for "${username}"`, {
        severity: 'warning',
        actor: { userId: user?.id ?? null, username }
      })
      throw new AppError('UNAUTHENTICATED', 'The password is not correct.')
    }
    this.deps.session.unlock()
    this.deps.session.refreshPermissions(this.deps.roles.permissionsForRole(user.roleId), user.overrides)
    this.audit('security.unlock', `Application unlocked by ${username}`)
    return this.deps.session.snapshot()
  }

  touch(): void {
    this.deps.session.touch()
  }

  changeOwnPassword(currentPassword: string, newPassword: string): void {
    const userId = this.deps.session.userId
    if (!userId) throw new AppError('UNAUTHENTICATED', 'Please sign in again.')
    const user = this.deps.users.findById(userId)
    if (!user) throw notFound('User')
    const record = this.deps.users.findByUsername(user.username)
    if (!record || !verifyPassword(currentPassword, record.passwordHash)) {
      throw validationError('Your current password is not correct.', [
        { field: 'currentPassword', message: 'Current password is not correct.' }
      ])
    }
    const issues = passwordIssues(newPassword, user.username)
    if (issues.length > 0) {
      throw validationError('The new password does not meet the requirements.', [
        { field: 'newPassword', message: issues.join(' ') }
      ])
    }
    this.deps.users.changePassword(userId, newPassword, user.username ?? 'self')
    this.audit('security.password_change', `Password changed for ${user.username}`, {
      entityType: 'user',
      entityId: userId
    })
  }

  /** Verify the acting user's password for a destructive action (re-authentication). */
  assertPassword(password: string): void {
    const username = this.deps.session.username
    if (!username) throw new AppError('UNAUTHENTICATED', 'Please sign in again.')
    const user = this.deps.users.findByUsername(username)
    if (!user || !verifyPassword(password, user.passwordHash)) {
      this.audit('security.reauth_failed', `Destructive-action password check failed for "${username}"`, {
        severity: 'warning'
      })
      throw new AppError('FORBIDDEN', 'The password you entered is not correct.')
    }
    this.deps.session.touch()
  }

  // -------------------------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------------------------

  listUsers(): UserSummary[] {
    return this.deps.users.list()
  }

  createUser(input: UserInput, password: string): UserSummary {
    if (!this.deps.session.hasPermission('users.manage')) throw forbidden()
    if (this.deps.users.findByUsername(input.username)) {
      throw duplicate('That username is already taken.', 'username')
    }
    const issues = passwordIssues(password, input.username)
    if (issues.length > 0) {
      throw validationError('The password does not meet the requirements.', [
        { field: 'password', message: issues.join(' ') }
      ])
    }
    const role = this.deps.roles.findById(input.roleId)
    if (!role) throw validationError('Choose a valid role.', [{ field: 'roleId', message: 'Unknown role.' }])
    const actor = this.deps.session.username ?? 'system'
    const id = this.deps.users.create({ ...input, password, actor })
    this.audit('users.create', `Created user "${input.username}" with role ${role.name}`, {
      entityType: 'user',
      entityId: id,
      after: { username: input.username, roleId: input.roleId, isActive: input.isActive },
      severity: 'warning'
    })
    return this.deps.users.findById(id) as UserSummary
  }

  updateUser(id: number, input: UserInput, password?: string): UserSummary {
    if (!this.deps.session.hasPermission('users.manage')) throw forbidden()
    const existing = this.deps.users.findById(id)
    if (!existing) throw notFound('User', id)
    if (input.username !== existing.username) {
      throw validationError('Usernames cannot be changed.', [
        { field: 'username', message: 'Usernames cannot be changed after creation.' }
      ])
    }
    const selfId = this.deps.session.userId
    const actor = this.deps.session.username ?? 'system'

    if (selfId === id && !input.isActive) {
      throw conflict('You cannot deactivate your own account.')
    }

    const role = this.deps.roles.findById(input.roleId)
    if (!role) throw validationError('Choose a valid role.', [{ field: 'roleId', message: 'Unknown role.' }])

    // Lock-out protection: the clinic must never lose its last administrator, and it must never lose
    // the ability to manage accounts at all. Both are checked against the users that remain.
    const losingAdmin = existing.roleId !== input.roleId || !input.isActive
    if (losingAdmin) {
      const adminRole = this.deps.roles.findByCode('administrator')
      const remaining = this.countEffectiveHolders(adminRole?.id ?? null, 'users.manage', id)
      if (adminRole && existing.roleId === adminRole.id && remaining.administrators === 0) {
        throw conflict(
          'At least one active administrator must remain. Create or promote another administrator first.'
        )
      }
      if (remaining.managers === 0) {
        throw conflict(
          'At least one active user must be able to manage accounts. Give another user the users.manage permission first.'
        )
      }
    }
    if (password) {
      const issues = passwordIssues(password, input.username)
      if (issues.length > 0) {
        throw validationError('The password does not meet the requirements.', [
          { field: 'password', message: issues.join(' ') }
        ])
      }
    }

    this.deps.users.update(id, { ...input, password, actor })
    if (selfId === id) {
      this.deps.session.refreshPermissions(this.deps.roles.permissionsForRole(input.roleId), input.overrides)
    }
    this.audit('users.update', `Updated user "${input.username}"`, {
      entityType: 'user',
      entityId: id,
      before: { roleId: existing.roleId, isActive: existing.isActive, overrides: existing.overrides },
      after: { roleId: input.roleId, isActive: input.isActive, overrides: input.overrides },
      severity: 'warning'
    })
    return this.deps.users.findById(id) as UserSummary
  }

  /**
   * Counts the active users that would remain after the change, split into those sitting in the given
   * role (`administrators`) and those that effectively hold the permission (`managers`). Overrides are
   * honoured, so a denied user does not count as a holder even when the role would grant the code.
   */
  private countEffectiveHolders(
    roleId: number | null,
    permission: PermissionCode,
    excludingUserId: number
  ): { administrators: number; managers: number } {
    const users = this.deps.users.list().filter((user) => user.id !== excludingUserId && user.isActive)
    let administrators = 0
    let managers = 0
    for (const user of users) {
      if (roleId != null && user.roleId === roleId) administrators += 1
      const denied = user.overrides.some(
        (override) => override.code === permission && override.effect === 'deny'
      )
      if (denied) continue
      const rolePermissions = this.deps.roles.permissionsForRole(user.roleId)
      const allowed =
        rolePermissions.includes(permission) ||
        user.overrides.some((override) => override.code === permission && override.effect === 'allow')
      if (allowed) managers += 1
    }
    return { administrators, managers }
  }

  // -------------------------------------------------------------------------------------------
  // Roles
  // -------------------------------------------------------------------------------------------

  listRoles(): RoleSummary[] {
    return this.deps.roles.list()
  }

  createRole(input: {
    code: string
    name: string
    description: string | null
    permissions: PermissionCode[]
  }): RoleSummary {
    if (!this.deps.session.hasPermission('roles.manage')) throw forbidden()
    if (this.deps.roles.findByCode(input.code))
      throw duplicate('A role with this code already exists.', 'code')
    const id = this.deps.roles.create({
      ...input,
      isSystem: false,
      actor: this.deps.session.username ?? 'system'
    })
    this.audit('roles.create', `Created role "${input.name}"`, {
      entityType: 'role',
      entityId: id,
      after: { code: input.code, permissions: input.permissions },
      severity: 'warning'
    })
    return this.deps.roles.findById(id) as RoleSummary
  }

  updateRole(
    roleId: number,
    input: { name: string; description: string | null; permissions: PermissionCode[] }
  ): RoleSummary {
    if (!this.deps.session.hasPermission('roles.manage')) throw forbidden()
    const existing = this.deps.roles.findById(roleId)
    if (!existing) throw notFound('Role', roleId)
    if (existing.code === 'administrator' && !input.permissions.includes('users.manage')) {
      throw conflict('The Administrator role must keep user management so the clinic cannot be locked out.')
    }
    const removedCritical = CRITICAL_PERMISSIONS.filter(
      (code) => existing.permissionCodes.includes(code) && !input.permissions.includes(code)
    )
    for (const code of removedCritical) {
      const holders = this.deps.roles
        .list()
        .filter((role) => role.id !== roleId && role.permissionCodes.includes(code)).length
      if (holders === 0) {
        throw conflict(
          `Another role must hold the "${code}" permission before removing it from "${existing.name}".`
        )
      }
    }
    this.deps.roles.update(roleId, { ...input, actor: this.deps.session.username ?? 'system' })
    this.deps.session.refreshPermissions(
      this.deps.roles.permissionsForRole(this.deps.session.user?.roleId ?? 0),
      this.deps.users.findById(this.deps.session.userId ?? 0)?.overrides ?? []
    )
    this.audit('roles.update', `Updated role "${input.name}"`, {
      entityType: 'role',
      entityId: roleId,
      before: { name: existing.name, permissions: existing.permissionCodes },
      after: { name: input.name, permissions: input.permissions },
      severity: 'warning'
    })
    return this.deps.roles.findById(roleId) as RoleSummary
  }

  deleteRole(roleId: number): void {
    if (!this.deps.session.hasPermission('roles.manage')) throw forbidden()
    const role = this.deps.roles.findById(roleId)
    if (!role) throw notFound('Role', roleId)
    if (role.isSystem) throw conflict('System roles cannot be deleted.')
    if (role.userCount > 0) throw conflict('Move the users of this role to another role first.')
    this.deps.roles.delete(roleId)
    this.audit('roles.delete', `Deleted role "${role.name}"`, {
      entityType: 'role',
      entityId: roleId,
      before: { code: role.code },
      severity: 'critical'
    })
  }
}
