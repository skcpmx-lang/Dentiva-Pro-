/**
 * First-run setup: activation, clinic profile, dentists and the initial administrator.
 *
 * The activation code is never stored in the clear (ADR-0004): only a PBKDF2 verifier plus an
 * installation-bound state hash are written to `app_meta`, and failed attempts are throttled.
 */

import { nowSql } from '@shared/date'
import { conflict, forbidden, validationError } from '@shared/errors'
import { LOGIN_POLICY } from '@shared/constants'
import type { ActivationResult, LoginResult, SetupInput, SetupStatus } from '@shared/types'
import type { SqliteDatabase } from '../db/connection'
import { setMeta } from '../db/connection'
import { createInstallId, activationStateHash as computeActivationStateHash } from '../security/activation'
import { passwordIssues } from '../security/password'
import type {
  CatalogueRepository,
  ClinicRepository,
  CounterRepository,
  DentistRepository,
  MetaRepository,
  PermissionRepository,
  RoleRepository,
  SettingsRepository,
  UserRepository
} from '../db/repositories-core'
import type { AuditRepository } from '../db/repositories-clinical'
import type { SessionManager } from '../security/session'
import type { DataLayout } from '../storage/paths'

export interface SetupServiceDeps {
  db: SqliteDatabase
  layout: DataLayout
  meta: MetaRepository
  counters: CounterRepository
  settings: SettingsRepository
  clinic: ClinicRepository
  permissions: PermissionRepository
  roles: RoleRepository
  users: UserRepository
  catalogue: CatalogueRepository
  dentists: DentistRepository
  audit: AuditRepository
  session: SessionManager
  appVersion: string
  buildInfo: { version: string; buildNumber: string; commit: string; buildDate: string }
  activation: {
    activated: boolean
    verify: (input: string) => boolean
    markActivated: () => void
    activationStateHash: () => string
  }
}

/** Attempts are kept in `app_meta` so a restart cannot be used to reset the throttle. */
const META_ATTEMPTS = 'activation_attempts'
const META_COOLDOWN = 'activation_cooldown_until'
const META_ACTIVATED_AT = 'activated_at'
const META_SETUP_COMPLETED = 'setup_completed'
const META_INSTALL_ID = 'install_id'
const META_STATE_HASH = 'activation_state_hash'

export class SetupService {
  constructor(private readonly deps: SetupServiceDeps) {}

  isSetupComplete(): boolean {
    return this.deps.meta.get(META_SETUP_COMPLETED) === 'true'
  }

  isActivated(): boolean {
    return this.deps.activation.activated || this.deps.meta.get(META_ACTIVATED_AT) != null
  }

  status(opts: { defaultDataRoot: string }): SetupStatus {
    const activatedAt = this.deps.meta.get(META_ACTIVATED_AT)
    return {
      setupRequired: !this.isSetupComplete(),
      activationRequired: activatedAt == null,
      dataRoot: this.deps.layout.root,
      defaultDataRoot: opts.defaultDataRoot,
      appVersion: this.deps.buildInfo.version,
      buildNumber: this.deps.buildInfo.buildNumber,
      commit: this.deps.buildInfo.commit,
      buildDate: this.deps.buildInfo.buildDate
    }
  }

