/**
 * Unit tests for password handling and permission resolution (acceptance tests AT-B03 and AT-B04).
 *
 * These two modules decide who can see what and whether a stored credential is genuine, so they are tested
 * directly rather than only through the screens: the hash format must carry its own parameters, comparison
 * must reject tampered, truncated and foreign strings, the policy must refuse the passwords people actually
 * type, and a per-user deny must always beat a role grant.
 */

import { describe, expect, it } from 'vitest'
import { hashPassword, passwordIssues, passwordStrength, verifyPassword } from '@main/security/password'
import {
  ALL_PERMISSION_CODES,
  getPermission,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  isFinancialPermission,
  isPermissionCode,
  PERMISSION_CODES,
  PERMISSION_MODULES,
  PERMISSIONS,
  permissionsByModule,
  requiresReauthentication,
  resolvePermissions,
  SYSTEM_ROLES
} from '@shared/permissions'
import { PASSWORD_POLICY, SCRYPT_PARAMS } from '@shared/constants'

const strong = 'Dentiva#Chart2026'

describe('password hashing', () => {
  it('stores the derivation parameters with the hash instead of a bare digest', () => {
    const stored = hashPassword(strong)
    const [scheme, n, r, p, salt, hash] = stored.split('$')
    expect(scheme).toBe('scrypt')
    expect([n, r, p]).toEqual([String(SCRYPT_PARAMS.N), String(SCRYPT_PARAMS.r), String(SCRYPT_PARAMS.p)])
    expect(salt).toMatch(/^[0-9a-f]+$/)
    expect(salt).toHaveLength(SCRYPT_PARAMS.saltLength * 2)
    expect(hash).toHaveLength(SCRYPT_PARAMS.keyLength * 2)
  })

  it('never produces the same hash twice for the same password, and still verifies both', () => {
    const first = hashPassword(strong)
    const second = hashPassword(strong)
    expect(first).not.toBe(second)
    expect(verifyPassword(strong, first)).toBe(true)
    expect(verifyPassword(strong, second)).toBe(true)
  })

  it('rejects a wrong password, a tampered hash, an unknown scheme and malformed input', () => {
    const stored = hashPassword(strong)
    expect(verifyPassword(`${strong}!`, stored)).toBe(false)
    expect(verifyPassword('', stored)).toBe(false)
    expect(
      verifyPassword(
        strong,
        stored.replace(/.$/, (char) => (char === '0' ? '1' : '0'))
      )
    ).toBe(false)
    expect(verifyPassword(strong, stored.replace('scrypt', 'pbkdf2'))).toBe(false)
    expect(verifyPassword(strong, 'scrypt$1024$8$1$abcd')).toBe(false)
    expect(verifyPassword(strong, '')).toBe(false)
    expect(verifyPassword(strong, 'plaintext')).toBe(false)
  })

  it('refuses to hash an empty password', () => {
    expect(() => hashPassword('')).toThrow(/must not be empty/i)
  })

  it('accepts the passwords the policy allows and rejects the ones it does not', () => {
    expect(passwordIssues(strong)).toEqual([])
    expect(passwordIssues('short1A')).toContainEqual(expect.stringContaining('at least 10 characters'))
    expect(passwordIssues('alllowercase')).toContainEqual(expect.stringContaining('at least 3 of'))
    expect(passwordIssues('aaaaaaaaaaaa')).toContainEqual(expect.stringContaining('same character'))
    expect(passwordIssues('1234567890abc')).toContainEqual(expect.stringContaining('simple sequences'))
    expect(passwordIssues(`${strong}`, 'dentiva')).toContainEqual(expect.stringContaining('username'))
    expect(passwordIssues('a'.repeat(PASSWORD_POLICY.maxLength + 1))).toContainEqual(
      expect.stringContaining('at most')
    )
  })

  it('scores a strong password highly and a weak one at the bottom', () => {
    const good = passwordStrength(strong)
    expect(good.acceptable).toBe(true)
    expect(good.score).toBeGreaterThanOrEqual(3)
    expect(good.label).toMatch(/Good|Strong/)
    expect(good.issues).toEqual([])

    const bad = passwordStrength('password')
    expect(bad.acceptable).toBe(false)
    expect(bad.score).toBeLessThanOrEqual(1)
    expect(bad.issues.length).toBeGreaterThan(0)
  })
})

