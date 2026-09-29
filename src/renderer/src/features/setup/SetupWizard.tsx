/**
 * First-run wizard: activation → clinic profile → dentists → administrator → review.
 *
 * Everything is written in one database transaction by the main process when the wizard finishes, so a
 * half-configured clinic can never be left behind.
 */

import { useMemo, useState } from 'react'
import { CheckCircle2, FolderOpen, KeyRound, Plus, Trash2 } from 'lucide-react'
import type { ActivationResult, ClinicInput, DentistInput } from '@shared/types'
import { invoke, errorMessage } from '../../lib/api'
import { useApp } from '../../app/state'
import { Button, Checkbox, Field, TextArea, TextInput } from '../../components/ui'

const STEPS = ['Activation', 'Clinic', 'Dentists', 'Administrator', 'Review'] as const
type Step = (typeof STEPS)[number]

interface DentistDraft {
  fullName: string
  designations: string
  qualifications: string
  certifications: string
  phone: string
  email: string
  registrationNo: string
  notes: string
}

const EMPTY_DENTIST: DentistDraft = {
  fullName: '',
  designations: '',
  qualifications: '',
  certifications: '',
  phone: '',
  email: '',
  registrationNo: '',
  notes: ''
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function passwordScore(password: string): { score: number; problems: string[] } {
  const problems: string[] = []
  if (password.length < 10) problems.push('at least 10 characters')
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length
  if (classes < 3) problems.push('three of: lower case, upper case, number, symbol')
  return { score: Math.min(4, classes + (password.length >= 14 ? 1 : 0)), problems }
}

export function SetupWizard() {
  const app = useApp()
  const [step, setStep] = useState<Step>('Activation')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [activationCode, setActivationCode] = useState('')
  const [activation, setActivation] = useState<ActivationResult | null>(null)

  const [clinic, setClinic] = useState<ClinicInput>({
    name: '',
    nameBn: null,
    address: '',
    city: null,
    postalCode: null,
    country: 'Bangladesh',
    phone1: '',
    phone2: null,
    email: null,
    website: null,
    registrationNo: null,
    footerQuote: null,
    logoPath: null
  })
  const [logoPath, setLogoPath] = useState<string | null>(null)

  const [dentists, setDentists] = useState<DentistDraft[]>([{ ...EMPTY_DENTIST }])
  const [admin, setAdmin] = useState({ username: '', displayName: '', password: '', confirmPassword: '' })

  const activationDone = activation?.activated === true
  const passwordState = useMemo(() => passwordScore(admin.password), [admin.password])

  async function activate(): Promise<void> {
    if (activationCode.trim().length === 0) {
      setError('Enter the activation code printed on your licence slip.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await invoke('setup.activate', { code: activationCode.trim() })
      setActivation(result)
      if (result.activated) setStep('Clinic')
      else setError(result.message)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  function validateClinic(): string | null {
    if (clinic.name.trim().length < 3) return 'Enter the clinic name as it should appear on prescriptions.'
    if (clinic.address.trim().length < 5) return 'Enter the clinic address.'
    if (clinic.phone1.trim().length < 6) return 'Enter a contact phone number.'
    return null
  }

  function validateDentists(): string | null {
    const valid = dentists.filter((entry) => entry.fullName.trim().length > 0)
    if (valid.length === 0) return 'Add at least one dentist.'
    if (valid.some((entry) => splitList(entry.designations).length === 0)) {
      return 'Every dentist needs at least one designation (for example "BDS" or "Consultant").'
    }
    return null
  }

  async function finish(): Promise<void> {
    const problems =
      validateDentists() ??
      (passwordState.problems.length > 0 ? `Password needs ${passwordState.problems.join(', ')}.` : null)
    if (problems) {
      setError(problems)
      return
    }
    if (admin.password !== admin.confirmPassword) {
      setError('The two administrator passwords do not match.')
      return
    }
    if (admin.username.trim().length < 3) {
      setError('Choose an administrator username with at least 3 characters.')
      return
    }

    setBusy(true)
    setError(null)
    const dentistInputs: DentistInput[] = dentists
      .filter((entry) => entry.fullName.trim().length > 0)
      .map((entry, index) => ({
        fullName: entry.fullName.trim(),
        designations: splitList(entry.designations),
        qualifications: splitList(entry.qualifications),
        certifications: splitList(entry.certifications),
        phone: entry.phone.trim() || null,
        email: entry.email.trim() || null,
        registrationNo: entry.registrationNo.trim() || null,
        signaturePath: null,
        notes: entry.notes.trim() || null,
        isActive: true,
        sortOrder: index,
        schedules: []
      }))

    try {
      await invoke('setup.complete', {
        clinic: { ...clinic, logoPath: null },
        dentists: dentistInputs,
        admin: {
          username: admin.username.trim(),
          displayName: admin.displayName.trim() || admin.username.trim(),
          password: admin.password,
          confirmPassword: admin.confirmPassword
        },
        activationCode: activationCode.trim()
      })
      if (logoPath) {
        // The clinic is created now, so the optional logo can be stored through the normal audited path.
        await invoke('clinic.logo.save', { sourcePath: logoPath }).catch(() => undefined)
      }
      await app.reloadBootstrap()
      await app.refreshSettings()
      app.toast({ tone: 'success', title: 'Setup complete', detail: 'Welcome to Dentiva Pro.' })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function chooseLogo(): Promise<void> {
    try {
      const paths = await invoke('system.openDialog', {
        title: 'Choose the clinic logo',
        multiple: false,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      })
      if (paths.length > 0) setLogoPath(paths[0] ?? null)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <div className="full-screen" style={{ alignItems: 'flex-start', paddingTop: 'var(--space-10)' }}>
      <div className="auth-card auth-card--wide">
        <div className="auth-card__brand">
          <span className="auth-card__brand-mark" aria-hidden="true">
            DP
          </span>
          <div>
            <h2 style={{ marginBottom: 2 }}>Set up Dentiva Pro</h2>
            <span className="auth-card__hint">
              {app.setup?.setupRequired ? 'First run on this computer' : 'Configuration'} · version{' '}
              {app.setup?.appVersion ?? '—'}
            </span>
          </div>
        </div>

        <div className="wizard-steps">
          {STEPS.map((entry, index) => {
            const currentIndex = STEPS.indexOf(step)
            const state = index === currentIndex ? 'active' : index < currentIndex ? 'done' : 'pending'
            return (
              <span
                key={entry}
                className={`wizard-step${state === 'active' ? ' wizard-step--active' : state === 'done' ? ' wizard-step--done' : ''}`}
              >
                <span className="wizard-step__index">{state === 'done' ? '✓' : index + 1}</span>
                {entry}
              </span>
            )
          })}
        </div>

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}

        {step === 'Activation' ? (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p className="field__hint">
              Dentiva Pro is activated once on this computer. Enter the activation code supplied with your
              licence. The code is verified offline and is never stored as plain text.
            </p>
            <TextInput
              label="Activation code"
              value={activationCode}
              onValueChange={setActivationCode}
              autoFocus
              placeholder="Enter the 16-digit code"
              hint={activation ? `${activation.attemptsRemaining} attempt(s) remaining` : undefined}
            />
            <div className="toolbar">
              <Button variant="primary" onClick={() => void activate()} loading={busy}>
                <KeyRound size={16} /> Activate
              </Button>
            </div>
            <details>
              <summary>Limitations</summary>
              <p className="field__hint">
                Activation protects against casual copying. Because the application must work without the
                internet, the check is performed on this computer and a determined person with access to the
                installed files could bypass it. Your patient data is protected separately by the database and
                user accounts.
              </p>
            </details>
          </div>
        ) : null}

        {step === 'Clinic' ? (
          <div className="form-grid form-grid--wide">
            <TextInput
              label="Clinic name"
              required
              value={clinic.name}
              onValueChange={(value) => setClinic({ ...clinic, name: value })}
              full
            />
            <TextInput
              label="Clinic name in Bangla (optional)"
              value={clinic.nameBn ?? ''}
              onValueChange={(value) => setClinic({ ...clinic, nameBn: value || null })}
              hint="Shown under the English name on prescriptions."
            />
            <TextInput
              label="Address"
              required
              value={clinic.address}
              onValueChange={(value) => setClinic({ ...clinic, address: value })}
              full
            />
            <TextInput
              label="City"
              value={clinic.city ?? ''}
              onValueChange={(value) => setClinic({ ...clinic, city: value || null })}
            />
            <TextInput
              label="Postal code"
              value={clinic.postalCode ?? ''}
              onValueChange={(value) => setClinic({ ...clinic, postalCode: value || null })}
            />
            <TextInput
              label="Country"
              value={clinic.country}
              onValueChange={(value) => setClinic({ ...clinic, country: value })}
            />
            <TextInput
              label="Phone"
              required
              value={clinic.phone1}
              onValueChange={(value) => setClinic({ ...clinic, phone1: value })}
            />
            <TextInput
              label="Second phone"
              value={clinic.phone2 ?? ''}
              onValueChange={(value) => setClinic({ ...clinic, phone2: value || null })}
            />
            <TextInput
              label="Email"
              value={clinic.email ?? ''}
              onValueChange={(value) => setClinic({ ...clinic, email: value || null })}
            />
            <TextInput
              label="Website"
              value={clinic.website ?? ''}
              onValueChange={(value) => setClinic({ ...clinic, website: value || null })}
            />
            <TextInput
              label="Registration number"
              value={clinic.registrationNo ?? ''}
              onValueChange={(value) => setClinic({ ...clinic, registrationNo: value || null })}
              hint="Printed when present (BMDC/clinic registration)."
            />
            <TextInput
              label="Footer quote (optional)"
              value={clinic.footerQuote ?? ''}
              onValueChange={(value) => setClinic({ ...clinic, footerQuote: value || null })}
              full
            />
            <Field
              label="Clinic logo"
              hint={logoPath ? logoPath : 'PNG, JPG or WEBP. Stored inside your data folder.'}
              full
            >
              <div className="toolbar">
                <Button onClick={() => void chooseLogo()}>
                  <FolderOpen size={16} /> Choose logo
                </Button>
                {logoPath ? (
                  <Button variant="ghost" onClick={() => setLogoPath(null)}>
                    Remove
                  </Button>
                ) : null}
              </div>
            </Field>
            <div className="form-grid__full">
              <p className="field__hint">
                Data folder: <span className="mono">{app.setup?.dataRoot}</span>. This is where the database,
                attachments, logs and backups live on this computer.
              </p>
            </div>
            <div className="form-grid__full toolbar">
              <Button onClick={() => setStep('Activation')}>Back</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const problem = validateClinic()
                  setError(problem)
                  if (!problem) setStep('Dentists')
                }}
              >
                Continue
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'Dentists' ? (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p className="field__hint">
              Add every dentist who signs prescriptions. Designations and qualifications accept several
              comma-separated values, for example “Consultant, Dental Surgeon” and “BDS, FCPS, MS”.
            </p>
            {dentists.map((dentist, index) => (
              <div key={index} className="card" style={{ padding: 'var(--space-4)' }}>
                <div className="toolbar" style={{ marginBottom: 'var(--space-3)' }}>
                  <strong>Dentist {index + 1}</strong>
                  {dentists.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDentists(dentists.filter((_, position) => position !== index))}
                    >
                      <Trash2 size={14} /> Remove
                    </Button>
                  ) : null}
                </div>
                <div className="form-grid form-grid--wide">
                  <TextInput
                    label="Full name"
                    required
                    value={dentist.fullName}
                    onValueChange={(value) =>
                      setDentists(
                        dentists.map((entry, position) =>
                          position === index ? { ...entry, fullName: value } : entry
                        )
                      )
                    }
                  />
                  <TextInput
                    label="Designations"
                    required
                    value={dentist.designations}
                    onValueChange={(value) =>
                      setDentists(
                        dentists.map((entry, position) =>
                          position === index ? { ...entry, designations: value } : entry
                        )
                      )
                    }
                    hint="Comma separated, e.g. Consultant, Dental Surgeon"
                  />
                  <TextInput
                    label="Qualifications"
                    value={dentist.qualifications}
                    onValueChange={(value) =>
                      setDentists(
                        dentists.map((entry, position) =>
                          position === index ? { ...entry, qualifications: value } : entry
                        )
                      )
                    }
                    hint="Comma separated, e.g. BDS, FCPS"
                  />
                  <TextInput
                    label="Certifications"
                    value={dentist.certifications}
                    onValueChange={(value) =>
                      setDentists(
                        dentists.map((entry, position) =>
                          position === index ? { ...entry, certifications: value } : entry
                        )
                      )
                    }
                  />
                  <TextInput
                    label="Phone"
                    value={dentist.phone}
                    onValueChange={(value) =>
                      setDentists(
                        dentists.map((entry, position) =>
                          position === index ? { ...entry, phone: value } : entry
                        )
                      )
                    }
                  />
                  <TextInput
                    label="Email"
                    value={dentist.email}
                    onValueChange={(value) =>
                      setDentists(
                        dentists.map((entry, position) =>
                          position === index ? { ...entry, email: value } : entry
                        )
                      )
                    }
                  />
                  <TextInput
                    label="BMDC / registration number"
                    value={dentist.registrationNo}
                    onValueChange={(value) =>
                      setDentists(
                        dentists.map((entry, position) =>
                          position === index ? { ...entry, registrationNo: value } : entry
                        )
                      )
                    }
                  />
                  <TextArea
                    label="Notes"
                    rows={2}
                    value={dentist.notes}
                    onValueChange={(value) =>
                      setDentists(
                        dentists.map((entry, position) =>
                          position === index ? { ...entry, notes: value } : entry
                        )
                      )
                    }
                    full
                  />
                </div>
              </div>
            ))}
            <div className="toolbar">
              <Button onClick={() => setDentists([...dentists, { ...EMPTY_DENTIST }])}>
                <Plus size={16} /> Add another dentist
              </Button>
            </div>
            <div className="toolbar">
              <Button onClick={() => setStep('Clinic')}>Back</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const problem = validateDentists()
                  setError(problem)
                  if (!problem) setStep('Administrator')
                }}
              >
                Continue
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'Administrator' ? (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p className="field__hint">
              This first account is the administrator: it can manage users, roles, backups and settings. Keep
              the password safe — it cannot be recovered, only reset by another administrator.
            </p>
            <div className="form-grid form-grid--wide">
              <TextInput
                label="Username"
                required
                value={admin.username}
                onValueChange={(value) => setAdmin({ ...admin, username: value })}
                autoComplete="off"
              />
              <TextInput
                label="Display name"
                value={admin.displayName}
                onValueChange={(value) => setAdmin({ ...admin, displayName: value })}
                hint="Shown in the application and in the audit log."
              />
              <TextInput
                label="Password"
                required
                type="password"
                value={admin.password}
                onValueChange={(value) => setAdmin({ ...admin, password: value })}
                autoComplete="new-password"
              />
              <TextInput
                label="Confirm password"
                required
                type="password"
                value={admin.confirmPassword}
                onValueChange={(value) => setAdmin({ ...admin, confirmPassword: value })}
                autoComplete="new-password"
              />
            </div>
            <div>
              <div className="progress-bar" aria-hidden="true">
                <div
                  className="progress-bar__fill"
                  style={{
                    width: `${(passwordState.score / 4) * 100}%`,
                    background: passwordState.score >= 3 ? 'var(--success-600)' : 'var(--warning-600)'
                  }}
                />
              </div>
              <p className="field__hint">
                {passwordState.problems.length === 0
                  ? 'Strong password.'
                  : `Needs ${passwordState.problems.join(' and ')}.`}
              </p>
            </div>
            <div className="toolbar">
              <Button onClick={() => setStep('Dentists')}>Back</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setError(null)
                  if (admin.password !== admin.confirmPassword) {
                    setError('The two passwords do not match.')
                    return
                  }
                  if (passwordState.problems.length > 0) {
                    setError(`Password needs ${passwordState.problems.join(' and ')}.`)
                    return
                  }
                  setStep('Review')
                }}
              >
                Continue
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'Review' ? (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <div className="card" style={{ padding: 'var(--space-4)' }}>
              <h4>Clinic</h4>
              <p>
                {clinic.name}
                {clinic.nameBn ? ` (${clinic.nameBn})` : ''}
                <br />
                {clinic.address}
                {clinic.city ? `, ${clinic.city}` : ''}
                <br />
                {clinic.phone1}
                {clinic.phone2 ? ` · ${clinic.phone2}` : ''}
              </p>
            </div>
            <div className="card" style={{ padding: 'var(--space-4)' }}>
              <h4>Dentists</h4>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {dentists
                  .filter((entry) => entry.fullName.trim().length > 0)
                  .map((entry, index) => (
                    <li key={index}>
                      {entry.fullName} — {splitList(entry.designations).join(', ')}
                      {splitList(entry.qualifications).length > 0
                        ? ` (${splitList(entry.qualifications).join(', ')})`
                        : ''}
                    </li>
                  ))}
              </ul>
            </div>
            <div className="card" style={{ padding: 'var(--space-4)' }}>
              <h4>Administrator</h4>
              <p>
                {admin.displayName || admin.username} (@{admin.username})
              </p>
            </div>
            <Checkbox
              label="I have recorded the administrator password somewhere safe."
              checked={admin.password.length > 0}
              onCheckedChange={() => undefined}
              disabled
            />
            <div className="toolbar">
              <Button onClick={() => setStep('Administrator')}>Back</Button>
              <Button variant="primary" onClick={() => void finish()} loading={busy}>
                <CheckCircle2 size={16} /> Finish setup
              </Button>
            </div>
          </div>
        ) : null}

        {!activationDone && step !== 'Activation' ? (
          <p className="field__hint">Activation is required before the clinic can be configured.</p>
        ) : null}
      </div>
    </div>
  )
}
