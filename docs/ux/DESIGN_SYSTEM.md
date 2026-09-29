# Dentiva Pro — UI/UX Design System

**Document ID:** UX-001 · **Version:** 1.0.0 · **Status:** Approved (implementation contract)
Implemented in `src/renderer/src/styles/tokens.css`, `base.css`, `components.css` — this document is the
normative source for values; code must match it.

---

## 1. Brand direction

Premium clinical software: deep teal primary, precise geometry, generous white space, restrained accent
colour, quiet elevation. It must read as *flagship practice-management software*, not a generic admin
template. No gradients-as-decoration, no rainbow charts, no playful shapes, no stock-photo energy.

Logo mark: rounded-square tooth silhouette with a clinical highlight (see `assets/branding/`), used in the
sidebar header, About page, print headers and installer icon.

## 2. Colour tokens

| Token | Value | Use |
|---|---|---|
| `--brand-900` | `#07303a` | deep panels, sidebar footer |
| `--brand-800` | `#0b3f4c` | sidebar background top |
| `--brand-700` | `#0e5162` | sidebar gradient end, headings on light |
| `--brand-600` | `#0f6d80` | primary buttons, active nav |
| `--brand-500` | `#12869c` | primary hover, links |
| `--brand-300` | `#7fc4d1` | charts, subtle borders on dark |
| `--brand-100` | `#e6f4f7` | selected rows, badges |
| `--brand-050` | `#f2f9fb` | section backgrounds |
| `--accent-600` | `#b45309` | attention chips (used sparingly) |
| `--success-600` / `--success-100` | `#12805c` / `#e3f5ee` | paid, active, in-stock |
| `--warning-600` / `--warning-100` | `#b7791f` / `#fdf3e3` | low stock, expiring, pending |
| `--danger-600` / `--danger-100` | `#b3261e` / `#fdeceb` | due, overdue, destructive |
| `--info-600` / `--info-100` | `#1d4ed8` / `#e8eefe` | informational, in-treatment |
| `--ink-900` | `#0f172a` | primary text |
| `--ink-700` | `#334155` | secondary text |
| `--ink-500` | `#64748b` | tertiary / meta |
| `--ink-300` | `#94a3b8` | disabled text, placeholders |
| `--line` | `#e2e8f0` | borders, dividers |
| `--line-strong` | `#cbd5e1` | input borders |
| `--surface` | `#ffffff` | cards, tables |
| `--surface-alt` | `#f8fafc` | page background, table stripes |
| `--surface-sunken` | `#f1f5f9` | wells, empty states |

Contrast: all text/background pairs used for content meet WCAG AA (≥ 4.5:1 body, ≥ 3:1 large/UI). Status is
never communicated by colour alone — every status chip carries a text label and/or icon.

## 3. Typography

* Families: `--font-ui: 'Inter'`, `--font-bn: 'Noto Sans Bengali'`, `--font-mono: 'JetBrains Mono', monospace`
  (numbers in tables use `font-variant-numeric: tabular-nums`).
* Bengali content renders in Noto Sans Bengali automatically via `:lang(bn)`, `.bn` class, or automatic
  script detection (Unicode-range font stacks in `@font-face`).
* Scale (desktop-first, `rem` based on 16px root):

| Token | Size / line-height | Use |
|---|---|---|
| `--text-3xl` | 30 / 36 | page hero numbers (dashboard KPIs) |
| `--text-2xl` | 24 / 32 | page titles |
| `--text-xl` | 20 / 28 | section titles, modal titles |
| `--text-lg` | 17 / 26 | card titles |
| `--text-md` | 15 / 24 | body, table cells |
| `--text-sm` | 13.5 / 20 | secondary, meta, table headers |
| `--text-xs` | 12 / 18 | captions, badges |

Weights: 400 body, 500 medium (labels/table headers), 600 semibold (titles/actions), 700 for KPI values.

## 4. Spacing, radius, elevation, motion

* Spacing scale: `2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48` px (`--space-1 … --space-11`).
* Radius: `--radius-sm 6px`, `--radius-md 10px`, `--radius-lg 14px`, `--radius-xl 18px`, `--radius-pill 999px`.
* Elevation: `--shadow-xs 0 1px 2px rgba(15,23,42,.06)`, `--shadow-sm 0 2px 6px rgba(15,23,42,.08)`,
  `--shadow-md 0 8px 20px rgba(15,23,42,.10)`, `--shadow-lg 0 18px 40px rgba(15,23,42,.16)`.
* Motion: `--motion-fast 120ms`, `--motion-base 180ms`, `--motion-slow 260ms`, easing `cubic-bezier(.2,.8,.2,1)`.
  Animations are limited to opacity/transform (no layout thrash), disabled under
  `@media (prefers-reduced-motion: reduce)`, and never block interaction.
* Layout constants: sidebar expanded 248 px, collapsed 72 px; header 60 px; page padding 20–24 px;
  content max-width 1680 px (centred beyond that); grid gutter 16 px.

## 5. Components (one implementation each, no per-screen styling)

