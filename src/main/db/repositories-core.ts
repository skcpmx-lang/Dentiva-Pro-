/**
 * Repositories — platform, identity, people and catalogue tables.
 *
 * Repositories own SQL only: they never decide permissions (that is the service/router layer) and never
 * throw user-facing messages beyond domain conflicts. All statements are parameterised; column names used
 * in dynamic sort clauses are validated against allow-lists before being interpolated.
 */

import { nowEpochMs, nowSql } from '@shared/date'
import type {
  ClinicProfile,
  Dentist,
  DentistInput,
  PermissionCatalogEntry,
  PrinterProfile,
  RoleSummary,
  StaffInput,
  StaffMember,
  UserInput,
  UserSummary
} from '@shared/types'
import { PERMISSIONS } from '@shared/permissions'
import type { PermissionCode } from '@shared/permissions'
import { SYSTEM_ROLES } from '@shared/permissions'
import {
  DEFAULT_CLINICAL_OPTIONS,
  DEFAULT_DENTAL_CONDITIONS,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_SETTINGS,
  DEFAULT_TREATMENTS,
  DEFAULT_BUILD_INFO,
  type AppSettingsShape
} from '@shared/constants'
import { hashPassword } from '../security/password'
import type { SqliteDatabase } from './connection'

const NOW = (): string => nowSql()

// ---------------------------------------------------------------------------------------------
// Meta / counters / settings
// ---------------------------------------------------------------------------------------------

export class MetaRepository {
  constructor(private readonly db: SqliteDatabase) {}

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
      { value: string } | undefined
    return row?.value ?? null
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, NOW())
  }

  all(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM app_meta').all() as { key: string; value: string }[]
    return Object.fromEntries(rows.map((row) => [row.key, row.value]))
  }
}

export class CounterRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /** Atomically reserve the next value of a counter (must be called inside the owning transaction). */
  next(name: string): number {
    this.db.prepare('INSERT OR IGNORE INTO counters (name, value) VALUES (?, 0)').run(name)
    this.db.prepare('UPDATE counters SET value = value + 1 WHERE name = ?').run(name)
    const row = this.db.prepare('SELECT value FROM counters WHERE name = ?').get(name) as { value: number }
    return row.value
  }

  current(name: string): number {
    const row = this.db.prepare('SELECT value FROM counters WHERE name = ?').get(name) as
      { value: number } | undefined
    return row?.value ?? 0
  }

  set(name: string, value: number): void {
    this.db
      .prepare(
        `INSERT INTO counters (name, value) VALUES (?, ?)
         ON CONFLICT(name) DO UPDATE SET value = excluded.value`
      )
      .run(name, value)
  }
}

export class SettingsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  get(): AppSettingsShape {
    const rows = this.db.prepare('SELECT key, value_json FROM settings').all() as {
      key: string
      value_json: string
    }[]
    const stored: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        stored[row.key] = JSON.parse(row.value_json)
      } catch {
        // ignore malformed individual settings, defaults win
      }
    }
    return { ...DEFAULT_SETTINGS, ...(stored as Partial<AppSettingsShape>) }
  }

  setMany(values: Partial<AppSettingsShape>, updatedBy: string | null): void {
    const statement = this.db.prepare(
      `INSERT INTO settings (key, value_json, category, updated_at, updated_by) VALUES (?, ?, 'general', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at,
                                      updated_by = excluded.updated_by`
    )
    const run = this.db.transaction((entries: [string, unknown][]) => {
      for (const [key, value] of entries) {
        statement.run(key, JSON.stringify(value ?? null), NOW(), updatedBy)
      }
    })
    run(Object.entries(values))
  }

  raw(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value_json FROM settings').all() as {
      key: string
      value_json: string
    }[]
    return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value_json)]))
  }
}

export class ClinicRepository {
  constructor(private readonly db: SqliteDatabase) {}

  get(): ClinicProfile | null {
    const row = this.db.prepare('SELECT * FROM clinic_profile WHERE id = 1').get() as
      Record<string, string | null> | undefined
    if (!row) return null
    return {
      id: 1,
      name: row.name as string,
      nameBn: row.name_bn,
      logoPath: row.logo_path,
      address: row.address as string,
      city: row.city,
      postalCode: row.postal_code,
      country: (row.country as string) ?? 'Bangladesh',
      phone1: row.phone1 as string,
      phone2: row.phone2,
      email: row.email,
      website: row.website,
      registrationNo: row.registration_no,
      footerQuote: row.footer_quote,
      updatedAt: row.updated_at as string
    }
  }

