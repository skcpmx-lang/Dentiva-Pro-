/**
 * About & help: product identity, build provenance, runtime information, the licence and a live view of the
 * application log. Nothing here is decorative — the version, commit and build date come from the build itself.
 */

import { useState } from 'react'
import {
  BookOpen,
  Database,
  FileText,
  FolderOpen,
  HardDriveDownload,
  Info,
  Mail,
  RefreshCw,
  ShieldCheck,
  User
} from 'lucide-react'
import { invoke } from '../../lib/api'
import { useApp } from '../../app/state'
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Tabs,
  TextInput
} from '../../components/ui'
import { useQuery } from '../../lib/hooks'
import { filesize, formatTimestamp, titleCase } from '../../lib/format'

type Tab = 'about' | 'diagnostics' | 'licence' | 'guide'

export function AboutPage() {
  const app = useApp()
  const [tab, setTab] = useState<Tab>('about')
  const info = useQuery('system.about', undefined)
  const runtime = useQuery('system.runtimeInfo', undefined)
  const notices = useQuery('system.thirdPartyNotices', undefined)

  return (
    <>
      <PageHeader title="About & help" subtitle="Version, diagnostics, licensing and support" />

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'about', label: 'About' },
          { value: 'diagnostics', label: 'Diagnostics' },
          { value: 'licence', label: 'Licence & third party' },
          { value: 'guide', label: 'User guide' }
        ]}
      />

      {tab === 'about' ? (
        info.loading ? (
          <LoadingState />
        ) : info.error ? (
          <ErrorState message={info.error} onRetry={info.reload} />
        ) : info.data ? (
          <>
            <Card>
              <div className="toolbar" style={{ alignItems: 'flex-start', gap: 'var(--space-4)' }}>
                <span
                  className="auth-card__brand-mark"
                  style={{ width: 64, height: 64, fontSize: 'var(--text-xl)' }}
                  aria-hidden="true"
                >
                  DP
                </span>
                <div style={{ flex: 1 }}>
                  <h2 style={{ marginBottom: 4 }}>{info.data.productName}</h2>
                  <p style={{ marginTop: 0 }}>
                    Offline-first dental clinic management for Windows. Patient records, appointments, queue,
                    prescriptions, billing, inventory and reporting — all stored on this computer.
                  </p>
                  <div className="toolbar">
                    <Badge tone="brand">Version {info.data.version}</Badge>
                    <Badge>Build {info.data.buildNumber}</Badge>
                    <Badge>Commit {info.data.commit.slice(0, 8)}</Badge>
                    <Badge>Built {info.data.buildDate.slice(0, 10)}</Badge>
                  </div>
                </div>
              </div>
            </Card>

            <div className="grid grid--2">
              <Card title="Built by">
                <dl className="detail-list">
                  <dt>
                    <User size={12} /> Author
                  </dt>
                  <dd>{info.data.author}</dd>
                  <dt>
                    <Mail size={12} /> Support
                  </dt>
                  <dd>
                    {info.data.authorEmail}
                    <span className="field__hint" style={{ display: 'block' }}>
                      Please include the version, build number and the log bundle from Diagnostics when
                      reporting a problem.
                    </span>
                  </dd>
                  <dt>Copyright</dt>
                  <dd>{info.data.copyright}</dd>
                  <dt>Licence</dt>
                  <dd>{info.data.licence}</dd>
                </dl>
              </Card>

              <Card title="Where your data lives">
                <dl className="detail-list">
                  <dt>
                    <FolderOpen size={12} /> Data folder
                  </dt>
                  <dd className="mono">{info.data.dataRoot}</dd>
                  <dt>
                    <Database size={12} /> Database
                  </dt>
                  <dd className="mono">{info.data.databasePath}</dd>
                  <dt>Logs</dt>
                  <dd className="mono">{info.data.logPath}</dd>
                  <dt>
                    <HardDriveDownload size={12} /> Backups
                  </dt>
                  <dd className="mono">{info.data.backupFolder}</dd>
                </dl>
                <div className="toolbar" style={{ marginTop: 'var(--space-3)' }}>
                  <Button onClick={() => void invoke('data.revealDataFolder').catch(() => undefined)}>
                    Open the data folder
                  </Button>
                  <Button onClick={() => void invoke('data.openBackupFolder').catch(() => undefined)}>
                    Open the backup folder
                  </Button>
                </div>
              </Card>
            </div>

            <Card title="This computer">
              <dl className="detail-list">
                <dt>Application</dt>
                <dd>
                  Electron {info.data.electron} · Chromium {info.data.chrome} · Node {info.data.node}
                </dd>
                <dt>Database engine</dt>
                <dd>SQLite {info.data.sqlite}</dd>
                <dt>Signed in as</dt>
                <dd>
                  {app.session.user?.displayName ?? '—'} ({app.session.user?.roleName ?? '—'})
                </dd>
                <dt>Activated</dt>
                <dd>{app.session.activatedAt ? formatTimestamp(app.session.activatedAt) : '—'}</dd>
                <dt>Third-party components</dt>
                <dd>{info.data.thirdPartyCount} packages with open-source licences (see the Licence tab)</dd>
                <dt>Offline</dt>
                <dd>This application works without an internet connection. No data leaves this computer.</dd>
              </dl>
            </Card>
          </>
        ) : (
          <EmptyState
            title="Information unavailable"
            description="The application could not read its own build information."
          />
        )
      ) : null}

      {tab === 'diagnostics' ? <DiagnosticsTab runtime={runtime} /> : null}

      {tab === 'licence' ? (
        <Card title="Third-party notices">
          {notices.loading ? (
            <LoadingState />
          ) : notices.error ? (
            <ErrorState message={notices.error} onRetry={notices.reload} />
          ) : (
            <>
              <p className="field__hint">
                Dentiva Pro is built on open-source components. Their licences are reproduced below in full;
                the list is generated from the packages actually shipped in this build.
              </p>
              <pre
                className="mono"
                style={{
                  whiteSpace: 'pre-wrap',
                  maxHeight: 480,
                  overflow: 'auto',
                  fontSize: 'var(--text-xs)'
                }}
              >
                {notices.data}
              </pre>
            </>
          )}
        </Card>
      ) : null}

      {tab === 'guide' ? <GuideTab /> : null}
    </>
  )
}

