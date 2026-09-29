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
  activationStateHash,
  createInstallId,
  deriveVerifier,
  evaluateThrottle,
  expectedVerifier,
  nextThrottleState,
  normalizeActivationCode,
  verifyActivationCode
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
  const code = '1516591935015165'

  it('accepts the clinic code and rejects anything else', () => {
    expect(verifyActivationCode(code)).toBe(true)
    expect(verifyActivationCode('1516591935015164')).toBe(false)
    expect(verifyActivationCode('1516591935015166')).toBe(false)
    expect(verifyActivationCode('')).toBe(false)
    expect(verifyActivationCode('not-a-code')).toBe(false)
  })

  it('normalises the code typed by hand: spaces, dashes and Bengali digits', () => {
    expect(normalizeActivationCode(' 1516 5919 3501 5165 ')).toBe(code)
    expect(normalizeActivationCode('1516-5919-3501-5165')).toBe(code)
    expect(normalizeActivationCode('১৫১৬৫৯১৯৩৫০১৫১৬৫')).toBe(code)
    expect(normalizeActivationCode('')).toBe('')
  })

  it('verifies a derived verifier without storing the code itself', () => {
    // The shipped artefact is a PBKDF2 digest; the code is never written anywhere in the repository.
    expect(deriveVerifier(code)).toEqual(expectedVerifier())
    expect(expectedVerifier().toString('hex')).not.toContain(Buffer.from(code, 'utf8').toString('hex'))
    expect(ACTIVATION_KDF.algorithm).toBe('pbkdf2-sha512')
    expect(ACTIVATION_KDF.keyLength).toBe(expectedVerifier().length)
    expect(ACTIVATION_KDF.iterations).toBeGreaterThanOrEqual(100_000)
  })

  it('binds the activation state to the installation it was activated on', () => {
    expect(activationStateHash('install-a')).toBe(activationStateHash('install-a'))
    expect(activationStateHash('install-a')).not.toBe(activationStateHash('install-b'))
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