  upsert(profile: Omit<ClinicProfile, 'id' | 'updatedAt'>): void {
    this.db
      .prepare(
        `INSERT INTO clinic_profile (id, name, name_bn, logo_path, address, city, postal_code, country, phone1, phone2,
                                     email, website, registration_no, footer_quote, created_at, updated_at)
         VALUES (1, @name, @nameBn, @logoPath, @address, @city, @postalCode, @country, @phone1, @phone2,
                 @email, @website, @registrationNo, @footerQuote, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           name = @name, name_bn = @nameBn, logo_path = @logoPath, address = @address, city = @city,
           postal_code = @postalCode, country = @country, phone1 = @phone1, phone2 = @phone2,
           email = @email, website = @website, registration_no = @registrationNo, footer_quote = @footerQuote,
           updated_at = @updatedAt`
      )
      .run({ ...profile, createdAt: NOW(), updatedAt: NOW() })
  }

  updateLogo(relativePath: string | null): void {
    this.db
      .prepare('UPDATE clinic_profile SET logo_path = ?, updated_at = ? WHERE id = 1')
      .run(relativePath, NOW())
  }
}

// ---------------------------------------------------------------------------------------------
// Permissions / roles / users
// ---------------------------------------------------------------------------------------------

export class PermissionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /** Insert any permission code that is missing (forward compatible; never deletes). */
  syncCatalogue(): { inserted: number } {
    const insert = this.db.prepare(
      `INSERT INTO permissions (code, module, action, label, description, is_destructive, is_financial)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET module = excluded.module, action = excluded.action,
                                       label = excluded.label, description = excluded.description,
                                       is_destructive = excluded.is_destructive,
                                       is_financial = excluded.is_financial`
    )
    let inserted = 0
    const existing = new Set(
      (this.db.prepare('SELECT code FROM permissions').all() as { code: string }[]).map((row) => row.code)
    )
    const run = this.db.transaction(() => {
      for (const definition of PERMISSIONS) {
        const [, action] = definition.code.split('.') as [string, string]
        if (!existing.has(definition.code)) inserted += 1
        insert.run(
          definition.code,
          definition.module,
          action,
          definition.label,
          definition.description,
          definition.destructive ? 1 : 0,
          definition.financial ? 1 : 0
        )
      }
    })
    run()
    return { inserted }
  }

  catalogue(): PermissionCatalogEntry[] {
    const rows = this.db.prepare('SELECT * FROM permissions ORDER BY module, code').all() as Record<
      string,
      string | number
    >[]
    return rows.map((row) => ({
      code: row.code as PermissionCode,
      module: row.module as PermissionCatalogEntry['module'],
      label: row.label as string,
      description: (row.description as string) ?? '',
      destructive: Number(row.is_destructive) === 1,
      financial: Number(row.is_financial) === 1
    }))
  }

  idByCode(): Map<string, number> {
    const rows = this.db.prepare('SELECT id, code FROM permissions').all() as { id: number; code: string }[]
    return new Map(rows.map((row) => [row.code, row.id]))
  }
}

export class RoleRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(): RoleSummary[] {
    const roles = this.db.prepare('SELECT * FROM roles ORDER BY is_system DESC, name').all() as Record<
      string,
      string | number
    >[]
    const permissionRows = this.db
      .prepare(
        `SELECT rp.role_id, p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id`
      )
      .all() as { role_id: number; code: string }[]
    const userCounts = this.db
      .prepare('SELECT role_id, COUNT(*) AS count FROM users GROUP BY role_id')
      .all() as { role_id: number; count: number }[]