function DiagnosticsTab({ runtime }: { runtime: ReturnType<typeof useQuery<'system.runtimeInfo'>> }) {
  const app = useApp()
  const logs = useQuery('diagnostics.logs', undefined)
  const [saving, setSaving] = useState(false)

  return (
    <>
      <Card title="Runtime information">
        {runtime.loading ? (
          <LoadingState />
        ) : runtime.error ? (
          <ErrorState message={runtime.error} onRetry={runtime.reload} />
        ) : runtime.data ? (
          <dl className="detail-list">
            <dt>Product</dt>
            <dd>
              {runtime.data.productName} {runtime.data.version} (build {runtime.data.buildNumber})
            </dd>
            <dt>Commit / build date</dt>
            <dd className="mono">
              {runtime.data.commit} · {runtime.data.buildDate}
            </dd>
            <dt>Platform</dt>
            <dd>
              {runtime.data.platform} · {runtime.data.arch}
            </dd>
            <dt>Versions</dt>
            <dd>
              Electron {runtime.data.electron} · Chromium {runtime.data.chrome} · Node {runtime.data.node} ·
              V8 {runtime.data.v8} · SQLite {runtime.data.sqlite}
            </dd>
            <dt>Data root</dt>
            <dd className="mono">{runtime.data.dataRoot}</dd>
            <dt>Third-party packages</dt>
            <dd>{runtime.data.thirdPartyCount}</dd>
          </dl>
        ) : null}
      </Card>

      <Card
        title="Application log"
        actions={
          <>
            <Button size="sm" onClick={() => logs.reload()}>
              <RefreshCw size={14} /> Refresh
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={saving}
              onClick={async () => {
                setSaving(true)
                try {
                  const path = await invoke('diagnostics.exportLogs', {
                    title: 'Save the log bundle',
                    suggestedName: `dentiva-logs-${new Date().toISOString().slice(0, 10)}`
                  })
                  if (path) app.toast({ tone: 'success', title: 'Log bundle saved', detail: path })
                } catch (cause) {
                  app.toast({
                    tone: 'error',
                    title: 'Could not save the logs',
                    detail: cause instanceof Error ? cause.message : String(cause)
                  })
                } finally {
                  setSaving(false)
                }
              }}
            >
              <HardDriveDownload size={14} /> Save log bundle
            </Button>
          </>
        }
        flush
      >
        {logs.loading ? (
          <LoadingState />
        ) : logs.error ? (
          <ErrorState message={logs.error} onRetry={logs.reload} />
        ) : (
          <>
            <DataTable
              columns={[
                { key: 'at', header: 'When', render: (row) => row.at.slice(0, 19).replace('T', ' ') },
                {
                  key: 'level',
                  header: 'Level',
                  render: (row) => (
                    <Badge
                      tone={row.level === 'error' ? 'danger' : row.level === 'warn' ? 'warning' : 'neutral'}
                    >
                      {titleCase(row.level)}
                    </Badge>
                  )
                },
                { key: 'scope', header: 'Scope', render: (row) => row.scope ?? '—' },
                { key: 'message', header: 'Message', render: (row) => row.message }
              ]}
              rows={logs.data?.entries ?? []}
              rowKey={(row, index) => `${row.at}-${index}`}
              empty={
                <EmptyState
                  title="No log entries"
                  description="The application has not logged anything yet in this session."
                />
              }
              compact
            />
            <div className="card__footer">
              {logs.data?.files.length ?? 0} log file(s) on disk:{' '}
              {(logs.data?.files ?? [])
                .map((file) => `${file.name} (${filesize(file.sizeBytes)})`)
                .join(', ') || '—'}
            </div>
          </>
        )}
      </Card>

      <Card title="Logging rules">
        <ul>
          <li>
            Log files rotate automatically and old files are removed once the retention limit is reached.
          </li>
          <li>
            Passwords, licence codes, patient clinical text and payment references are never written to the
            log.
          </li>
          <li>Errors include a reference code so a support request can be matched to the exact log line.</li>
        </ul>
        <p className="field__hint">
          Data folder: <span className="mono">{app.setup?.dataRoot}</span>
        </p>
      </Card>
    </>
  )
}

