/**
 * Reports: every figure is produced by a SQL query in the main process over real transactions — nothing is
 * estimated in the browser. Any report can be printed or exported to CSV/PDF, and the print header contains
 * only the clinic identity required by the specification.
 */

import { useMemo, useState } from 'react'
import { BarChart3, Download, FileText, Printer } from 'lucide-react'
import type { ReportDataPayload, ReportDataResult, ReportPrintRequest } from '@shared/ipc'
import { invoke } from '../../lib/api'
import { useApp } from '../../app/state'
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pagination,
  SegmentedControl,
  Select,
  TextInput
} from '../../components/ui'
import { usePagination, useQuery } from '../../lib/hooks'
import { formatDate, money } from '../../lib/format'
import { addDaysIso, todayIso } from '@shared/date'
import { PAPER_SIZE_KEYS } from '@shared/printing/paper'
import { REPORT_CATALOGUE } from '@shared/constants'

type Preset = 'today' | 'last7' | 'last30' | 'thisMonth' | 'thisYear' | 'custom'

function rangeFor(preset: Preset, customFrom: string, customTo: string): { from: string; to: string } {
  const today = todayIso()
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'last7':
      return { from: addDaysIso(today, -6), to: today }
    case 'last30':
      return { from: addDaysIso(today, -29), to: today }
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'thisYear':
      return { from: `${today.slice(0, 4)}-01-01`, to: today }
    default:
      return { from: customFrom, to: customTo }
  }
}