    return roles.map((role) => ({
      id: role.id as number,
      code: role.code as string,
      name: role.name as string,
      description: (role.description as string) ?? null,
      isSystem: Number(role.is_system) === 1,
      permissionCodes: permissionRows
        .filter((row) => row.role_id === role.id)
        .map((row) => row.code as PermissionCode),
      userCount: userCounts.find((row) => row.role_id === role.id)?.count ?? 0,
      createdAt: role.created_at as string,
      updatedAt: role.updated_at as string
    }))
  }

  findByCode(code: string): RoleSummary | null {
    return this.list().find((role) => role.code === code) ?? null
  }

  findById(id: number): RoleSummary | null {
    return this.list().find((role) => role.id === id) ?? null
  }

  create(input: {
    code: string
    name: string
    description: string | null
    permissions: PermissionCode[]
    isSystem?: boolean
    actor: string
  }): number {
    const run = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO roles (code, name, description, is_system, created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.code,
          input.name,
          input.description,
          input.isSystem ? 1 : 0,
          NOW(),
          NOW(),
          input.actor,
          input.actor
        )
      const roleId = Number(result.lastInsertRowid)
      this.setPermissions(roleId, input.permissions, input.actor)
      return roleId
    })
    return run()
  }

  update(
    roleId: number,
    input: { name: string; description: string | null; permissions: PermissionCode[]; actor: string }
  ): void {
    const run = this.db.transaction(() => {
      this.db
        .prepare('UPDATE roles SET name = ?, description = ?, updated_at = ?, updated_by = ? WHERE id = ?')
        .run(input.name, input.description, NOW(), input.actor, roleId)
      this.setPermissions(roleId, input.permissions, input.actor)
    })
    run()
  }

  private setPermissions(roleId: number, permissions: PermissionCode[], actor: string): void {
    this.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId)
    const ids = new PermissionRepository(this.db).idByCode()
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
    )
    for (const code of permissions) {
      const permissionId = ids.get(code)
      if (permissionId) insert.run(roleId, permissionId)
    }
    void actor
  }

  delete(roleId: number): void {
    const role = this.db.prepare('SELECT is_system FROM roles WHERE id = ?').get(roleId) as
      { is_system: number } | undefined
    if (!role) throw new Error('Role not found')
    if (role.is_system === 1) throw new Error('System roles cannot be deleted')
    const users = this.db.prepare('SELECT COUNT(*) AS count FROM users WHERE role_id = ?').get(roleId) as {
      count: number
    }
    if (users.count > 0) throw new Error('Reassign the users of this role before deleting it')
    this.db.prepare('DELETE FROM roles WHERE id = ?').run(roleId)
  }

  permissionsForRole(roleId: number): PermissionCode[] {
    const rows = this.db
      .prepare(
        `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`
      )
      .all(roleId) as { code: string }[]
    return rows.map((row) => row.code as PermissionCode)
  }

  countUsersWithPermissionEverywhere(permissionCode: PermissionCode): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(DISTINCT u.id) AS count
           FROM users u
           JOIN role_permissions rp ON rp.role_id = u.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE u.is_active = 1 AND p.code = ?
            AND NOT EXISTS (
              SELECT 1 FROM user_permissions up JOIN permissions p2 ON p2.id = up.permission_id
               WHERE up.user_id = u.id AND p2.code = ? AND up.effect = 'deny'
            )`
      )
      .get(permissionCode, permissionCode) as { count: number }
    return row.count
  }
}

export class UserRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(): UserSummary[] {
    const rows = this.db
      .prepare(
        `SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id
          ORDER BY u.is_active DESC, u.display_name COLLATE NOCASE`
      )
      .all() as Record<string, string | number | null>[]
    const overrides = this.db
      .prepare(
        `SELECT up.user_id, p.code, up.effect FROM user_permissions up JOIN permissions p ON p.id = up.permission_id`
      )
      .all() as { user_id: number; code: string; effect: 'allow' | 'deny' }[]

    return rows.map((row) => ({
      id: row.id as number,
      username: row.username as string,
      displayName: row.display_name as string,
      roleId: row.role_id as number,
      roleName: row.role_name as string,
      isActive: Number(row.is_active) === 1,
      mustChangePassword: Number(row.must_change_password) === 1,
      lastLoginAt: (row.last_login_at as string) ?? null,
      createdAt: row.created_at as string,
      overrides: overrides
        .filter((entry) => entry.user_id === row.id)
        .map((entry) => ({ code: entry.code as PermissionCode, effect: entry.effect }))
    }))
  }

  findById(id: number): UserSummary | null {
    return this.list().find((user) => user.id === id) ?? null
  }

  findByUsername(
    username: string
  ):
    (UserSummary & { passwordHash: string; lockedUntilEpoch: number | null; failedAttempts: number }) | null {
    const row = this.db
      .prepare(
        `SELECT u.*, r.name AS role_name, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.username = ? COLLATE NOCASE`
      )
      .get(username) as Record<string, string | number | null> | undefined
    if (!row) return null
    const summary = this.list().find((user) => user.id === row.id) as UserSummary
    return {
      ...summary,
      passwordHash: row.password_hash as string,
      lockedUntilEpoch: (row.locked_until_epoch as number | null) ?? null,
      failedAttempts: Number(row.failed_attempts ?? 0)
    }
  }

  create(input: UserInput & { password: string; actor: string }): number {
    const run = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO users (username, display_name, password_hash, password_algo, password_changed_at, role_id,
                              is_active, must_change_password, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, 'scrypt', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.username,
          input.displayName,
          hashPassword(input.password),
          NOW(),
          input.roleId,
          input.isActive ? 1 : 0,
          input.mustChangePassword ? 1 : 0,
          NOW(),
          input.actor,
          NOW(),
          input.actor
        )
      const userId = Number(result.lastInsertRowid)
      this.setOverrides(userId, input.overrides, input.actor)
      return userId
    })
    return run()
  }

  update(id: number, input: UserInput & { password?: string; actor: string }): void {
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE users SET display_name = ?, role_id = ?, is_active = ?, must_change_password = ?,
                            updated_at = ?, updated_by = ? WHERE id = ?`
        )
        .run(
          input.displayName,
          input.roleId,
          input.isActive ? 1 : 0,
          input.mustChangePassword ? 1 : 0,
          NOW(),
          input.actor,
          id
        )
      if (input.password && input.password.length > 0) {
        this.db
          .prepare(
            `UPDATE users SET password_hash = ?, password_changed_at = ?, must_change_password = 0,
                              failed_attempts = 0, locked_until_epoch = NULL WHERE id = ?`
          )
          .run(hashPassword(input.password), NOW(), id)
      }
      this.setOverrides(id, input.overrides, input.actor)
    })
    run()
  }

  private setOverrides(
    userId: number,
    overrides: { code: PermissionCode; effect: 'allow' | 'deny' }[],
    actor: string
  ): void {
    this.db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(userId)
    const ids = new PermissionRepository(this.db).idByCode()
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO user_permissions (user_id, permission_id, effect, granted_at, granted_by) VALUES (?, ?, ?, ?, ?)'
    )
    for (const override of overrides) {
      const permissionId = ids.get(override.code)
      if (permissionId) insert.run(userId, permissionId, override.effect, NOW(), actor)
    }
  }

  changePassword(userId: number, password: string, actor: string): void {
    this.db
      .prepare(
        `UPDATE users SET password_hash = ?, password_changed_at = ?, must_change_password = 0,
                          failed_attempts = 0, locked_until_epoch = NULL, updated_at = ?, updated_by = ? WHERE id = ?`
      )
      .run(hashPassword(password), NOW(), NOW(), actor, userId)
  }

  registerFailedAttempt(username: string, reason: string, maxAttempts: number, lockoutMinutes: number): void {
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO login_attempts (username, success, reason, attempted_at, attempt_epoch_ms)
           VALUES (?, 0, ?, ?, ?)`
        )
        .run(username, reason, NOW(), nowEpochMs())
      const user = this.db
        .prepare('SELECT id, failed_attempts FROM users WHERE username = ? COLLATE NOCASE')
        .get(username) as { id: number; failed_attempts: number } | undefined
      if (user) {
        const attempts = user.failed_attempts + 1
        const lockUntil = attempts >= maxAttempts ? nowEpochMs() + lockoutMinutes * 60_000 : null
        this.db
          .prepare(
            'UPDATE users SET failed_attempts = ?, locked_until_epoch = COALESCE(?, locked_until_epoch) WHERE id = ?'
          )
          .run(attempts, lockUntil, user.id)
      }
    })
    run()
  }

  registerSuccessfulLogin(username: string, epochIso: string): void {
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO login_attempts (username, success, reason, attempted_at, attempt_epoch_ms)
           VALUES (?, 1, NULL, ?, ?)`
        )
        .run(username, NOW(), nowEpochMs())
      this.db
        .prepare(
          `UPDATE users SET failed_attempts = 0, locked_until_epoch = NULL, last_login_at = ? WHERE username = ? COLLATE NOCASE`
        )
        .run(epochIso, username)
    })
    run()
  }

  countActiveAdmins(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.is_active = 1 AND r.code = 'administrator'`
      )
      .get() as { count: number }
    return row.count
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
    return row.count
  }
}

// ---------------------------------------------------------------------------------------------
// Dentists / staff
// ---------------------------------------------------------------------------------------------

export class DentistRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(includeInactive = true): Dentist[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM dentists ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY sort_order, id`
      )
      .all() as Record<string, string | number | null>[]
    const designations = this.db
      .prepare('SELECT * FROM dentist_designations ORDER BY sort_order, id')
      .all() as { dentist_id: number; value: string }[]
    const qualifications = this.db
      .prepare('SELECT * FROM dentist_qualifications ORDER BY sort_order, id')
      .all() as { dentist_id: number; value: string }[]
    const certifications = this.db
      .prepare('SELECT * FROM dentist_certifications ORDER BY sort_order, id')
      .all() as { dentist_id: number; value: string }[]
    const schedules = this.db
      .prepare('SELECT * FROM dentist_schedules ORDER BY weekday, start_time')
      .all() as { id: number; dentist_id: number; weekday: number; start_time: string; end_time: string }[]

    return rows.map((row) => ({
      id: row.id as number,
      fullName: row.full_name as string,
      phone: (row.phone as string) ?? null,
      email: (row.email as string) ?? null,
      registrationNo: (row.registration_no as string) ?? null,
      signaturePath: (row.signature_path as string) ?? null,
      isActive: Number(row.is_active) === 1,
      sortOrder: Number(row.sort_order),
      notes: (row.notes as string) ?? null,
      designations: designations.filter((d) => d.dentist_id === row.id).map((d) => d.value),
      qualifications: qualifications.filter((d) => d.dentist_id === row.id).map((d) => d.value),
      certifications: certifications.filter((d) => d.dentist_id === row.id).map((d) => d.value),
      schedules: schedules
        .filter((s) => s.dentist_id === row.id)
        .map((s) => ({ id: s.id, weekday: s.weekday, startTime: s.start_time, endTime: s.end_time })),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    }))
  }

  findById(id: number): Dentist | null {
    return this.list(true).find((dentist) => dentist.id === id) ?? null
  }

  create(input: DentistInput, actor: string): number {
    const run = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO dentists (full_name, phone, email, registration_no, signature_path, is_active, sort_order,
                                 notes, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.fullName,
          input.phone,
          input.email,
          input.registrationNo,
          input.signaturePath,
          input.isActive ? 1 : 0,
          input.sortOrder,
          input.notes,
          NOW(),
          actor,
          NOW(),
          actor
        )
      const dentistId = Number(result.lastInsertRowid)
      this.replaceChildren(dentistId, input)
      return dentistId
    })
    return run()
  }

  update(id: number, input: DentistInput, actor: string): void {
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE dentists SET full_name = ?, phone = ?, email = ?, registration_no = ?, signature_path = ?,
                               is_active = ?, sort_order = ?, notes = ?, updated_at = ?, updated_by = ? WHERE id = ?`
        )
        .run(
          input.fullName,
          input.phone,
          input.email,
          input.registrationNo,
          input.signaturePath,
          input.isActive ? 1 : 0,
          input.sortOrder,
          input.notes,
          NOW(),
          actor,
          id
        )
      this.replaceChildren(id, input)
    })
    run()
  }

  private replaceChildren(dentistId: number, input: DentistInput): void {
    const tables: [string, string[]][] = [
      ['dentist_designations', input.designations],
      ['dentist_qualifications', input.qualifications],
      ['dentist_certifications', input.certifications]
    ]
    for (const [table, values] of tables) {
      this.db.prepare(`DELETE FROM ${table} WHERE dentist_id = ?`).run(dentistId)
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO ${table} (dentist_id, value, sort_order) VALUES (?, ?, ?)`
      )
      values.forEach((value, index) => insert.run(dentistId, value, index))
    }
    this.db.prepare('DELETE FROM dentist_schedules WHERE dentist_id = ?').run(dentistId)
    const insertSchedule = this.db.prepare(
      'INSERT INTO dentist_schedules (dentist_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)'
    )
    for (const schedule of input.schedules) {
      insertSchedule.run(dentistId, schedule.weekday, schedule.startTime, schedule.endTime)
    }
  }

  deactivate(id: number, actor: string): void {
    this.db
      .prepare('UPDATE dentists SET is_active = 0, updated_at = ?, updated_by = ? WHERE id = ?')
      .run(NOW(), actor, id)
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM dentists WHERE is_active = 1').get() as {
      count: number
    }
    return row.count
  }
}

