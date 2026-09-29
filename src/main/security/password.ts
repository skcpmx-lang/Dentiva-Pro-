/**
 * Password hashing and policy (REQ §44, §68; SEC-001 §2).
 *
 * Format: `scrypt$N$r$p$<salt-hex>$<hash-hex>` — the parameters travel with the hash so they can be
 * raised in future versions without invalidating existing passwords. Comparison is constant-time.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { PASSWORD_POLICY, SCRYPT_PARAMS } from '@shared/constants'

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4
  label: 'Very weak' | 'Weak' | 'Fair' | 'Good' | 'Strong'
  issues: string[]
  acceptable: boolean
}

export function hashPassword(password: string, params = SCRYPT_PARAMS): string {
  if (typeof password !== 'string' || password.length === 0) throw new Error('Password must not be empty')
  const salt = randomBytes(params.saltLength)
  const derived = scryptSync(password.normalize('NFC'), salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 128 * params.N * params.r * 2
  })
  return ['scrypt', params.N, params.r, params.p, salt.toString('hex'), derived.toString('hex')].join('$')
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const [, nText, rText, pText, saltHex, hashHex] = parts as [
      string,
      string,
      string,
      string,
      string,
      string
    ]
    const N = Number(nText)
    const r = Number(rText)
    const p = Number(pText)
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
    const salt = Buffer.from(saltHex, 'hex')
    const expected = Buffer.from(hashHex, 'hex')
    const derived = scryptSync(password.normalize('NFC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2
    })
    if (derived.length !== expected.length) return false
    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

export function passwordIssues(password: string, username?: string): string[] {
  const issues: string[] = []
  if (password.length < PASSWORD_POLICY.minLength) {
    issues.push(`Password must be at least ${PASSWORD_POLICY.minLength} characters long.`)
  }
  if (password.length > PASSWORD_POLICY.maxLength) {
    issues.push(`Password must be at most ${PASSWORD_POLICY.maxLength} characters long.`)
  }
  const classes = [
    PASSWORD_POLICY.classes.lower.test(password),
    PASSWORD_POLICY.classes.upper.test(password),
    PASSWORD_POLICY.classes.digit.test(password),
    PASSWORD_POLICY.classes.symbol.test(password)
  ].filter(Boolean).length
  if (classes < PASSWORD_POLICY.requireClasses) {
    issues.push(
      `Use at least ${PASSWORD_POLICY.requireClasses} of: lowercase letters, uppercase letters, numbers, symbols.`
    )
  }
  const lower = password.toLowerCase()
  if (PASSWORD_POLICY.weakPasswords.includes(lower)) {
    issues.push('This password is too common and easy to guess.')
  }
  if (/^(.)\1{5,}$/.test(password)) {
    issues.push('Avoid repeating the same character many times.')
  }
  if (/^(?:0123|1234|2345|3456|4567|5678|6789|7890|abcd|bcde|cdef)/i.test(password)) {
    issues.push('Avoid simple sequences such as 1234 or abcd.')
  }
  if (username && username.length >= 3 && lower.includes(username.toLowerCase())) {
    issues.push('Password must not contain the username.')
  }
  return issues
}

/** Strength meter used by the setup wizard and password change dialog. */
export function passwordStrength(password: string, username?: string): PasswordStrength {
  const issues = passwordIssues(password, username)
  let score = 0
  if (password.length >= PASSWORD_POLICY.minLength) score += 1
  if (password.length >= 14) score += 1
  const classes = [
    PASSWORD_POLICY.classes.lower.test(password),
    PASSWORD_POLICY.classes.upper.test(password),
    PASSWORD_POLICY.classes.digit.test(password),
    PASSWORD_POLICY.classes.symbol.test(password)
  ].filter(Boolean).length
  if (classes >= 3) score += 1
  if (classes === 4 && password.length >= 12) score += 1
  if (issues.length > 0) score = Math.max(0, score - 2)

  const clamped = Math.min(4, score) as PasswordStrength['score']
  const labels: PasswordStrength['label'][] = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong']
  return {
    score: clamped,
    label: labels[clamped] as PasswordStrength['label'],
    issues,
    acceptable: issues.length === 0
  }
}
