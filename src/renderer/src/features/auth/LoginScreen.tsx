import { useState } from 'react'
import { Lock, ShieldCheck } from 'lucide-react'
import { invoke, isApiError, errorMessage } from '../../lib/api'
import { useApp } from '../../app/state'
import { Button, TextInput } from '../../components/ui'

/**
 * Sign-in screen. Failed attempts are counted by the main process, which also applies the lock-out.
 * No hint about whether the username exists is shown.
 */
export function LoginScreen() {
  const app = useApp()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lockedUntil, setLockedUntil] = useState<string | null>(null)
  const [mustChange, setMustChange] = useState(false)
  const [pendingPassword, setPendingPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  async function signIn(): Promise<void> {
    if (username.trim().length === 0 || password.length === 0) {
      setError('Enter your username and password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await invoke('auth.login', { username: username.trim(), password })
      if (result.mustChangePassword) {
        // The main process keeps the session; the user must set a new password before using the app.
        setPendingPassword(password)
        setMustChange(true)
      }
      setPassword('')
    } catch (cause) {
      if (isApiError(cause)) {
        if (cause.code === 'LOCKED_OUT') setLockedUntil(new Date(Date.now() + 5 * 60_000).toISOString())
        setError(cause.message)
        if (cause.code === 'PASSWORD_WEAK') setMustChange(false)
      } else {
        setError(errorMessage(cause))
      }
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  async function changePassword(): Promise<void> {
    if (newPassword !== confirmPassword) {
      setError('The two passwords do not match.')
      return
    }
    if (newPassword.length < 10) {
      setError('Use at least 10 characters for the new password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await invoke('auth.changePassword', { currentPassword: pendingPassword, newPassword })
      setPendingPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMustChange(false)
      await app.refreshSession()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="full-screen">
      <div className="auth-card">
        <div className="auth-card__brand">
          <span className="auth-card__brand-mark" aria-hidden="true">
            DP
          </span>
          <div>
            <h2 style={{ marginBottom: 2 }}>Dentiva Pro</h2>
            <span className="auth-card__hint">{app.clinic?.name ?? 'Dental clinic management'}</span>
          </div>
        </div>

        {mustChange ? (
          <>
            <p className="field__hint">
              This account must set a new password before continuing. Use at least 10 characters with upper
              and lower case, a number and a symbol.
            </p>
            <TextInput
              label="New password"
              type="password"
              value={newPassword}
              onValueChange={setNewPassword}
              autoComplete="new-password"
              autoFocus
            />
            <TextInput
              label="Confirm new password"
              type="password"
              value={confirmPassword}
              onValueChange={setConfirmPassword}
              autoComplete="new-password"
            />
            {error ? (
              <p className="field__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="toolbar">
              <Button variant="primary" onClick={() => void changePassword()} loading={busy} block>
                Set password and continue
              </Button>
            </div>
          </>
        ) : (
          <>
            <TextInput
              label="Username"
              value={username}
              onValueChange={setUsername}
              autoFocus
              autoComplete="username"
            />
            <TextInput
              label="Password"
              type="password"
              value={password}
              onValueChange={setPassword}
              autoComplete="current-password"
              onKeyDown={(event) => {
                if (event.key === 'Enter') void signIn()
              }}
            />
            {error ? (
              <p className="field__error" role="alert">
                {error}
              </p>
            ) : null}
            {lockedUntil ? (
              <p className="field__hint">
                Too many failed attempts. Sign-in is paused for a few minutes; ask an administrator if you
                cannot remember the password.
              </p>
            ) : null}
            <Button variant="primary" onClick={() => void signIn()} loading={busy} block>
              <Lock size={16} /> Sign in
            </Button>
          </>
        )}

        <div className="auth-card__hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ShieldCheck size={14} /> Works fully offline. Data stays on this computer.
        </div>
        <div className="auth-card__hint">
          Dentiva Pro {app.setup?.appVersion ?? '—'} (build {app.setup?.buildNumber ?? '—'}) ·{' '}
          {app.setup?.dataRoot ?? ''}
        </div>
      </div>
    </div>
  )
}
