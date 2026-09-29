/**
 * Integration tests for activation, the setup wizard, sign-in and auto-lock.
 *
 * These run against a real SQLite database through the real services, so what is verified here is the
 * behaviour the clinic gets, not a mock. The activation code itself is never stored in the repository: the
 * suites that need it read `DENTIVA_ACTIVATION_CODE` (a CI secret) and are skipped when it is not present.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, completeSetup, type Harness } from './harness'
import { verifyActivationCode, deriveVerifier, expectedVerifier } from '@main/security/activation'

const activationCode = process.env.DENTIVA_ACTIVATION_CODE ?? ''
const withCode = describe.skipIf(activationCode.length === 0)

let harness: Harness

beforeEach(() => {
  harness = createHarness()
})

afterEach(() => {
  harness.dispose()
})

describe('activation verifier', () => {
  it('rejects anything that is not the activation code', () => {
    expect(verifyActivationCode('')).toBe(false)
    expect(verifyActivationCode('0000000000000000')).toBe(false)
    expect(verifyActivationCode('1516591935015164')).toBe(false)
  })

  it('stores only a derived verifier, never the code', () => {
    const verifier = expectedVerifier()
    expect(verifier).toHaveLength(64)
    const derived = deriveVerifier('0000000000000000')
    expect(derived.length).toBe(64)
    expect(derived.equals(verifier)).toBe(false)
  })

  it('is deterministic for the same input', () => {
    expect(deriveVerifier('1234').equals(deriveVerifier('1234'))).toBe(true)
  })
})

describe('setup wizard', () => {
  it('refuses to create the first account before activation', () => {
    const status = harness.services.setup.status({ defaultDataRoot: harness.root })
    expect(status.setupRequired).toBe(true)
    expect(status.activationRequired).toBe(true)
    expect(() =>
      harness.services.setup.complete({
        clinic: {
          name: 'Test',
          nameBn: null,
          address: 'x',
          city: null,
          postalCode: null,
          country: 'Bangladesh',
          phone1: '123456',
          phone2: null,
          email: null,
          website: null,
          registrationNo: null,
          footerQuote: null
        },
        dentists: [],
        admin: {
          username: 'admin',
          displayName: 'Admin',
          password: 'Harness#Pass1',
          confirmPassword: 'Harness#Pass1'
        },
        activationCode: '0000000000000000'
      })
    ).toThrow()
  })

  it('records failed activation attempts and throttles after the limit', () => {
    const first = harness.services.setup.activate('0000000000000000')
    expect(first.activated).toBe(false)
    expect(first.attemptsRemaining).toBe(9)

    // LOGIN_POLICY.maxActivationAttempts failed attempts exhaust the window.
    for (let attempt = 0; attempt < 9; attempt += 1) harness.services.setup.activate('0000000000000000')
    const blocked = harness.services.setup.activate('0000000000000000')
    expect(blocked.activated).toBe(false)
    expect(blocked.message).toMatch(/Too many attempts/)
    expect(blocked.attemptsRemaining).toBe(0)
  })

  it('seeds the permission catalogue and the default roles', () => {
    const codes = harness.services.permissions.catalogue().map((entry) => entry.code)
    expect(codes.length).toBeGreaterThan(50)
    const roles = harness.services.roles.list().map((role) => role.code)
    expect(roles).toContain('administrator')
    expect(roles).toContain('dentist')
    expect(roles).toContain('receptionist')
    expect(roles).toContain('accountant')
    // The default clinical lists must exist before the first prescription is written. Read through the
    // repository here: the service intentionally requires a signed-in user with `visits.view`.
    expect(harness.services.catalogue.clinicalOptions('medicine_type').length).toBeGreaterThan(0)
    expect(harness.services.catalogue.clinicalOptions('duration_unit').length).toBeGreaterThan(0)
    expect(harness.services.catalogue.clinicalOptions('chief_complaint').length).toBeGreaterThan(0)
  })
})

withCode('activation + setup (needs DENTIVA_ACTIVATION_CODE)', () => {
  it('activates, completes setup and signs the administrator in', () => {
    completeSetup(harness, { activationCode })

    expect(harness.services.setup.isSetupComplete()).toBe(true)
    const clinic = harness.services.clinic.get()
    expect(clinic?.name).toBe('Harness Dental Care')
    expect(harness.services.dentists.list(false)).toHaveLength(1)
    expect(harness.services.session.username).toBe('admin')

    const snapshot = harness.services.session.snapshot()
    expect(snapshot.state).toBe('authenticated')
    expect(snapshot.user?.roleCode).toBe('administrator')
  })

  it('signs in with the stored password and rejects a wrong one', () => {
    completeSetup(harness, { activationCode })
    harness.services.session.signOut()

    const ok = harness.services.auth.login('admin', 'Harness#Pass1')
    expect(ok.snapshot.user?.username).toBe('admin')
    expect(ok.mustChangePassword).toBe(false)

    harness.services.session.signOut()
    expect(() => harness.services.auth.login('admin', 'wrong-password')).toThrow()
  })

  it('locks the session when the auto-lock window elapses', () => {
    completeSetup(harness, { activationCode })
    harness.advance(11 * 60_000)
    harness.tickTimers()
    expect(harness.services.session.sessionState).toBe('locked')
    expect(() => harness.services.session.assertUsable()).toThrow()

    // The password unlocks the session without signing out.
    harness.services.auth.unlock('Harness#Pass1')
    expect(harness.services.session.sessionState).toBe('authenticated')
  })
})
