/**
 * Audit log: every recorded action with its actor, entity, before/after values and the hash-chain status.
 * The chain makes silent tampering detectable — the page re-checks it on demand.
 */

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileDown, RefreshCw, Search } from 'lucide-react'
import type { AuditQuery, AuditEntry } from '@shared/types'
import { invoke } from '../../lib/api'
import { useApp } from '../../app/state'
import {
  Badge,
  Button,
  Card,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pagination,
  Select,
  StatCard,
  TextInput
} from '../../components/ui'
import { usePagination, useQuery } from '../../lib/hooks'
import { formatTimestamp, titleCase } from '../../lib/format'
import { AUDIT_SEVERITIES } from '@shared/constants'
import type { AuditSeverity } from '@shared/constants'

export function AuditPage() {
  const app = useApp()
  const pagination = usePagination(50)
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [severity, setSeverity] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [detail, setDetail] = useState<AuditEntry | null>(null)
  const [busy, setBusy] = useState<'csv' | 'logs' | null>(null)

  const query: AuditQuery & { page: number; pageSize: number } = {
    page: pagination.page,
    pageSize: pagination.pageSize,
    search: search.trim() || null,
    action: action.trim() || null,
    severity: (severity || null) as AuditSeverity | null,
    from: from || null,
    to: to || null
  }

  const list = useQuery('audit.list', query, { deps: [JSON.stringify(query)] })
  const chain = useQuery('audit.chain', undefined)

  async function exportCsv(): Promise<void> {
    if (!app.hasPermission('audit.export')) {
      app.toast({
        tone: 'warning',
        title: 'Export not allowed',
        detail: 'Your role cannot export the audit log.'
      })
      return
    }
    setBusy('csv')
    try {
      const folder = await invoke('export.chooseFolder', { title: 'Choose a folder for the audit export' })
      if (!folder) return
      const result = await invoke('export.data', {
        entity: 'audit_log',
        format: 'csv',
        from: from || null,
        to: to || null,
        targetFolder: folder
      })
      app.toast({ tone: 'success', title: `Exported ${result.rowCount} entr(ies)`, detail: result.filePath })
    } catch (cause) {
      app.toast({
        tone: 'error',
        title: 'Export failed',
        detail: cause instanceof Error ? cause.message : String(cause)
      })
    } finally {
      setBusy(null)
    }
  }

  async function exportLogs(): Promise<void> {
    setBusy('logs')
    try {
      const path = await invoke('diagnostics.exportLogs', {
        title: 'Save the application log bundle',
        suggestedName: 'dentiva-logs'
      })
      if (path) app.toast({ tone: 'success', title: 'Log bundle saved', detail: path })
    } catch (cause) {
      app.toast({
        tone: 'error',
        title: 'Could not export the logs',
        detail: cause instanceof Error ? cause.message : String(cause)
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Who did what, when, and what changed"
        actions={
          <>
            <Button loading={busy === 'logs'} onClick={() => void exportLogs()}>
              <Download size={16} /> Application logs
            </Button>
            {app.hasPermission('audit.export') ? (
              <Button loading={busy === 'csv'} onClick={() => void exportCsv()}>
                <FileDown size={16} /> Export audit CSV
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => chain.reload()}>
              <RefreshCw size={16} /> Verify chain
            </Button>
          </>
        }
      />

      <div className="grid grid--kpi">
        <StatCard
          label="Entries"
          value={String(list.data?.total ?? 0)}
          hint="Matching the current filters"
          tone="brand"
        />
        <StatCard
          label="Chain status"
          value={chain.data ? (chain.data.valid ? 'Intact' : 'Broken') : '—'}
          hint={chain.data ? chain.data.message : 'Checking…'}
        />
        <StatCard
          label="Entries checked"
          value={chain.data ? String(chain.data.checkedEntries) : '—'}
          hint="Hash chain verification"
        />
        <StatCard
          label="First broken"
          value={chain.data?.firstBrokenId != null ? `#${chain.data.firstBrokenId}` : 'None'}
          hint="Report immediately if this is not “None”"
        />
      </div>

      {chain.data && !chain.data.valid ? (
        <Card>
          <div className="toolbar">
            <Badge tone="danger">
              <AlertTriangle size={12} /> The audit chain does not verify
            </Badge>
            <span>{chain.data.message}</span>
          </div>
          <p className="field__hint">
            This can happen after an interrupted write or an external edit of the database file. Take a
            backup, note the entry id, and contact support before making further changes.
          </p>
        </Card>
      ) : null}

      <Card>
        <div className="toolbar">
          <div className="toolbar__grow">
            <TextInput
              label="Search"
              value={search}
              onValueChange={(value) => {
                setSearch(value)
                pagination.reset()
              }}
              placeholder="Action, summary, user"
            />
          </div>
          <TextInput
            label="Action contains"
            value={action}
            onValueChange={(value) => {
              setAction(value)
              pagination.reset()
            }}
            placeholder="e.g. invoice"
          />
          <Select
            label="Severity"
            value={severity}
            onValueChange={(value) => {
              setSeverity(value)
              pagination.reset()
            }}
            options={AUDIT_SEVERITIES.map((entry) => ({ value: entry, label: titleCase(entry) }))}
            placeholder="All"
          />
          <TextInput label="From" type="date" value={from} onValueChange={setFrom} />
          <TextInput label="To" type="date" value={to} onValueChange={setTo} />
        </div>
      </Card>

      <Card flush>
        {list.loading ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : (
          <DataTable
            columns={[
              { key: 'at', header: 'When', render: (row: AuditEntry) => formatTimestamp(row.at) },
              { key: 'actor', header: 'User', render: (row) => row.actorUsername ?? 'system' },
              {
                key: 'action',
                header: 'Action',
                render: (row) => <span className="mono">{row.action}</span>
              },
              { key: 'summary', header: 'Summary', render: (row) => row.summary },
              {
                key: 'entity',
                header: 'Entity',
                render: (row) =>
                  row.entityType ? `${row.entityType}${row.entityId ? ` #${row.entityId}` : ''}` : '—'
              },
              {
                key: 'severity',
                header: 'Severity',
                render: (row) => (
                  <Badge
                    tone={
                      row.severity === 'critical'
                        ? 'danger'
                        : row.severity === 'warning'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {titleCase(row.severity)}
                  </Badge>
                )
              },
              {
                key: 'actions',
                header: '',
                render: (row: AuditEntry) => (
                  <Button size="sm" variant="ghost" onClick={() => setDetail(row)}>
                    Details
                  </Button>
                )
              }
            ]}
            rows={list.data?.rows ?? []}
            rowKey={(row) => row.id}
            empty={
              <EmptyState title="No audit entries match" description="Adjust the filters to see more." />
            }
            footer={
              list.data ? (
                <Pagination
                  page={pagination.page}
                  pageSize={pagination.pageSize}
                  total={list.data.total}
                  onPageChange={pagination.setPage}
                  onPageSizeChange={pagination.setPageSize}
                />
              ) : null
            }
          />
        )}
      </Card>

      {detail ? (
        <Drawer title={`Audit entry #${detail.id}`} onClose={() => setDetail(null)}>
          <dl className="detail-list">
            <dt>When</dt>
            <dd>{formatTimestamp(detail.at)}</dd>
            <dt>User</dt>
            <dd>
              {detail.actorUsername ?? 'system'}
              {detail.actorUserId ? ` (#${detail.actorUserId})` : ''}
            </dd>
            <dt>Action</dt>
            <dd className="mono">{detail.action}</dd>
            <dt>Summary</dt>
            <dd>{detail.summary}</dd>
            <dt>Entity</dt>
            <dd>
              {detail.entityType ?? '—'}
              {detail.entityId ? ` #${detail.entityId}` : ''}
            </dd>
            <dt>Severity</dt>
            <dd>{titleCase(detail.severity)}</dd>
            <dt>Application version</dt>
            <dd>{detail.appVersion}</dd>
            <dt>Hash</dt>
            <dd className="mono" style={{ wordBreak: 'break-all' }}>
              {detail.hash}
            </dd>
            <dt>Previous hash</dt>
            <dd className="mono" style={{ wordBreak: 'break-all' }}>
              {detail.prevHash ?? 'genesis'}
            </dd>
          </dl>

          {detail.beforeJson ? (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <strong>Before</strong>
              <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--text-xs)' }}>
                {pretty(detail.beforeJson)}
              </pre>
            </div>
          ) : null}
          {detail.afterJson ? (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <strong>After</strong>
              <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--text-xs)' }}>
                {pretty(detail.afterJson)}
              </pre>
            </div>
          ) : null}
        </Drawer>
      ) : null}

      <p className="field__hint">
        <Search size={12} style={{ verticalAlign: 'middle' }} />{' '}
        {chain.data?.valid ? <CheckCircle2 size={12} style={{ verticalAlign: 'middle' }} /> : null} Audit
        entries are written inside the same database transaction as the change they describe, so a change
        without an audit entry cannot be committed.
      </p>
    </>
  )
}

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}
