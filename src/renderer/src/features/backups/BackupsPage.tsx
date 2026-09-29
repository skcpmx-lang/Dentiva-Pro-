/**
 * Backup & restore.
 *
 * Backups are real files with a manifest and checksums; verification re-hashes them. Restoring always takes
 * a pre-restore backup first, and the typed confirmation phrase plus the account password are required.
 */

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FolderOpen,
  HardDriveDownload,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import type { BackupInspection, BackupRecord } from '@shared/types'
import { invoke } from '../../lib/api'
import { useApp } from '../../app/state'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  ProgressBar,
  StatCard,
  TextArea,
  TextInput,
  useConfirm
} from '../../components/ui'
import { useAction, useQuery } from '../../lib/hooks'
import { filesize, formatDate, formatTimestamp } from '../../lib/format'

export function BackupsPage() {
  const app = useApp()
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [notes, setNotes] = useState('')
  const [verifyFolder, setVerifyFolder] = useState('')
  const [inspection, setInspection] = useState<BackupInspection | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null)
  const [restorePhrase, setRestorePhrase] = useState('')
  const [restorePassword, setRestorePassword] = useState('')
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ message: string; current: number; total: number } | null>(null)

  const list = useQuery('backups.list', undefined)
  const create = useAction(async (payload: { includeAttachments: boolean; notes: string | null }) =>
    invoke('backups.create', payload)
  )
  const verify = useAction(async (folderPath: string) => invoke('backups.verify', { folderPath }))
  const remove = useAction(async (id: number, deleteFiles: boolean) =>
    invoke('backups.delete', { id, deleteFiles })
  )
  const restore = useAction(
    async (payload: { folderPath: string; password: string; confirmationPhrase: string }) =>
      invoke('backups.restore', payload)
  )

  useEffect(() => {
    if (params.get('create') === '1' && app.hasPermission('backup.create')) {
      void runBackup()
      const next = new URLSearchParams(params)
      next.delete('create')
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  useEffect(() => {
    return window.dentiva.subscribe((event) => {
      if (event.type === 'job:progress') {
        setProgress({
          message: event.payload.message,
          current: event.payload.current,
          total: event.payload.total
        })
        if (event.payload.done) {
          window.setTimeout(() => setProgress(null), 1500)
        }
      }
    })
  }, [])

  async function runBackup(): Promise<void> {
    const result = await create.run({ includeAttachments, notes: notes.trim() || null })
    if (result.ok) {
      app.toast({
        tone: 'success',
        title: 'Backup completed',
        detail: `${result.value.fileName} · ${filesize(result.value.sizeBytes)}`
      })
      setNotes('')
      list.reload()
    } else {
      app.toast({ tone: 'error', title: 'Backup failed', detail: result.error })
    }
  }

  const backups = list.data ?? []
  const lastBackup = backups[0]
  const totalSize = backups.reduce((sum, backup) => sum + backup.sizeBytes, 0)

  return (
    <>
      <PageHeader
        title="Backup & restore"
        subtitle="Verified copies of your database, attachments and settings"
        actions={
          <>
            <Button onClick={() => void invoke('data.openBackupFolder').catch(() => undefined)}>
              <FolderOpen size={16} /> Open backup folder
            </Button>
            <Button onClick={() => list.reload()}>
              <RefreshCw size={16} /> Refresh
            </Button>
            {app.hasPermission('backup.create') ? (
              <Button variant="primary" loading={create.pending} onClick={() => void runBackup()}>
                <HardDriveDownload size={16} /> Back up now
              </Button>
            ) : null}
          </>
        }
      />

      {progress ? (
        <Card title="Working…">
          <ProgressBar value={progress.current} max={Math.max(1, progress.total)} label={progress.message} />
        </Card>
      ) : null}

      <div className="grid grid--kpi">
        <StatCard
          label="Backups stored"
          value={String(backups.length)}
          hint={`${filesize(totalSize)} in total`}
          tone="brand"
        />
        <StatCard
          label="Last backup"
          value={lastBackup ? formatDate(lastBackup.createdAt.slice(0, 10)) : '—'}
          hint={
            lastBackup
              ? `${lastBackup.trigger} · ${filesize(lastBackup.sizeBytes)}`
              : 'No backup has been taken yet'
          }
        />
        <StatCard
          label="Automatic backup"
          value={app.settings?.autoBackupEnabled ? 'On' : 'Off'}
          hint={`Every ${app.settings?.autoBackupIntervalDays ?? 7} day(s) at ${app.settings?.autoBackupTime ?? '21:00'}, keeping ${app.settings?.autoBackupRetention ?? 10}`}
        />
        <StatCard
          label="Verification"
          value={
            lastBackup?.status === 'verified'
              ? 'Verified'
              : lastBackup?.status === 'success'
                ? 'Not verified yet'
                : '—'
          }
          hint={
            lastBackup?.sha256
              ? `SHA-256 ${lastBackup.sha256.slice(0, 12)}…`
              : 'Checksums are stored with every backup'
          }
        />
      </div>

      <Card title="Create a backup">
        <div className="form-grid form-grid--wide">
          <Checkbox
            label="Include attachments (X-rays, scans and documents)"
            checked={includeAttachments}
            onCheckedChange={setIncludeAttachments}
            hint="A backup with attachments is larger but restores the complete record."
          />
          <TextArea
            label="Notes for this backup"
            rows={2}
            value={notes}
            onValueChange={setNotes}
            hint="Stored in the backup manifest."
            full
          />
        </div>
        <div className="toolbar">
          {app.hasPermission('backup.create') ? (
            <Button variant="primary" loading={create.pending} onClick={() => void runBackup()}>
              <HardDriveDownload size={16} /> Create backup now
            </Button>
          ) : (
            <p className="field__hint">
              Your role cannot create backups. An administrator can grant the “backup.create” permission.
            </p>
          )}
        </div>
      </Card>

      <Card title="Backup history" flush>
        {list.loading ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : (
          <DataTable
            columns={[
              {
                key: 'file',
                header: 'Backup',
                render: (row: BackupRecord) => <span className="mono">{row.fileName}</span>
              },
              { key: 'when', header: 'Taken', render: (row) => formatTimestamp(row.createdAt) },
              { key: 'by', header: 'By', render: (row) => row.createdBy ?? 'system' },
              {
                key: 'trigger',
                header: 'Trigger',
                render: (row) => (
                  <Badge
                    tone={row.trigger === 'manual' ? 'brand' : row.trigger === 'auto' ? 'info' : 'warning'}
                  >
                    {row.trigger.replace('_', ' ')}
                  </Badge>
                )
              },
              { key: 'size', header: 'Size', align: 'right', render: (row) => filesize(row.sizeBytes) },
              {
                key: 'attachments',
                header: 'Attachments',
                render: (row) => (row.includesAttachments ? 'Included' : 'No')
              },
              {
                key: 'version',
                header: 'Version',
                render: (row) => `${row.appVersion} · schema ${row.schemaVersion}`
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) =>
                  row.status === 'verified' ? (
                    <Badge tone="success">
                      <ShieldCheck size={12} /> Verified
                    </Badge>
                  ) : row.status === 'failed' ? (
                    <Badge tone="danger">
                      <AlertTriangle size={12} /> Failed
                    </Badge>
                  ) : (
                    <Badge tone="info">Completed</Badge>
                  )
              },
              {
                key: 'actions',
                header: '',
                render: (row: BackupRecord) => (
                  <div className="toolbar" style={{ gap: 4 }}>
                    <Button
                      size="sm"
                      onClick={async () => {
                        const result = await verify.run(row.path)
                        if (result.ok) {
                          setInspection(result.value)
                          app.toast({
                            tone: result.value.valid ? 'success' : 'error',
                            title: result.value.valid ? 'Backup verified' : 'Backup has problems',
                            detail: result.value.problems[0]
                          })
                          list.reload()
                        } else {
                          app.toast({ tone: 'error', title: 'Could not verify', detail: result.error })
                        }
                      }}
                    >
                      Verify
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void invoke('system.openPath', { path: row.path }).catch(() => undefined)
                      }
                    >
                      <FolderOpen size={14} />
                    </Button>
                    {app.hasPermission('backup.restore') ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Restore this backup"
                        onClick={() => {
                          setRestoreTarget(row)
                          setRestorePhrase('')
                          setRestorePassword('')
                          setRestoreError(null)
                        }}
                      >
                        <RotateCcw size={14} />
                      </Button>
                    ) : null}
                    {app.hasPermission('backup.configure') ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Delete this backup"
                        onClick={() =>
                          confirm({
                            title: 'Delete this backup?',
                            message: `${row.fileName} and its verification files will be removed. Other backups are not affected.`,
                            tone: 'danger',
                            confirmLabel: 'Delete backup',
                            onConfirm: async () => {
                              const result = await remove.run(row.id, true)
                              if (result.ok) {
                                app.toast({ tone: 'success', title: 'Backup deleted' })
                                list.reload()
                              } else throw new Error(result.error)
                            }
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    ) : null}
                  </div>
                )
              }
            ]}
            rows={backups}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="No backups yet"
                description="Create the first backup now — automatic backups run on the schedule set in Settings."
                action={
                  app.hasPermission('backup.create') ? (
                    <Button variant="primary" onClick={() => void runBackup()}>
                      Back up now
                    </Button>
                  ) : null
                }
              />
            }
          />
        )}
      </Card>

      <Card title="Verify a backup folder">
        <p className="field__hint">
          Use this when you have copied a backup to a USB drive or another computer. The manifest, the
          database hash and the checksum file are all re-checked.
        </p>
        <div className="toolbar">
          <div className="toolbar__grow">
            <TextInput
              label="Backup folder"
              value={verifyFolder}
              onValueChange={setVerifyFolder}
              placeholder="Choose a folder to inspect"
            />
          </div>
          <Button
            onClick={async () => {
              const paths = await invoke('system.openDialog', {
                title: 'Choose the backup folder',
                directory: true
              }).catch(() => [] as string[])
              if (paths[0]) setVerifyFolder(paths[0])
            }}
          >
            <FolderOpen size={16} /> Browse
          </Button>
          <Button
            variant="primary"
            loading={verify.pending}
            disabled={verifyFolder.trim().length === 0}
            onClick={async () => {
              const result = await verify.run(verifyFolder.trim())
              if (result.ok) setInspection(result.value)
              else app.toast({ tone: 'error', title: 'Could not verify', detail: result.error })
            }}
          >
            Verify folder
          </Button>
        </div>

        {inspection ? (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Badge tone={inspection.valid ? 'success' : 'danger'}>
              {inspection.valid ? (
                <>
                  <CheckCircle2 size={12} /> Valid backup
                </>
              ) : (
                <>
                  <AlertTriangle size={12} /> Problems found
                </>
              )}
            </Badge>
            {inspection.problems.length > 0 ? (
              <ul>
                {inspection.problems.map((problem, index) => (
                  <li key={index}>{problem}</li>
                ))}
              </ul>
            ) : null}
            {inspection.manifest ? (
              <dl className="detail-list" style={{ marginTop: 'var(--space-3)' }}>
                <dt>Format</dt>
                <dd>
                  {inspection.manifest.format} v{inspection.manifest.formatVersion}
                </dd>
                <dt>Created</dt>
                <dd>{formatTimestamp(inspection.manifest.backupDate)}</dd>
                <dt>Application</dt>
                <dd>
                  {inspection.manifest.appVersion} (build {inspection.manifest.buildNumber}) · schema{' '}
                  {inspection.manifest.dataSchemaVersion}
                </dd>
                <dt>Clinic</dt>
                <dd>{inspection.manifest.clinic ?? '—'}</dd>
                <dt>Created by</dt>
                <dd>{inspection.manifest.createdBy ?? 'system'}</dd>
                <dt>Database integrity</dt>
                <dd>{inspection.manifest.database.integrityCheck}</dd>
                <dt>Size</dt>
                <dd>
                  {filesize(inspection.sizeBytes)} · {inspection.fileCount} file(s)
                </dd>
                <dt>Compatibility</dt>
                <dd>{inspection.compatibilityMessage}</dd>
                <dt>Counts</dt>
                <dd>
                  {Object.entries(inspection.manifest.counts)
                    .map(([table, count]) => `${table}: ${count}`)
                    .join(' · ')}
                </dd>
              </dl>
            ) : null}
          </div>
        ) : null}
      </Card>

      {restoreTarget ? (
        <Modal
          title="Restore this backup"
          size="md"
          onClose={() => setRestoreTarget(null)}
          footer={
            <>
              <Button onClick={() => setRestoreTarget(null)}>Cancel</Button>
              <Button
                variant="danger"
                loading={restore.pending}
                disabled={restorePhrase !== 'RESTORE' || restorePassword.length === 0}
                onClick={async () => {
                  const result = await restore.run({
                    folderPath: restoreTarget.path,
                    password: restorePassword,
                    confirmationPhrase: restorePhrase
                  })
                  if (result.ok) {
                    app.toast({
                      tone: 'success',
                      title: 'Backup restored',
                      detail: `A pre-restore backup was saved as ${result.value.preRestoreBackup.fileName}.`
                    })
                    setRestoreTarget(null)
                    list.reload()
                  } else {
                    setRestoreError(result.error)
                  }
                }}
              >
                <RotateCcw size={16} /> Restore backups
              </Button>
            </>
          }
        >
          <p>
            Restoring replaces the current database with <strong>{restoreTarget.fileName}</strong> (taken{' '}
            {formatTimestamp(restoreTarget.createdAt)}). Before anything is replaced, the application takes a
            “pre-restore” backup automatically, so this step can be undone.
          </p>
          <p className="field__hint">
            Any changes made after this backup — visits, prescriptions, invoices and payments — will no longer
            be visible once the restore finishes. Close other work before continuing.
          </p>
          {restoreError ? (
            <p className="field__error" role="alert">
              {restoreError}
            </p>
          ) : null}
          <TextInput
            label='Type "RESTORE" to confirm'
            value={restorePhrase}
            onValueChange={setRestorePhrase}
            autoFocus
          />
          <TextInput
            label="Your account password"
            type="password"
            value={restorePassword}
            onValueChange={setRestorePassword}
            autoComplete="current-password"
          />
        </Modal>
      ) : null}

      <Card title="Where backups are stored">
        <p className="field__hint">
          Backup folder:{' '}
          <span className="mono">{app.settings?.backupFolder || '(inside the data folder)'}</span>. Change it
          in Settings → Backup. Copying a backup to a USB drive or another computer is recommended — a backup
          on the same disk as the database does not protect against a disk failure.
        </p>
        <div className="toolbar">
          <Button onClick={() => void invoke('data.openBackupFolder').catch(() => undefined)}>
            <Download size={16} /> Open the folder
          </Button>
          <Button onClick={() => void invoke('data.revealDataFolder').catch(() => undefined)}>
            <FolderOpen size={16} /> Open the data folder
          </Button>
        </div>
      </Card>
    </>
  )
}