export class StaffRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(): StaffMember[] {
    const rows = this.db
      .prepare('SELECT * FROM staff WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE')
      .all() as Record<string, string | number | null>[]
    return rows.map((row) => ({
      id: row.id as number,
      name: row.name as string,
      age: (row.age as number | null) ?? null,
      gender: (row.gender as StaffMember['gender']) ?? null,
      address: (row.address as string) ?? null,
      bloodGroup: (row.blood_group as string) ?? null,
      identificationNo: (row.identification_no as string) ?? null,
      photoPath: (row.photo_path as string) ?? null,
      phone: row.phone as string,
      position: row.position as string,
      department: (row.department as string) ?? null,
      salaryPoisha: (row.salary_poisha as number | null) ?? null,
      joiningDate: row.joining_date as string,
      status: row.status as StaffMember['status'],
      notes: (row.notes as string) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    }))
  }

  findById(id: number): StaffMember | null {
    return this.list().find((member) => member.id === id) ?? null
  }

  create(input: StaffInput, actor: string): number {
    const result = this.db
      .prepare(
        `INSERT INTO staff (name, age, gender, address, blood_group, identification_no, photo_path, phone, position,
                            department, salary_poisha, joining_date, status, notes, created_at, created_by,
                            updated_at, updated_by)
         VALUES (@name, @age, @gender, @address, @bloodGroup, @identificationNo, @photoPath, @phone, @position,
                 @department, @salaryPoisha, @joiningDate, @status, @notes, @createdAt, @createdBy, @updatedAt, @updatedBy)`
      )
      .run({ ...input, createdAt: NOW(), createdBy: actor, updatedAt: NOW(), updatedBy: actor })
    return Number(result.lastInsertRowid)
  }

  update(id: number, input: StaffInput, actor: string): void {
    this.db
      .prepare(
        `UPDATE staff SET name = @name, age = @age, gender = @gender, address = @address, blood_group = @bloodGroup,
                         identification_no = @identificationNo, photo_path = @photoPath, phone = @phone,
                         position = @position, department = @department, salary_poisha = @salaryPoisha,
                         joining_date = @joiningDate, status = @status, notes = @notes,
                         updated_at = @updatedAt, updated_by = @updatedBy
          WHERE id = @id`
      )
      .run({ ...input, id, updatedAt: NOW(), updatedBy: actor })
  }

  softDelete(id: number, actor: string): void {
    this.db
      .prepare('UPDATE staff SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .run(NOW(), NOW(), actor, id)
  }
}

