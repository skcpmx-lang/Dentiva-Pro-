/**
 * Shared UI primitives. Every screen is built from these so spacing, focus rings, loading and empty
 * states stay consistent; the styles live in `styles/design-system.css`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from 'react'
import { money as formatMoney } from '../lib/format'

// ---------------------------------------------------------------------------------------------
// Buttons and links
// ---------------------------------------------------------------------------------------------

export interface ButtonProps {
  children: ReactNode
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  type?: 'button' | 'submit' | 'reset'
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  title?: string
  block?: boolean
  ariaLabel?: string
  autoFocus?: boolean
}

export function Button({
  children,
  variant = 'default',
  size = 'md',
  type = 'button',
  onClick,
  disabled,
  loading,
  title,
  block,
  ariaLabel,
  autoFocus
}: ButtonProps): React.ReactElement {
  const classes = ['button']
  if (variant !== 'default') classes.push(`button--${variant}`)
  if (size !== 'md') classes.push(`button--${size}`)
  if (block) classes.push('button--block')
  return (
    <button
      type={type}
      className={classes.join(' ')}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      aria-label={ariaLabel}
      aria-busy={loading ?? false}
      autoFocus={autoFocus}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------------------------

interface FieldShellProps {
  label?: string
  required?: boolean
  hint?: string
  error?: string | null
  htmlFor?: string
  children: ReactNode
  full?: boolean
}

export function Field({
  label,
  required,
  hint,
  error,
  htmlFor,
  children,
  full
}: FieldShellProps): React.ReactElement {
  return (
    <div className={full ? 'field form-grid__full' : 'field'}>
      {label ? (
        <label className={`field__label${required ? ' field__label--required' : ''}`} htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint">{hint}</span>
      ) : null}
    </div>
  )
}

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label?: string
  hint?: string
  error?: string | null
  value: string
  onValueChange: (value: string) => void
  full?: boolean
}

export function TextInput({
  label,
  hint,
  error,
  value,
  onValueChange,
  full,
  required,
  type = 'text',
  ...rest
}: TextInputProps): React.ReactElement {
  const id = useId()
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={id} full={full}>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={Boolean(error)}
        required={required}
        {...rest}
      />
    </Field>
  )
}

export interface MoneyInputProps {
  label?: string
  hint?: string
  error?: string | null
  value: string
  onValueChange: (value: string) => void
  required?: boolean
  disabled?: boolean
  full?: boolean
  placeholder?: string
}

/** Money input: keeps a free-text string so the user can type "1,250.50" while editing. */
export function MoneyInput({
  label,
  hint,
  error,
  value,
  onValueChange,
  required,
  disabled,
  full,
  placeholder
}: MoneyInputProps): React.ReactElement {
  const id = useId()
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={id} full={full}>
      <input
        id={id}
        className="input--numeric"
        inputMode="decimal"
        value={value}
        placeholder={placeholder ?? '0.00'}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={Boolean(error)}
        disabled={disabled}
        required={required}
      />
    </Field>
  )
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  label?: string
  hint?: string
  error?: string | null
  value: string
  onValueChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  full?: boolean
}

export function Select({
  label,
  hint,
  error,
  value,
  onValueChange,
  options,
  placeholder,
  full,
  required,
  ...rest
}: SelectProps): React.ReactElement {
  const id = useId()
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={id} full={full}>
      <select
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={Boolean(error)}
        required={required}
        {...rest}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export interface TextAreaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'onChange' | 'value'
> {
  label?: string
  hint?: string
  error?: string | null
  value: string
  onValueChange: (value: string) => void
  full?: boolean
  rows?: number
}

export function TextArea({
  label,
  hint,
  error,
  value,
  onValueChange,
  full,
  rows = 4,
  ...rest
}: TextAreaProps): React.ReactElement {
  const id = useId()
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id} full={full}>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={Boolean(error)}
        {...rest}
      />
    </Field>
  )
}

