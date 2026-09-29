/**
 * Premium application shell: header with global search, quick actions, notification centre and user menu;
 * collapsible grouped sidebar; status bar; command palette; notification drawer; toasts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  User,
  X
} from 'lucide-react'
import type { Notification, SearchResults } from '@shared/types'
import { invoke, errorMessage } from '../lib/api'
import { useApp } from './state'
import { BrandMark } from '../components/BrandMark'
import { ROUTES, SIDEBAR_GROUPS, canSeeRoute, routeByPath } from './routes'
import { Button, Drawer, EmptyState, LoadingState, Modal, Toaster } from '../components/ui'
import { formatDate, formatRelativeDate, notificationCategoryLabel, todayIso } from '../lib/format'
import { usePersistentState } from '../lib/hooks'

interface CommandItem {
  id: string
  label: string
  detail: string
  run: () => void
}

export function Shell() {
  const app = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = usePersistentState('dentiva.sidebarCollapsed', false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [queueCount, setQueueCount] = useState<number | null>(null)
  const [lastBackup, setLastBackup] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const has = app.hasPermission
  const hasAny = app.hasAnyPermission

  const visibleRoutes = useMemo(
    () => ROUTES.filter((route) => canSeeRoute(route, has, hasAny)),
    [has, hasAny]
  )
  const activeGroup = routeByPath(location.pathname)?.group ?? null

  const lock = useCallback(async () => {
    try {
      await invoke('auth.lock')
    } catch (error) {
      app.toast({ tone: 'error', title: 'Could not lock', detail: errorMessage(error) })
    }
  }, [app])

  const signOut = useCallback(async () => {
    try {
      await invoke('auth.logout')
    } catch (error) {
      app.toast({ tone: 'error', title: 'Could not sign out', detail: errorMessage(error) })
    }
  }, [app])

  const runCommand = useCallback(
    (command: string): void => {
      switch (command) {
        case 'navigate:dashboard':
          navigate('/dashboard')
          break
        case 'navigate:patients':
          navigate('/patients')
          break
        case 'navigate:appointments':
          navigate('/appointments')
          break
        case 'navigate:queue':
          navigate('/queue')
          break
        case 'navigate:about':
          navigate('/about')
          break
        case 'action:lock':
          void lock()
          break
        case 'action:logout':
          void signOut()
          break
        case 'action:search':
          setPaletteOpen(true)
          break
        case 'action:new-patient':
          navigate('/patients?new=1')
          break
        case 'action:new-invoice':
          navigate('/invoices?new=1')
          break
        case 'action:backup':
          navigate('/backups?create=1')
          break
        case 'action:notifications':
          setNotificationsOpen(true)
          break
        case 'action:integrity':
          navigate('/settings?tab=data&integrity=1')
          break
        default:
          break
      }
    },
    [navigate, lock, signOut]
  )

  // Menu-driven commands from the main process.
  useEffect(() => {
    return window.dentiva.subscribe((event) => {
      if (event.type === 'command') runCommand(event.payload.command)
    })
  }, [runCommand])

  // Global keyboard shortcuts.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if (event.ctrlKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        void lock()
        return
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        navigate('/patients?new=1')
        return
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault()
        navigate('/invoices?new=1')
        return
      }
      if (event.ctrlKey && ['1', '2', '3', '4'].includes(event.key)) {
        const route = { '1': '/dashboard', '2': '/patients', '3': '/appointments', '4': '/queue' }[event.key]
        event.preventDefault()
        navigate(route as string)
        return
      }
      if (!typing && event.key === '?') {
        setShortcutsOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lock, navigate])

  // Shell badges: today's queue size and the most recent backup.
  useEffect(() => {
    if (app.session.state !== 'authenticated') return
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        if (has('queue.view')) {
          const snapshot = await invoke('queue.get', { date: todayIso() })
          if (!cancelled)
            setQueueCount(
              snapshot.entries.filter(
                (entry) =>
                  entry.status !== 'completed' && entry.status !== 'left' && entry.status !== 'cancelled'
              ).length
            )
        }
        if (has('backup.create')) {
          const backups = await invoke('backups.list')
          if (!cancelled) setLastBackup(backups[0]?.createdAt ?? null)
        }
      } catch {
        // Badges are cosmetic; the screens report real errors.
      }
    }
    void load()
    const interval = setInterval(() => void load(), 120_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [app.session.state, has, app.unread])

  // Command palette search.
  useEffect(() => {
    if (!paletteOpen) return
    const term = searchTerm.trim()
    if (term.length < 2) {
      setSearchResults(null)
      setSearchError(null)
      return
    }
    let cancelled = false
    setSearching(true)
    const handle = setTimeout(() => {
      invoke('search.global', { term, limit: 20 })
        .then((results) => {
          if (!cancelled) {
            setSearchResults(results)
            setSearchError(null)
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) setSearchError(errorMessage(error))
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [paletteOpen, searchTerm])

  const commandItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = visibleRoutes.map((route) => ({
      id: `nav:${route.path}`,
      label: route.label,
      detail: route.subtitle,
      run: () => navigate(route.path)
    }))
    if (has('patients.create')) {
      items.unshift({
        id: 'new:patient',
        label: 'Register a new patient',
        detail: 'Open the patient form',
        run: () => navigate('/patients?new=1')
      })
    }
    if (has('appointments.create')) {
      items.unshift({
        id: 'new:appointment',
        label: 'Book an appointment',
        detail: 'Open the appointment form',
        run: () => navigate('/appointments?new=1')
      })
    }
    if (has('invoices.create')) {
      items.unshift({
        id: 'new:invoice',
        label: 'Create an invoice',
        detail: 'Start billing',
        run: () => navigate('/invoices?new=1')
      })
    }
    return items
  }, [visibleRoutes, navigate, has])

  const filteredCommands = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (term.length === 0) return commandItems.slice(0, 8)
    return commandItems
      .filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(term))
      .slice(0, 8)
  }, [commandItems, searchTerm])

  const openSearchHit = useCallback(
    (hit: SearchResults['hits'][number]): void => {
      navigate(hit.route || '/dashboard')
      setPaletteOpen(false)
    },
    [navigate]
  )

  function notificationRoute(notification: Notification): string | null {
    if (!notification.entityType) return null
    const map: Record<string, string> = {
      appointment: '/appointments',
      invoice: '/invoices',
      patient: '/patients',
      prescription: '/prescriptions',
      inventory_item: '/inventory',
      backup: '/backups'
    }
    return map[notification.entityType] ?? null
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <BrandMark className="app-header__logo" />
          <span className="app-header__title">
            <strong>Dentiva Pro</strong>
            <span>{app.clinic?.name ?? 'Dental clinic'}</span>
          </span>
        </div>

        <div className="app-header__search">
          <input
            ref={searchInputRef}
            type="search"
            value={searchTerm}
            placeholder="Search patients, invoices, prescriptions…  (Ctrl+K)"
            aria-label="Global search"
            onFocus={() => setPaletteOpen(true)}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div className="app-header__actions">
          {has('patients.create') ? (
            <button
              type="button"
              className="header-button"
              onClick={() => navigate('/patients?new=1')}
              title="New patient (Ctrl+Shift+P)"
            >
              <Plus size={16} /> <span className="hide-narrow">Patient</span>
            </button>
          ) : null}
          {has('appointments.create') ? (
            <button
              type="button"
              className="header-button"
              onClick={() => navigate('/appointments?new=1')}
              title="New appointment"
            >
              <Plus size={16} /> <span className="hide-narrow">Appointment</span>
            </button>
          ) : null}
          {has('invoices.create') ? (
            <button
              type="button"
              className="header-button"
              onClick={() => navigate('/invoices?new=1')}
              title="New invoice (Ctrl+Shift+I)"
            >
              <Plus size={16} /> <span className="hide-narrow">Invoice</span>
            </button>
          ) : null}
          <span className="hide-narrow" style={{ fontSize: 'var(--text-sm)', opacity: 0.85 }}>
            {formatDate(todayIso())}
          </span>
          <button
            type="button"
            className="header-button header-button--icon"
            onClick={() => setNotificationsOpen(true)}
            title="Notifications"
            aria-label={`Notifications${app.unread > 0 ? ` (${app.unread} unread)` : ''}`}
          >
            <Bell size={18} />
            {app.unread > 0 ? (
              <span className="header-button__badge">{app.unread > 99 ? '99+' : app.unread}</span>
            ) : null}
          </button>
          <button
            type="button"
            className="header-button header-button--icon"
            onClick={() => void lock()}
            title="Lock now (Ctrl+L)"
            aria-label="Lock now"
          >
            <Lock size={18} />
          </button>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="header-button"
              onClick={() => setUserMenuOpen((open) => !open)}
              aria-expanded={userMenuOpen}
            >
              <User size={16} />
              <span className="hide-narrow">
                {app.session.user?.displayName ?? app.session.user?.username ?? 'User'}
              </span>
            </button>
            {userMenuOpen ? (
              <div
                className="card"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 42,
                  width: 260,
                  zIndex: 40,
                  padding: 'var(--space-2)'
                }}
                role="menu"
              >
                <div style={{ padding: 'var(--space-2) var(--space-3)' }}>
                  <strong>{app.session.user?.displayName}</strong>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-500)' }}>
                    {app.session.user?.roleName} · @{app.session.user?.username}
                  </div>
                  {app.session.user?.lastLoginAt ? (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-400)' }}>
                      Last sign-in {formatRelativeDate(app.session.user.lastLoginAt.slice(0, 10))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="nav-item"
                  onClick={() => {
                    setUserMenuOpen(false)
                    navigate('/staff?tab=account')
                  }}
                >
                  <span className="nav-item__icon">
                    <User size={16} />
                  </span>{' '}
                  My account
                </button>
                <button
                  type="button"
                  className="nav-item"
                  onClick={() => {
                    setUserMenuOpen(false)
                    void lock()
                  }}
                >
                  <span className="nav-item__icon">
                    <Lock size={16} />
                  </span>{' '}
                  Lock now
                </button>
                <button
                  type="button"
                  className="nav-item"
                  onClick={() => {
                    setUserMenuOpen(false)
                    void signOut()
                  }}
                >
                  <span className="nav-item__icon">
                    <LogOut size={16} />
                  </span>{' '}
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className={collapsed ? 'app-body app-body--collapsed' : 'app-body'}>
        <nav className="app-sidebar" aria-label="Main navigation">
          {SIDEBAR_GROUPS.map((group) => {
            const routes = visibleRoutes.filter((route) => route.group === group)
            if (routes.length === 0) return null
            return (
              <div key={group}>
                <div
                  className="app-sidebar__group-label"
                  data-active={activeGroup === group ? 'true' : undefined}
                >
                  {group}
                </div>
                {routes.map((route) => {
                  const Icon = route.icon
                  const badge =
                    route.path === '/queue' && queueCount != null && queueCount > 0 ? queueCount : null
                  return (
                    <NavLink
                      key={route.path}
                      to={route.path}
                      className={({ isActive }) => (isActive ? 'nav-item nav-item--active' : 'nav-item')}
                      title={collapsed ? route.label : route.subtitle}
                    >
                      <span className="nav-item__icon" aria-hidden="true">
                        <Icon size={18} />
                      </span>
                      <span className="nav-item__label">{route.label}</span>
                      {badge != null ? <span className="nav-item__count">{badge}</span> : null}
                    </NavLink>
                  )
                })}
              </div>
            )
          })}
          <div style={{ marginTop: 'auto', padding: 'var(--space-2)' }}>
            <button
              type="button"
              className="nav-item"
              onClick={() => setCollapsed(!collapsed)}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <span className="nav-item__icon">
                {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              </span>
              <span className="nav-item__label">Collapse</span>
            </button>
          </div>
        </nav>

        <main className="app-content">
          <div className="app-content__inner">
            <Outlet />
          </div>
        </main>
      </div>

      <footer
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          padding: '4px var(--space-5)',
          borderTop: '1px solid var(--ink-200)',
          background: 'var(--surface)',
          fontSize: 'var(--text-xs)',
          color: 'var(--ink-500)'
        }}
      >
        <span>
          <ShieldCheck size={12} style={{ verticalAlign: 'middle' }} /> {app.clinic?.name ?? 'Clinic'}
        </span>
        <span>
          Signed in: {app.session.user?.displayName ?? '—'} ({app.session.user?.roleName ?? '—'})
        </span>
        {queueCount != null ? <span>In queue now: {queueCount}</span> : null}
        {lastBackup ? (
          <span>Last backup: {formatRelativeDate(lastBackup.slice(0, 10))}</span>
        ) : (
          <span>Last backup: none yet</span>
        )}
        <span style={{ marginLeft: 'auto' }}>
          Dentiva Pro {app.setup?.appVersion ?? '—'} (build {app.setup?.buildNumber ?? '—'}) ·{' '}
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => setShortcutsOpen(true)}
          >
            Shortcuts (?)
          </button>
        </span>
      </footer>

      <Toaster toasts={app.toasts} onDismiss={app.dismissToast} />

      {notificationsOpen ? (
        <Drawer
          title="Notifications"
          onClose={() => setNotificationsOpen(false)}
          footer={
            <>
              <Button size="sm" onClick={() => void app.refreshNotifications()}>
                <RefreshCw size={14} /> Refresh
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => void app.markAllNotificationsRead()}
                disabled={app.unread === 0}
              >
                Mark all read
              </Button>
            </>
          }
        >
          {app.notifications.length === 0 ? (
            <EmptyState
              title="No notifications"
              description="Appointment reminders, low stock and overdue payments appear here."
            />
          ) : (
            <div className="notification-list">
              {app.notifications.map((notification) => {
                const route = notificationRoute(notification)
                return (
                  <div
                    key={notification.id}
                    className={
                      notification.readAt
                        ? 'notification-item'
                        : 'notification-item notification-item--unread'
                    }
                    onClick={() => {
                      if (!notification.readAt) void app.markNotificationRead(notification.id)
                      if (route) {
                        setNotificationsOpen(false)
                        navigate(route)
                      }
                    }}
                  >
                    <span
                      className={`notification-item__priority notification-item__priority--${notification.priority}`}
                      aria-hidden="true"
                    />
                    <span className="notification-item__body">
                      <strong>{notification.title}</strong>
                      {notification.body ? <span>{notification.body}</span> : null}
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-400)' }}>
                        {notificationCategoryLabel(notification.category)}
                      </span>
                    </span>
                    <span className="notification-item__time">
                      {formatRelativeDate(notification.createdAt.slice(0, 10))}
                    </span>
                    {has('notifications.manage') ? (
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        aria-label="Dismiss notification"
                        onClick={(event) => {
                          event.stopPropagation()
                          void app.dismissNotification(notification.id)
                        }}
                      >
                        <X size={14} />
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </Drawer>
      ) : null}

      {paletteOpen ? (
        <div
          className="overlay"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && setPaletteOpen(false)}
        >
          <div className="command-palette" role="dialog" aria-label="Search and commands">
            <input
              className="command-palette__input"
              aria-label="Search patients, invoices, prescriptions and commands"
              value={searchTerm}
              autoFocus
              placeholder="Search patients, invoices, prescriptions or type a command…"
              onChange={(event) => setSearchTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setPaletteOpen(false)
                if (event.key === 'Enter' && searchResults && searchResults.hits.length > 0) {
                  openSearchHit(searchResults.hits[0])
                }
              }}
            />
            <div className="command-palette__results">
              {searching ? <LoadingState label="Searching…" /> : null}
              {searchError ? <p className="field__error">{searchError}</p> : null}
              {searchResults && searchResults.hits.length > 0 ? (
                <>
                  <div className="command-palette__group-label">Records</div>
                  {searchResults.hits.map((hit) => (
                    <div
                      key={`${hit.entityType}-${hit.entityId}`}
                      className="command-palette__item"
                      onClick={() => openSearchHit(hit)}
                    >
                      <strong>{hit.title}</strong>
                      <span>{[hit.subtitle, hit.meta].filter(Boolean).join(' · ') || hit.entityType}</span>
                    </div>
                  ))}
                </>
              ) : null}
              {filteredCommands.length > 0 ? (
                <>
                  <div className="command-palette__group-label">
                    {searchTerm.trim() ? 'Actions' : 'Quick actions'}
                  </div>
                  {filteredCommands.map((item) => (
                    <div
                      key={item.id}
                      className="command-palette__item"
                      onClick={() => {
                        item.run()
                        setPaletteOpen(false)
                        setSearchTerm('')
                      }}
                    >
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </div>
                  ))}
                </>
              ) : null}
              {!searching &&
              (!searchResults || searchResults.hits.length === 0) &&
              filteredCommands.length === 0 ? (
                <EmptyState
                  title="Nothing found"
                  description="Try a patient code, name, phone number, invoice number or medicine."
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {shortcutsOpen ? (
        <Modal title="Keyboard shortcuts" size="md" onClose={() => setShortcutsOpen(false)}>
          <div className="detail-list">
            {[
              ['Ctrl + K', 'Global search and commands'],
              ['Ctrl + L', 'Lock the application'],
              ['Ctrl + 1…4', 'Dashboard, Patients, Appointments, Queue'],
              ['Ctrl + Shift + P', 'Register a new patient'],
              ['Ctrl + Shift + I', 'Create an invoice'],
              ['Ctrl + Shift + N', 'Open notifications'],
              ['Ctrl + Shift + B', 'Create a backup'],
              ['Ctrl + S', 'Save the open form'],
              ['Esc', 'Close the open dialog'],
              ['?', 'Show this panel']
            ].map(([keys, description]) => (
              <div key={keys} style={{ display: 'contents' }}>
                <dt className="mono">{keys}</dt>
                <dd>{description}</dd>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
