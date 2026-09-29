/**
 * Application root: providers, first-run gates, hash router and the route table.
 *
 * The router runs on hash history so a print window can be opened with a plain `#/print/{jobId}` URL and
 * the packaged app can be served from `file://` without server rewrites.
 */

import { Navigate, Route, HashRouter, Routes } from 'react-router-dom'
import type { ComponentType } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { AppStateProvider, useApp } from './state'
import { ConfirmProvider, Button, Card, ErrorState, LoadingState } from '../components/ui'
import { invoke } from '../lib/api'
import { Shell } from './Shell'
import { ROUTES, canSeeRoute } from './routes'
import type { RouteDefinition } from './routes'
import { LoginScreen } from '../features/auth/LoginScreen'
import { LockScreen } from '../features/auth/LockScreen'
import { SetupWizard } from '../features/setup/SetupWizard'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { PatientsPage } from '../features/patients/PatientsPage'
import { PatientDetailPage } from '../features/patients/PatientDetailPage'
import { AppointmentsPage } from '../features/appointments/AppointmentsPage'
import { QueuePage } from '../features/queue/QueuePage'
import { PrescriptionsPage } from '../features/prescriptions/PrescriptionsPage'
import { TreatmentsPage } from '../features/treatments/TreatmentsPage'
import { InvoicesPage } from '../features/invoices/InvoicesPage'
import { PaymentsPage } from '../features/payments/PaymentsPage'
import { InventoryPage } from '../features/inventory/InventoryPage'
import { AccountingPage } from '../features/accounting/AccountingPage'
import { ReportsPage } from '../features/reports/ReportsPage'
import { StaffPage } from '../features/staff/StaffPage'
import { BackupsPage } from '../features/backups/BackupsPage'
import { AuditPage } from '../features/audit/AuditPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { AboutPage } from '../features/about/AboutPage'
import { PrintPage } from '../features/print/PrintPage'

/** Extra routes that are not top-level sidebar entries. */
const DETAIL_ROUTES: {
  path: string
  permission: RouteDefinition['permission']
  anyOf?: RouteDefinition['anyOf']
  component: ComponentType
}[] = [
  { path: '/patients/:id', permission: 'patients.view', component: PatientDetailPage },
  { path: '/visits/:id', permission: 'patients.view', component: PatientDetailPage },
  { path: '/invoices/:id', permission: 'invoices.view', component: InvoicesPage },
  { path: '/prescriptions/:id', permission: 'prescriptions.view', component: PrescriptionsPage }
]

const SCREENS: Record<string, ComponentType> = {
  '/dashboard': DashboardPage,
  '/patients': PatientsPage,
  '/appointments': AppointmentsPage,
  '/queue': QueuePage,
  '/prescriptions': PrescriptionsPage,
  '/treatments': TreatmentsPage,
  '/invoices': InvoicesPage,
  '/payments': PaymentsPage,
  '/inventory': InventoryPage,
  '/accounting': AccountingPage,
  '/reports': ReportsPage,
  '/staff': StaffPage,
  '/backups': BackupsPage,
  '/audit': AuditPage,
  '/settings': SettingsPage,
  '/about': AboutPage
}

function NoPermissionScreen() {
  const app = useApp()
  return (
    <div style={{ padding: 'var(--space-8)', maxWidth: 720, margin: '0 auto' }}>
      <Card title="No modules are available for this account">
        <p>
          {app.session.user?.displayName ?? 'This account'} ({app.session.user?.roleName ?? 'no role'}) does
          not have access to any screen yet. An administrator can grant access under Administration → Staff
          &amp; users.
        </p>
        <Button onClick={() => void invoke('auth.logout')}>Sign out</Button>
      </Card>
    </div>
  )
}

function Guarded({ definition }: { definition: RouteDefinition }) {
  const app = useApp()
  if (!canSeeRoute(definition, app.hasPermission, app.hasAnyPermission)) return <NoPermissionScreen />
  const Screen = SCREENS[definition.path]
  return Screen ? <Screen /> : <NoPermissionScreen />
}

function useLandingPath(): string {
  const app = useApp()
  const visible = ROUTES.filter((route) => canSeeRoute(route, app.hasPermission, app.hasAnyPermission))
  return visible[0]?.path ?? '/about'
}

function AppRoutes() {
  const app = useApp()
  const landing = useLandingPath()

  return (
    <Routes>
      <Route path="/print/:jobId" element={<PrintPage />} />
      <Route element={<Shell />}>
        <Route index element={<Navigate to={landing} replace />} />
        {ROUTES.map((definition) => (
          <Route key={definition.path} path={definition.path} element={<Guarded definition={definition} />} />
        ))}
        {DETAIL_ROUTES.filter(
          (route) =>
            route.permission === null ||
            app.hasPermission(route.permission) ||
            (route.anyOf ?? []).some((code) => app.hasPermission(code))
        ).map((route) => (
          <Route key={route.path} path={route.path} element={<route.component />} />
        ))}
        <Route path="*" element={<Navigate to={landing} replace />} />
      </Route>
    </Routes>
  )
}

function Gate() {
  const app = useApp()

  if (!app.ready) {
    return (
      <div className="full-screen">
        <LoadingState label="Starting Dentiva Pro…" />
      </div>
    )
  }

  if (app.bootstrapError) {
    return (
      <div className="full-screen">
        <Card title="The application could not start">
          <ErrorState
            message={app.bootstrapError}
            onRetry={() => {
              window.location.reload()
            }}
          />
        </Card>
      </div>
    )
  }

  if (app.setup?.setupRequired || app.setup?.activationRequired) return <SetupWizard />
  if (app.session.state === 'unauthenticated') return <LoginScreen />
  if (app.session.state === 'locked') return <LockScreen />

  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppStateProvider>
        <ConfirmProvider>
          <Gate />
        </ConfirmProvider>
      </AppStateProvider>
    </ErrorBoundary>
  )
}