export function ReportsPage() {
  const app = useApp()
  const pagination = usePagination(50)
  const [report, setReport] = useState<string>(REPORT_CATALOGUE[0]?.key ?? 'daily_income')
  const [preset, setPreset] = useState<Preset>('last30')
  const [customFrom, setCustomFrom] = useState(addDaysIso(todayIso(), -29))
  const [customTo, setCustomTo] = useState(todayIso())
  const [paper, setPaper] = useState('a4_portrait')
  const [busy, setBusy] = useState<'print' | 'pdf' | 'csv' | null>(null)

  const range = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo])
  const payload: ReportDataPayload = { report, from: range.from, to: range.to }
  const data = useQuery('reports.data', payload, { deps: [report, range.from, range.to] })

  const active = REPORT_CATALOGUE.find((entry) => entry.key === report) ?? REPORT_CATALOGUE[0]

  async function exportCsv(): Promise<void> {
    const result = data.data
    if (!result) return
    if (!app.hasPermission('reports.financial.export')) {
      app.toast({
        tone: 'warning',
        title: 'Export not allowed',
        detail: 'Your role cannot export financial reports.'
      })
      return
    }
    setBusy('csv')
    try {
      const folder = await invoke('export.chooseFolder', { title: 'Choose a folder for the report' })
      if (!folder) return
      const response = await invoke('reports.export', {
        report,
        from: range.from,
        to: range.to,
        targetFolder: folder
      })
      app.toast({ tone: 'success', title: `Exported ${response.rowCount} row(s)`, detail: response.filePath })
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

  async function printReport(mode: 'preview' | 'pdf'): Promise<void> {
    const result = data.data
    if (!result) return
    if (!app.hasPermission('reports.financial.view')) return
    setBusy(mode === 'pdf' ? 'pdf' : 'print')
    try {
      const request: ReportPrintRequest = {
        title: result.title,
        from: range.from,
        to: range.to,
        columns: result.columns,
        rows: result.rows.map((row) => row.map((cell) => String(cell))),
        summaries: result.summaries,
        footNotes: result.footNotes,
        paper
      }
      const job = await invoke('print.job', {
        documentType: 'report',
        entityId: 0,
        mode,
        reportRequest: request
      })
      if (!job.ok) app.toast({ tone: 'error', title: 'Could not prepare the report', detail: job.message })
      else if (job.filePath)
        app.toast({ tone: 'success', title: 'Report saved as PDF', detail: job.filePath })
    } catch (cause) {
      app.toast({
        tone: 'error',
        title: 'Could not print the report',
        detail: cause instanceof Error ? cause.message : String(cause)
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Financial and practice reporting, computed from your own transactions"
        actions={
          <>
            <Button loading={busy === 'csv'} onClick={() => void exportCsv()} disabled={!data.data}>
              <Download size={16} /> Export CSV
            </Button>
            <Button
              loading={busy === 'print'}
              onClick={() => void printReport('preview')}
              disabled={!data.data}
            >
              <Printer size={16} /> Preview / print
            </Button>
            <Button
              variant="primary"
              loading={busy === 'pdf'}
              onClick={() => void printReport('pdf')}
              disabled={!data.data}
            >
              <FileText size={16} /> Save as PDF
            </Button>
          </>
        }
      />

      <Card>
        <div className="form-grid form-grid--wide">
          <Select
            label="Report"
            value={report}
            onValueChange={setReport}
            options={REPORT_CATALOGUE.map((entry) => ({ value: entry.key, label: entry.label }))}
          />
          <Select
            label="Paper"
            value={paper}
            onValueChange={setPaper}
            options={PAPER_SIZE_KEYS.map((key) => ({ value: key, label: key.replace(/_/g, ' ') }))}
            hint="Reports print on the selected paper size."
          />
          <div>
            <span className="field__label">Period</span>
            <SegmentedControl
              value={preset}
              onChange={setPreset}
              options={[
                { value: 'today', label: 'Today' },
                { value: 'last7', label: '7 days' },
                { value: 'last30', label: '30 days' },
                { value: 'thisMonth', label: 'Month' },
                { value: 'thisYear', label: 'Year' },
                { value: 'custom', label: 'Custom' }
              ]}
            />
          </div>
          {preset === 'custom' ? (
            <>
              <TextInput label="From" type="date" value={customFrom} onValueChange={setCustomFrom} />
              <TextInput label="To" type="date" value={customTo} onValueChange={setCustomTo} />
            </>
          ) : null}
        </div>
        {active ? <p className="field__hint">{active.description}</p> : null}
      </Card>

      {data.loading ? (
        <LoadingState label="Running the report…" />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : data.data ? (
        <ReportTable result={data.data} pagination={pagination} />
      ) : (
        <EmptyState title="No data" description="Choose a report and a period." />
      )}
    </>
  )
}

function ReportTable({
  result,
  pagination
}: {
  result: ReportDataResult
  pagination: ReturnType<typeof usePagination>
}) {
  const from = (pagination.page - 1) * pagination.pageSize
  const rows = result.rows.slice(from, from + pagination.pageSize)

  return (
    <Card
      title={result.title}
      actions={
        <span className="field__hint">
          {result.rows.length.toLocaleString('en-US')} row(s) ·{' '}
          {result.summaries.map((summary) => `${summary.label}: ${summary.value}`).join(' · ')}
        </span>
      }
      flush
    >
      {result.rows.length === 0 ? (
        <EmptyState
          title="No transactions in this period"
          description="Nothing was recorded between these dates, so every figure would be zero."
        />
      ) : (
        <DataTable
          columns={result.columns.map((column) => ({
            key: column.key,
            header: column.label,
            align: column.align === 'right' ? 'right' : column.align === 'center' ? 'center' : 'left',
            render: (row: (string | number)[]) => {
              const index = result.columns.findIndex((entry) => entry.key === column.key)
              const cell = row[index]
              if (typeof cell === 'number') return money(cell)
              const text = String(cell ?? '')
              return /^\d{4}-\d{2}-\d{2}$/.test(text) ? formatDate(text) : text
            }
          }))}
          rows={rows}
          rowKey={(row, index) => String(index) + String(row[0] ?? '')}
          compact
          footer={
            <Pagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={result.rows.length}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
            />
          }
        />
      )}
      <div className="card__footer">
        <BarChart3 size={12} style={{ verticalAlign: 'middle' }} /> Figures are calculated by the database;
        the same numbers are printed on the report sheet.
      </div>
    </Card>
  )
}
