# Session: accounting-and-wipe

**Date:** 2026-07-10 (IST)
**Workstream:** WS-accounting (new)
**Duration (rough):** unknown

> **⚠️ Backfilled note.** Reconstructed on 2026-07-19 from migrations and code
> after the original session notes were lost.

## What was built

**Phase 1 — Chart of Accounts + Journal Entries (`20260710000001–2`):**

- Standard double-entry. `sum(debit) = sum(credit)` enforced in the
  `create_journal_entry` RPC (set-level rule, deliberately not a table CHECK).
- COA is a tree via `parent_id`; `is_group=true` accounts are headers only —
  journal lines post to leaves. **Explicitly matches the Tally mental model
  the shop is coming from.** Code blocks: 1xxx assets, 2xxx liabilities,
  3xxx income, 4xxx expenses, 5xxx equity.
- `is_system=true` seeded accounts: deactivatable/renamable but not
  deletable, because auto-posting resolves them by code.
- `journal_source_type` enum: `manual, invoice, payment, purchase_bill,
  sales_return, ll_wage_payment` — the last two reserving auto-post slots for
  flows not yet hooked.
- Journal numbering "JE/<FY>/0001" per FY. `cancel_journal_entry` flips
  status; cancelled entries excluded from `account_balances` view.
- New role in play: `accountant` (create_journal_entry allows
  `super_admin` or `accountant`).
- App code: `/accounting/coa/*`, `/accounting/journal/*`.

**Phase 2 — Auto-posting (`20260710000003`):**

- AFTER-UPDATE **triggers watch status transitions** on invoices + payments
  and insert journal entries directly. Source RPCs untouched — business flow
  and books kept separate and independently reversible.
- **Failure mode is deliberate:** missing system account → `NOTICE`, never
  `RAISE` — broken books must never block an invoice from issuing. Unposted
  events findable by cross-referencing issued invoices against
  `journal_entries.source_id`.
- Cancellations emit equal-but-opposite entries so the day-book shows both
  events.
- Seeded a non-system "Default bank" (1201, ડિફોલ્ટ બેન્ક) under bank group
  1200 for UPI/bank-transfer payments to land in; renamable, deletable
  (autopost then skips).

**Maintenance (`20260710000004`):**

- `wipe_test_data(p_confirm)` — super_admin-only pre-go-live wipe of all
  transactional data (invoices, payments, journals, job orders, counters)
  **preserving all master data**. Requires literal `'WIPE'` confirmation;
  UI adds type-to-confirm. App page: `/admin/wipe-test-data`.

## Decisions made (visible in code)

- Books integrate via triggers, not by editing business RPCs.
- Books failures degrade silently by design (NOTICE, reconcile later).
- Tally-familiar structure chosen deliberately for the shop's accountant.
- Presence of `wipe_test_data` signals **go-live preparation** was underway
  by 2026-07-10.

## Open questions / gaps in this reconstruction

- Auto-post hooks exist for invoices + payments only; `purchase_bill`,
  `sales_return`, `ll_wage_payment` enum slots are reserved but unhooked.
- Payroll and reminders pages remain "coming soon" shells; barcodes page is a
  navigation hub.
- Whether go-live has happened since 2026-07-10 is not determinable from the
  repo snapshot.