  /** Verify the activation code with throttling and full auditing. */
  activate(code: string): ActivationResult {
    const attempts = Number(this.deps.meta.get(META_ATTEMPTS) ?? '0')
    const cooldownUntil = Number(this.deps.meta.get(META_COOLDOWN) ?? '0')
    const now = Date.now()

    if (cooldownUntil > now) {
      const seconds = Math.ceil((cooldownUntil - now) / 1000)
      this.audit('activation.throttled', 'Activation attempt refused during cool-down', 'warning')
      return {
        activated: false,
        message: `Too many attempts. Try again in ${seconds} second(s).`,
        attemptsRemaining: 0
      }
    }

    if (this.isActivated()) {
      return { activated: true, message: 'This installation is already activated.', attemptsRemaining: 0 }
    }

    const ok = this.deps.activation.verify(code)
    if (!ok) {
      const nextAttempts = attempts + 1
      const remaining = Math.max(0, LOGIN_POLICY.maxActivationAttempts - nextAttempts)
      this.deps.meta.set(META_ATTEMPTS, String(nextAttempts))
      if (remaining === 0) {
        this.deps.meta.set(META_COOLDOWN, String(now + LOGIN_POLICY.activationCooldownSeconds * 1000))
      }
      this.audit(
        'activation.failed',
        `Activation attempt ${nextAttempts} of ${LOGIN_POLICY.maxActivationAttempts} failed`,
        'warning'
      )
      return {
        activated: false,
        message:
          remaining > 0
            ? `That activation code is not valid. ${remaining} attempt(s) remaining.`
            : `Too many attempts. Wait ${LOGIN_POLICY.activationCooldownSeconds} seconds and try again.`,
        attemptsRemaining: remaining
      }
    }

    const installId = this.deps.meta.get(META_INSTALL_ID) ?? createInstallId()
    this.deps.db.transaction(() => {
      setMeta(this.deps.db, META_INSTALL_ID, installId)
      setMeta(this.deps.db, META_ACTIVATED_AT, nowSql())
      setMeta(this.deps.db, META_STATE_HASH, this.deps.activation.activationStateHash())
      setMeta(this.deps.db, META_ATTEMPTS, '0')
      setMeta(this.deps.db, META_COOLDOWN, '0')
      this.deps.activation.markActivated()
    })()
    this.audit('activation.success', 'Installation activated', 'warning')
    return {
      activated: true,
      message: 'Activation successful. Welcome to Dentiva Pro.',
      attemptsRemaining: 0
    }
  }

  /** Verify the activation state has not been edited by hand; returns a human message when it has. */
  verifyActivationIntegrity(): { ok: boolean; message: string; activatedAt: string | null } {
    const activatedAt = this.deps.meta.get(META_ACTIVATED_AT)
    if (!activatedAt) return { ok: true, message: 'Not activated yet.', activatedAt: null }
    const installId = this.deps.meta.get(META_INSTALL_ID)
    const stored = this.deps.meta.get(META_STATE_HASH)
    if (!installId || !stored) {
      return {
        ok: false,
        message:
          'The activation record is incomplete; the application will ask for the activation code again.',
        activatedAt
      }
    }
    const expected = computeActivationStateHash(installId)
    return expected === stored
      ? { ok: true, message: 'Activation record verified.', activatedAt }
      : { ok: false, message: 'The activation record was modified outside the application.', activatedAt }
  }