// ---------------------------------------------------------------------------------------------
// Catalogues
// ---------------------------------------------------------------------------------------------

export class CatalogueRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /** Insert the shipped default catalogues on first run (never duplicates, never overwrites user edits). */
  seedDefaults(): void {
    const run = this.db.transaction(() => {
      const insertOption = this.db.prepare(
        `INSERT OR IGNORE INTO clinical_options (list_code, value, value_bn, sort_order, is_active, is_system_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 1, ?, ?)`
      )
      for (const [listCode, options] of Object.entries(DEFAULT_CLINICAL_OPTIONS)) {
        options.forEach((option, index) => {
          insertOption.run(
            listCode,
            option.value,
            option.valueBn ?? null,
            option.sortOrder ?? index,
            NOW(),
            NOW()
          )
        })
      }

      const insertCondition = this.db.prepare(
        `INSERT OR IGNORE INTO dental_conditions (code, name, color, text_color, category, applies_to, sort_order,
                                                  is_active, is_system_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`
      )
      for (const condition of DEFAULT_DENTAL_CONDITIONS) {
        insertCondition.run(
          condition.code,
          condition.name,
          condition.color,
          condition.textColor,
          condition.category,
          condition.appliesTo,
          condition.sortOrder
        )
      }

      const insertTreatment = this.db.prepare(
        `INSERT OR IGNORE INTO treatment_catalog (code, name, category, default_fee_poisha, duration_minutes, is_active,
                                                 is_system_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`
      )
      for (const treatment of DEFAULT_TREATMENTS) {
        insertTreatment.run(
          treatment.code,
          treatment.name,
          treatment.category,
          treatment.defaultFeePoisha,
          treatment.durationMinutes,
          NOW(),
          NOW()
        )
      }

      const insertMethod = this.db.prepare(
        `INSERT OR IGNORE INTO payment_methods (code, name, name_bn, requires_reference, is_active, is_system_default, sort_order)
         VALUES (?, ?, ?, ?, 1, 1, ?)`
      )
      DEFAULT_PAYMENT_METHODS.forEach((method, index) => {
        insertMethod.run(
          method.code,
          method.name,
          method.nameBn ?? null,
          method.requiresReference ? 1 : 0,
          index
        )
      })

      const insertExpenseCategory = this.db.prepare(
        `INSERT OR IGNORE INTO expense_categories (code, name, name_bn, is_active, is_system_default, sort_order)
         VALUES (?, ?, ?, 1, 1, ?)`
      )
      DEFAULT_EXPENSE_CATEGORIES.forEach((category, index) => {
        insertExpenseCategory.run(category.code, category.name, category.nameBn ?? null, index)
      })
    })
    run()
  }

  /** Seed the six system roles and grant their permissions (idempotent). */
  seedRoles(): void {
    const run = this.db.transaction(() => {
      const permissionIds = new PermissionRepository(this.db).idByCode()
      for (const role of SYSTEM_ROLES) {
        const existing = this.db.prepare('SELECT id FROM roles WHERE code = ?').get(role.code) as
          { id: number } | undefined
        let roleId: number
        if (existing) {
          roleId = existing.id
          this.db
            .prepare('UPDATE roles SET name = ?, description = ? WHERE id = ? AND is_system = 1')
            .run(role.name, role.description, roleId)
        } else {
          const result = this.db
            .prepare(
              `INSERT INTO roles (code, name, description, is_system, created_at, updated_at, created_by, updated_by)
               VALUES (?, ?, ?, 1, ?, ?, 'system', 'system')`
            )
            .run(role.code, role.name, role.description, NOW(), NOW())
          roleId = Number(result.lastInsertRowid)
        }

        const granted = this.db
          .prepare('SELECT COUNT(*) AS count FROM role_permissions WHERE role_id = ?')
          .get(roleId) as { count: number }
        if (granted.count === 0) {
          const insert = this.db.prepare(
            'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
          )
          for (const code of role.permissions) {
            const permissionId = permissionIds.get(code)
            if (permissionId) insert.run(roleId, permissionId)
          }
        }
      }
    })
    run()
  }

  clinicalOptions(listCode?: string): {
    id: number
    listCode: string
    value: string
    valueBn: string | null
    sortOrder: number
    isActive: boolean
    isSystemDefault: boolean
  }[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM clinical_options ${listCode ? 'WHERE list_code = ?' : ''} ORDER BY list_code, sort_order, id`
      )
      .all(...(listCode ? [listCode] : [])) as Record<string, string | number>[]
    return rows.map((row) => ({
      id: row.id as number,
      listCode: row.list_code as string,
      value: row.value as string,
      valueBn: (row.value_bn as string) ?? null,
      sortOrder: Number(row.sort_order),
      isActive: Number(row.is_active) === 1,
      isSystemDefault: Number(row.is_system_default) === 1
    }))
  }

  upsertClinicalOption(input: {
    id?: number
    listCode: string
    value: string
    valueBn?: string | null
    sortOrder?: number
    isActive?: boolean
  }): number {
    if (input.id) {
      this.db
        .prepare(
          'UPDATE clinical_options SET value = ?, value_bn = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?'
        )
        .run(
          input.value,
          input.valueBn ?? null,
          input.sortOrder ?? 0,
          input.isActive === false ? 0 : 1,
          NOW(),
          input.id
        )
      return input.id
    }
    const result = this.db
      .prepare(
        `INSERT INTO clinical_options (list_code, value, value_bn, sort_order, is_active, is_system_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        input.listCode,
        input.value,
        input.valueBn ?? null,
        input.sortOrder ?? 999,
        input.isActive === false ? 0 : 1,
        NOW(),
        NOW()
      )
    return Number(result.lastInsertRowid)
  }

  deactivateClinicalOption(id: number): void {
    this.db.prepare('UPDATE clinical_options SET is_active = 0, updated_at = ? WHERE id = ?').run(NOW(), id)
  }

  dentalConditions(includeInactive = false): {
    id: number
    code: string
    name: string
    color: string
    textColor: string
    category: 'condition' | 'treatment' | 'restoration'
    appliesTo: 'permanent' | 'primary' | 'both'
    isActive: boolean
    sortOrder: number
    isSystemDefault: boolean
  }[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM dental_conditions ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY sort_order, id`
      )
      .all() as Record<string, string | number>[]
    return rows.map((row) => ({
      id: row.id as number,
      code: row.code as string,
      name: row.name as string,
      color: row.color as string,
      textColor: row.text_color as string,
      category: row.category as 'condition' | 'treatment' | 'restoration',
      appliesTo: row.applies_to as 'permanent' | 'primary' | 'both',
      isActive: Number(row.is_active) === 1,
      sortOrder: Number(row.sort_order),
      isSystemDefault: Number(row.is_system_default) === 1
    }))
  }

  paymentMethods(includeInactive = false): {
    id: number
    code: string
    name: string
    nameBn: string | null
    requiresReference: boolean
    isActive: boolean
    isSystemDefault: boolean
    sortOrder: number
  }[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM payment_methods ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY sort_order, id`
      )
      .all() as Record<string, string | number>[]
    return rows.map((row) => ({
      id: row.id as number,
      code: row.code as string,
      name: row.name as string,
      nameBn: (row.name_bn as string) ?? null,
      requiresReference: Number(row.requires_reference) === 1,
      isActive: Number(row.is_active) === 1,
      isSystemDefault: Number(row.is_system_default) === 1,
      sortOrder: Number(row.sort_order)
    }))
  }

  upsertPaymentMethod(input: {
    id?: number
    code: string
    name: string
    nameBn?: string | null
    requiresReference?: boolean
    isActive?: boolean
    sortOrder?: number
  }): number {
    if (input.id) {
      this.db
        .prepare(
          'UPDATE payment_methods SET name = ?, name_bn = ?, requires_reference = ?, is_active = ?, sort_order = ? WHERE id = ?'
        )
        .run(
          input.name,
          input.nameBn ?? null,
          input.requiresReference ? 1 : 0,
          input.isActive === false ? 0 : 1,
          input.sortOrder ?? 0,
          input.id
        )
      return input.id
    }
    const result = this.db
      .prepare(
        `INSERT INTO payment_methods (code, name, name_bn, requires_reference, is_active, is_system_default, sort_order)
         VALUES (?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        input.code,
        input.name,
        input.nameBn ?? null,
        input.requiresReference ? 1 : 0,
        input.isActive === false ? 0 : 1,
        input.sortOrder ?? 999
      )
    return Number(result.lastInsertRowid)
  }

  expenseCategories(includeInactive = false): {
    id: number
    code: string
    name: string
    nameBn: string | null
    isActive: boolean
    isSystemDefault: boolean
  }[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM expense_categories ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY sort_order, id`
      )
      .all() as Record<string, string | number>[]
    return rows.map((row) => ({
      id: row.id as number,
      code: row.code as string,
      name: row.name as string,
      nameBn: (row.name_bn as string) ?? null,
      isActive: Number(row.is_active) === 1,
      isSystemDefault: Number(row.is_system_default) === 1
    }))
  }

  upsertExpenseCategory(input: {
    id?: number
    code?: string
    name: string
    nameBn?: string | null
    isActive?: boolean
  }): number {
    if (input.id) {
      this.db
        .prepare('UPDATE expense_categories SET name = ?, name_bn = ?, is_active = ? WHERE id = ?')
        .run(input.name, input.nameBn ?? null, input.isActive === false ? 0 : 1, input.id)
      return input.id
    }
    const code =
      input.code ??
      input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 30)
    const result = this.db
      .prepare(
        `INSERT INTO expense_categories (code, name, name_bn, is_active, is_system_default, sort_order)
         VALUES (?, ?, ?, ?, 0, 999)`
      )
      .run(code, input.name, input.nameBn ?? null, input.isActive === false ? 0 : 1)
    return Number(result.lastInsertRowid)
  }
}

