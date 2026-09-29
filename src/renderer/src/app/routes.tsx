/**
 * Navigation model.
 *
 * Each entry declares the route path, the sidebar group, the icon, and the permission needed to open the
 * screen. The sidebar and the router are generated from this table, so a screen can never be exposed
 * without also being listed (and vice versa).
 */

import type { PermissionCode } from '@shared/permissions'
import {
  BadgeDollarSign,
  BarChart3,
  Boxes,
  CalendarDays,
  ClipboardList,
  FileText,
  HelpCircle,
  History,
  LayoutDashboard,
  Pill,
  Receipt,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
  Wallet
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type SidebarGroup = 'Practice' | 'Clinical' | 'Billing' | 'Administration'

export interface RouteDefinition {
  path: string
  label: string
  group: SidebarGroup
  icon: LucideIcon
  /** Permission required to see the entry; `null` means visible to every signed-in user. */
  permission: PermissionCode | null
  /** Accepts any of these permissions instead of a single one. */
  anyOf?: PermissionCode[]
  subtitle: string
  /** Renders outside the standard shell (print windows). */
  standalone?: boolean
  hidden?: boolean
  /** Shortcut hint shown in the shortcuts panel. */
  shortcut?: string
}

export const ROUTES: RouteDefinition[] = [
  {
    path: '/dashboard',
    label: 'Dashboard',
    group: 'Practice',
    icon: LayoutDashboard,
    permission: 'dashboard.view',
    subtitle: 'Today at a glance',
    shortcut: 'Ctrl+1'
  },
  {
    path: '/patients',
    label: 'Patients',
    group: 'Practice',
    icon: Users,
    permission: 'patients.view',
    subtitle: 'Patient records, history and documents',
    shortcut: 'Ctrl+2'
  },
  {
    path: '/appointments',
    label: 'Appointments',
    group: 'Practice',
    icon: CalendarDays,
    permission: 'appointments.view',
    subtitle: 'Bookings, reminders and status',
    shortcut: 'Ctrl+3'
  },
  {
    path: '/queue',
    label: 'Queue',
    group: 'Practice',
    icon: ClipboardList,
    permission: 'queue.view',
    subtitle: 'Who is waiting right now',
    shortcut: 'Ctrl+4'
  },
  {
    path: '/prescriptions',
    label: 'Prescriptions',
    group: 'Clinical',
    icon: Pill,
    permission: 'prescriptions.view',
    subtitle: 'Prescribe, print and reprint'
  },
  {
    path: '/treatments',
    label: 'Treatment catalog',
    group: 'Clinical',
    icon: FileText,
    permission: 'treatments.view',
    subtitle: 'Prices, categories and clinical options'
  },
  {
    path: '/invoices',
    label: 'Invoices',
    group: 'Billing',
    icon: Receipt,
    permission: 'invoices.view',
    subtitle: 'Billing, printing and dues'
  },
  {
    path: '/payments',
    label: 'Payments',
    group: 'Billing',
    icon: Wallet,
    permission: 'payments.view',
    subtitle: 'Cash, bKash, Nagad, card and bank receipts'
  },
  {
    path: '/inventory',
    label: 'Inventory',
    group: 'Billing',
    icon: Boxes,
    permission: 'inventory.view',
    subtitle: 'Stock, batches, expiry and suppliers'
  },
  {
    path: '/accounting',
    label: 'Accounting',
    group: 'Billing',
    icon: BadgeDollarSign,
    permission: 'accounting.view',
    subtitle: 'Expenses, cash flow and receivables'
  },
  {
    path: '/reports',
    label: 'Reports',
    group: 'Billing',
    icon: BarChart3,
    permission: 'reports.financial.view',
    subtitle: 'Financial and practice reports'
  },
  {
    path: '/staff',
    label: 'Staff & users',
    group: 'Administration',
    icon: UsersRound,
    permission: 'staff.view',
    anyOf: ['users.view'],
    subtitle: 'Dentists, employees, user accounts and roles'
  },
  {
    path: '/backups',
    label: 'Backup & restore',
    group: 'Administration',
    icon: ShieldCheck,
    permission: 'backup.create',
    anyOf: ['backup.restore'],
    subtitle: 'Verified backups and safe restore'
  },
  {
    path: '/audit',
    label: 'Audit log',
    group: 'Administration',
    icon: History,
    permission: 'audit.view',
    subtitle: 'Every change, who made it and when'
  },
  {
    path: '/settings',
    label: 'Settings',
    group: 'Administration',
    icon: Settings,
    permission: 'settings.view',
    subtitle: 'Clinic profile, printing, data and security'
  },
  {
    path: '/about',
    label: 'About & help',
    group: 'Administration',
    icon: HelpCircle,
    permission: null,
    subtitle: 'Version, diagnostics, licence and support'
  }
]

export const SIDEBAR_GROUPS: SidebarGroup[] = ['Practice', 'Clinical', 'Billing', 'Administration']

export function routeByPath(path: string): RouteDefinition | null {
  const clean = path.split('?')[0].replace(/\/$/, '') || '/dashboard'
  const direct = ROUTES.find((route) => route.path === clean)
  if (direct) return direct
  // Nested detail pages belong to their list screen (e.g. /patients/12 → /patients).
  const parent = ROUTES.filter((route) => clean.startsWith(`${route.path}/`)).sort(
    (a, b) => b.path.length - a.path.length
  )[0]
  return parent ?? null
}

export function canSeeRoute(
  route: RouteDefinition,
  has: (code: PermissionCode) => boolean,
  hasAny: (codes: readonly PermissionCode[]) => boolean
): boolean {
  if (route.permission === null) return true
  if (has(route.permission)) return true
  return route.anyOf ? hasAny(route.anyOf) : false
}