  /** Complete the setup wizard: clinic, dentists, initial administrator, then sign the administrator in. */
  complete(input: SetupInput): LoginResult {
    if (this.isSetupComplete()) {
      throw conflict('The setup wizard has already been completed.')
    }
    if (!this.isActivated()) {
      throw forbidden('Activate this installation before completing the setup.')
    }

    const problems: { field: string; message: string }[] = []
    if (input.clinic.name.trim().length < 2)
      problems.push({ field: 'clinic.name', message: 'Enter the clinic name.' })
    if (input.clinic.address.trim().length < 3) {
      problems.push({ field: 'clinic.address', message: 'Enter the clinic address.' })
    }
    if (input.clinic.phone1.trim().length < 6)
      problems.push({ field: 'clinic.phone1', message: 'Enter a phone number.' })
    if (input.dentists.length === 0) {
      problems.push({ field: 'dentists', message: 'Add at least one dentist.' })
    }
    input.dentists.forEach((dentist, index) => {
      if (dentist.fullName.trim().length < 3) {
        problems.push({ field: `dentists.${index}.fullName`, message: 'Enter the dentist name.' })
      }
      if (dentist.designations.filter((value) => value.trim() !== '').length === 0) {
        problems.push({ field: `dentists.${index}.designations`, message: 'Add at least one designation.' })
      }
      if (dentist.qualifications.filter((value) => value.trim() !== '').length === 0) {
        problems.push({
          field: `dentists.${index}.qualifications`,
          message: 'Add at least one qualification.'
        })
      }
    })
    if (input.admin.password !== input.admin.confirmPassword) {
      problems.push({ field: 'admin.confirmPassword', message: 'The passwords do not match.' })
    }
    const passwordProblemList = passwordIssues(input.admin.password, input.admin.username)
    if (passwordProblemList.length > 0) {
      problems.push({ field: 'admin.password', message: passwordProblemList.join(' ') })
    }
    if (problems.length > 0) throw validationError('The setup information is incomplete.', problems)

    const administratorRole = this.deps.roles.findByCode('administrator')
    if (!administratorRole) {
      throw forbidden('The Administrator role is missing. Reinstall or restore a valid database.')
    }
    const actor = 'setup'

    this.deps.db.transaction(() => {
      this.deps.clinic.upsert({
        name: input.clinic.name.trim(),
        nameBn: input.clinic.nameBn ?? null,
        logoPath: null,
        address: input.clinic.address.trim(),
        city: input.clinic.city ?? null,
        postalCode: input.clinic.postalCode ?? null,
        country: input.clinic.country || 'Bangladesh',
        phone1: input.clinic.phone1.trim(),
        phone2: input.clinic.phone2 ?? null,
        email: input.clinic.email ?? null,
        website: input.clinic.website ?? null,
        registrationNo: input.clinic.registrationNo ?? null,
        footerQuote: input.clinic.footerQuote ?? null
      })

      input.dentists.forEach((dentist, index) => {
        this.deps.dentists.create(
          {
            ...dentist,
            fullName: dentist.fullName.trim(),
            isActive: true,
            sortOrder: dentist.sortOrder || index + 1,
            designations: dentist.designations.map((value) => value.trim()).filter((value) => value !== ''),
            qualifications: dentist.qualifications
              .map((value) => value.trim())
              .filter((value) => value !== ''),
            certifications: dentist.certifications
              .map((value) => value.trim())
              .filter((value) => value !== '')
          },
          actor
        )
      })

      const userId = this.deps.users.create({
        username: input.admin.username.trim().toLowerCase(),
        displayName: input.admin.displayName.trim() || input.admin.username.trim(),
        roleId: administratorRole.id,
        isActive: true,
        mustChangePassword: false,
        overrides: [],
        password: input.admin.password,
        actor
      })
      setMeta(this.deps.db, META_SETUP_COMPLETED, 'true')
      setMeta(this.deps.db, 'setup_completed_at', nowSql())
      setMeta(this.deps.db, 'setup_completed_by', String(userId))
    })()

    this.deps.counters.set('patient_code', 0)
    this.audit(
      'setup.complete',
      `Setup completed for "${input.clinic.name.trim()}" with ${input.dentists.length} dentist(s)`,
      'critical',
      actor
    )

    const created = this.deps.users.findByUsername(input.admin.username.trim().toLowerCase())
    if (!created) throw forbidden('The administrator account could not be created.')
    const rolePermissions = this.deps.roles.permissionsForRole(created.roleId)
    const loginAt = nowSql()
    this.deps.users.registerSuccessfulLogin(created.username, loginAt)
    const snapshot = this.deps.session.signIn(
      {
        id: created.id,
        username: created.username,
        displayName: created.displayName,
        roleId: created.roleId,
        roleCode: administratorRole.code,
        roleName: administratorRole.name,
        isActive: true,
        lastLoginAt: loginAt
      },
      rolePermissions,
      created.overrides
    )
    return { snapshot, mustChangePassword: false }
  }

  private audit(
    action: string,
    summary: string,
    severity: 'info' | 'warning' | 'critical',
    actor = 'system'
  ): void {
    this.deps.audit.append({
      actorUserId: null,
      actorUsername: actor,
      action,
      entityType: 'setup',
      entityId: null,
      summary,
      severity,
      appVersion: this.deps.appVersion
    })
  }
}
