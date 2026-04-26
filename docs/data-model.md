# Jay Paras OS — Data Model Specification

**Version:** 0.1 (Draft for build kickoff)
**Date:** 2026-04-26
**Database:** Supabase Postgres
**Conventions:** snake_case tables/columns, UUIDs as primary keys, all timestamps `timestamptz` in UTC (rendered IST in UI), soft-delete via `deleted_at` everywhere, `created_at` and `updated_at` on every table.

---

## 1. Entity overview

```
auth.users (Supabase) ──┐
                        │
                  app_users ──── role
                        │
                        ├── audit_log (every mutation)
                        │
                  locations
                        │
                  lead_ladies ──── lead_lady_locations (M:N)
                        │
                  designs
                        │
                        ▼
                     jobs ──── job_events (issue, receive, edit, cancel, partial outcomes)
                        │
                  payments (1:1 with completed jobs)
                        │
                  incentive_accruals (rolled up per lead lady per season)

settings (singleton key-value table for business constants)
```

---

## 2. Tables

### 2.1 `app_users`
Internal staff who log in. Linked 1:1 with `auth.users` via `auth_user_id`.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| auth_user_id | uuid FK → auth.users | unique |
| full_name | text | |
| mobile | text | unique, used as login identifier |
| role | enum: `super_admin`, `supervisor`, `centre_manager`, `accountant` | |
| is_active | bool | default true |
| created_at, updated_at, deleted_at | timestamptz | soft-delete |

**RLS rules (high-level):**
- super_admin: full access to everything.
- supervisor: read/write all jobs across all locations; can confirm at any centre.
- centre_manager: read/write **only** jobs at their assigned locations (see `centre_manager_locations`).
- accountant: read-only on all tables; can call export functions.

### 2.2 `centre_manager_locations`
Many-to-many: a centre manager can cover multiple locations.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| app_user_id | uuid FK → app_users | role must be `centre_manager` (CHECK) |
| location_id | uuid FK → locations | |
| created_at | timestamptz | |

Unique constraint on (`app_user_id`, `location_id`).

### 2.3 `locations`
The six job-work locations (Atgam, Khergam, Arnala, Ambheti, Jashoda, Vaghchhipa). Seeded at install. Editable by super_admin only.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name_en | text | "Atgam" |
| name_gu | text | "આટગામ" |
| is_active | bool | |
| created_at, updated_at, deleted_at | timestamptz | |

### 2.4 `lead_ladies`
One row per lead lady. A lead lady can be associated with multiple locations.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| full_name | text | |
| mobile | text | not necessarily unique (some may share; soft warning if duplicate) |
| notes | text | optional |
| is_active | bool | |
| created_at, updated_at, deleted_at | timestamptz | |

### 2.5 `lead_lady_locations`
Many-to-many between lead ladies and locations.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| lead_lady_id | uuid FK | |
| location_id | uuid FK | |
| created_at | timestamptz | |

Unique on (`lead_lady_id`, `location_id`).

### 2.6 `designs`
Catalogue of rakhi designs. Each has a labour rate per guss. Created by super_admin or supervisor (per business rule b).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| design_number | text unique | e.g. "1325" — the number on the register |
| name_en | text | optional |
| name_gu | text | optional |
| current_rate_per_guss | numeric(10,2) | INR. Used at issue-time only; jobs lock their own rate. |
| is_active | bool | |
| created_at, updated_at, deleted_at | timestamptz | |
| created_by | uuid FK → app_users | for audit |

**Note:** Changing `current_rate_per_guss` does NOT affect existing open jobs — they have `rate_per_guss_locked` snapshotted on the job.

### 2.7 `jobs`
The heart of the system. One row per job-work cycle.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| job_code | text unique | `JP-YYMM-NNNN`, auto-generated, monotonic per month |
| lead_lady_id | uuid FK | |
| location_id | uuid FK | which of the lead lady's locations this job is for |
| design_id | uuid FK | |
| target_quantity | int | total rakhis expected (in pieces, not guss) |
| rate_per_guss_locked | numeric(10,2) | snapshot from design at issue time |
| dozen_multiplier_locked | numeric(10,2) | snapshot from settings at issue time (default 1.5) |
| raw_material_weight_g | numeric(10,2) | issued weight in grams |
| issued_at | timestamptz | when packet handed over |
| issued_by | uuid FK → app_users | |
| sla_due_at | timestamptz | issued_at + settings.sla_days |
| status | enum: `issued`, `in_progress`, `received`, `cancelled` | |
| notes | text | optional |
| created_at, updated_at, deleted_at | timestamptz | |

