/**
 * Dental chart model — FDI two-digit tooth numbering for adult (permanent) and pediatric (primary)
 * dentitions, with chart-order helpers used by the interactive chart and print documents.
 */

import type { Dentition, ToothSurface } from './constants'

export interface ToothDefinition {
  /** FDI number as a string, e.g. "11" (upper right central incisor) or "55" (primary). */
  fdi: string
  dentition: Dentition
  quadrant: 1 | 2 | 3 | 4
  label: string
  shortLabel: string
  surfaceSet: ToothSurface[]
}

export const PERMANENT_TEETH: string[] = [
  // Upper right (1), upper left (2) — read from the patient's perspective (chart is mirrored)
  '18',
  '17',
  '16',
  '15',
  '14',
  '13',
  '12',
  '11',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  // Lower left (3), lower right (4)
  '38',
  '37',
  '36',
  '35',
  '34',
  '33',
  '32',
  '31',
  '41',
  '42',
  '43',
  '44',
  '45',
  '46',
  '47',
  '48'
]

export const PRIMARY_TEETH: string[] = [
  '55',
  '54',
  '53',
  '52',
  '51',
  '61',
  '62',
  '63',
  '64',
  '65',
  '75',
  '74',
  '73',
  '72',
  '71',
  '81',
  '82',
  '83',
  '84',
  '85'
]

const TOOTH_LABELS: Record<string, { label: string; short: string }> = {
  '11': { label: 'Upper right central incisor', short: 'UR1' },
  '12': { label: 'Upper right lateral incisor', short: 'UR2' },
  '13': { label: 'Upper right canine', short: 'UR3' },
  '14': { label: 'Upper right first premolar', short: 'UR4' },
  '15': { label: 'Upper right second premolar', short: 'UR5' },
  '16': { label: 'Upper right first molar', short: 'UR6' },
  '17': { label: 'Upper right second molar', short: 'UR7' },
  '18': { label: 'Upper right third molar', short: 'UR8' },
  '21': { label: 'Upper left central incisor', short: 'UL1' },
  '22': { label: 'Upper left lateral incisor', short: 'UL2' },
  '23': { label: 'Upper left canine', short: 'UL3' },
  '24': { label: 'Upper left first premolar', short: 'UL4' },
  '25': { label: 'Upper left second premolar', short: 'UL5' },
  '26': { label: 'Upper left first molar', short: 'UL6' },
  '27': { label: 'Upper left second molar', short: 'UL7' },
  '28': { label: 'Upper left third molar', short: 'UL8' },
  '31': { label: 'Lower left central incisor', short: 'LL1' },
  '32': { label: 'Lower left lateral incisor', short: 'LL2' },
  '33': { label: 'Lower left canine', short: 'LL3' },
  '34': { label: 'Lower left first premolar', short: 'LL4' },
  '35': { label: 'Lower left second premolar', short: 'LL5' },
  '36': { label: 'Lower left first molar', short: 'LL6' },
  '37': { label: 'Lower left second molar', short: 'LL7' },
  '38': { label: 'Lower left third molar', short: 'LL8' },
  '41': { label: 'Lower right central incisor', short: 'LR1' },
  '42': { label: 'Lower right lateral incisor', short: 'LR2' },
  '43': { label: 'Lower right canine', short: 'LR3' },
  '44': { label: 'Lower right first premolar', short: 'LR4' },
  '45': { label: 'Lower right second premolar', short: 'LR5' },
  '46': { label: 'Lower right first molar', short: 'LR6' },
  '47': { label: 'Lower right second molar', short: 'LR7' },
  '48': { label: 'Lower right third molar', short: 'LR8' },
  '51': { label: 'Upper right primary central incisor', short: 'UR-A' },
  '52': { label: 'Upper right primary lateral incisor', short: 'UR-B' },
  '53': { label: 'Upper right primary canine', short: 'UR-C' },
  '54': { label: 'Upper right primary first molar', short: 'UR-D' },
  '55': { label: 'Upper right primary second molar', short: 'UR-E' },
  '61': { label: 'Upper left primary central incisor', short: 'UL-A' },
  '62': { label: 'Upper left primary lateral incisor', short: 'UL-B' },
  '63': { label: 'Upper left primary canine', short: 'UL-C' },
  '64': { label: 'Upper left primary first molar', short: 'UL-D' },
  '65': { label: 'Upper left primary second molar', short: 'UL-E' },
  '71': { label: 'Lower left primary central incisor', short: 'LL-A' },
  '72': { label: 'Lower left primary lateral incisor', short: 'LL-B' },
  '73': { label: 'Lower left primary canine', short: 'LL-C' },
  '74': { label: 'Lower left primary first molar', short: 'LL-D' },
  '75': { label: 'Lower left primary second molar', short: 'LL-E' },
  '81': { label: 'Lower right primary central incisor', short: 'LR-A' },
  '82': { label: 'Lower right primary lateral incisor', short: 'LR-B' },
  '83': { label: 'Lower right primary canine', short: 'LR-C' },
  '84': { label: 'Lower right primary first molar', short: 'LR-D' },
  '85': { label: 'Lower right primary second molar', short: 'LR-E' }
}