describe('permission catalogue', () => {
  it('has unique, well-formed codes and definitions', () => {
    expect(PERMISSION_CODES.length).toBeGreaterThan(50)
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length)
    expect(ALL_PERMISSION_CODES).toEqual(PERMISSION_CODES)
    for (const definition of PERMISSIONS) {
      expect(isPermissionCode(definition.code)).toBe(true)
      expect(definition.label.length).toBeGreaterThan(2)
      expect(definition.description.length).toBeGreaterThan(10)
      expect(PERMISSION_MODULES).toContain(definition.module)
    }
    expect(getPermission('patients.view')?.label).toBe('View patients')
    expect(getPermission('does.not.exist' as never)).toBeUndefined()
    expect(isPermissionCode('does.not.exist')).toBe(false)
  })

  it('groups every permission under exactly one module', () => {
    const grouped = permissionsByModule()
    const groupedCodes = grouped.flatMap((entry) => entry.permissions.map((permission) => permission.code))
    expect(groupedCodes).toHaveLength(PERMISSION_CODES.length)
    expect(new Set(groupedCodes).size).toBe(PERMISSION_CODES.length)
    for (const entry of grouped) {
      expect(entry.permissions.length).toBeGreaterThan(0)
    }
  })

  it('knows which permissions are destructive and which are financial', () => {
    expect(requiresReauthentication('patients.delete')).toBe(true)
    expect(requiresReauthentication('patients.view')).toBe(false)
    expect(isFinancialPermission('payments.create')).toBe(true)
    expect(isFinancialPermission('patients.view')).toBe(false)
  })
})

describe('system roles', () => {
  it('gives the administrator every permission and never invents codes elsewhere', () => {
    const administrator = SYSTEM_ROLES.find((role) => role.code === 'administrator')
    expect(administrator).toBeDefined()
    expect(administrator?.permissions).toEqual(ALL_PERMISSION_CODES)

    const codes = SYSTEM_ROLES.map((role) => role.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const role of SYSTEM_ROLES) {
      expect(role.name.length).toBeGreaterThan(2)
      expect(role.description.length).toBeGreaterThan(20)
      expect(role.permissions.length).toBeGreaterThan(0)
      for (const code of role.permissions) {
        expect(isPermissionCode(code)).toBe(true)
      }
    }
  })

  it('keeps the receptionist away from clinical records and the accountant inside billing', () => {
    const receptionist = SYSTEM_ROLES.find((role) => role.code === 'receptionist')
    expect(receptionist?.permissions).toContain('patients.create')
    expect(receptionist?.permissions).not.toContain('visits.create')
    expect(receptionist?.permissions).not.toContain('users.manage')

    const accountant = SYSTEM_ROLES.find((role) => role.code === 'accountant')
    expect(accountant?.permissions).toContain('reports.financial.view')
    expect(accountant?.permissions).not.toContain('prescriptions.create')
  })
})

describe('effective permissions', () => {
  const role = SYSTEM_ROLES.find((entry) => entry.code === 'receptionist')?.permissions ?? []

  it('starts from the role and lets an override grant an extra permission', () => {
    const effective = resolvePermissions({
      rolePermissions: role,
      overrides: [{ code: 'visits.view', effect: 'allow' }]
    })
    expect(hasPermission(effective, 'visits.view')).toBe(true)
    expect(hasPermission(effective, 'patients.create')).toBe(true)
  })

  it('lets a deny beat the role grant, whatever the order of the overrides', () => {
    const denied = resolvePermissions({
      rolePermissions: role,
      overrides: [
        { code: 'patients.create', effect: 'deny' },
        { code: 'patients.create', effect: 'allow' }
      ]
    })
    expect(hasPermission(denied, 'patients.create')).toBe(false)

    const reDenied = resolvePermissions({
      rolePermissions: role,
      overrides: [
        { code: 'patients.create', effect: 'allow' },
        { code: 'patients.create', effect: 'deny' }
      ]
    })
    expect(hasPermission(reDenied, 'patients.create')).toBe(false)
  })

  it('treats a deny for a permission the role never had as a no-op', () => {
    const effective = resolvePermissions({
      rolePermissions: role,
      overrides: [{ code: 'payments.create', effect: 'deny' }]
    })
    expect(hasPermission(effective, 'payments.create')).toBe(false)
    expect(hasPermission(effective, 'patients.view')).toBe(true)
  })

  it('answers any/all questions over the effective set', () => {
    const effective = resolvePermissions({ rolePermissions: role })
    expect(hasAnyPermission(effective, ['payments.create', 'patients.view'])).toBe(true)
    expect(hasAnyPermission(effective, ['users.manage', 'audit.view'])).toBe(false)
    expect(hasAllPermissions(effective, ['patients.view', 'patients.create'])).toBe(true)
    expect(hasAllPermissions(effective, ['patients.view', 'users.manage'])).toBe(false)
    expect(hasPermission(effective, 'users.manage')).toBe(false)
  })
})
