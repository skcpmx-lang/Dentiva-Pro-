/**
 * Paper catalogue for the print engine (ADR-0003).
 *
 * Every document is laid out with CSS millimetre units; the paper definition below drives `@page` size,
 * margins and the layout variant (single-column thermal vs. columned A-series).
 */

export const PAPER_SIZE_KEYS = ['A4', 'A5', 'A6', 'Letter', 'thermal58', 'thermal80', 'custom'] as const
export type PaperSizeKey = (typeof PAPER_SIZE_KEYS)[number]

export interface PaperMarginsMm {
  top: number
  right: number
  bottom: number
  left: number
}

export interface PaperSize {
  key: PaperSizeKey
  label: string
  widthMm: number
  heightMm: number | null // null = continuous roll
  margins: PaperMarginsMm
  /** Thermal/roll papers use a single-column, reduced-decoration layout. */
  thermal: boolean
  /** Maximum number of content columns the layout may use. */
  columns: 1 | 2
  /** Base body font size in points for this paper. */
  bodyPt: number
}

export const PAPER_SIZES: Record<PaperSizeKey, PaperSize> = {
  A4: {
    key: 'A4',
    label: 'A4 (210 × 297 mm)',
    widthMm: 210,
    heightMm: 297,
    margins: { top: 12, right: 12, bottom: 14, left: 12 },
    thermal: false,
    columns: 2,
    bodyPt: 10.5
  },
  A5: {
    key: 'A5',
    label: 'A5 (148 × 210 mm)',
    widthMm: 148,
    heightMm: 210,
    margins: { top: 8, right: 8, bottom: 8, left: 8 },
    thermal: false,
    columns: 1,
    bodyPt: 9.5
  },
  A6: {
    key: 'A6',
    label: 'A6 (105 × 148 mm)',
    widthMm: 105,
    heightMm: 148,
    margins: { top: 6, right: 6, bottom: 6, left: 6 },
    thermal: false,
    columns: 1,
    bodyPt: 9
  },
  Letter: {
    key: 'Letter',
    label: 'Letter (8.5 × 11 in)',
    widthMm: 215.9,
    heightMm: 279.4,
    margins: { top: 12, right: 12, bottom: 14, left: 12 },
    thermal: false,
    columns: 2,
    bodyPt: 10.5
  },
  thermal58: {
    key: 'thermal58',
    label: 'Thermal 58 mm',
    widthMm: 58,
    heightMm: null,
    margins: { top: 3, right: 3, bottom: 3, left: 3 },
    thermal: true,
    columns: 1,
    bodyPt: 9
  },
  thermal80: {
    key: 'thermal80',
    label: 'Thermal 80 mm',
    widthMm: 80,
    heightMm: null,
    margins: { top: 4, right: 4, bottom: 4, left: 4 },
    thermal: true,
    columns: 1,
    bodyPt: 9.5
  },
  custom: {
    key: 'custom',
    label: 'Custom size',
    widthMm: 210,
    heightMm: 297,
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    thermal: false,
    columns: 1,
    bodyPt: 10
  }
}

export const CUSTOM_PAPER_LIMITS = { minWidthMm: 40, maxWidthMm: 320, minHeightMm: 40, maxHeightMm: 1000 }

/**
 * Resolve a paper definition, applying custom dimensions and profile margin overrides.
 * Invalid custom dimensions throw, so a bad profile can never produce a broken print job.
 */
export function resolvePaper(
  key: PaperSizeKey,
  options: {
    customWidthMm?: number | null
    customHeightMm?: number | null
    margins?: Partial<PaperMarginsMm> | null
  } = {}
): PaperSize {
  const base = PAPER_SIZES[key] ?? PAPER_SIZES.A4
  let paper: PaperSize = { ...base }

  if (key === 'custom') {
    const width = options.customWidthMm ?? base.widthMm
    const height = options.customHeightMm ?? base.heightMm ?? 297
    if (width < CUSTOM_PAPER_LIMITS.minWidthMm || width > CUSTOM_PAPER_LIMITS.maxWidthMm) {
      throw new Error(
        `Custom paper width must be between ${CUSTOM_PAPER_LIMITS.minWidthMm} and ${CUSTOM_PAPER_LIMITS.maxWidthMm} mm.`
      )
    }
    if (height < CUSTOM_PAPER_LIMITS.minHeightMm || height > CUSTOM_PAPER_LIMITS.maxHeightMm) {
      throw new Error(
        `Custom paper height must be between ${CUSTOM_PAPER_LIMITS.minHeightMm} and ${CUSTOM_PAPER_LIMITS.maxHeightMm} mm.`
      )
    }
    paper = {
      ...paper,
      widthMm: width,
      heightMm: height,
      thermal: width <= 85,
      columns: width <= 120 ? 1 : 2
    }
  }

  if (options.margins) {
    paper = { ...paper, margins: { ...paper.margins, ...options.margins } }
  }

  return paper
}

export function paperCssSize(paper: PaperSize): string {
  const width = `${paper.widthMm}mm`
  const height = paper.heightMm == null ? 'auto' : `${paper.heightMm}mm`
  return `${width} ${height}`
}

/** Printable content box in millimetres (used by layout tests to guarantee no clipping). */
export function contentBoxMm(paper: PaperSize): { widthMm: number; heightMm: number | null } {
  const width = paper.widthMm - paper.margins.left - paper.margins.right
  const height = paper.heightMm == null ? null : paper.heightMm - paper.margins.top - paper.margins.bottom
  return { widthMm: width, heightMm: height }
}

export function describePaper(paper: PaperSize): string {
  if (paper.heightMm == null) return `${paper.widthMm} mm roll`
  return `${paper.widthMm} × ${paper.heightMm} mm`
}

export function isThermalPaper(key: string): boolean {
  return key === 'thermal58' || key === 'thermal80'
}
