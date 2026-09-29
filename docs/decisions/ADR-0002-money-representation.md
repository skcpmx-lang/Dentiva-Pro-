# ADR-0002 — Monetary values as integer poisha, quantities as integer milli-units

* **Status:** Accepted
* **Date:** 2026-09-29

## Context

Dental billing involves fees, discounts, VAT-style adjustments, partial payments, overpayments and
aggregate reports. IEEE-754 floating point (`REAL`) produces non-deterministic results
(`0.1 + 0.2 !== 0.3`) and is unacceptable for money (REQ §60). Some inventory items (e.g. liquids,
gels, anaesthetic cartridges sold partially) need fractional quantities.

## Decision

1. **Money is stored and computed as `INTEGER` poisha** (1 BDT = 100 poisha). Column names end in
   `_poisha`. No `REAL`/`FLOAT`/`DOUBLE` column exists for any monetary value.
2. **Quantities with possible fractions are stored as `INTEGER` milli-units** (3 implied decimals),
   column names end in `_milli`. Countable items simply use multiples of 1000.
3. A single `Money` module (`src/shared/money.ts`) owns all arithmetic: `fromTaka`, `toTakaString`,
   `add`, `sub`, `mulByQuantity`, `applyDiscount`, `applyPercent`, `allocate` (largest-remainder split
   for distributions), `roundHalfUp`, `formatBDT` (Bangla-friendly grouping `৳ 1,23,456.78` optional,
   default `৳ 123,456.78`), `parseUserInput` (tolerant of `৳`, commas, Bengali digits ০-৯, `.৫`).
4. Percentage discounts compute on integer bases with half-up rounding **once**, at the line level, and
   totals are sums of already-rounded line values (so invoice totals always equal the printed lines).
5. UI receives integers (poisha) and formats them; it never performs financial arithmetic itself.

## Consequences

* Deterministic, exact arithmetic; totals always reconcile with reports and receipts.
* Every financial UI path must pass through `Money`, enforced by unit tests (property-style tests over
  discounts, partial payments, rounding, large values, zero values).
* Max safe value: 2^53 poisha ≈ ৳ 90 trillion — far beyond any clinic requirement.