Indexes: (`status`), (`lead_lady_id`, `status`), (`location_id`, `status`), (`sla_due_at`).

**Status transitions:**
- `issued` → `in_progress` (auto, on first save; effectively merged in v1 — we may collapse to just `in_progress` until receive)
- `in_progress` → `received` (on receive event)
- `in_progress` → `cancelled` (with reason)

For v1 simplicity: collapse `issued` and `in_progress` into a single `open` status. Final enum: `open`, `received`, `cancelled`.

### 2.8 `job_receipts`
Captures the receive event. 1:1 with `jobs` when `status = received`.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| job_id | uuid FK unique | |
| received_at | timestamptz | |
| received_by | uuid FK → app_users | the collector |
| finished_weight_g | numeric(10,2) | |
| guss | int | default 0 |
| dozen | int | default 0 |
| nang | int | default 0 |
| actual_quantity | int generated | `guss*144 + dozen*12 + nang` |
| weight_loss_g | numeric(10,2) generated | `raw - finished` |
| weight_loss_pct | numeric(5,2) generated | `(raw - finished) / raw * 100` |
| weight_loss_flagged | bool generated | `pct > settings.weight_loss_tolerance_pct` |
| quantity_shortfall | int generated | `target - actual_quantity` (can be negative) |
| labour_amount | numeric(10,2) generated | `guss * rate_per_guss_locked + dozen * dozen_multiplier_locked` (BEFORE adjustments) |
| outcome | enum: `accepted_full`, `partial_redo`, `partial_reduced_rate`, `partial_discarded` | |
| outcome_notes | text | required when not `accepted_full` |
| reduced_rate_discount_pct | numeric(5,2) | only when outcome = `partial_reduced_rate`; e.g. 50 means 50% off |
| final_labour_amount | numeric(10,2) | calculated: applies discount if reduced rate; equals labour_amount otherwise |
| created_at, updated_at | timestamptz | |

**Important: `partial_redo` does NOT close the job.** It creates a `job_receipts` row capturing what was delivered, applies labour for the delivered portion, but the job's `status` stays `open` and the SLA clock keeps ticking. A future receipt closes it.

This means the 1:1 assumption above needs to relax: **a job can have multiple `job_receipts` rows** where all but the last are `partial_redo`, and the last one is `accepted_full` / `partial_reduced_rate` / `partial_discarded`. The unique constraint should be: only ONE non-redo receipt per job.

Adjusted: `unique (job_id) where outcome != 'partial_redo'`.

### 2.9 `payments`
One row per payment to a lead lady. Tied to a closing receipt.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| job_id | uuid FK | |
| job_receipt_id | uuid FK | |
| lead_lady_id | uuid FK | denormalised for fast queries |
| amount | numeric(10,2) | sum of final_labour_amount across all receipts on this job |
| payment_date | date | defaults to receipt's received_at date, editable |
| recorded_by | uuid FK → app_users | |
| notes | text | |
| created_at, updated_at, deleted_at | timestamptz | |

### 2.10 `cancellations`
Captures cancellation reason. 1:1 with cancelled jobs.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| job_id | uuid FK unique | |
| reason | text | required |
| cancelled_at | timestamptz | |
| cancelled_by | uuid FK → app_users | |

### 2.11 `incentive_accruals` (view, not table)
Derived view per lead lady per season (Aug-to-Jul or calendar year — TBD with super-admin). Calculated as 15% of total `final_labour_amount` for all received jobs in the season.

```sql
-- pseudocode
SELECT
  lead_lady_id,
  season_year,
  SUM(p.amount) AS total_labour,
  SUM(p.amount) * (settings.incentive_pct / 100) AS incentive_due
FROM payments p
JOIN jobs j ON j.id = p.job_id
GROUP BY lead_lady_id, season_year;
```

A separate `incentive_payouts` table can later record actual August payouts.

### 2.12 `settings`
Singleton key-value store for business constants. Edit restricted to super_admin.