export function Checkbox({
  label,
  checked,
  onCheckedChange,
  disabled,
  hint
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  hint?: string
}): React.ReactElement {
  const id = useId()
  return (
    <div className="field">
      <label className="checkbox" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
        {label}
      </label>
      {hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  )
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
}): React.ReactElement {
  return (
    <div className="segmented" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function SearchInput({
  value,
  onValueChange,
  placeholder,
  autoFocus,
  onKeyDown,
  className
}: {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
  className?: string
}): React.ReactElement {
  return (
    <div className={className} style={{ width: '100%' }}>
      <input
        type="search"
        value={value}
        placeholder={placeholder ?? 'Search…'}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        aria-label={placeholder ?? 'Search'}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Layout blocks
// ---------------------------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}): React.ReactElement {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  )
}

export function Card({
  title,
  actions,
  children,
  footer,
  flush
}: {
  title?: string
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
  flush?: boolean
}): React.ReactElement {
  return (
    <section className="card">
      {title || actions ? (
        <div className="card__header">
          {title ? <h3>{title}</h3> : null}
          {actions ? <div className="card__header-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? 'card__body card__body--flush' : 'card__body'}>{children}</div>
      {footer ? <div className="card__footer">{footer}</div> : null}
    </section>
  )
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  onClick
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'brand'
  onClick?: () => void
}): React.ReactElement {
  const classes = ['stat-card']
  if (tone === 'brand') classes.push('stat-card--brand')
  const content = (
    <>
      <span className="stat-card__label">{label}</span>
      <span className="stat-card__value">{value}</span>
      {hint ? <span className="stat-card__hint">{hint}</span> : null}
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        className={classes.join(' ')}
        onClick={onClick}
        style={{ textAlign: 'left', cursor: 'pointer' }}
      >
        {content}
      </button>
    )
  }
  return <div className={classes.join(' ')}>{content}</div>
}

export function Badge({
  children,
  tone = 'neutral'
}: {
  children: ReactNode
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'
}): React.ReactElement {
  return <span className={tone === 'neutral' ? 'badge' : `badge badge--${tone}`}>{children}</span>
}

export function EmptyState({
  title,
  description,
  action
}: {
  title: string
  description?: string
  action?: ReactNode
}): React.ReactElement {
  return (
    <div className="empty-state">
      <div className="empty-state__icon" aria-hidden="true">
        ∅
      </div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  )
}

export function LoadingState({ label = 'Loading…' }: { label?: string }): React.ReactElement {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function ErrorState({
  message,
  onRetry,
  title = 'Something went wrong'
}: {
  message: string
  onRetry?: () => void
  title?: string
}): React.ReactElement {
  return (
    <div className="error-state" role="alert">
      <div className="error-state__icon" aria-hidden="true">
        !
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
      {onRetry ? (
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; count?: number }[]
}): React.ReactElement {
  return (
    <div className="tabs" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          className="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count != null ? ` (${option.count})` : ''}
        </button>
      ))}
    </div>
  )
}

export interface Column<T> {
  key: string
  header: string
  align?: 'left' | 'right' | 'center'
  width?: string
  render: (row: T) => ReactNode
  sortable?: boolean
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  onRowClick,
  compact,
  footer,
  sortKey,
  sortDirection,
  onSort
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string | number
  loading?: boolean
  empty?: ReactNode
  onRowClick?: (row: T) => void
  compact?: boolean
  footer?: ReactNode
  sortKey?: string
  sortDirection?: 'asc' | 'desc'
  onSort?: (key: string) => void
}): React.ReactElement {
  if (loading && rows.length === 0) return <LoadingState />
  if (!loading && rows.length === 0) {
    return (
      <>
        {empty ?? (
          <EmptyState title="Nothing to show yet" description="Records will appear here once they exist." />
        )}
      </>
    )
  }
  return (
    <>
      <div className="table-wrapper">
        <table className={compact ? 'data-table data-table--compact' : 'data-table'}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={column.align === 'right' ? 'numeric' : undefined}
                  style={column.width ? { width: column.width } : undefined}
                  data-sortable={column.sortable ? 'true' : undefined}
                  aria-sort={
                    sortKey === column.key
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  onClick={column.sortable && onSort ? () => onSort(column.key) : undefined}
                >
                  {column.header}
                  {sortKey === column.key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} className={column.align === 'right' ? 'numeric' : undefined}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer}
    </>
  )
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
}): React.ReactElement | null {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  return (
    <div className="pagination">
      <span>
        {total.toLocaleString('en-US')} record{total === 1 ? '' : 's'} · page {page} of {pageCount}
      </span>
      {onPageSizeChange ? (
        <select
          aria-label="Rows per page"
          value={String(pageSize)}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          style={{ width: 'auto' }}
        >
          {[10, 25, 50, 100, 200].map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </select>
      ) : null}
      <Button size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
        Previous
      </Button>
      <Button size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}>
        Next
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------------------------

export function Modal({
  title,
  children,
  footer,
  onClose,
  size = 'md',
  closeOnBackdrop = true
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  size?: 'sm' | 'md' | 'lg'
  closeOnBackdrop?: boolean
}): React.ReactElement {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const sizeClass = size === 'lg' ? 'modal modal--wide' : size === 'sm' ? 'modal modal--narrow' : 'modal'
  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose()
      }}
    >
      <div className={sizeClass} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__header">
          <h3>{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose} ariaLabel="Close">
            ✕
          </Button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Drawer({
  title,
  children,
  onClose,
  footer
}: {
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
}): React.ReactElement {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__header">
          <h3>{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose} ariaLabel="Close">
            ✕
          </Button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </aside>
    </div>
  )
}

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  tone?: 'default' | 'danger'
  /** When set, the user must type this text exactly before the confirm button enables. */
  typeToConfirm?: string
  /** When true, the dialog also asks for the signed-in user's password. */
  requirePassword?: boolean
  onConfirm: (input: { confirmationPhrase: string; password: string }) => Promise<void> | void
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => void
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [pending, setPending] = useState<ConfirmOptions | null>(null)
  const [phrase, setPhrase] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = useCallback((options: ConfirmOptions) => {
    setPhrase('')
    setPassword('')
    setError(null)
    setPending(options)
  }, [])

  const value = useMemo(() => ({ confirm }), [confirm])
  const ready =
    (!pending?.typeToConfirm || phrase === pending.typeToConfirm) &&
    (!pending?.requirePassword || password.length > 0)

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending ? (
        <Modal
          title={pending.title}
          size="sm"
          onClose={() => setPending(null)}
          footer={
            <>
              <Button onClick={() => setPending(null)}>Cancel</Button>
              <Button
                variant={pending.tone === 'danger' ? 'danger' : 'primary'}
                disabled={!ready || busy}
                loading={busy}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    await pending.onConfirm({ confirmationPhrase: phrase, password })
                    setPending(null)
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : String(cause))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {pending.confirmLabel ?? 'Confirm'}
              </Button>
            </>
          }
        >
          <p>{pending.message}</p>
          {pending.typeToConfirm ? (
            <TextInput
              label={`Type "${pending.typeToConfirm}" to continue`}
              value={phrase}
              onValueChange={setPhrase}
              autoFocus
            />
          ) : null}
          {pending.requirePassword ? (
            <TextInput
              label="Your password"
              type="password"
              value={password}
              onValueChange={setPassword}
              autoComplete="current-password"
            />
          ) : null}
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmContextValue['confirm'] {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error('useConfirm must be used inside ConfirmProvider')
  return context.confirm
}

// ---------------------------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------------------------

export function Toaster({
  toasts,
  onDismiss
}: {
  toasts: { id: number; tone: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string }[]
  onDismiss: (id: number) => void
}): React.ReactElement | null {
  if (toasts.length === 0) return null
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <div style={{ flex: 1 }}>
            <strong>{toast.title}</strong>
            {toast.detail ? (
              <div style={{ fontSize: 'var(--text-xs)', opacity: 0.9 }}>{toast.detail}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss"
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

export function Money({ poisha, compact }: { poisha: number; compact?: boolean }): React.ReactElement {
  return <span className="numeric">{formatMoney(poisha, { compact })}</span>
}

export function DescriptionList({
  items
}: {
  items: { label: string; value: ReactNode }[]
}): React.ReactElement {
  return (
    <dl className="detail-list">
      {items.map((item) => (
        <div key={item.label} style={{ display: 'contents' }}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ProgressBar({
  value,
  max,
  label
}: {
  value: number
  max: number
  label?: string
}): React.ReactElement {
  const percent = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100))
  return (
    <div>
      {label ? (
        <div
          style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-500)', marginBottom: 4 } as CSSProperties}
        >
          {label}
        </div>
      ) : null}
      <div
        className="progress-bar"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-bar__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

/** Focus trap for modals/drawers: keeps Tab inside the overlay while it is open. */
export function useFocusTrap(active: boolean): (node: HTMLElement | null) => void {
  const ref = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!active || !ref.current) return
    const node = ref.current
    const selector =
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    const first = node.querySelector<HTMLElement>(selector)
    first?.focus()
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const focusable = Array.from(node.querySelectorAll<HTMLElement>(selector)).filter(
        (element) => element.offsetParent !== null
      )
      if (focusable.length === 0) return
      const firstElement = focusable[0]
      const lastElement = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }
    node.addEventListener('keydown', handler)
    return () => node.removeEventListener('keydown', handler)
  }, [active])
  return useCallback((node: HTMLElement | null) => {
    ref.current = node
  }, [])
}
