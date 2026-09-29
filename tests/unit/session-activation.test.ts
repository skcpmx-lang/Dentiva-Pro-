/**
 * Unit tests for the session manager and the offline activation verifier.
 *
 * Both are security surfaces the rest of the application trusts: the session decides whether a call may
 * run at all, and the verifier decides whether this installation is activated. The clock and the timer are
 * injected, so auto-lock and throttling are exercised without waiting.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVATION_KDF,
  createInstallId,
  createVerifierFromSecret,
  deriveVerifier,
  evaluateThrottle,
  expectedVerifier,
  nextThrottleState,
  normalizeActivationCode
} from '@main/security/activation'
import { SessionManager } from '@main/security/session'
import { LOGIN_POLICY } from '@shared/constants'
import type { PermissionOverride } from '@shared/permissions'

const user = {
  id: 7,
  username: 'admin',
  displayName: 'Clinic Administrator',
  roleId: 1,
  roleCode: 'administrator',
  roleName: 'Administrator',
  isActive: true,
  lastLoginAt: '2026-09-30 09:00:00'
}

const rolePermissions = ['patients.view', 'patients.create', 'patients.edit'] as const

let clock = Date.parse('2026-09-30T09:00:00+06:00')
let ticks: (() => void)[] = []

function makeSession(autoLockMinutes = 10): SessionManager {
  return new SessionManager({
    autoLockMinutes,
    now: () => clock,
    activationInfo: () => ({ activatedAt: '2026-09-30 08:00:00' }),
    scheduler: {
      setInterval: (handler) => {
        ticks.push(handler)
        return ticks.length - 1
      },
      clearInterval: () => undefined
    }
  })
}

beforeEach(() => {
  clock = Date.parse('2026-09-30T09:00:00+06:00')
  ticks = []
})

describe('session manager', () => {
  it('starts unauthenticated and refuses privileged calls until sign-in', () => {
    const session = makeSession()
    expect(session.snapshot().state).toBe('unauthenticated')
    expect(session.snapshot().user).toBeNull()
    expect(session.snapshot().permissions).toEqual([])
    expect(session.snapshot().activatedAt).toBe('2026-09-30 08:00:00')
    expect(session.hasPermission('patients.view')).toBe(false)
    expect(() => session.assertPermission('patients.view')).toThrow(/sign in/i)
    session.shutdown()
  })

  it('signs in with the resolved permission set and reports it in the snapshot', () => {
    const session = makeSession()
    const overrides: PermissionOverride[] = [
      { code: 'invoices.view', effect: 'allow' },
      { code: 'patients.edit', effect: 'deny' }
    ]
    const snapshot = session.signIn(user, [...rolePermissions], overrides)

    expect(snapshot.state).toBe('authenticated')
    expect(snapshot.user?.username).toBe('admin')
    expect(snapshot.autoLockMinutes).toBe(10)
    // Role grant, per-user allow, and the deny that wins over the role grant.
    expect(session.hasPermission('patients.view')).toBe(true)
    expect(session.hasPermission('invoices.view')).toBe(true)
    expect(session.hasPermission('patients.edit')).toBe(false)
    expect(snapshot.permissions).not.toContain('patients.edit')
    // Nothing outside the role or the overrides may leak in.
    expect(session.hasPermission('users.manage')).toBe(false)
    expect(() => session.assertPermission('users.manage')).toThrow(/users\.manage/)
    session.shutdown()
  })

  it('locks on demand, hides the protected data and only unlocks after verification', () => {
    const session = makeSession()
    session.signIn(user, [...rolePermissions])

    const locked = vi.fn()
    session.on('session:locked', locked)
    session.lock()
    expect(session.snapshot().state).toBe('locked')
    expect(locked).toHaveBeenCalledWith(expect.objectContaining({ reason: 'manual' }))
    // A locked session keeps the identity for the lock screen but refuses every call.
    expect(session.snapshot().user?.username).toBe('admin')
    expect(() => session.assertPermission('patients.view')).toThrow(/locked/i)
    expect(() => session.assertUsable()).toThrow(/locked/i)

    // unlock() itself is what the auth service calls after re-checking the password.
    session.unlock()
    expect(session.snapshot().state).toBe('authenticated')
    expect(session.hasPermission('patients.view')).toBe(true)
    session.shutdown()
  })

  it('auto-locks after the idle window and activity postpones it', () => {
    const session = makeSession(5)
    session.signIn(user, [...rolePermissions])

    clock += 4 * 60_000
    session.touch()
    clock += 4 * 60_000
    ticks.forEach((tick) => tick())
    expect(session.snapshot().state).toBe('authenticated')

    clock += 6 * 60_000
    ticks.forEach((tick) => tick())
    expect(session.snapshot().state).toBe('locked')
    session.shutdown()
  })

  it('applies a new auto-lock window and restarts the idle countdown', () => {
    const session = makeSession(30)
    session.signIn(user, [...rolePermissions])
    clock += 20 * 60_000

    session.setAutoLockMinutes(5)
    expect(session.snapshot().autoLockMinutes).toBe(5)
    // The countdown restarted, so 6 minutes after the change is what locks it.
    clock += 4 * 60_000
    ticks.forEach((tick) => tick())
    expect(session.snapshot().state).toBe('authenticated')
    clock += 2 * 60_000
    ticks.forEach((tick) => tick())
    expect(session.snapshot().state).toBe('locked')
    session.shutdown()
  })

  it('refreshes permissions after a role change without signing the user out', () => {
    const session = makeSession()
    session.signIn(user, [...rolePermissions])

    const changed = vi.fn()
    session.on('session:changed', changed)
    session.refreshPermissions(['reports.financial.view', 'reports.financial.export'])

    expect(changed).toHaveBeenCalled()
    expect(session.snapshot().state).toBe('authenticated')
    expect(session.snapshot().user?.username).toBe('admin')
    expect(session.hasPermission('reports.financial.view')).toBe(true)
    expect(session.hasPermission('patients.view')).toBe(false)
    session.shutdown()
  })

  it('signs out to a clean unauthenticated snapshot and emits the event', () => {
    const session = makeSession()
    session.signIn(user, [...rolePermissions])

    const loggedOut = vi.fn()
    session.on('session:logged-out', loggedOut)
    session.signOut()

    const snapshot = session.snapshot()
    expect(loggedOut).toHaveBeenCalled()
    expect(snapshot.state).toBe('unauthenticated')
    expect(snapshot.user).toBeNull()
    expect(snapshot.permissions).toEqual([])
    expect(session.username).toBeNull()
    expect(() => session.assertPermission('patients.view')).toThrow(/sign in/i)
    session.shutdown()
  })

  it('keeps the identity when a lock follows a lock, so the lock screen cannot be re-entered as somebody else', () => {
    const session = makeSession()
    session.signIn(user, [...rolePermissions])
    session.lock('idle-timeout')
    session.lock('manual')
    // The first reason is what matters for the audit trail; a second call must not change the state.
    expect(session.snapshot().state).toBe('locked')
    expect(session.user?.id).toBe(user.id)
    session.shutdown()
  })
})

describe('activation verifier', () => {
  // A fixture secret keeps the clinic code out of the repository: the shipped digest is only ever
  // exercised against the code itself through `DENTIVA_ACTIVATION_CODE` (setup-auth suite and the CI
  // gate). Everything the verifier must guarantee can be proven with this fixture.
  const fixtureCode = '2026000000000000'
  const fixture = createVerifierFromSecret(fixtureCode)

  it('accepts the code it was built from and rejects anything else', () => {
    expect(fixture.verify(fixtureCode)).toBe(true)
    expect(fixture.verify('2026000000000001')).toBe(false)
    expect(fixture.verify('202600000000000')).toBe(false)
    expect(fixture.verify('20260000000000000')).toBe(false)
    expect(fixture.verify('')).toBe(false)
    expect(fixture.verify('not-a-code')).toBe(false)
  })

  it('normalises the code typed by hand: spaces, dashes and Bengali digits', () => {
    expect(normalizeActivationCode(' 2026 0000 0000 0000 ')).toBe(fixtureCode)
    expect(normalizeActivationCode('2026-0000-0000-0000')).toBe(fixtureCode)
    expect(normalizeActivationCode('২০২৬০০০০০০০০০০০০')).toBe(fixtureCode)
    expect(normalizeActivationCode('')).toBe('')
  })

  it('derives a stable, one-way digest instead of storing the code', () => {
    const derived = fixture.derive(fixtureCode)
    expect(derived).toHaveLength(ACTIVATION_KDF.keyLength)
    expect(ACTIVATION_KDF.algorithm).toBe('pbkdf2-sha512')
    expect(ACTIVATION_KDF.iterations).toBeGreaterThanOrEqual(100_000)
    // Deterministic for the same input, and equal to the digest the verifier compares against.
    expect(fixture.derive(fixtureCode).equals(derived)).toBe(true)
    expect(derived.equals(fixture.expected())).toBe(true)
    // The digest is not a plain hash of the code, and the code cannot be read back out of it.
    expect(derived.toString('latin1')).not.toContain(fixtureCode)
    expect(
      derived.equals(Buffer.from(fixtureCode.padEnd(ACTIVATION_KDF.keyLength, '0').slice(0, 64), 'utf8'))
    ).toBe(false)
  })

  it('ships only a 64-byte digest for the clinic code', () => {
    const shipped = expectedVerifier()
    expect(shipped).toHaveLength(ACTIVATION_KDF.keyLength)
    // A digest is what is compiled in: it is not a code-shaped string and contains no typed characters.
    expect(shipped.toString('hex')).toMatch(/^[0-9a-f]{128}$/)
    expect(deriveVerifier('a-different-candidate').equals(shipped)).toBe(false)
  })

  it('binds the activation state to the installation it was activated on', () => {
    expect(fixture.stateHash('install-a')).toBe(fixture.stateHash('install-a'))
    expect(fixture.stateHash('install-a')).not.toBe(fixture.stateHash('install-b'))
    // A fresh install id is unique and looks like a UUID.
    const first = createInstallId()
    const second = createInstallId()
    expect(first).not.toBe(second)
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('throttles repeated wrong codes: ten attempts, then a cooldown', () => {
    let attempts = 0
    for (let index = 1; index < LOGIN_POLICY.maxActivationAttempts; index += 1) {
      const state = nextThrottleState(attempts, clock)
      attempts = state.attempts
      expect(state.cooldownUntilEpochMs).toBe(0)
      expect(evaluateThrottle(attempts, state.cooldownUntilEpochMs, clock).blocked).toBe(false)
    }

    // The tenth failure closes the door for the configured cooldown.
    const last = nextThrottleState(attempts, clock)
    expect(last.attempts).toBe(0)
    expect(last.cooldownUntilEpochMs).toBe(clock + LOGIN_POLICY.activationCooldownSeconds * 1000)

    const blocked = evaluateThrottle(last.attempts, last.cooldownUntilEpochMs, clock)
    expect(blocked.blocked).toBe(true)
    expect(blocked.attemptsRemaining).toBe(0)
    expect(blocked.secondsRemaining).toBe(LOGIN_POLICY.activationCooldownSeconds)

    // Once the cooldown elapses the counter starts again rather than staying blocked.
    const later = clock + (LOGIN_POLICY.activationCooldownSeconds + 1) * 1000
    const open = evaluateThrottle(last.attempts, last.cooldownUntilEpochMs, later)
    expect(open.blocked).toBe(false)
    expect(open.attemptsRemaining).toBe(LOGIN_POLICY.maxActivationAttempts)
  })
})
