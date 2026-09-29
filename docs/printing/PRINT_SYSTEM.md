# Dentiva Pro — Print & PDF System Specification

**Document ID:** PRINT-001 · **Version:** 1.0.0 · **Status:** Approved
**Related:** ADR-0003, `src/shared/printing/*`, `src/main/printing/*`, `src/renderer/src/print/*`

---

## 1. Goals

Print professional prescriptions and invoices on A4, A5, A6, Letter, 58 mm and 80 mm thermal paper, to
standard Windows printers (USB, wired LAN, Wi-Fi, Bluetooth), and save identical-fidelity PDFs with
embedded Bengali + Latin fonts. Layout must never clip, overlap, lose content, break the signature area,
or produce orphan/blank pages.

## 2. Pipeline

```
DB rows ──► services document builders (shared/printing/documents.ts)
         ──► PrintDocument model  (typed, testable, versioned)
         ──► renderer PrintHost (mm-precise CSS, same component for preview & print)
         ──► offscreen BrowserWindow
              ├─ webContents.printToPDF()  →  Save as PDF (embedded fonts)
              └─ webContents.print({ deviceName, pageSize, margins, scale, copies })
```

* Documents are built **only** from database rows (a caller cannot inject HTML/arbitrary markup).
* The preview surface is literally the component that is printed → WYSIWYG by construction.
* Hidden by default: `PrintHost` renders inside an offscreen window created per job and destroyed after.

## 3. Paper catalogue (`shared/printing/paper.ts`)

| Key | Size | Margins (mm) | Notes |
|---|---|---|---|
| `A4` | 210 × 297 | 12 / 12 / 12 / 14 | default for invoices |
| `A5` | 148 × 210 | 8 | compact prescription variant |
| `A6` | 105 × 148 | 6 | mini prescription / token slip |
| `Letter` | 215.9 × 279.4 | 12 | |
| `thermal58` | 58 × auto | 3 | single column, large type, no header art |
| `thermal80` | 80 × auto | 4 | single column |
| `custom` | user width/height | user | validated 40–320 mm width |

Scaling rule: content is laid out in CSS `@page` boxes with `mm` units; the thermal profiles reflow to a
single column and drop decorative rules, so no layout is hardcoded per printer.

## 4. Prescription document (REQ §29)

```
┌───────────────────────────────────────────────────────────────────────┐
│ [LOGO] CLINIC NAME (bangla ok)                    Dr. NAME            │
│        address · phone · email                    BDS, FCPS, …        │
│                                                   Consultant Dentist  │
├───────────────────────────────────────────────────────────────────────┤
│ Patient: <name>     Age: <age>   Sex: <sex>      Date: <dd MMM yyyy>  │
├──────────────────────────────┬────────────────────────────────────────┤
│ C/C   chief complaints       │ Rx                                      │
│ O/E   on examination         │ 1. Tab. NAME 500mg — 1-0-1 — after food │
│ R/E   diagnosis / remarks    │    × 5 days  → 10 pcs                   │
│ Advice  …                    │ 2. …                                    │
│                              │ (multi-page safe: repeats table header) │
├──────────────────────────────┴────────────────────────────────────────┤
│ Follow-up: <date>                                                     │
│ <footer quote / consultation timing>                                  │
│                                                                       │
│                        (≥ 25 mm clear space — nothing printed below)  │
│                                            ______________________     │
│                                            Dr. <name>                 │
│                                            <designation>              │
└───────────────────────────────────────────────────────────────────────┘
```

* Left column (clinical) and right column (medicines) are balanced grid columns (42 % / 58 %); on thermal
  they stack.
* Signature block is a `break-inside: avoid` block with at least 25 mm of vertical clear space and no
  text placed beneath it (physical signing space requirement).
* Bengali clinic/patient text renders with Noto Sans Bengali; medicine names support arbitrary length with
  wrapping (no ellipsis in print).

## 5. Invoice document (REQ §32)

* Header contains **clinic name, logo, address, phone only** — doctor information is included only if the
  clinic explicitly enables it in Settings (`invoice.showDentist`).
* **No signature block and no footer signature area** (explicit product rule).
* Body: invoice number, date, patient block, item table (`#`, description, qty, unit price, discount,
  line total), then totals block: subtotal, discount, tax/adjustment (if enabled), round-off, **total**,
  paid, **due**, payment status chip, and optional payment history lines (received amounts with method and
  date) plus a payment-terms note.
* Multi-page: header repeats via `<thead>`, totals block kept together, "continued" marker on subsequent
  pages, page numbering `Page n of m`.
* Thermal: 80/58 mm single-column receipt with item lines, totals and payment status; no decorative rules.

## 6. Fonts and PDF fidelity

* `@fontsource/inter` (Latin) and `@fontsource/noto-sans-bengali` (Bengali) are bundled and registered with
  `@font-face` using `unicode-range`, so mixed Bangla/English text in one line shapes correctly.
* `printToPDF` runs with `printBackground: true`, `preferCSSPageSize: true`, and the bundled fonts are
  already loaded in the document (fonts awaited before print) → text is embedded, not rasterised.
* Verification test: render Bengali + English prescription to PDF, assert page size, page count, no third
  page, text extractability of Bengali glyph clusters and Latin tokens (`tests/integration/print.test.ts`).

## 7. Printer profiles (REQ §31, §33, §61)

`printer_profiles` rows store: name, document type (`prescription | invoice | report`), OS device name (or
`default`), paper key, custom dimensions, orientation, margins override, scale %, copies, thermal options
(print density via system dialog where unsupported programmatically), and `is_default` (one per document
type). The print dialog lists installed printers (`webContents.getPrintersAsync()`), shows a live preview,
and lets the user change paper/orientation/scale/copies before printing; "Print", "Save as PDF" and
"Print copy" are real actions. Printer profiles are managed in Settings → Printing, and included in
backups.

## 8. Failure handling

* Missing printer (unplugged/offline/Bluetooth unavailable) → clear message naming the device, job marked
  failed in logs (no patient data), user can retry or choose another printer; the document is never lost.
* Print job failures never crash the app; the offscreen window is always destroyed in a `finally` block.
* Every print/copy is recorded (`printed_count`, `last_printed_at`) so reprints are visible in history.

## 9. Test matrix (executed in CI where a device is unavailable → PDF assertions)

Prescription: A4, A5, A6, 58 mm, 80 mm; English, Bengali, mixed; 1 and 12+ medicines (multi-page); long
clinic name/address; long dentist qualification list; empty C/C-O/E; long advice; large logo; missing logo;
signature-area clearance assertion; no text below signature.
Invoice: A4, A5, 80 mm, 58 mm; unpaid/partial/paid; 1 and 30 line items (multi-page with repeated header);
long item descriptions; discount + tax + round-off; Bengali patient name; voided invoice watermark;
dentist header hidden/shown.
