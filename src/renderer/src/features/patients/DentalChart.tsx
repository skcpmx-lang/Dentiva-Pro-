/**
 * Dental chart (FDI notation, permanent and primary dentition).
 *
 * The chart is a real editor, not a picture: click a tooth to select it, click a condition, optionally
 * pick surfaces, and save. The chart is stored per patient (optionally per visit) so the history of what
 * was found when is preserved; nothing is overwritten silently.
 */

import { useEffect, useMemo, useState } from 'react'
import { CircleDot, Eraser, Save, Undo2 } from 'lucide-react'
import type { DentalChartEntry, DentalCondition } from '@shared/types'
import type { Dentition, ToothSurface } from '@shared/constants'
import { TOOTH_SURFACE_LABELS } from '@shared/constants'
import { invoke } from '../../lib/api'
import { useApp } from '../../app/state'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SegmentedControl,
  Select
} from '../../components/ui'
import { useAction, useQuery } from '../../lib/hooks'
import { PERMANENT_TEETH, PRIMARY_TEETH, toothLabel } from '@shared/dental'

interface DraftEntry {
  toothNumber: string
  conditionCode: string
  treatmentCode: string | null
  surfaces: string[]
  status: 'existing' | 'planned' | 'completed'
  note: string | null
}

export function DentalChart({ patientId, visitId = null }: { patientId: number; visitId?: number | null }) {
  const app = useApp()
  const [dentition, setDentition] = useState<Dentition>('permanent')
  const [selectedTeeth, setSelectedTeeth] = useState<string[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [draft, setDraft] = useState<DraftEntry[]>([])
  const [surfaceSelection, setSurfaceSelection] = useState<ToothSurface[]>([])

  const chart = useQuery('chart.get', { patientId, visitId }, { deps: [patientId, visitId] })
  const conditions = useQuery('chart.conditions', undefined)
  const save = useAction(async (entries: DraftEntry[]) =>
    invoke('chart.save', { patientId, visitId, entries })
  )

  const storedEntries = chart.data?.entries

  useEffect(() => {
    const entries: DentalChartEntry[] = storedEntries ?? []
    setDraft(
      entries.map((entry) => ({
        toothNumber: entry.toothNumber,
        conditionCode: entry.conditionCode,
        treatmentCode: entry.treatmentCode,
        surfaces: entry.surfaces,
        status: entry.status,
        note: entry.note
      }))
    )
    setCanEdit(false)
    setSelectedTeeth([])
  }, [storedEntries])

  const conditionByCode = useMemo(() => {
    const map = new Map<string, DentalCondition>()
    for (const condition of conditions.data ?? []) map.set(condition.code, condition)
    return map
  }, [conditions.data])

  const conditionOptions = useMemo(
    () =>
      (conditions.data ?? [])
        .filter((condition) => condition.appliesTo === 'both' || condition.appliesTo === dentition)
        .map((condition) => ({ value: condition.code, label: `${condition.name} (${condition.code})` })),
    [conditions.data, dentition]
  )

  const teeth = useMemo(() => (dentition === 'permanent' ? PERMANENT_TEETH : PRIMARY_TEETH), [dentition])
  const upper = teeth.slice(0, 16)
  const lower = teeth.slice(16)

  const draftByTooth = useMemo(() => {
    const map = new Map<string, DraftEntry>()
    for (const entry of draft) map.set(entry.toothNumber, entry)
    return map
  }, [draft])

  const isDirty = useMemo(() => {
    const entries = storedEntries ?? []
    if (entries.length !== draft.length) return true
    return draft.some((entry) => {
      const original = entries.find((item) => item.toothNumber === entry.toothNumber)
      if (!original) return true
      return (
        original.conditionCode !== entry.conditionCode ||
        original.status !== entry.status ||
        original.note !== entry.note ||
        original.surfaces.join(',') !== entry.surfaces.join(',')
      )
    })
  }, [draft, storedEntries])

  function toggleTooth(tooth: string): void {
    setSelectedTeeth((current) =>
      current.includes(tooth) ? current.filter((item) => item !== tooth) : [...current, tooth]
    )
  }

  function applyCondition(conditionCode: string, surfaces: ToothSurface[]): void {
    if (selectedTeeth.length === 0) return
    setDraft((current) => {
      const next = [...current]
      for (const tooth of selectedTeeth) {
        const index = next.findIndex((entry) => entry.toothNumber === tooth)
        const entry: DraftEntry = {
          toothNumber: tooth,
          conditionCode,
          treatmentCode: index >= 0 ? next[index].treatmentCode : null,
          surfaces,
          status: 'existing',
          note: index >= 0 ? next[index].note : null
        }
        if (index >= 0) next[index] = { ...next[index], ...entry }
        else next.push(entry)
      }
      return next
    })
    setCanEdit(true)
  }

  function clearTeeth(): void {
    if (selectedTeeth.length === 0) return
    setDraft((current) => current.filter((entry) => !selectedTeeth.includes(entry.toothNumber)))
    setCanEdit(true)
  }

  async function persist(): Promise<void> {
    const result = await save.run(draft)
    if (result.ok) {
      app.toast({ tone: 'success', title: 'Dental chart saved' })
      chart.reload()
    } else {
      app.toast({ tone: 'error', title: 'Could not save the chart', detail: result.error })
    }
  }

  if (chart.loading || conditions.loading) return <LoadingState label="Loading the dental chart…" />
  if (chart.error) return <ErrorState message={chart.error} onRetry={chart.reload} />
  if (conditions.error) return <ErrorState message={conditions.error} onRetry={conditions.reload} />

  const canWrite = app.hasPermission('chart.edit')

  return (
    <Card
      title="Dental chart"
      actions={
        <>
          <SegmentedControl
            value={dentition}
            onChange={(value) => {
              setDentition(value)
              setSelectedTeeth([])
            }}
            options={[
              { value: 'permanent', label: 'Permanent' },
              { value: 'primary', label: 'Primary' }
            ]}
          />
          {canWrite ? (
            <>
              <Button size="sm" disabled={selectedTeeth.length === 0} onClick={() => clearTeeth()}>
                <Eraser size={14} /> Clear selected
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!isDirty || save.pending}
                loading={save.pending}
                onClick={() => void persist()}
              >
                <Save size={14} /> Save chart
              </Button>
            </>
          ) : null}
        </>
      }
    >
      {!canEdit && canWrite ? (
        <p className="field__hint">
          Select one or more teeth, then choose a condition to mark them. Nothing is written until you press
          Save chart.
        </p>
      ) : null}

      <div className="chart-grid">
        <ToothRow
          teeth={upper}
          draftByTooth={draftByTooth}
          selected={selectedTeeth}
          onToggle={toggleTooth}
          conditionByCode={conditionByCode}
        />
        <ToothRow
          teeth={lower}
          draftByTooth={draftByTooth}
          selected={selectedTeeth}
          onToggle={toggleTooth}
          conditionByCode={conditionByCode}
          reverse
        />
      </div>

      <div className="toolbar" style={{ marginTop: 'var(--space-4)' }}>
        <Badge tone="info">
          <CircleDot size={12} /> {selectedTeeth.length} tooth(es) selected
        </Badge>
        {selectedTeeth.length > 0 ? (
          <span className="field__hint">{selectedTeeth.map((tooth) => toothLabel(tooth)).join(', ')}</span>
        ) : null}
      </div>

      {canWrite ? (
        <div className="form-grid form-grid--wide" style={{ marginTop: 'var(--space-3)' }}>
          <Select
            label="Condition / treatment"
            value=""
            onValueChange={(value) => {
              if (value) applyCondition(value, surfaceSelection)
            }}
            options={conditionOptions}
            placeholder="Choose a condition to apply"
            disabled={selectedTeeth.length === 0}
          />
          <div>
            <span className="field__label">Surfaces (optional)</span>
            <div className="toolbar" style={{ flexWrap: 'wrap' }}>
              {(Object.keys(TOOTH_SURFACE_LABELS) as ToothSurface[]).map((surface) => (
                <button
                  key={surface}
                  type="button"
                  className={
                    surfaceSelection.includes(surface)
                      ? 'button button--sm button--primary'
                      : 'button button--sm'
                  }
                  onClick={() =>
                    setSurfaceSelection((current) =>
                      current.includes(surface)
                        ? current.filter((item) => item !== surface)
                        : [...current, surface]
                    )
                  }
                >
                  {surface}
                </button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setSurfaceSelection([])}>
                <Undo2 size={14} /> Reset
              </Button>
            </div>
          </div>
          <div>
            <span className="field__label">Status for the next condition</span>
            <SegmentedControl
              value={draft.find((entry) => selectedTeeth.includes(entry.toothNumber))?.status ?? 'existing'}
              onChange={(value) =>
                setDraft((current) =>
                  current.map((entry) =>
                    selectedTeeth.includes(entry.toothNumber) ? { ...entry, status: value } : entry
                  )
                )
              }
              options={[
                { value: 'existing', label: 'Existing' },
                { value: 'planned', label: 'Planned' },
                { value: 'completed', label: 'Completed' }
              ]}
            />
          </div>
        </div>
      ) : null}

      <div className="tooth-legend" style={{ marginTop: 'var(--space-4)' }}>
        {(conditions.data ?? []).slice(0, 16).map((condition) => (
          <span key={condition.code} className="tooth-legend__item">
            <span
              className="tooth-legend__swatch"
              style={{ background: condition.color }}
              aria-hidden="true"
            />
            {condition.name}
          </span>
        ))}
      </div>

      {draft.length === 0 ? (
        <EmptyState title="The chart is empty" description="No findings recorded for this patient yet." />
      ) : (
        <div className="table-wrapper" style={{ marginTop: 'var(--space-3)' }}>
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Tooth</th>
                <th>Condition</th>
                <th>Surfaces</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.map((entry) => (
                <tr key={entry.toothNumber}>
                  <td>
                    <span className="mono">{entry.toothNumber}</span> · {toothLabel(entry.toothNumber)}
                  </td>
                  <td>{conditionByCode.get(entry.conditionCode)?.name ?? entry.conditionCode}</td>
                  <td>{entry.surfaces.join(', ') || '—'}</td>
                  <td>
                    <Badge
                      tone={
                        entry.status === 'completed'
                          ? 'success'
                          : entry.status === 'planned'
                            ? 'info'
                            : 'neutral'
                      }
                    >
                      {entry.status}
                    </Badge>
                  </td>
                  <td>
                    {canWrite ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setDraft((current) =>
                            current.filter((item) => item.toothNumber !== entry.toothNumber)
                          )
                          setCanEdit(true)
                        }}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function ToothRow({
  teeth,
  draftByTooth,
  selected,
  onToggle,
  conditionByCode,
  reverse
}: {
  teeth: string[]
  draftByTooth: Map<string, DraftEntry>
  selected: string[]
  onToggle: (tooth: string) => void
  conditionByCode: Map<string, DentalCondition>
  reverse?: boolean
}) {
  const ordered = reverse ? [...teeth].reverse() : teeth
  return (
    <div className="chart-row">
      <span className="chart-row__label">{reverse ? 'Lower' : 'Upper'}</span>
      <div className="chart-teeth">
        {ordered.map((tooth) => {
          const entry = draftByTooth.get(tooth)
          const condition = entry ? conditionByCode.get(entry.conditionCode) : undefined
          const isSelected = selected.includes(tooth)
          return (
            <button
              key={tooth}
              type="button"
              className={isSelected ? 'tooth tooth--selected' : 'tooth'}
              onClick={() => onToggle(tooth)}
              aria-pressed={isSelected}
              title={`${tooth} — ${toothLabel(tooth)}${condition ? ` · ${condition.name}` : ''}`}
              style={condition ? { borderColor: condition.color, color: condition.textColor } : undefined}
            >
              <span
                className="tooth__number"
                style={condition ? { background: condition.color, color: condition.textColor } : undefined}
              >
                {tooth}
              </span>
              <span className="tooth__face" style={condition ? { background: condition.color } : undefined} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
