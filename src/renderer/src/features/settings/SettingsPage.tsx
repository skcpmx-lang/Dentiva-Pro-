/**
 * Settings.
 *
 * Every value here is stored in the database (not in a config file the user cannot see) and takes effect
 * immediately: printing starts from these paper and printer profiles, the dashboard reads the widget flags,
 * and the security section controls the auto-lock and destructive-action rules.
 */

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Database,
  FileDown,
  FileUp,
  Image as ImageIcon,
  Printer,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import type { AppSettingsShape } from '@shared/constants'
import type {
  ClinicInput,
  ClinicProfile,
  DestructiveRequest,
  IntegrityReport,
  PatientImportResult,
  PrinterInfo,
  PrinterProfile
} from '@shared/types'
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
  MoneyInput,
  PageHeader,
  SegmentedControl,
  Select,
  Tabs,
  TextArea,
  TextInput,
  useConfirm
} from '../../components/ui'
import { useAction, useQuery } from '../../lib/hooks'
import { amountInput, filesize, money, parseMoneyInput, titleCase, todayIso } from '../../lib/format'
import { PATIENT_IMPORT } from '@shared/constants'
import { PAPER_SIZE_KEYS } from '@shared/printing/paper'
import { addDaysIso } from '@shared/date'

type Tab =
  | 'clinic'
  | 'prescription'
  | 'invoice'
  | 'clinical'
  | 'inventory'
  | 'notifications'
  | 'security'
  | 'backup'
  | 'printing'
  | 'data'

const TAB_LABELS: Record<Tab, string> = {
  clinic: 'Clinic',
  prescription: 'Prescription',
  invoice: 'Invoice',
  clinical: 'Clinical',
  inventory: 'Inventory',
  notifications: 'Notifications',
  security: 'Security',
  backup: 'Backup',
  printing: 'Printing',
  data: 'Data & diagnostics'
}