const POSTERIOR = new Set(['4', '5', '6', '7', '8'])
const INCISOR_POSTERIOR = new Set(['4', '5'])

/** Surfaces recorded for a tooth: posteriors use occlusal, anteriors use incisal instead. */
export function surfacesForTooth(fdi: string): ToothSurface[] {
  const secondDigit = fdi.slice(-1)
  if (POSTERIOR.has(secondDigit)) return ['M', 'D', 'B', 'L', 'O']
  if (INCISOR_POSTERIOR.has(secondDigit)) return ['M', 'D', 'B', 'L', 'O']
  return ['M', 'D', 'B', 'L', 'I']
}

export function dentitionOf(fdi: string): Dentition | null {
  if (/^[1-4][1-8]$/.test(fdi)) return 'permanent'
  if (/^[5-8][1-5]$/.test(fdi)) return 'primary'
  return null
}

export function isValidToothNumber(fdi: string): boolean {
  return dentitionOf(fdi) !== null
}

export function toothLabel(fdi: string): string {
  return TOOTH_LABELS[fdi]?.label ?? `Tooth ${fdi}`
}

export function toothShortLabel(fdi: string): string {
  return TOOTH_LABELS[fdi]?.short ?? fdi
}

export function quadrantOf(fdi: string): 1 | 2 | 3 | 4 | null {
  const first = Number(fdi[0])
  if (first >= 1 && first <= 4) return first as 1 | 2 | 3 | 4
  if (first >= 5 && first <= 8) return (first - 4) as 1 | 2 | 3 | 4
  return null
}

/** Chart row layout: [upperRight, upperLeft] then [lowerLeft, lowerRight] (patient-mirrored). */
export function chartRows(dentition: Dentition): { upper: string[][]; lower: string[][] } {
  if (dentition === 'primary') {
    return {
      upper: [
        ['55', '54', '53', '52', '51'],
        ['61', '62', '63', '64', '65']
      ],
      lower: [
        ['85', '84', '83', '82', '81'],
        ['71', '72', '73', '74', '75']
      ]
    }
  }
  return {
    upper: [
      ['18', '17', '16', '15', '14', '13', '12', '11'],
      ['21', '22', '23', '24', '25', '26', '27', '28']
    ],
    lower: [
      ['48', '47', '46', '45', '44', '43', '42', '41'],
      ['31', '32', '33', '34', '35', '36', '37', '38']
    ]
  }
}

export function allTeeth(dentition: Dentition): string[] {
  return dentition === 'primary' ? [...PRIMARY_TEETH] : [...PERMANENT_TEETH]
}

/** Ordering key so tooth numbers sort anatomically on screen and in print. */
export function toothSortIndex(fdi: string): number {
  const dentition = dentitionOf(fdi)
  const list = dentition === 'primary' ? PRIMARY_TEETH : PERMANENT_TEETH
  const index = list.indexOf(fdi)
  return index === -1 ? 999 : index
}

export function sortTeeth(teeth: readonly string[]): string[] {
  return [...teeth].sort((a, b) => toothSortIndex(a) - toothSortIndex(b))
}

/** Human readable list for documents: "11, 12, 36" (anatomically ordered). */
export function formatToothList(teeth: readonly string[]): string {
  return sortTeeth(teeth).join(', ')
}
