# ADR-0004 — Offline one-time activation: derived verifier + hash-chained state

* **Status:** Accepted
* **Date:** 2026-09-29

## Context

Dentiva Pro requires a one-time activation code during setup. The code is a fixed offline secret
supplied by the vendor to the clinic; the application must not contain it as an obvious plaintext
string in source, UI, configuration or documentation (REQ §57), so this document never reproduces it. It must be verified without any network call, and local
activation state must be tamper-evident.

## Decision

1. **Verifier, not the secret.** The code is checked against a **PBKDF2-HMAC-SHA512 derived verifier**
   (salt = static application salt constant compiled into a mixing function, 120,000 iterations,
   64-byte output) compared with `crypto.timingSafeEqual`. Only the verifier is stored; the plaintext
   seed used to derive it is assembled at runtime from several disjoint numeric fragments that are
   individually meaningless and are never present as a contiguous literal (`src/main/security/activation.ts`).
2. **Normalised input.** Input is trimmed, whitespace/`-`/`_` stripped, Bengali digits are transliterated
   to ASCII, and the comparison is case-insensitive for any hex letters.
3. **Rate limiting.** Failed attempts are throttled (progressive delay) and audited; ≥10 failures in an
   install require a 60 s cool-down.
4. **Tamper-evident activation state.** On success the app writes
   `{ activatedAt, installId, verifierHash }` into `app_meta`, where `verifierHash = SHA-256(verifier ||
   installId || activationSecretMaster)` with `installId` generated at install time. Mismatch or manual
   edits are detected on startup and re-activation is requested; the event is audited.
5. **Honest documentation.** Any purely local scheme can be recovered by a sufficiently determined
   reverse engineer. The goal here is to prevent casual extraction (plain `strings` grep, config
   inspection, UI/source dumps) — **not** to claim mathematical impossibility. Offline activation is
   deliberately simple, server-free and paid-service-free.

## Consequences

* No network, no licence server, no paid service, clinic-friendly.
* The verifier and fragments are unit-tested against correct/incorrect/empty/whitespace/Bengali-digit
  variants, repeated attempts, reinstallation and tampered state (REQ §57, §106).
