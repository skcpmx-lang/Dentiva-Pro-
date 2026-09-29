/**
 * Application state: session, settings, clinic profile, notifications and toasts.
 *
 * The main process owns the session; this provider mirrors its snapshot, keeps the settings cache in
 * sync, and exposes permission helpers that screens use only to show/hide affordances. Every privileged
 * call is re-checked in the main process.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type {
  ClinicProfile,
  Notification,
  SessionSnapshot,
  SettingsSnapshot,
  SetupStatus
} from '@shared/types'
import type { AppSettingsShape } from '@shared/constants'
import type { AppEvent } from '@shared/ipc'
import type { PermissionCode } from '@shared/permissions'
import { errorMessage, invoke, subscribe } from '../lib/api'

export interface ToastEntry {
  id: number
  tone: 'info' | 'success' | 'warning' | 'error'
  title: string
  detail?: string
}

interface AppStateValue {
  ready: boolean
  bootstrapError: string | null
  setup: SetupStatus | null
  session: SessionSnapshot
  settings: AppSettingsShape | null
  clinic: ClinicProfile | null
  notifications: Notification[]
  unread: number
  toasts: ToastEntry[]
  hasPermission: (code: PermissionCode) => boolean
  hasAnyPermission: (codes: readonly PermissionCode[]) => boolean
  canLock: boolean
  reloadBootstrap: () => Promise<void>
  refreshSession: () => Promise<void>
  refreshSettings: () => Promise<void>
  refreshNotifications: () => Promise<void>
  markNotificationRead: (id: number) => Promise<void>
  markAllNotificationsRead: () => Promise<void>
  dismissNotification: (id: number) => Promise<void>
  toast: (entry: Omit<ToastEntry, 'id'>) => void
  dismissToast: (id: number) => void
}

const EMPTY_SESSION: SessionSnapshot = {
  state: 'unauthenticated',
  user: null,
  permissions: [],
  autoLockMinutes: 10,
  activatedAt: null
}

const AppStateContext = createContext<AppStateValue | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [setup, setSetup] = useState<SetupStatus | null>(null)
  const [session, setSession] = useState<SessionSnapshot>(EMPTY_SESSION)
  const [settings, setSettings] = useState<AppSettingsShape | null>(null)
  const [clinic, setClinic] = useState<ClinicProfile | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const toastId = useRef(1)

  const toast = useCallback((entry: Omit<ToastEntry, 'id'>) => {
    const id = toastId.current++
    setToasts((current) => [...current, { ...entry, id }])
    const ttl = entry.tone === 'error' ? 12000 : entry.tone === 'warning' ? 9000 : 4500
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), ttl)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id))
  }, [])

  const refreshSession = useCallback(async (): Promise<void> => {
    const snapshot = await invoke('session.snapshot')
    setSession(snapshot)
  }, [])

  const refreshSettings = useCallback(async (): Promise<void> => {
    try {
      const snapshot: SettingsSnapshot = await invoke('settings.snapshot')
      setSettings(snapshot.settings)
      setClinic(snapshot.clinic)
    } catch {
      // Settings need a session; ignore while signed out.
    }
  }, [])

  const refreshNotifications = useCallback(async (): Promise<void> => {
    try {
      const [list, count] = await Promise.all([
        invoke('notifications.list', { onlyUnread: false, limit: 60 }),
        invoke('notifications.count')
      ])
      setNotifications(list)
      setUnread(count.unread)
    } catch {
      // Notifications need a session.
    }
  }, [])

  const markNotificationRead = useCallback(async (id: number): Promise<void> => {
    await invoke('notifications.markRead', { id })
    setNotifications((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, readAt: entry.readAt ?? new Date().toISOString() } : entry
      )
    )
    setUnread((count) => Math.max(0, count - 1))
  }, [])

  const markAllNotificationsRead = useCallback(async (): Promise<void> => {
    await invoke('notifications.markAllRead')
    setNotifications((current) =>
      current.map((entry) => ({ ...entry, readAt: entry.readAt ?? new Date().toISOString() }))
    )
    setUnread(0)
  }, [])

  const dismissNotification = useCallback(async (id: number): Promise<void> => {
    await invoke('notifications.dismiss', { id })
    setNotifications((current) => current.filter((entry) => entry.id !== id))
  }, [])

  const reloadBootstrap = useCallback(async (): Promise<void> => {
    const [status, snapshot] = await Promise.all([invoke('setup.status'), invoke('session.snapshot')])
    setSetup(status)
    setSession(snapshot)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([invoke('setup.status'), invoke('session.snapshot')])
      .then(([status, snapshot]) => {
        if (cancelled) return
        setSetup(status)
        setSession(snapshot)
        setReady(true)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setBootstrapError(errorMessage(error, 'The application could not start.'))
        setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return subscribe((event: AppEvent) => {
      if (event.type === 'session:changed') setSession(event.payload)
      else if (event.type === 'setup:changed') setSetup(event.payload)
      else if (event.type === 'notifications:changed') setUnread(event.payload.unread)
    })
  }, [])

  useEffect(() => {
    if (session.state !== 'authenticated') {
      setNotifications([])
      setUnread(0)
      return
    }
    void refreshSettings()
    void refreshNotifications()
    const handle = setInterval(() => {
      void invoke('auth.touch').catch(() => undefined)
    }, 120_000)
    return () => clearInterval(handle)
  }, [session.state, refreshSettings, refreshNotifications])

  const permissionSet = useMemo(() => new Set<string>(session.permissions), [session.permissions])

  const value = useMemo<AppStateValue>(
    () => ({
      ready,
      bootstrapError,
      setup,
      session,
      settings,
      clinic,
      notifications,
      unread,
      toasts,
      hasPermission: (code) => permissionSet.has(code),
      hasAnyPermission: (codes) => codes.some((code) => permissionSet.has(code)),
      canLock: session.state === 'authenticated',
      reloadBootstrap,
      refreshSession,
      refreshSettings,
      refreshNotifications,
      markNotificationRead,
      markAllNotificationsRead,
      dismissNotification,
      toast,
      dismissToast
    }),
    [
      ready,
      bootstrapError,
      setup,
      session,
      settings,
      clinic,
      notifications,
      unread,
      toasts,
      permissionSet,
      reloadBootstrap,
      refreshSession,
      refreshSettings,
      refreshNotifications,
      markNotificationRead,
      markAllNotificationsRead,
      dismissNotification,
      toast,
      dismissToast
    ]
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useApp(): AppStateValue {
  const context = useContext(AppStateContext)
  if (!context) throw new Error('useApp must be used inside AppStateProvider')
  return context
}

export function usePermissions(): {
  has: (code: PermissionCode) => boolean
  hasAny: (codes: readonly PermissionCode[]) => boolean
} {
  const { hasPermission, hasAnyPermission } = useApp()
  return { has: hasPermission, hasAny: hasAnyPermission }
}
