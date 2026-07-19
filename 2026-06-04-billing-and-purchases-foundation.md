# Session: billing-and-purchases-foundation

**Date:** 2026-06-04 (IST)
**Workstream:** WS-billing (new)
**Duration (rough):** unknown — 12 migrations in one date-cluster suggests one long session or several same-week sessions squashed into one migration date

> **⚠️ Backfilled note.** Reconstructed on 2026-07-19 from migrations and code
> after the original session notes were lost.

## What was built

**Migrations (in order):**

1. `billing_customers` — buyer master shared across **rakhi (no-GST) and kite
   (GST) business lines**; GSTIN/PAN optional. Mobile unique among non-deleted
   rows; GSTIN unique among non-null non-deleted rows.
2. `billing_customers_rpc` — SECURITY DEFINER CRUD mirroring the lead_ladies
   pattern. New error key `gstin_taken`.
3. `customer_groups` — route-planning buckets within a city (e.g. "Station
   Road" in "Surat") so delivery runs can batch customers. `(city, name)`
   unique among non-deleted.
4. `customer_groups_rpc` — group CRUD + customer RPCs recreated with
   `p_group_id`.
5. `drop_reason_requirement` — **audit reason neutralised system-wide.**
   `_validate_reason()` is now a no-op (role check only). Columns and
   `p_reason` parameters retained for signature/history stability; UI stops
   collecting reasons.
6. `company_info` — singleton seller record (partial unique index on a
   constant), snapshotted into every issued invoice. Bank details + default
   terms/due-days included.
7. `invoices` — header + lines + per-`(business_line, financial_year)` number
   counters. New enums `business_line ('rakhi','kite')` and
   `invoice_status ('draft','issued','cancelled')`. Draft → issue snapshots
   customer + seller and freezes totals; cancel preserves the number
   (gap-free series); drafts hard-deletable.
8. `invoices_rpc` — draft/issue/cancel RPCs, `_financial_year()` helper
   (April-start Indian FY). Error keys: `invoice_not_editable`,
   `company_info_missing`, `invoice_lines_required`,
   `invoice_customer_missing`.
9. `audit_trigger_no_deleted_at` — bug fix: generic audit trigger crashed on
   tables without `deleted_at` (e.g. `invoice_lines`); switched to jsonb
   extraction so missing columns degrade to NULL.
10. `invoice_extras` — `packing_charges` + `delivery_charges` on invoices.
    Positioned after the tax block, before round-off: included in grand total
    but not GST-attracting (GST-on-packing achievable via a regular taxable
    line if needed).
11. `purchase_suppliers_items` — `suppliers` (vendor master mirroring
    billing_customers) + `purchase_items` (raw-material master with default
    rate + default GST% for bill auto-fill).
12. `purchase_bills` — supplier invoices we receive; mirrors sales invoices
    inverted. Number prefixes **PRK (rakhi) / PKT (kite)**; reuses
    `business_line` and `invoice_status` enums ("issued" = "posted").

**App code (attributed to this cluster):** `/billing/*` (customers, groups,
company, invoices incl. print views), `/purchases/*` (suppliers, items,
bills). **AI bill scanning** (`purchases/bills/scan-action.ts` +
`lib/purchases/scan-bill.ts`) using the Anthropic SDK: photograph a supplier
bill → extract structured fields → auto-match supplier by GSTIN. 10 MB limit,
jpeg/png/webp.

## Decisions made (visible in code)

- Two business lines (rakhi + kite) are first-class in the schema — separate
  invoice number series per line per FY.
- Invoices snapshot both parties at issue time; historical invoices never
  drift when masters change.
- Gap-free invoice numbering: cancellation preserves the number.
- Audit reasons abandoned as a UX requirement (ADR-worthy; no ADR exists).
- Purchases reuse the sales enums/patterns rather than parallel types.

## Open questions / gaps in this reconstruction

- Why the reason-requirement was dropped (user pushback? friction?) lived in
  the lost conversation.
- Exact date the AI bill-scan feature landed is not derivable from
  migrations (no schema change); placed here because the module ships with
  purchase bills.
