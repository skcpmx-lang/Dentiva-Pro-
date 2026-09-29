import { useState } from 'react'
import { Lock, LogOut, User } from 'lucide-react'
import { invoke, errorMessage } from '../../lib/api'
import { useApp } from '../../app/state'
import { Button, TextInput } from '../../components/ui'
import { initials } from '../../lib/format'

/**
 * Lock screen. Nothing about the clinic is shown while locked — no patient names, no counters, no data —
 * only the signed-in user's name so the right person unlocks it.
 */
export function LockScreen() {
  const app = useApp()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function unlock(): Promise<void> {
    if (password.length === 0) {
      setError('Enter your password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await invoke('auth.unlock', { password })
      setPassword('')
    } catch (cause) {
      setError(errorMessage(cause))
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="full-screen">
      <div className="auth-card">
        <div className="auth-card__brand">
          <span className="auth-card__brand-mark" aria-hidden="true">
            {initials(app.session.user?.displayName ?? 'U')}
          </span>
          <div>
            <h2 style={{ marginBottom: 2 }}>Locked</h2>
            <span className="auth-card__hint">
              {app.session.user?.displayName} · @{app.session.user?.username}
            </span>
          </div>
        </div>

        <p className="auth-card__hint">
          The application locked itself after {app.session.autoLockMinutes} minutes of inactivity. Your work
          is saved; unlock to continue.
        </p>

        <TextInput
          label="Password"
          type="password"
          value={password}
          onValueChange={setPassword}
          autoFocus
          autoComplete="current-password"
          onKeyDown={(event) => {
            if (event.key === 'Enter') void unlock()
          }}
        />

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}

        <Button variant="primary" onClick={() => void unlock()} loading={busy} block>
          <Lock size={16} /> Unlock
        </Button>

        <Button
          variant="ghost"
          block
          onClick={async () => {
            await invoke('auth.logout').catch(() => undefined)
          }}
        >
          <LogOut size={16} /> Sign out instead
        </Button>

        <div className="auth-card__hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <User size={14} /> Only this user can unlock the application.
        </div>
      </div>
    </div>
  )
}
