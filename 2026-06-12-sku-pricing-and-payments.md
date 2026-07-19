# Session: sku-pricing-and-payments

**Date:** 2026-06-12 → 2026-06-13 (IST)
**Workstream:** WS-E (inventory) + WS-billing
**Duration (rough):** unknown

> **⚠️ Backfilled note.** Reconstructed on 2026-07-19 from migrations and code
> after the original session notes were lost.

## What was built

**2026-06-12 — SKU pricing model refinements:**

- `skus.discount_pct` (0–100, default 0) — each SKU carries its own default
  invoice discount. Set on `/skus/new` and bulk-create `/skus/multiple`.
- `skus.is_discountable` (default **false** = kids-item behaviour) — the
  invoice **print page groups discountable items on top with their own
  subtotal, spacer, then non-discountable items with their subtotal, then
  grand total**. Flag captured into `invoice_lines.sku_snapshot`, so flipping
  it later never re-groups historical invoices.
- `update_sku` extended with NULL-means-keep semantics for the two new fields.
- `skus.rate_unit ('pack'|'piece')` — 'pack': rate per pack/dozen, invoice qty
  defaults 1; 'piece': rate per piece, qty defaults `pack_size`. Existing rows
  default 'piece' (matches prior invoice pre-fill). `design_no` made optional
  for single packs (new form folds design number into design name; legacy mix
  path kept in schema, hidden in UI).
- `invoice_number_on_draft` — **bug fix:** numbers were only assigned at
  issue, so staff couldn't see the invoice number while composing. Now
  assigned at draft creation; issue keeps it.

**2026-06-13 — Payments Received:**

- `payments` (one row per money transfer), `payment_allocations` (join —
  one payment can settle multiple invoices: one cheque covers #42 fully +
  #43 partially), `payment_number_counters` (per-FY, "PMT/26-27/001"),
  `invoice_balances` view (derived balance-due per invoice).
- App code: `/billing/payments/*` incl. receipt print view; ledger pages for
  customers and groups (`/billing/customers/[id]/ledger`,
  `/billing/groups/[id]/ledger`, both with print).

## Decisions made (visible in code)

- Discount semantics are a SKU-level default, snapshot-frozen per invoice
  line.
- Allocations are a separate table (many-invoices-per-payment) with balance
  derived by view, not stored.
- Staff-facing workflow beat purist numbering: draft invoices show their
  number immediately.

## Open questions / gaps in this reconstruction

- Whether the discountable/non-discountable split maps to a specific trade
  practice (e.g. fancy vs kids rakhi) was presumably discussed but not
  recorded; only the print-grouping behaviour is in code.