export function SettingsPage() {
  const app = useApp()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) ?? 'clinic')
  const [draft, setDraft] = useState<AppSettingsShape | null>(null)
  const snapshot = useQuery('settings.snapshot', undefined)
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null)
  const [busy, setBusy] = useState<'integrity' | 'export' | 'import' | null>(null)
  const [importDraft, setImportDraft] = useState<PatientImportResult | null>(null)

  const saveSettings = useAction(async (patch: Partial<AppSettingsShape>) =>
    invoke('settings.update', { patch })
  )

  useEffect(() => {
    if (snapshot.data && draft === null) setDraft(snapshot.data.settings)
  }, [snapshot.data, draft])

  useEffect(() => {
    if (params.get('integrity') === '1') {
      setTab('data')
      void runIntegrity(false)
      const next = new URLSearchParams(params)
      next.delete('integrity')
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  async function runIntegrity(deep: boolean): Promise<void> {
    setBusy('integrity')
    try {
      const report = await invoke('system.integrity', { deep })
      setIntegrity(report)
    } catch (cause) {
      app.toast({
        tone: 'error',
        title: 'Integrity check failed to run',
        detail: cause instanceof Error ? cause.message : String(cause)
      })
    } finally {
      setBusy(null)
    }
  }

  const dirty = useMemo(() => {
    if (!snapshot.data || !draft) return false
    return JSON.stringify(snapshot.data.settings) !== JSON.stringify(draft)
  }, [snapshot.data, draft])

  if (snapshot.loading || !draft) return <LoadingState label="Loading settings…" />
  if (snapshot.error) return <ErrorState message={snapshot.error} onRetry={snapshot.reload} />

  function patch(changes: Partial<AppSettingsShape>): void {
    setDraft((current) => (current ? { ...current, ...changes } : current))
  }

  async function persist(): Promise<void> {
    if (!draft) return
    const result = await saveSettings.run(draft)
    if (result.ok) {
      app.toast({ tone: 'success', title: 'Settings saved' })
      await app.refreshSettings()
      snapshot.reload()
    } else {
      app.toast({ tone: 'error', title: 'Could not save settings', detail: result.error })
    }
  }

  const tabs: Tab[] =
    app.hasPermission('settings.manage') || app.hasPermission('settings.view')
      ? [
          'clinic',
          'prescription',
          'invoice',
          'clinical',
          'inventory',
          'notifications',
          'security',
          'backup',
          'printing',
          'data'
        ]
      : []

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Clinic profile, printing, security and data management"
        actions={
          <>
            {dirty ? <Badge tone="warning">Unsaved changes</Badge> : null}
            <Button onClick={() => snapshot.reload()}>
              <RefreshCw size={16} /> Reload
            </Button>
            <Button
              variant="primary"
              disabled={!dirty || !app.hasPermission('settings.manage')}
              loading={saveSettings.pending}
              onClick={() => void persist()}
            >
              <Save size={16} /> Save settings
            </Button>
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        options={tabs.map((entry) => ({ value: entry, label: TAB_LABELS[entry] }))}
      />

      {tab === 'clinic' ? (
        <ClinicTab
          clinic={snapshot.data?.clinic ?? null}
          onSaved={() => {
            snapshot.reload()
            void app.refreshSettings()
          }}
        />
      ) : null}

      {tab === 'prescription' ? (
        <Card title="Prescription defaults">
          <div className="form-grid form-grid--wide">
            <Select
              label="Default paper"
              value={draft.prescriptionPaper}
              onValueChange={(value) => patch({ prescriptionPaper: value })}
              options={PAPER_SIZE_KEYS.map((key) => ({ value: key, label: key.replace(/_/g, ' ') }))}
              hint="Used when no printer profile overrides it."
            />
            <TextInput
              label="Default follow-up (days)"
              value={String(draft.prescriptionDefaultFollowUpDays)}
              onValueChange={(value) =>
                patch({ prescriptionDefaultFollowUpDays: Number(value.replace(/\D/g, '') || 0) })
              }
            />
            <TextInput
              label="Footer quote"
              value={draft.prescriptionFooterQuote}
              onValueChange={(value) => patch({ prescriptionFooterQuote: value })}
              hint="Printed at the bottom of the prescription, above the signature area."
              full
            />
          </div>
          <Checkbox
            label="Print the dentist's qualifications and designations"
            checked={draft.prescriptionShowDentistQualifications}
            onCheckedChange={(checked) => patch({ prescriptionShowDentistQualifications: checked })}
          />
          <Checkbox
            label="Print the clinic logo"
            checked={draft.prescriptionShowLogo}
            onCheckedChange={(checked) => patch({ prescriptionShowLogo: checked })}
          />
          <Checkbox
            label="Print consultation hours"
            checked={draft.prescriptionShowConsultationTiming}
            onCheckedChange={(checked) => patch({ prescriptionShowConsultationTiming: checked })}
          />
          <p className="field__hint">
            The signature area is always left physically blank — nothing is printed inside the reserved space.
          </p>
        </Card>
      ) : null}

      {tab === 'invoice' ? (
        <Card title="Invoice defaults">
          <div className="form-grid form-grid--wide">
            <Select
              label="Default paper"
              value={draft.invoicePaper}
              onValueChange={(value) => patch({ invoicePaper: value })}
              options={PAPER_SIZE_KEYS.map((key) => ({ value: key, label: key.replace(/_/g, ' ') }))}
            />
            <TextInput
              label="Default tax %"
              value={(draft.invoiceDefaultTaxPercentX100 / 100).toString()}
              onValueChange={(value) =>
                patch({
                  invoiceDefaultTaxPercentX100: Math.round(Number(value.replace(/[^\d.]/g, '') || '0') * 100)
                })
              }
            />
            <TextArea
              label="Terms note"
              rows={2}
              value={draft.invoiceTermsNote}
              onValueChange={(value) => patch({ invoiceTermsNote: value })}
              full
            />
          </div>
          <Checkbox
            label="Round invoice totals to the nearest taka"
            checked={draft.invoiceRoundOffEnabled}
            onCheckedChange={(checked) => patch({ invoiceRoundOffEnabled: checked })}
          />
          <Checkbox
            label="Show the dentist on invoices"
            checked={draft.invoiceShowDentist}
            onCheckedChange={(checked) => patch({ invoiceShowDentist: checked })}
          />
          <Checkbox
            label="Print the payment history on invoices"
            checked={draft.invoiceShowPaymentHistory}
            onCheckedChange={(checked) => patch({ invoiceShowPaymentHistory: checked })}
          />
          <Checkbox
            label="Print the clinic logo"
            checked={draft.invoiceShowLogo}
            onCheckedChange={(checked) => patch({ invoiceShowLogo: checked })}
          />
          <p className="field__hint">
            Invoice sheets carry the clinic name, logo, address and phone only — no signature block, as
            required.
          </p>
        </Card>
      ) : null}

      {tab === 'clinical' ? (
        <Card title="Clinical defaults">
          <div className="form-grid form-grid--wide">
            <Select
              label="Dental chart dentition"
              value={draft.chartDefaultDentition}
              onValueChange={(value) => patch({ chartDefaultDentition: value as 'permanent' | 'primary' })}
              options={[
                { value: 'permanent', label: 'Permanent teeth' },
                { value: 'primary', label: 'Primary (milk) teeth' }
              ]}
            />
            <TextInput
              label="Patient code prefix"
              value={draft.patientCodePrefix}
              onValueChange={(value) => patch({ patientCodePrefix: value.toUpperCase().slice(0, 6) })}
            />
            <TextInput
              label="Patient code digits"
              value={String(draft.patientCodePadding)}
              onValueChange={(value) =>
                patch({
                  patientCodePadding: Math.min(10, Math.max(2, Number(value.replace(/\D/g, '') || 4)))
                })
              }
              hint={`Next code: ${draft.patientCodePrefix}${'1'.padStart(draft.patientCodePadding, '0')}`}
            />
            <TextInput
              label="Invoice number prefix"
              value={draft.invoicePrefix}
              onValueChange={(value) => patch({ invoicePrefix: value.toUpperCase().slice(0, 8) })}
            />
          </div>
          <Checkbox
            label="Require visits to be finalised before billing"
            checked={draft.requireVisitFinalization}
            onCheckedChange={(checked) => patch({ requireVisitFinalization: checked })}
            hint="Finalised visits are immutable; corrections are recorded as amendments in the audit log."
          />
        </Card>
      ) : null}

      {tab === 'inventory' ? (
        <Card title="Inventory alerts">
          <div className="form-grid form-grid--wide">
            <TextInput
              label="Expiry warning (days before)"
              value={String(draft.inventoryExpiryWarningDays)}
              onValueChange={(value) =>
                patch({ inventoryExpiryWarningDays: Math.max(1, Number(value.replace(/\D/g, '') || 30)) })
              }
              hint="Batches expiring within this window raise a notification."
            />
          </div>
          <Checkbox
            label="Show low-stock alerts"
            checked={draft.inventoryLowStockAlerts}
            onCheckedChange={(checked) => patch({ inventoryLowStockAlerts: checked })}
          />
          <Checkbox
            label="Allow issuing expired stock (not recommended)"
            checked={draft.inventoryAllowExpiredIssue}
            onCheckedChange={(checked) => patch({ inventoryAllowExpiredIssue: checked })}
            hint="When off, expired batches cannot be issued and must be written off explicitly."
          />
        </Card>
      ) : null}

      {tab === 'notifications' ? (
        <Card title="Notifications">
          <Checkbox
            label="Enable the in-app notification centre"
            checked={draft.notificationsEnabled}
            onCheckedChange={(checked) => patch({ notificationsEnabled: checked })}
          />
          <div className="form-grid form-grid--wide">
            <TextInput
              label="Appointment reminder (minutes before)"
              value={String(draft.appointmentReminderMinutes)}
              onValueChange={(value) =>
                patch({ appointmentReminderMinutes: Math.max(0, Number(value.replace(/\D/g, '') || 0)) })
              }
            />
            <MoneyInput
              label="Outstanding balance threshold"
              value={amountInput(draft.outstandingBalanceThresholdPoisha)}
              onValueChange={(value) =>
                patch({ outstandingBalanceThresholdPoisha: parseMoneyInput(value) ?? 0 })
              }
              hint="Patients owing more than this are flagged on the dashboard."
            />
            <TextInput
              label="Queue waiting reminder (minutes)"
              value={String(draft.queueWaitingReminderMinutes)}
              onValueChange={(value) =>
                patch({ queueWaitingReminderMinutes: Math.max(0, Number(value.replace(/\D/g, '') || 0)) })
              }
              hint="The front desk is reminded when a queued patient has waited this long. 0 turns it off."
            />
          </div>
          <Checkbox
            label="Notify about missed appointments"
            checked={draft.notifyMissedAppointments}
            onCheckedChange={(checked) => patch({ notifyMissedAppointments: checked })}
          />
          <Checkbox
            label="Notify about outstanding balances"
            checked={draft.notifyOutstandingBalances}
            onCheckedChange={(checked) => patch({ notifyOutstandingBalances: checked })}
          />
          <p className="field__hint">
            The notification centre is local to this computer; nothing is sent over the internet.
          </p>
        </Card>
      ) : null}

      {tab === 'security' ? (
        <>
          <Card title="Auto-lock">
            <div className="toolbar">
              <SegmentedControl
                value={String(draft.autoLockMinutes)}
                onChange={(value) => patch({ autoLockMinutes: Number(value) })}
                options={[
                  { value: '5', label: '5 minutes' },
                  { value: '10', label: '10 minutes' },
                  { value: '15', label: '15 minutes' },
                  { value: '30', label: '30 minutes' }
                ]}
              />
              <Button onClick={() => void invoke('auth.lock')}>Lock now (Ctrl+L)</Button>
            </div>
            <p className="field__hint">
              The application locks itself after this period without keyboard or mouse activity. While locked,
              no patient information is shown until the correct password is entered.
            </p>
            <div className="form-grid form-grid--wide">
              <TextInput
                label="Failed sign-in attempts before lock-out"
                value={String(draft.loginMaxAttempts)}
                onValueChange={(value) =>
                  patch({ loginMaxAttempts: Math.max(3, Number(value.replace(/\D/g, '') || 5)) })
                }
                hint="After this many failures the account is blocked for five minutes."
              />
            </div>
            <Checkbox
              label="Ask for a password before destructive actions"
              checked={draft.requirePasswordOnDestructive}
              onCheckedChange={(checked) => patch({ requirePasswordOnDestructive: checked })}
              hint="Applies to voiding, deleting and restoring. Strongly recommended."
            />
          </Card>
          <Card title="Password policy">
            <ul>
              <li>Minimum 10 characters.</li>
              <li>At least three of: lower case, upper case, digit, symbol.</li>
              <li>Common and breached passwords are rejected.</li>
              <li>
                Passwords are stored as scrypt verifiers (N=2¹⁵, r=8, p=1) — they cannot be recovered, only
                reset.
              </li>
            </ul>
          </Card>
        </>
      ) : null}

      {tab === 'backup' ? (
        <Card title="Backup settings">
          <Checkbox
            label="Take backups automatically"
            checked={draft.autoBackupEnabled}
            onCheckedChange={(checked) => patch({ autoBackupEnabled: checked })}
          />
          <div className="form-grid form-grid--wide">
            <Select
              label="Interval"
              value={String(draft.autoBackupIntervalDays)}
              onValueChange={(value) => patch({ autoBackupIntervalDays: Number(value) })}
              options={[
                { value: '7', label: 'Every 7 days' },
                { value: '15', label: 'Every 15 days' },
                { value: '30', label: 'Every 30 days' }
              ]}
            />
            <TextInput
              label="Time of day"
              type="time"
              value={draft.autoBackupTime}
              onValueChange={(value) => patch({ autoBackupTime: value })}
              hint="Automatic backups run only while somebody is signed in."
            />
            <TextInput
              label="Keep the newest"
              value={String(draft.autoBackupRetention)}
              onValueChange={(value) =>
                patch({
                  autoBackupRetention: Math.min(200, Math.max(3, Number(value.replace(/\D/g, '') || 10)))
                })
              }
              hint="Older automatic backups are removed once this many exist."
            />
            <TextInput
              label="Backup folder"
              value={draft.backupFolder}
              onValueChange={(value) => patch({ backupFolder: value })}
              hint="Leave empty to keep backups inside the data folder. A folder on another drive is safer."
              full
            />
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.encryptBackups}
              onChange={(event) => patch({ encryptBackups: event.target.checked })}
            />
            Encrypt backup contents
          </label>
          <p className="field__hint">
            Every backup is verified automatically: the database is opened and its integrity is checked, a
            SHA-256 checksum is written, and the manifest records the schema and data format versions. A
            failed backup never overwrites a good one.
          </p>
        </Card>
      ) : null}

      {tab === 'printing' ? <PrintingTab /> : null}

      {tab === 'data' ? (
        <>
          <Card title="Integrity check">
            <div className="toolbar">
              <Button loading={busy === 'integrity'} onClick={() => void runIntegrity(false)}>
                <ShieldCheck size={16} /> Quick check
              </Button>
              <Button loading={busy === 'integrity'} onClick={() => void runIntegrity(true)}>
                Deep check (re-hashes attachments)
              </Button>
            </div>
            {integrity ? (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <Badge tone={integrity.ok ? 'success' : 'danger'}>
                  {integrity.ok ? 'All checks passed' : 'Problems found'}
                </Badge>
                <DataTable
                  columns={[
                    { key: 'check', header: 'Check', render: (row) => row.name },
                    { key: 'detail', header: 'Detail', render: (row) => row.detail },
                    {
                      key: 'count',
                      header: 'Count',
                      align: 'right',
                      render: (row) => (row.count == null ? '—' : row.count)
                    },
                    {
                      key: 'ok',
                      header: 'Result',
                      render: (row) =>
                        row.ok ? <Badge tone="success">OK</Badge> : <Badge tone="danger">Failed</Badge>
                    }
                  ]}
                  rows={integrity.checks}
                  rowKey={(row) => row.name}
                  compact
                />
              </div>
            ) : (
              <p className="field__hint">No check has been run in this session yet.</p>
            )}
          </Card>

          <Card title="Export">
            <div className="toolbar">
              <Button
                loading={busy === 'export'}
                onClick={async () => {
                  if (!app.hasPermission('patients.export')) {
                    app.toast({
                      tone: 'warning',
                      title: 'Export not allowed',
                      detail: 'Your role cannot export the patient register.'
                    })
                    return
                  }
                  setBusy('export')
                  try {
                    const folder = await invoke('export.chooseFolder', {
                      title: 'Choose a folder for the export'
                    })
                    if (!folder) return
                    const result = await invoke('export.data', {
                      entity: 'patients',
                      format: 'csv',
                      from: null,
                      to: null,
                      targetFolder: folder
                    })
                    app.toast({
                      tone: 'success',
                      title: `Exported ${result.rowCount} row(s)`,
                      detail: result.filePath
                    })
                  } catch (cause) {
                    app.toast({
                      tone: 'error',
                      title: 'Export failed',
                      detail: cause instanceof Error ? cause.message : String(cause)
                    })
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                <FileDown size={16} /> Export patients (CSV)
              </Button>
              <Button
                onClick={async () => {
                  // The service exports invoices under the financial-report permission, so the button asks
                  // for exactly the same permission instead of letting the call fail.
                  if (!app.hasPermission('reports.financial.export')) {
                    app.toast({
                      tone: 'warning',
                      title: 'Export not allowed',
                      detail: 'Your role cannot export financial data.'
                    })
                    return
                  }
                  try {
                    const folder = await invoke('export.chooseFolder', {
                      title: 'Choose a folder for the export'
                    })
                    if (!folder) return
                    const result = await invoke('export.data', {
                      entity: 'invoices',
                      format: 'csv',
                      from: addDaysIso(todayIso(), -365),
                      to: todayIso(),
                      targetFolder: folder
                    })
                    app.toast({
                      tone: 'success',
                      title: `Exported ${result.rowCount} invoice(s)`,
                      detail: result.filePath
                    })
                  } catch (cause) {
                    app.toast({
                      tone: 'error',
                      title: 'Export failed',
                      detail: cause instanceof Error ? cause.message : String(cause)
                    })
                  }
                }}
              >
                <FileDown size={16} /> Export invoices, last 12 months
              </Button>
            </div>
            <p className="field__hint">
              Exports contain the same values you see on screen, written as UTF-8 CSV with a BOM so Bangla
              text opens correctly in Excel.
            </p>
          </Card>

          <Card title="Import">
            <div className="toolbar">
              <Button
                loading={busy === 'import'}
                onClick={async () => {
                  if (!app.hasPermission('data.import')) {
                    app.toast({
                      tone: 'warning',
                      title: 'Import not allowed',
                      detail: 'Your role cannot import patient data.'
                    })
                    return
                  }
                  setBusy('import')
                  try {
                    const [file] = await invoke('system.openDialog', {
                      title: 'Choose the patient list to import',
                      multiple: false,
                      filters: [{ name: 'Comma-separated values', extensions: ['csv'] }]
                    })
                    if (!file) return
                    // The first pass is always a dry run: nothing is written until the user confirms.
                    setImportDraft(await invoke('data.import', { filePath: file, dryRun: true }))
                  } catch (cause) {
                    app.toast({
                      tone: 'error',
                      title: 'Could not read that file',
                      detail: cause instanceof Error ? cause.message : String(cause)
                    })
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                <FileUp size={16} /> Import patients (CSV)
              </Button>
            </div>
            <p className="field__hint">
              The file needs a header row with at least <strong>Full Name</strong> and <strong>Phone</strong>.
              Columns: {PATIENT_IMPORT.templateHeader.join(', ')}. Dates may be written as YYYY-MM-DD or
              DD/MM/YYYY. Every row is validated before anything is saved, duplicates are skipped, and the
              import is recorded in the audit log.
            </p>
          </Card>

          {importDraft ? (
            <Modal
              title="Confirm the patient import"
              size="lg"
              onClose={() => setImportDraft(null)}
              footer={
                <>
                  <Button onClick={() => setImportDraft(null)}>Cancel</Button>
                  <Button
                    variant="primary"
                    disabled={importDraft.validRows === 0}
                    loading={busy === 'import'}
                    onClick={async () => {
                      setBusy('import')
                      try {
                        const result = await invoke('data.import', {
                          filePath: importDraft.filePath,
                          dryRun: false
                        })
                        app.toast({
                          tone: 'success',
                          title: `Imported ${result.imported} patient(s)`,
                          detail: `${result.duplicateRows} duplicate(s) skipped · ${result.invalidRows} invalid row(s) left out`
                        })
                        setImportDraft(null)
                      } catch (cause) {
                        app.toast({
                          tone: 'error',
                          title: 'Import failed',
                          detail: cause instanceof Error ? cause.message : String(cause)
                        })
                      } finally {
                        setBusy(null)
                      }
                    }}
                  >
                    Import {importDraft.validRows} patient(s)
                  </Button>
                </>
              }
            >
              <p>
                {importDraft.totalRows} row(s) read · {importDraft.validRows} ready to import ·{' '}
                {importDraft.duplicateRows} duplicate(s) · {importDraft.invalidRows} row(s) with problems.
              </p>
              {importDraft.preview.length > 0 ? (
                <DataTable
                  compact
                  rowKey={(row) => row.row}
                  rows={importDraft.preview}
                  columns={[
                    { key: 'row', header: 'Line', align: 'right', render: (row) => row.row },
                    { key: 'name', header: 'Patient', render: (row) => row.fullName },
                    { key: 'phone', header: 'Phone', render: (row) => row.phone },
                    { key: 'gender', header: 'Gender', render: (row) => row.gender ?? '—' },
                    { key: 'city', header: 'City', render: (row) => row.city ?? '—' }
                  ]}
                />
              ) : null}
              {importDraft.issues.length > 0 ? (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <h4>Rows that will be left out</h4>
                  <ul className="field__hint">
                    {importDraft.issues.slice(0, 8).map((issue) => (
                      <li key={`${issue.row}-${issue.field}`}>
                        Line {issue.row}: {issue.field} — {issue.message}
                        {issue.value ? ` (found “${issue.value}”)` : ''}
                      </li>
                    ))}
                  </ul>
                  {importDraft.issues.length > 8 ? (
                    <p className="field__hint">
                      …and {importDraft.issues.length - 8} more problem(s) in the same file.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="field__hint">No problems found in the file.</p>
              )}
              <p className="field__hint">
                Nothing has been saved yet. Confirming writes every ready row in one transaction with newly
                generated patient codes and records the import in the audit log.
              </p>
            </Modal>
          ) : null}

          <Card title="Diagnostics">
            <div className="toolbar">
              <Button
                onClick={() =>
                  void invoke('diagnostics.exportLogs', { suggestedName: 'dentiva-logs' }).catch(
                    () => undefined
                  )
                }
              >
                Save log bundle
              </Button>
              <Button onClick={() => void invoke('data.revealDataFolder').catch(() => undefined)}>
                <Database size={16} /> Open the data folder
              </Button>
              <Button onClick={() => void invoke('data.openUserGuide').catch(() => undefined)}>
                Open the user guide
              </Button>
            </div>
            <p className="field__hint">
              Logs rotate automatically and never contain passwords, patient clinical text or payment
              references. The data folder holds the database, attachments, logs and backups.
            </p>
          </Card>

          <DangerZone />
        </>
      ) : null}
    </>
  )
}

function ClinicTab({ clinic, onSaved }: { clinic: ClinicProfile | null; onSaved: () => void }) {
  const app = useApp()
  const [form, setForm] = useState<ClinicInput | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (clinic && form === null) {
      setForm({
        name: clinic.name,
        nameBn: clinic.nameBn,
        address: clinic.address,
        city: clinic.city,
        postalCode: clinic.postalCode,
        country: clinic.country,
        phone1: clinic.phone1,
        phone2: clinic.phone2,
        email: clinic.email,
        website: clinic.website,
        registrationNo: clinic.registrationNo,
        footerQuote: clinic.footerQuote,
        logoPath: clinic.logoPath
      })
    }
  }, [clinic, form])

  const save = useAction(async (input: ClinicInput) => invoke('clinic.update', input))
  const logo = useAction(async (sourcePath: string) => invoke('clinic.logo.save', { sourcePath }))
  const clearLogo = useAction(async () => invoke('clinic.logo.clear'))

  if (!clinic || !form) return <LoadingState />

  const canManage = app.hasPermission('settings.manage')

  return (
    <Card title="Clinic profile">
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-grid form-grid--wide">
        <TextInput
          label="Name"
          required
          value={form.name}
          onValueChange={(value) => setForm({ ...form, name: value })}
          disabled={!canManage}
        />
        <TextInput
          label="Name in Bangla"
          value={form.nameBn ?? ''}
          onValueChange={(value) => setForm({ ...form, nameBn: value || null })}
          disabled={!canManage}
        />
        <TextInput
          label="Address"
          required
          value={form.address}
          onValueChange={(value) => setForm({ ...form, address: value })}
          disabled={!canManage}
          full
        />
        <TextInput
          label="City"
          value={form.city ?? ''}
          onValueChange={(value) => setForm({ ...form, city: value || null })}
          disabled={!canManage}
        />
        <TextInput
          label="Postal code"
          value={form.postalCode ?? ''}
          onValueChange={(value) => setForm({ ...form, postalCode: value || null })}
          disabled={!canManage}
        />
        <TextInput
          label="Country"
          value={form.country}
          onValueChange={(value) => setForm({ ...form, country: value })}
          disabled={!canManage}
        />
        <TextInput
          label="Phone"
          required
          value={form.phone1}
          onValueChange={(value) => setForm({ ...form, phone1: value })}
          disabled={!canManage}
        />
        <TextInput
          label="Second phone"
          value={form.phone2 ?? ''}
          onValueChange={(value) => setForm({ ...form, phone2: value || null })}
          disabled={!canManage}
        />
        <TextInput
          label="Email"
          value={form.email ?? ''}
          onValueChange={(value) => setForm({ ...form, email: value || null })}
          disabled={!canManage}
        />
        <TextInput
          label="Website"
          value={form.website ?? ''}
          onValueChange={(value) => setForm({ ...form, website: value || null })}
          disabled={!canManage}
        />
        <TextInput
          label="Registration number"
          value={form.registrationNo ?? ''}
          onValueChange={(value) => setForm({ ...form, registrationNo: value || null })}
          disabled={!canManage}
        />
        <TextInput
          label="Footer quote"
          value={form.footerQuote ?? ''}
          onValueChange={(value) => setForm({ ...form, footerQuote: value || null })}
          disabled={!canManage}
          full
        />
      </div>

      <div className="toolbar" style={{ marginTop: 'var(--space-3)' }}>
        <Button
          variant="primary"
          disabled={!canManage}
          loading={save.pending}
          onClick={async () => {
            setError(null)
            if (form.name.trim().length < 3) {
              setError('The clinic name is required.')
              return
            }
            if (form.address.trim().length < 5) {
              setError('The clinic address is required.')
              return
            }
            if (form.phone1.trim().length < 6) {
              setError('A contact phone number is required.')
              return
            }
            const result = await save.run(form)
            if (result.ok) {
              app.toast({ tone: 'success', title: 'Clinic profile saved' })
              onSaved()
            } else {
              setError(result.error)
            }
          }}
        >
          <Save size={16} /> Save clinic profile
        </Button>
      </div>

      <div className="toolbar" style={{ marginTop: 'var(--space-4)' }}>
        <Badge tone={clinic.logoPath ? 'success' : 'warning'}>
          <ImageIcon size={12} /> {clinic.logoPath ? 'Logo uploaded' : 'No logo'}
        </Badge>
        <Button
          disabled={!canManage}
          loading={logo.pending}
          onClick={async () => {
            const paths = await invoke('system.openDialog', {
              title: 'Choose the clinic logo',
              multiple: false,
              filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
            }).catch(() => [] as string[])
            const path = paths[0]
            if (!path) return
            const result = await logo.run(path)
            if (result.ok) {
              app.toast({ tone: 'success', title: 'Logo updated' })
              onSaved()
            } else {
              app.toast({ tone: 'error', title: 'Could not store the logo', detail: result.error })
            }
          }}
        >
          Choose logo
        </Button>
        {clinic.logoPath ? (
          <Button
            variant="ghost"
            disabled={!canManage}
            onClick={async () => {
              const result = await clearLogo.run()
              if (result.ok) {
                app.toast({ tone: 'success', title: 'Logo removed' })
                onSaved()
              }
            }}
          >
            Remove logo
          </Button>
        ) : null}
        <span className="field__hint">{clinic.logoPath ?? 'PNG, JPG or WEBP up to 5 MB.'}</span>
      </div>
      <p className="field__hint">Last updated {clinic.updatedAt.slice(0, 19).replace('T', ' ')}</p>
    </Card>
  )
}

function PrintingTab() {
  const app = useApp()
  const profiles = useQuery('printers.profiles', undefined)
  const printers = useQuery('printers.list', undefined)
  const [form, setForm] = useState<Omit<PrinterProfile, 'id'> & { id?: number }>({
    name: '',
    documentType: 'prescription',
    printerName: null,
    paperSize: 'A5',
    customWidthMm: null,
    customHeightMm: null,
    orientation: 'portrait',
    marginTopMm: 8,
    marginRightMm: 8,
    marginBottomMm: 8,
    marginLeftMm: 8,
    scalePercent: 100,
    copies: 1,
    isDefault: false
  })
  const [error, setError] = useState<string | null>(null)

  const save = useAction(async (payload: Omit<PrinterProfile, 'id'> & { id?: number }) =>
    invoke('printers.save', payload)
  )
  const remove = useAction(async (id: number) => invoke('printers.delete', { id }))
  const canManage = app.hasPermission('printers.manage')

  const printerList: PrinterInfo[] = printers.data ?? []

  return (
    <>
      <Card title="Printer profiles">
        <p className="field__hint">
          A profile binds a document type to a paper size and a Windows printer. Use it for A4/A5 sheets, a
          58/80 mm thermal receipt printer, or a wireless/bluetooth printer that is installed in Windows.
        </p>
        {profiles.loading ? (
          <LoadingState />
        ) : profiles.error ? (
          <ErrorState message={profiles.error} onRetry={profiles.reload} />
        ) : (
          <DataTable
            columns={[
              { key: 'name', header: 'Profile', render: (row: PrinterProfile) => row.name },
              { key: 'doc', header: 'Document', render: (row) => titleCase(row.documentType) },
              { key: 'printer', header: 'Printer', render: (row) => row.printerName ?? 'System default' },
              { key: 'paper', header: 'Paper', render: (row) => `${row.paperSize} · ${row.orientation}` },
              { key: 'copies', header: 'Copies', align: 'right', render: (row) => row.copies },
              {
                key: 'default',
                header: 'Default',
                render: (row) => (row.isDefault ? <Badge tone="success">Default</Badge> : '—')
              },
              {
                key: 'actions',
                header: '',
                render: (row: PrinterProfile) =>
                  canManage ? (
                    <div className="toolbar" style={{ gap: 4 }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setForm({ ...row })
                          setError(null)
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const result = await remove.run(row.id)
                          if (result.ok) profiles.reload()
                          else app.toast({ tone: 'error', title: 'Could not delete', detail: result.error })
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ) : null
              }
            ]}
            rows={profiles.data ?? []}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="No printer profiles"
                description="Create a profile for each document type you print."
              />
            }
            compact
          />
        )}
      </Card>

      <Card title={form.id ? 'Edit profile' : 'New profile'}>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-grid form-grid--wide">
          <TextInput
            label="Profile name"
            required
            value={form.name}
            onValueChange={(value) => setForm({ ...form, name: value })}
            disabled={!canManage}
          />
          <Select
            label="Document"
            value={form.documentType}
            onValueChange={(value) =>
              setForm({ ...form, documentType: value as PrinterProfile['documentType'] })
            }
            options={[
              { value: 'prescription', label: 'Prescription' },
              { value: 'invoice', label: 'Invoice' },
              { value: 'report', label: 'Report' }
            ]}
            disabled={!canManage}
          />
          <Select
            label="Printer"
            value={form.printerName ?? ''}
            onValueChange={(value) => setForm({ ...form, printerName: value || null })}
            options={printerList.map((printer) => ({
              value: printer.name,
              label: `${printer.displayName}${printer.isDefault ? ' (Windows default)' : ''}`
            }))}
            placeholder="System default printer"
            disabled={!canManage}
          />
          <Select
            label="Paper size"
            value={form.paperSize}
            onValueChange={(value) => setForm({ ...form, paperSize: value })}
            options={PAPER_SIZE_KEYS.map((key) => ({ value: key, label: key.replace(/_/g, ' ') }))}
            disabled={!canManage}
          />
          <Select
            label="Orientation"
            value={form.orientation}
            onValueChange={(value) => setForm({ ...form, orientation: value as 'portrait' | 'landscape' })}
            options={[
              { value: 'portrait', label: 'Portrait' },
              { value: 'landscape', label: 'Landscape' }
            ]}
            disabled={!canManage}
          />
          <TextInput
            label="Copies"
            value={String(form.copies)}
            onValueChange={(value) =>
              setForm({ ...form, copies: Math.max(1, Number(value.replace(/\D/g, '') || 1)) })
            }
            disabled={!canManage}
          />
          <TextInput
            label="Scale %"
            value={String(form.scalePercent)}
            onValueChange={(value) =>
              setForm({
                ...form,
                scalePercent: Math.min(200, Math.max(50, Number(value.replace(/\D/g, '') || 100)))
              })
            }
            disabled={!canManage}
          />
          <TextInput
            label="Margin top (mm)"
            value={String(form.marginTopMm)}
            onValueChange={(value) =>
              setForm({ ...form, marginTopMm: Number(value.replace(/[^\d.]/g, '') || 0) })
            }
            disabled={!canManage}
          />
          <TextInput
            label="Margin right (mm)"
            value={String(form.marginRightMm)}
            onValueChange={(value) =>
              setForm({ ...form, marginRightMm: Number(value.replace(/[^\d.]/g, '') || 0) })
            }
            disabled={!canManage}
          />
          <TextInput
            label="Margin bottom (mm)"
            value={String(form.marginBottomMm)}
            onValueChange={(value) =>
              setForm({ ...form, marginBottomMm: Number(value.replace(/[^\d.]/g, '') || 0) })
            }
            disabled={!canManage}
          />
          <TextInput
            label="Margin left (mm)"
            value={String(form.marginLeftMm)}
            onValueChange={(value) =>
              setForm({ ...form, marginLeftMm: Number(value.replace(/[^\d.]/g, '') || 0) })
            }
            disabled={!canManage}
          />
        </div>
        <Checkbox
          label="Default profile for this document"
          checked={form.isDefault}
          onCheckedChange={(checked) => setForm({ ...form, isDefault: checked })}
        />
        <div className="toolbar">
          <Button
            variant="primary"
            disabled={!canManage}
            loading={save.pending}
            onClick={async () => {
              if (form.name.trim().length < 2) {
                setError('Give the profile a name.')
                return
              }
              const result = await save.run(form)
              if (result.ok) {
                app.toast({ tone: 'success', title: 'Printer profile saved' })
                setForm({ ...form, id: result.value.id })
                profiles.reload()
              } else {
                setError(result.error)
              }
            }}
          >
            <Printer size={16} /> Save profile
          </Button>
          <Button
            onClick={() => {
              setForm({
                name: '',
                documentType: 'prescription',
                printerName: null,
                paperSize: 'A5',
                customWidthMm: null,
                customHeightMm: null,
                orientation: 'portrait',
                marginTopMm: 8,
                marginRightMm: 8,
                marginBottomMm: 8,
                marginLeftMm: 8,
                scalePercent: 100,
                copies: 1,
                isDefault: false
              })
              setError(null)
            }}
          >
            New profile
          </Button>
        </div>
        <p className="field__hint">
          Installed printers detected on this computer:{' '}
          {printerList.length === 0
            ? 'none reported by Windows'
            : printerList.map((printer) => printer.displayName).join(', ')}
        </p>
      </Card>
    </>
  )
}

const DESTRUCTIVE_ACTIONS: DestructiveRequest['action'][] = [
  'delete_business_data',
  'delete_all_patients',
  'reset_database'
]

function DangerZone() {
  const app = useApp()
  const confirm = useConfirm()
  const counts = useQuery('system.dataCounts', undefined)
  const data = counts.data ?? {}
  const phraseFor: Record<DestructiveRequest['action'], string> = {
    delete_patient: 'DELETE PATIENT',
    delete_selected_patients: 'DELETE PATIENTS',
    delete_all_patients: 'DELETE ALL PATIENTS',
    delete_business_data: 'DELETE BUSINESS DATA',
    reset_database: 'RESET DATABASE'
  }

  return (
    <Card title="Danger zone">
      <div className="toolbar">
        <Badge tone="danger">
          <AlertTriangle size={12} /> These actions cannot be undone from inside the application
        </Badge>
        <span className="field__hint">
          {Object.entries(data)
            .map(([table, count]) => `${table}: ${count}`)
            .join(' · ') || 'Loading record counts…'}
        </span>
      </div>

      {DESTRUCTIVE_ACTIONS.map((action) => (
        <div key={action} className="toolbar" style={{ marginTop: 'var(--space-2)' }}>
          <span style={{ flex: 1 }}>
            <strong>{titleCase(action.replace(/_/g, ' '))}</strong>
            <span className="field__hint" style={{ display: 'block' }}>
              {action === 'delete_business_data'
                ? 'Removes patients, visits, prescriptions, invoices, payments and inventory. Settings, users and audit history stay.'
                : action === 'delete_all_patients'
                  ? 'Removes every patient record. A pre-action backup is taken first.'
                  : 'Removes all clinical and financial data and restores the catalogue and settings to their defaults. User accounts are kept.'}
            </span>
          </span>
          <Button
            variant="danger"
            disabled={!app.hasPermission('data.destructive')}
            onClick={() =>
              confirm({
                title: titleCase(action.replace(/_/g, ' ')),
                message:
                  'A verified backup is created before anything is removed. Type the confirmation phrase and enter your password to continue.',
                tone: 'danger',
                confirmLabel: 'Run destructive action',
                typeToConfirm: phraseFor[action],
                requirePassword: true,
                onConfirm: async ({ confirmationPhrase, password }) => {
                  const result = await invoke('system.destructive', {
                    action,
                    confirmationPhrase,
                    password,
                    includeAttachments: true
                  })
                  app.toast({
                    tone: 'success',
                    title: 'Action completed',
                    detail: `${result.affected} record(s) removed. Pre-action backup: ${result.preBackup.fileName} (${filesize(result.preBackup.sizeBytes)}).`
                  })
                  counts.reload()
                }
              })
            }
          >
            Run
          </Button>
        </div>
      ))}

      <p className="field__hint">
        Money already recorded stays consistent: voiding is preferred over deleting, and every destructive
        action is written to the audit log with the account that performed it.
      </p>
      <p className="field__hint">
        Current balance of invoiced value: {money(data.invoices_invoiced_poisha ?? 0)}
      </p>
    </Card>
  )
}