// ---------------------------------------------------------------------------------------------
// Printer profiles
// ---------------------------------------------------------------------------------------------

export class PrinterProfileRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(): PrinterProfile[] {
    const rows = this.db
      .prepare('SELECT * FROM printer_profiles ORDER BY document_type, name')
      .all() as Record<string, string | number | null>[]
    return rows.map((row) => ({
      id: row.id as number,
      name: row.name as string,
      documentType: row.document_type as PrinterProfile['documentType'],
      printerName: (row.printer_name as string) ?? null,
      paperSize: row.paper_size as string,
      customWidthMm: (row.custom_width_mm as number | null) ?? null,
      customHeightMm: (row.custom_height_mm as number | null) ?? null,
      orientation: row.orientation as 'portrait' | 'landscape',
      marginTopMm: row.margin_top_mm as number,
      marginRightMm: row.margin_right_mm as number,
      marginBottomMm: row.margin_bottom_mm as number,
      marginLeftMm: row.margin_left_mm as number,
      scalePercent: row.scale_percent as number,
      copies: row.copies as number,
      isDefault: Number(row.is_default) === 1
    }))
  }

  save(input: PrinterProfile): number {
    const run = this.db.transaction(() => {
      if (input.isDefault) {
        this.db
          .prepare('UPDATE printer_profiles SET is_default = 0 WHERE document_type = ?')
          .run(input.documentType)
      }
      if (input.id && input.id > 0) {
        this.db
          .prepare(
            `UPDATE printer_profiles SET name = @name, document_type = @documentType, printer_name = @printerName,
                    paper_size = @paperSize, custom_width_mm = @customWidthMm, custom_height_mm = @customHeightMm,
                    orientation = @orientation, margin_top_mm = @marginTopMm, margin_right_mm = @marginRightMm,
                    margin_bottom_mm = @marginBottomMm, margin_left_mm = @marginLeftMm, scale_percent = @scalePercent,
                    copies = @copies, is_default = @isDefault, updated_at = @updatedAt WHERE id = @id`
          )
          .run({ ...input, isDefault: input.isDefault ? 1 : 0, updatedAt: NOW() })
        return input.id
      }
      const result = this.db
        .prepare(
          `INSERT INTO printer_profiles (name, document_type, printer_name, paper_size, custom_width_mm, custom_height_mm,
                                         orientation, margin_top_mm, margin_right_mm, margin_bottom_mm, margin_left_mm,
                                         scale_percent, copies, is_default, created_at, updated_at)
           VALUES (@name, @documentType, @printerName, @paperSize, @customWidthMm, @customHeightMm, @orientation,
                   @marginTopMm, @marginRightMm, @marginBottomMm, @marginLeftMm, @scalePercent, @copies, @isDefault,
                   @createdAt, @updatedAt)`
        )
        .run({ ...input, isDefault: input.isDefault ? 1 : 0, createdAt: NOW(), updatedAt: NOW() })
      return Number(result.lastInsertRowid)
    })
    return run()
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM printer_profiles WHERE id = ?').run(id)
  }

  defaultFor(documentType: PrinterProfile['documentType']): PrinterProfile | null {
    return this.list().find((profile) => profile.documentType === documentType && profile.isDefault) ?? null
  }
}

// ---------------------------------------------------------------------------------------------
// System defaults helper used by setup/test fixtures
// ---------------------------------------------------------------------------------------------

export function applyInitialDefaults(db: SqliteDatabase, appVersion = DEFAULT_BUILD_INFO.version): void {
  const run = db.transaction(() => {
    const meta = new MetaRepository(db)
    // Only fill in what is missing: this runs on every start and must never overwrite the clinic's data.
    if (meta.get('data_format_version') === null) meta.set('data_format_version', '1')
    if (meta.get('first_run_at') === null) meta.set('first_run_at', nowSql())
    meta.set('app_version', appVersion)

    const storedKeys = new Set(
      (db.prepare('SELECT key FROM settings').all() as { key: string }[]).map((row) => row.key)
    )
    const missing: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS) as [string, unknown][]) {
      if (!storedKeys.has(key)) missing[key] = value
    }
    if (Object.keys(missing).length > 0) new SettingsRepository(db).setMany(missing, 'system')
  })
  run()
}