function GuideTab() {
  const app = useApp()
  const [search, setSearch] = useState('')
  const topics: { title: string; body: string }[] = [
    {
      title: 'Registering a patient',
      body: 'Patients → New patient. Name and phone are required; everything else can be added later. The patient code is generated automatically and never reused.'
    },
    {
      title: 'Booking and running the day',
      body: 'Appointments → New appointment books a slot. When the patient arrives, mark the appointment “Arrived” and add them to the Queue. In the queue you can call, start, reorder and complete patients.'
    },
    {
      title: 'Recording a visit',
      body: 'Open the patient and press New visit. Record the complaint, examination and diagnosis, add the treatments performed with the FDI tooth numbers, then finalise the visit. Finalised visits are locked; corrections are recorded as amendments.'
    },
    {
      title: 'Writing a prescription',
      body: 'Prescriptions → New prescription. Choose the patient and dentist, fill C/C, O/E, R/E and advice, then add one row per medicine with type, strength, dose, morning/noon/night, before or after food, duration, quantity and any conditional instruction such as “if pain occurs”. Save, then print or save as PDF.'
    },
    {
      title: 'Billing and receipts',
      body: 'Invoices → New invoice. Add lines from the treatment catalogue or the stock list, apply discounts, then save. Payments are recorded with the method (cash, bKash, Nagad, Rocket, Upay, card or bank) and the reference number where the method needs one.'
    },
    {
      title: 'Stock control',
      body: 'Inventory → Stock in records a purchase with batch number and expiry date. “Stock out” records usage, wastage, returns and adjustments. Expired and low-stock items raise notifications.'
    },
    {
      title: 'Backups and restore',
      body: 'Backup & restore → Back up now. Automatic backups run on the schedule in Settings. Always copy backups to another drive. Restoring takes a pre-restore backup automatically and needs the phrase RESTORE plus your password.'
    },
    {
      title: 'Printing and PDF',
      body: 'Every printable document opens in a preview first: choose the printer, the paper and the number of copies, then print or “Save as PDF”. Settings → Printing holds the printer profiles for A4, A5, thermal and custom sizes.'
    },
    {
      title: 'Security',
      body: 'The application locks itself after the interval set in Settings → Security, and Ctrl+L locks it immediately. Roles decide what each account can do; the check happens in the application core, not just on screen.'
    },
    {
      title: 'Keyboard shortcuts',
      body: 'Ctrl+K search and commands · Ctrl+L lock · Ctrl+1…4 dashboard, patients, appointments, queue · Ctrl+Shift+P new patient · Ctrl+Shift+I new invoice · Ctrl+Shift+N notifications · ? shortcut list.'
    }
  ]
  const filtered = topics.filter((topic) =>
    `${topic.title} ${topic.body}`.toLowerCase().includes(search.trim().toLowerCase())
  )

  return (
    <Card
      title="User guide"
      actions={
        <>
          <Button size="sm" onClick={() => void invoke('data.openUserGuide').catch(() => undefined)}>
            <BookOpen size={14} /> Open the full guide
          </Button>
        </>
      }
    >
      <TextInput
        label="Search the guide"
        value={search}
        onValueChange={setSearch}
        placeholder="backup, prescription, printing…"
      />
      <div style={{ marginTop: 'var(--space-3)' }}>
        {filtered.length === 0 ? (
          <EmptyState title="No matching topic" description="Try a different word, or open the full guide." />
        ) : (
          filtered.map((topic) => (
            <div key={topic.title} style={{ marginBottom: 'var(--space-3)' }}>
              <strong>
                <Info size={12} style={{ verticalAlign: 'middle' }} /> {topic.title}
              </strong>
              <p style={{ margin: '4px 0 0' }}>{topic.body}</p>
            </div>
          ))
        )}
      </div>
      <p className="field__hint">
        <ShieldCheck size={12} style={{ verticalAlign: 'middle' }} /> Dentiva Pro never sends your data
        anywhere. Support requests are handled by e-mail using the address on the About tab.
      </p>
      <p className="field__hint">
        <FileText size={12} style={{ verticalAlign: 'middle' }} /> Data folder:{' '}
        <span className="mono">{app.setup?.dataRoot}</span>
      </p>
    </Card>
  )
}
