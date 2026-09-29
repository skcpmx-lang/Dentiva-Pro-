/**
 * Dashboard: every number comes from the database through `dashboard.get`. No sample data, no invented
 * chart values — the trend chart plots the real collected/invoiced figures for the last 14 days.
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Boxes, CalendarClock, Clock, Users, Wallet } from 'lucide-react'
import { useApp } from '../../app/state'
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  PageHeader,
  StatCard
} from '../../components/ui'
import { useQuery } from '../../lib/hooks'
import {
  appointmentStatusLabel,
  formatDate,
  formatTime12h,
  money,
  quantityMilliText,
  statusTone
} from '../../lib/format'

import type { DashboardTrendPoint } from '@shared/types'

type TrendPoint = DashboardTrendPoint

function TrendChart({ points }: { points: TrendPoint[] }) {
  const { collectedPath, invoicedPath, maxValue, labels } = useMemo(() => {
    const width = 720
    const height = 220
    const padding = 16
    const values = points.flatMap((point) => [point.revenuePoisha, point.collectedPoisha])
    const max = Math.max(1, ...values)
    const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0
    const toPath = (selector: (point: TrendPoint) => number): string =>
      points
        .map((point, index) => {
          const x = padding + index * stepX
          const y = height - padding - (selector(point) / max) * (height - padding * 2)
          return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
        })
        .join(' ')
    return {
      collectedPath: toPath((point) => point.collectedPoisha),
      invoicedPath: toPath((point) => point.revenuePoisha),
      maxValue: max,
      labels: points.filter(
        (_, index) => index % Math.ceil(points.length / 6) === 0 || index === points.length - 1
      )
    }
  }, [points])

  if (points.length === 0) {
    return <EmptyState title="No activity yet" description="Invoices and payments will plot here." />
  }

  return (
    <div className="chart-card">
      <svg viewBox="0 0 720 220" role="img" aria-label="Revenue trend for the last 14 days">
        <defs>
          <linearGradient id="collectedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f6d80" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#0f6d80" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1="16" y1="204" x2="704" y2="204" stroke="#cbd5e1" strokeWidth="1" />
        <line x1="16" y1="16" x2="704" y2="16" stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 4" />
        <path d={`${invoicedPath} L 704 204 L 16 204 Z`} fill="url(#collectedFill)" opacity="0.35" />
        <path d={invoicedPath} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 4" />
        <path d={collectedPath} fill="none" stroke="#0f6d80" strokeWidth="2.5" />
        {points.map((point, index) => {
          const stepX = points.length > 1 ? (720 - 32) / (points.length - 1) : 0
          const x = 16 + index * stepX
          const y = 204 - (point.collectedPoisha / maxValue) * 188
          return <circle key={point.date} cx={x} cy={y} r="2.6" fill="#0f6d80" />
        })}
      </svg>
      <div className="chart-card__legend">
        <span className="legend-dot">Collected</span>
        <span>Peak day: {money(maxValue)}</span>
        <span>
          {labels.length > 0
            ? `${formatDate(labels[0].date)} → ${formatDate(labels[labels.length - 1].date)}`
            : ''}
        </span>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const app = useApp()
  const navigate = useNavigate()
  const query = useQuery('dashboard.get', undefined)

  if (query.loading) return <LoadingState label="Loading today's figures…" />
  if (query.error) return <ErrorState message={query.error} onRetry={query.reload} />
  const data = query.data
  if (!data)
    return <EmptyState title="No data yet" description="Register your first patient to see the dashboard." />

  const kpis = data.kpis
  const trendPoints: TrendPoint[] = data.revenueTrend

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${app.clinic?.name ?? 'Clinic'} · ${formatDate(kpis.date)}`}
        actions={
          <>
            <Button onClick={() => navigate('/queue')}>
              <Clock size={16} /> Queue ({kpis.queueWaiting})
            </Button>
            <Button variant="primary" onClick={() => navigate('/patients?new=1')}>
              <Users size={16} /> New patient
            </Button>
          </>
        }
      />

      <div className="grid grid--kpi">
        <StatCard
          label="Collected today"
          value={money(kpis.collectedTodayPoisha)}
          hint={`Invoiced ${money(kpis.revenueTodayPoisha)}`}
          tone="brand"
          onClick={() => navigate('/payments')}
        />
        <StatCard
          label="Outstanding dues"
          value={money(kpis.outstandingTotalPoisha)}
          hint="All unpaid balances"
          onClick={() => navigate('/invoices?status=unpaid')}
        />
        <StatCard
          label="Appointments today"
          value={`${kpis.appointmentsTotal}`}
          hint={`${kpis.appointmentsCompleted} done · ${kpis.appointmentsPending} pending · ${kpis.appointmentsUpcoming} upcoming`}
          onClick={() => navigate('/appointments')}
        />
        <StatCard
          label="In queue"
          value={`${kpis.queueWaiting + kpis.queueInTreatment}`}
          hint={`${kpis.queueWaiting} waiting · ${kpis.queueInTreatment} in treatment`}
          onClick={() => navigate('/queue')}
        />
        <StatCard
          label="Patients seen today"
          value={`${kpis.patientsSeenToday}`}
          hint={`${kpis.newPatientsToday} new patient(s)`}
          onClick={() => navigate('/patients')}
        />
        <StatCard
          label="Stock alerts"
          value={`${kpis.lowStockCount + kpis.expiringCount + kpis.expiredCount}`}
          hint={`${kpis.lowStockCount} low · ${kpis.expiringCount} expiring · ${kpis.expiredCount} expired`}
          onClick={() => navigate('/inventory')}
        />
      </div>

      <div className="grid grid--2">
        <Card
          title="Revenue — last 14 days"
          actions={
            <Button size="sm" onClick={() => navigate('/reports')}>
              Open reports
            </Button>
          }
        >
          <TrendChart points={trendPoints} />
        </Card>

        <Card
          title="Collected by payment method"
          actions={
            <Button size="sm" onClick={() => navigate('/payments')}>
              Payments
            </Button>
          }
        >
          {data.paymentMethods.length === 0 ? (
            <EmptyState
              title="No payments yet"
              description="Receipts broken down by method will appear here."
            />
          ) : (
            <DataTable
              columns={[
                { key: 'method', header: 'Method', render: (row) => row.methodName },
                { key: 'count', header: 'Receipts', align: 'right', render: (row) => row.count },
                {
                  key: 'total',
                  header: 'Amount',
                  align: 'right',
                  render: (row) => <Money poisha={row.totalPoisha} />
                }
              ]}
              rows={data.paymentMethods}
              rowKey={(row) => row.methodCode}
              compact
            />
          )}
        </Card>
      </div>

      <div className="grid grid--2">
        <Card
          title="Upcoming appointments"
          actions={
            <Button size="sm" onClick={() => navigate('/appointments')}>
              <CalendarClock size={14} /> All
            </Button>
          }
          flush
        >
          <DataTable
            columns={[
              {
                key: 'when',
                header: 'When',
                render: (row) => `${formatDate(row.appointmentDate)} · ${formatTime12h(row.startTime)}`
              },
              {
                key: 'patient',
                header: 'Patient',
                render: (row) => `${row.patientName} (${row.patientCode})`
              },
              { key: 'dentist', header: 'Dentist', render: (row) => row.dentistName ?? '—' },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <Badge tone={statusTone(row.status)}>{appointmentStatusLabel(row.status)}</Badge>
                )
              }
            ]}
            rows={data.upcomingAppointments}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="No upcoming appointments"
                description="Booked visits for the coming days appear here."
              />
            }
            compact
          />
        </Card>

        <Card
          title="Newest patients"
          actions={
            <Button size="sm" onClick={() => navigate('/patients')}>
              All patients
            </Button>
          }
          flush
        >
          <DataTable
            columns={[
              { key: 'code', header: 'Code', render: (row) => <span className="mono">{row.code}</span> },
              { key: 'name', header: 'Name', render: (row) => row.fullName },
              { key: 'phone', header: 'Phone', render: (row) => row.phone ?? '—' },
              {
                key: 'registered',
                header: 'Registered',
                render: (row) => formatDate(row.createdAt.slice(0, 10))
              }
            ]}
            rows={data.recentPatients}
            rowKey={(row) => row.id}
            onRowClick={(row) => navigate(`/patients/${row.id}`)}
            empty={
              <EmptyState title="No patients yet" description="Register the first patient to get started." />
            }
            compact
          />
        </Card>
      </div>

      <div className="grid grid--2">
        <Card
          title="Stock alerts"
          actions={
            <Button size="sm" onClick={() => navigate('/inventory')}>
              <Boxes size={14} /> Inventory
            </Button>
          }
          flush
        >
          {data.lowStockItems.length === 0 && data.expiringItems.length === 0 ? (
            <EmptyState
              title="Stock levels are healthy"
              description="Items below minimum stock or approaching expiry appear here."
            />
          ) : (
            <DataTable
              columns={[
                { key: 'item', header: 'Item', render: (row) => row.name },
                {
                  key: 'stock',
                  header: 'In stock',
                  align: 'right',
                  render: (row) => `${quantityMilliText(row.quantityMilli)} ${row.unit}`
                },
                {
                  key: 'min',
                  header: 'Minimum',
                  align: 'right',
                  render: (row) => quantityMilliText(row.minStockMilli)
                },
                {
                  key: 'flag',
                  header: 'Alert',
                  render: () => (
                    <Badge tone="warning">
                      <AlertTriangle size={12} /> Low stock
                    </Badge>
                  )
                }
              ]}
              rows={data.lowStockItems}
              rowKey={(row) => row.id}
              compact
            />
          )}
        </Card>

        <Card title="Recent activity" flush>
          <DataTable
            columns={[
              {
                key: 'at',
                header: 'When',
                render: (row) => `${formatDate(row.at.slice(0, 10))} ${row.at.slice(11, 16)}`
              },
              { key: 'actor', header: 'User', render: (row) => row.actorUsername ?? 'system' },
              { key: 'action', header: 'Action', render: (row) => row.action },
              { key: 'summary', header: 'Detail', render: (row) => row.summary }
            ]}
            rows={data.recentActivity}
            rowKey={(row) => row.id}
            empty={
              <EmptyState title="No recorded activity yet" description="Every change is recorded here." />
            }
            compact
          />
        </Card>
      </div>

      {data.widgets.length > 0 ? (
        <p className="field__hint">
          Widgets shown: {data.widgets.join(', ')} · adjust visibility in Settings → Dashboard.{' '}
          <Wallet size={12} style={{ verticalAlign: 'middle' }} />
        </p>
      ) : null}
    </>
  )
}