| Component | Spec highlights |
|---|---|
| `Button` | variants `primary, secondary, ghost, danger, subtle`; sizes `sm (32), md (38), lg (44)`; icon + label always flex-centred, `gap 8px`, label `white-space: nowrap` + `text-overflow: ellipsis`; loading state replaces icon with spinner and disables; `:focus-visible` 2px brand ring offset 1px; disabled uses `--ink-300` on `--surface-sunken` |
| `IconButton` | 32/36 px square, tooltip + `aria-label` required, same focus ring |
| `Input`, `Textarea`, `Select`, `Combobox` | 38 px tall, 1px `--line-strong`, radius `--radius-sm`, focus = brand border + 3px ring; error = danger border + inline message with icon; label always present (floating placeholder is not a label); required marker; helper text slot |
| `DatePicker`, `TimePicker` | typed input + calendar/clock popover, keyboard navigable, respects clinic date format setting, quick presets (Today, This week, Last 30 days, Custom) |
| `SearchInput` | 300–420 px, leading icon, clear button, ⌘/Ctrl+F hint, debounce 250 ms |
| `Card` | `surface`, 1px `--line`, `--radius-lg`, `--shadow-xs`, 16–20 px padding; hover lift only for clickable cards |
| `StatCard` | label (sm, ink-500), value (3xl, tabular), delta chip, icon in tinted 40 px square, optional footnote; click target optional; never overflows (value truncates with tooltip) |
| `Table` | sticky header (`surface-alt`, medium 13.5px), zebra rows, 44 px row height, right-aligned numeric columns, row hover, sortable headers with direction indicators, skeleton loading rows, empty state row, footer pagination; horizontal scroll container with shadow edges when overflowing |
| `Pagination` | page size selector (10/25/50/100), range label “1–25 of 1,432”, first/prev/next/last, keyboard support |
| `Badge` / `StatusChip` | tonal (100 background / 600 text), 20 px tall, pill, optional dot or icon, uppercase-off (sentence case) |
| `Modal` | centred, max-height `calc(100vh - 96px)`, header + scrollable body + sticky footer, focus trap, ESC closes (unless destructive), overlay `rgba(15,23,42,.45)` + 4px blur, sizes `sm 420 / md 560 / lg 760 / xl 1000` |
| `Drawer` | right side, 420–720 px, slide-in 180 ms, same focus/ESC rules; used for quick patient/queue side panels |
| `ConfirmDialog` | icon + title + explanation + consequence list; destructive variant requires typed phrase for irreversible operations |
| `Toast` | bottom-right stack, 4 variants + progress, auto-dismiss 4 s (errors persist), action slot (Undo where meaningful) |
| `Tooltip` | 400 ms delay, 12px, max 240 px, `role="tooltip"`, hidden on `prefers-reduced-motion` |
| `Tabs` | underline variant with 8px gap, badge counts, ARIA tablist/tab/tabpanel, arrow-key navigation |
| `EmptyState` | 96 px tinted icon, title, explanation, primary action, secondary hint; used by every list |
| `Skeleton` / `Spinner` | shimmer skeletons for tables/cards, spinner for inline actions; never a frozen screen |
| `ErrorState` | icon, plain-language message, technical reference code, Retry + Back |
| `Timeline` | vertical rail 2 px, event icon nodes tinted per type, title + meta + summary, expandable details, grouped by date with sticky date headers |
| `Stepper` | setup wizard: numbered nodes, completed = check, current = brand ring, upcoming = muted; linear progress |
| `Avatar` | initials on tinted background, deterministic colour from id; patient/doctor avatars |
| `DropdownMenu` | 8px radius, shadow-md, sections + dividers, keyboard navigation, destructive items in danger tone |
| `FormLayout` | 12-column responsive grid (`minmax` based), labels above inputs, 16px vertical rhythm, section headers, sticky action bar for long forms |
| `ChartPanel` | pure SVG charts (bar, line, donut) — no chart library; accessible `role="img"` + data table fallback; token colours |

## 6. Application shell

* **Header (60px):** brand lockup; clinic name; global search (⌘/Ctrl+K opens the command palette);
  quick actions (New Patient, New Appointment, New Invoice); date; notification bell with unread count;
  user menu (profile, lock, logout); window controls are native (frameless is not used, so Windows
  accessibility and snapping work normally).
* **Sidebar (248/72 px, collapsible, state remembered):** grouped sections **Practice**, **Clinical**,
  **Billing**, **Administration** (see REQ §10); active item uses tinted background + 3px left rail + brand
  icon; groups collapse; icon-only mode keeps tooltips and correct alignment; count badges for today's
  queue and unread notifications; footer shows version + lock button.
* **Content area:** page header (title, subtitle/meta, action buttons right-aligned), optional filter bar,
  then content; `max-width` 1680px; every table lives in a scroll container with a sticky header.
* **Status bar:** database/backup status, last backup time, active user + role, in-treatment count.

## 7. Responsive / DPI rules (REQ §11)

Breakpoints: `≤ 1280px` collapse KPI grids to 2 columns and hide non-essential columns; `≤ 1080px`
sidebar auto-collapses; `≤ 900px` (small windows) KPI grid → 1 column, filter bars wrap, tables switch to
priority-column mode with a details drawer. Grids use `repeat(auto-fill, minmax(240px, 1fr))` so 6 cards
never leave orphan rows. Everything is verified at 100/125/150/175/200 % DPI and 1366×768 → 3840×2160;
no clipped text, no overlapping cards, no hidden controls, all scroll regions scrollable.

## 8. Accessibility (REQ §64)

Full keyboard operation (documented shortcuts in `docs/user-guide/KEYBOARD_SHORTCUTS.md`), visible focus
rings everywhere, logical tab order, `aria-*` on all composite widgets, `aria-live` for toasts and async
results, labelled icon-only buttons, ≥ 4.5:1 contrast, 24 px minimum hit targets, no colour-only meaning,
screen-reader-friendly table headers (`scope`), and error messages tied to inputs via `aria-describedby`.

## 9. Print surfaces

Screen (app) and print documents share tokens but print uses a paper-specific stylesheet with mm units,
no shadows, 0.4 pt hairlines, and dedicated print typography (see `docs/printing/PRINT_SYSTEM.md`).
