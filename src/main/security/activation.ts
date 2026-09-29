/**
 * Offline one-time activation (ADR-0004, REQ §57).
 *
 * The activation secret is never present in this file, in the UI, in configuration or in the database.
 * Only a **PBKDF2-HMAC-SHA512 verifier** of the code is stored (static application salt, 120,000
 * iterations, 64-byte output) and the entered code is verified against it with a constant-time compare.
 *
 * Honest limitation (documented in ADR-0004 and in the user guide): because activation is entirely
 * offline, a determined reverse engineer could in principle recover the code by brute force. The purpose
 * of this mechanism is to prevent casual extraction (searching the binary/source, reading configuration)
 * — not to claim mathematical impossibility.
 */

import { pbkdf2Sync, createHash, timingSafeEqual, randomUUID } from 'node:crypto'
import { LOGIN_POLICY } from '@shared/constants'
import { normalizeDigits } from '@shared/money'

/** Static application salt (compiled-in constant; not secret, only prevents rainbow tables). */
const KDF_SALT_PARTS: readonly number[] = [68, 101, 110, 116, 105, 118, 97, 80, 114, 111, 58, 58]
const KDF_SALT_SUFFIX = 'activation-verifier::v1::9f3a1c7e'
const KDF_ITERATIONS = 120_000
const KDF_KEY_LENGTH = 64
const KDF_DIGEST = 'sha512' as const

const buildSalt = (): string => String.fromCharCode(...KDF_SALT_PARTS) + KDF_SALT_SUFFIX

/**
 * PBKDF2-HMAC-SHA512 verifier of the activation code. This is a one-way value: the code cannot be read
 * back from it. Split into chunks to keep it out of naive single-token string searches.
 */
const VERIFIER_CHUNKS: readonly string[] = [
  '6d686af7c2fc4f24',
  'f99259149d37872c',
  '40a3763d5069bfae',
  'a92b02a21d3f5549',
  '435a911a9d89605d',
  'c15fca23d6b43e3e',
  'a39627e3fe514683',
  'b2ba6d4c2d41065a'
]

/** Master value used to bind the activation record to this installation. */
const STATE_MASTER = 'e4b263cbd26244a33ff0ec43e36d63c3c92dbb0a75a3efdc432f35a443aa96a5'

export function expectedVerifier(): Buffer {
  return Buffer.from(VERIFIER_CHUNKS.join(''), 'hex')
}

/** Normalise user input: trim, drop separators/spaces, transliterate Bengali digits to ASCII. */
export function normalizeActivationCode(input: string): string {
  if (typeof input !== 'string') return ''
  return normalizeDigits(input)
    .replace(/[\s\u2010-\u2015\-_]/g, '')
    .trim()
}

export function deriveVerifier(code: string): Buffer {
  return pbkdf2Sync(code.normalize('NFC'), buildSalt(), KDF_ITERATIONS, KDF_KEY_LENGTH, KDF_DIGEST)
}

/** Verify a candidate code in constant time. */
export function verifyActivationCode(input: string): boolean {
  const normalized = normalizeActivationCode(input)
  if (normalized.length === 0) return false
  const derived = deriveVerifier(normalized)
  const expected = expectedVerifier()
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

/**
 * Hash stored alongside the activation record so any manual edit of the activation state is detected.
 * Binds the verifier to the installation id and to the application master value.
 */
export function activationStateHash(installId: string, verifierHex?: string): string {
  const verifier = verifierHex ?? expectedVerifier().toString('hex')
  return createHash('sha256').update(`${verifier}|${installId}|${STATE_MASTER}`).digest('hex')
}

export function createInstallId(): string {
  return randomUUID()
}

export interface ActivationThrottleState {
  attempts: number
  cooldownUntilEpochMs: number
}

export function evaluateThrottle(
  attempts: number,
  cooldownUntilEpochMs: number,
  nowEpochMs: number
): { blocked: boolean; secondsRemaining: number; attemptsRemaining: number } {
  if (cooldownUntilEpochMs > nowEpochMs) {
    return {
      blocked: true,
      secondsRemaining: Math.ceil((cooldownUntilEpochMs - nowEpochMs) / 1000),
      attemptsRemaining: 0
    }
  }
  const attemptsInWindow = Math.max(0, attempts)
  const attemptsRemaining = Math.max(0, LOGIN_POLICY.maxActivationAttempts - attemptsInWindow)
  return { blocked: false, secondsRemaining: 0, attemptsRemaining }
}

export function nextThrottleState(attempts: number, nowEpochMs: number): ActivationThrottleState {
  const nextAttempts = attempts + 1
  if (nextAttempts >= LOGIN_POLICY.maxActivationAttempts) {
    return { attempts: 0, cooldownUntilEpochMs: nowEpochMs + LOGIN_POLICY.activationCooldownSeconds * 1000 }
  }
  return { attempts: nextAttempts, cooldownUntilEpochMs: 0 }
}

export const ACTIVATION_KDF = {
  algorithm: 'pbkdf2-sha512',
  iterations: KDF_ITERATIONS,
  keyLength: KDF_KEY_LENGTH
} as const
