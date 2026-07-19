# Session: returns-and-job-work

**Date:** 2026-06-24 → 2026-06-25 (IST)
**Workstream:** WS-billing + WS-jobwork (new — the core domain)
**Duration (rough):** unknown

> **⚠️ Backfilled note.** Reconstructed on 2026-07-19 from migrations and code
> after the original session notes were lost.

## What was built

**2026-06-24 — Sales Returns / Credit Notes:**

- `sales_returns` + `sales_return_lines` + `credit_note_number_counters`
  (per-`(business_line, FY)`).
- A return is **always linked 1:1 to an original invoice** (Indian GST credit
  notes must reference the source invoice). Lines must be a subset of that
  invoice's lines — same SKU snapshot, rate, GST%; only returned qty (and
  per-line override) captured.
- `invoice_balances` view updated: credit-note totals subtract from
  outstanding automatically alongside payments.
- Status flow mirrors invoices: draft → issued → cancelled; drafts
  hard-deletable; numbers preserved on cancel.
- App code: `/billing/returns/*` incl. print view.

**2026-06-25 — Job-work (the business's core model):**

- `labourers` — each lead-lady (LL) manages her own sub-list of labourers.
- `job_orders` + `job_order_items` — "office gave these pieces to LL X on
  date D", one line per design.
- `job_sub_assignments` — stage-2 tracking: LL hands N pieces of an item to a
  labourer.
- `job_receipts` — work returning: accepted vs rejected, optional
  `labourer_id` when a labourer (not the LL herself) finished it.
- `job_order_number_counters` — per-FY ("JW/26-27/001").
- `job_order_item_balances` view — derived `qty_at_ll`, `qty_at_labourer`,
  `qty_accepted`, `qty_rejected` per item.
- **Wage model:** `wages_owed = Σ(qty_accepted × rate_per_piece)`; paid to the
  LL, who settles her labourers privately. LL payout tables noted in the
  migration as a follow-up mirroring payments/returns — **not yet shipped as
  of this reconstruction (2026-07-19).**
- App code: `/job-work/*` (list, new order form, detail).

## Decisions made (visible in code)

- Credit notes constrained to reference-invoice subsets — GST-compliant by
  construction, not by discipline.
- Two-stage custody tracking (office→LL, LL→labourer) with balances derived
  by view from immutable-ish order/assignment/receipt rows.
- Wages accrue on *accepted* qty only; rejects don't pay.

## Open questions / gaps in this reconstruction

- LL wage-payout flow (referenced in the migration comment, and in the later
  accounting enum `ll_wage_payment`) remains unbuilt — the biggest known
  pending item from this period.