| Column | Type | Notes |
|---|---|---|
| key | text PK | |
| value_numeric | numeric | nullable |
| value_text | text | nullable |
| description | text | |
| updated_at | timestamptz | |
| updated_by | uuid FK → app_users | |

**Initial seed:**
| key | value | description |
|---|---|---|
| `weight_loss_tolerance_pct` | 5.0 | Flag jobs above this % weight loss |
| `dozen_multiplier` | 1.5 | Multiplier for dozen in labour calc |
| `sla_days` | 20 | Job-work deadline in days |
| `incentive_pct` | 15.0 | Lead lady annual incentive % |
| `season_start_month` | 8 | August (incentive payout month) |

### 2.13 `audit_log`
Every mutation on every business table. Required for super-admin's editing and compliance.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| table_name | text | |
| record_id | uuid | |
| operation | enum: `insert`, `update`, `delete`, `soft_delete`, `restore` | |
| changed_by | uuid FK → app_users | |
| changed_at | timestamptz | default now() |
| reason | text | required for super-admin edits |
| old_values | jsonb | |
| new_values | jsonb | |

Implemented via Postgres trigger on every business table.

---

## 3. Computed UI states

### 3.1 SLA badge per open job
- `green`: days_remaining > 5
- `amber`: 0 < days_remaining ≤ 5
- `red`: days_remaining ≤ 0 (overdue, but soft flag — doesn't block)

### 3.2 Weight loss badge per receipt
- `ok`: weight_loss_pct ≤ settings.weight_loss_tolerance_pct
- `flagged`: weight_loss_pct > tolerance

### 3.3 Quantity shortfall badge
- `match`: actual_quantity == target_quantity
- `shortfall`: actual_quantity < target_quantity
- `surplus`: actual_quantity > target_quantity (rare but possible)

---

## 4. Job code generation

Format: `JP-YYMM-NNNN`
- `YY`: 2-digit year of issue
- `MM`: 2-digit month of issue
- `NNNN`: 4-digit zero-padded serial, monotonic per (year, month), reset each month

Implementation: a Postgres sequence per month is fragile. Cleaner approach: a `job_code_counters` table with (year, month, last_serial), atomically incremented on insert.

```sql
CREATE TABLE job_code_counters (
  year_month text PRIMARY KEY,  -- '2608'
  last_serial int NOT NULL DEFAULT 0
);
```

A `before insert` trigger on `jobs` allocates the next code.

---

## 5. RLS policy summary

| Table | super_admin | supervisor | centre_manager | accountant |
|---|---|---|---|---|
| app_users | full | read | read self | read |
| locations | full | read | read | read |
| lead_ladies | full | full | read | read |
| designs | full | insert + read; update only own | read | read |
| jobs | full | full | full **only for assigned locations** | read |
| job_receipts | full | full | full **only for jobs at assigned locations** | read |
| payments | full | full | full **only for assigned locations** | read |
| cancellations | full | full | full **only for assigned locations** | read |
| settings | full | read | read | read |
| audit_log | read all | read own | read own | read own |

---

## 6. Open items for v2 (explicitly out of scope)

- Lead lady self-login / portal
- Raw material packet decomposition (line items per packet)
- Inventory module (raw material stock at main centre)
- WhatsApp/SMS auto-reminders
- Photo attachments on issue/receive
- Multi-currency (assume INR forever)
- Multi-org tenancy
- Mobile push notifications

---

## 7. Migration ordering

For Claude Code to execute in WS-A and WS-B:

1. Enable `pgcrypto` extension for `gen_random_uuid()`.
2. Create enums.
3. Create `settings` + seed.
4. Create `app_users` + RLS.
5. Create `locations` + seed six locations.
6. Create `lead_ladies` + `lead_lady_locations`.
7. Create `centre_manager_locations`.
8. Create `designs`.
9. Create `job_code_counters`.
10. Create `jobs` + trigger for code generation.
11. Create `job_receipts` (with generated columns).
12. Create `cancellations`.
13. Create `payments`.
14. Create `audit_log` + triggers on all business tables.
15. Create views: `v_open_jobs_with_sla`, `v_lead_lady_ledger`, `v_incentive_accruals`.
16. Apply RLS policies per table.
