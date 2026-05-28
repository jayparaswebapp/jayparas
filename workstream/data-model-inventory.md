# Jai Paras OS — Data Model Addendum: Inventory (WS-E)

**Version:** 0.1 (Create-SKU slice only)
**Date:** 2026-05-28
**Merge into:** `docs/data-model.md`
**Database:** Supabase Postgres
**Conventions (unchanged from foundation):** snake_case, UUID primary keys, `timestamptz` stored UTC / displayed IST, soft-delete via `deleted_at` everywhere, `created_at` + `updated_at` on every table. User-visible brand "Jai Paras"; technical prefix `JP-` retained (ADR-008).

---

## Scope of this addendum

Only the tables needed for the first shippable slice: **create a sellable pack (SKU), view the SKU library, print its barcode label.** Stock movements, sales, batches, bins, pricing tiers, GST, and reports are explicitly **out** and will be specced in later WS-E sessions.

---

## 1. `skus` — the sellable pack (the inventory atom)

A SKU is one sellable pack, not a design. The same design in two pack sizes is two SKUs. A mix pack is a plain named SKU with no recorded recipe (deferred to v2).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` |
| `sku_code` | text | Unique (where not deleted). App-generated, never user-typed. |
| `pack_type` | text | `check (pack_type in ('single','mix'))` |
| `design_no` | text | Single packs only, e.g. `1325`. NULL for mix. |
| `mix_code` | text | Mix packs only, short token e.g. `FEST`. NULL for single. |
| `design_name` | text | Display name, both types, e.g. `Lotus gold` / `Festive mix`. NOT NULL. |
| `pack_size` | integer | `check (pack_size > 0)`, e.g. 3 / 6 / 12. |
| `price` | numeric(10,2) | Wholesale price per pack. `check (price >= 0)`. Editable later; NOT printed on label. |
| `photo_path` | text | Supabase Storage object path. Nullable. |
| `is_active` | boolean | Default `true`. Discontinued SKUs set `false` (still scannable/historic). |
| `created_by` | uuid | FK → `app_users(id)`. |
| `created_at` | timestamptz | Default `now()`. |
| `updated_at` | timestamptz | Maintained by trigger or app. |
| `deleted_at` | timestamptz | Soft delete. Nullable. |

### Constraints

```sql
-- exactly one of design_no / mix_code per pack_type
alter table skus add constraint skus_type_fields_chk check (
  (pack_type = 'single' and design_no is not null and mix_code is null)
  or
  (pack_type = 'mix'    and mix_code  is not null and design_no is null)
);

-- can't create the same single design + pack size twice (ignoring soft-deleted)
create unique index skus_single_uq
  on skus (design_no, pack_size)
  where pack_type = 'single' and deleted_at is null;

-- can't create the same mix code + pack size twice
create unique index skus_mix_uq
  on skus (mix_code, pack_size)
  where pack_type = 'mix' and deleted_at is null;

-- sku_code unique among live rows
create unique index skus_code_uq
  on skus (sku_code)
  where deleted_at is null;
```

### SKU code generation (app-side, deterministic)

Single: `JP-${design_no}-${String(pack_size).padStart(2,'0')}` → `JP-1325-06`
Mix:    `JP-MIX-${mix_code}-${pack_size}` → `JP-MIX-FEST-12`

Generated once at create time, stored in `sku_code`. Because design/pack identity is baked into both the code and the printed label, `design_no`, `mix_code`, `pack_type`, and `pack_size` are **locked after creation** (see edit rules). To "change" them, deactivate this SKU and create a new one.

### Edit rules

- Editable anytime: `design_name`, `price`, `photo_path`, `is_active`.
- Locked after create: `pack_type`, `design_no`, `mix_code`, `pack_size`, `sku_code`.
- Rationale: editing locked fields would invalidate already-printed barcode labels stuck on physical stock.

---

## 2. Storage — SKU photos

- Supabase Storage bucket: `sku-photos`.
- v1: **public bucket** (rakhi product photos are low-sensitivity; keeps display simple via public URL). Note in ADR; can tighten to private + signed URLs later without schema change.
- Optional client-side downscale before upload (e.g. max 1024px) to keep the library fast on phones.
- `skus.photo_path` stores the object path; UI derives the display URL.

---

## 3. Barcode

- Symbology: **Code 128**, encoding the `sku_code` string verbatim (e.g. `JP-1325-06`).
- Generated client-side at label-render time (no DB field beyond `sku_code`). Library: `jsbarcode`.
- No GS1 / EAN-13 in v1 (revisit only if formal retail/marketplace ever needed).

---

## 4. Label content (confirmed)

Printed label carries only permanent data — never the price:

```
Jai Paras
Design: 1325 — Lotus gold
Pack: 6 pcs
[ Code 128 barcode ]
JP-1325-06
```

- Design number **and** design name both appear (confirmed).
- Photo on the label is optional/off by default for v1 (ink + space); revisit after staff feedback.

---

## 5. Permissions (RLS) — sensible v1 default

| Role | SKUs |
|---|---|
| super_admin | create / edit / deactivate / view / print |
| supervisor | create / edit / view / print |
| center_manager | view / print |
| accountant | view / print |

Adjustable — flagged for confirmation, not blocking. Enforce via Supabase RLS policies keyed off the existing `app_users.role`.

---

## Deferred to later WS-E sessions (not in this slice)

`stock_movements` (immutable ledger), `sales` + `sale_items`, batches, bin/rack locations, mix-pack recipe table, price tiers, per-customer discounts, GST invoicing, returns, reporting, design master table (promote `design_no`/`design_name` into it then).
