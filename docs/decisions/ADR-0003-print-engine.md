# ADR-0003 — Document model + HTML/CSS layout + Chromium print pipeline

* **Status:** Accepted
* **Date:** 2026-09-29

## Context

Prescriptions and invoices must print on A4, A5, thermal 58/80 mm, and network/Bluetooth printers, must
support Bengali Unicode, must produce reliable PDFs with embedded fonts, must never clip content, and
must reserve real blank space for a doctor's handwritten signature (REQ §29–§33, §61–§62, §105).

## Options

1. **Per-printer hardcoded layouts** — rejected: unmaintainable, breaks on every new device.
2. **Server-side PDF library (PDFKit/pdfmake/jsPDF) as primary** — rejected as primary: Bengali shaping
   and font subsetting are fragile, preview ≠ print, and thermal layouts would need a second engine.
3. **HTML/CSS document model rendered by Chromium, printed via `webContents.print` / `printToPDF`** —
   chosen: identical code path for preview, printer and PDF; CSS `@page` gives exact mm control; Chromium
   embeds bundled OFL fonts; one layout engine adapts to all paper sizes.

## Decision

Build `src/shared/printing/*` (paper catalog, layout primitives, document builders) and
`src/main/printing/print-service.ts`:

* Services produce a **typed `PrintDocument`** from the database (never renderer HTML) → auditable,
  testable layout snapshot tests (long names, many medicines, empty sections, Bengali).
* The renderer renders that model in a `PrintHost` surface using mm-precise CSS; **preview and print use
  the same component**.
* Printing happens in an offscreen `BrowserWindow`; `printToPDF` for "Save as PDF", `webContents.print`
  for physical devices with `deviceName`, `pageSize`, `margins`, `scale`, `copies` from the selected
  `printer_profiles` row.
* Thermal profiles (58 mm/80 mm) switch to a single-column, high-contrast layout with reduced ornament.
* Every component of the layout is page-break aware (`thead` repetition, `break-inside: avoid`,
  signature block on its own avoid-break region with ≥ 25 mm vertical clear space and **no text below
  it**).

## Consequences

* One layout system, testable, printable to any Windows device including Bluetooth/network printers.
* Print fidelity depends on Chromium print internals — mitigated by a print test matrix executed
  against generated PDFs (page count, geometry assertions, glyph-presence checks) in CI.
