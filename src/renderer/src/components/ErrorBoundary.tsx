import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
  reference: string
}

/**
 * Catches renderer crashes so a broken screen never leaves a blank window. The user gets a readable
 * message, a reference id, and the option to reload or copy the details for support.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, reference: '' }

  static getDerivedStateFromError(error: Error): State {
    return { error, reference: `UI-${Math.random().toString(16).slice(2, 8).toUpperCase()}` }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The renderer cannot write the main log file directly; the message is surfaced to the user instead.
    console.error('Renderer error boundary caught an error', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error, reference } = this.state
    if (!error) return this.props.children
    return (
      <div className="full-screen">
        <div className="auth-card auth-card--wide" role="alert">
          <h2>This screen could not be displayed</h2>
          <p>
            Dentiva Pro hit an unexpected problem while drawing this screen. Your saved data has not been
            changed. Reload the window to continue; if the problem repeats, share the reference below with
            support.
          </p>
          <p className="mono" style={{ fontSize: 'var(--text-sm)' }}>
            Reference: {reference}
          </p>
          <details>
            <summary>Technical detail</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--text-xs)' }}>{error.message}</pre>
          </details>
          <div className="toolbar">
            <button type="button" className="button button--primary" onClick={() => window.location.reload()}>
              Reload window
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                void navigator.clipboard?.writeText(`${reference}: ${error.message}`)
              }}
            >
              Copy details
            </button>
          </div>
        </div>
      </div>
    )
  }
}
