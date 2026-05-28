# Session WS-E1 — Inventory: Create SKU + library + label printing

**Date:** 2026-05-28
**Workstream:** WS-E (Inventory & Sales)
**Depends on:** WS-A (foundation: auth, roles, i18n, repo, Vercel) — must be deployed and working.
**Goal of this session:** Ship the first usable inventory slice — staff can create a sellable pack (SKU) with a photo, browse the SKU library, and print a barcode label. Nothing else.

> This is a deliberately tiny, shippable slice. We deploy it, let floor staff use it, gather feedback, then build stock-in and scan-to-sell in later sessions. Do **not** scope-creep into stock, sales, batches, or reports — those are explicitly out.

---

## Before you start

1. Confirm the repo is the existing one and you're on a fresh branch off the deployed main (e.g. `feat/ws-e1-create-sku`).
2. Read `docs/data-model-inventory.md` (added alongside this note) — it is the source of truth for the schema, constraints, and label content. If anything here conflicts with it, stop and ask.
3. Reuse existing foundation building blocks: `app_users`, the `role` enum, `next-intl` i18n setup, the shadcn/ui components already installed, the auth/session helpers, and the established mobile-first Tailwind conventions (min 44px tap targets, large readable type for semi-literate users).
4. Do not bulk-install shadcn components — add only what this session needs.

---

## Scope

**In:**
- `skus` table + constraints + RLS (per data-model-inventory.md).
- Supabase Storage bucket `sku-photos` (public, v1).
- Create SKU screen (single + mix).
- SKU library screen (searchable grid).
- SKU detail/edit screen (respecting locked-field rules).
- Print label: single label + bulk A4 sticker-sheet print view, Code 128 via `jsbarcode`.
- Gujarati-primary / English-secondary strings for all new screens.

**Out (do NOT build):** stock quantities, stock-in, movements, sales, billing, scanning, batches, bins, pricing tiers, GST, reports, design master.

---

## Tasks (in order)

### 1. Migration
- Create `skus` per `docs/data-model-inventory.md` §1 (all columns, the `skus_type_fields_chk` check, the three partial unique indexes).
- Add an `updated_at` auto-update trigger consistent with how other foundation tables do it (match the existing pattern; if none exists, set `updated_at` in app code instead and note it).
- Add RLS policies per §5 (super_admin/supervisor manage; center_manager/accountant read). Keep policies readable and commented.

### 2. Storage
- Create the `sku-photos` bucket (public, v1).
- Helper to upload a photo and return its object path; optional client-side downscale to ~1024px max edge before upload.

### 3. SKU code generator (pure util + tests)
- `generateSkuCode({ pack_type, design_no, mix_code, pack_size })` returning the string per data-model §1 ("SKU code generation").
- Single → `JP-1325-06` (pack size zero-padded to 2). Mix → `JP-MIX-FEST-12`.
- Unit test both branches.

### 4. Create SKU screen (`/skus/new`)
- Mobile-first. Fields, in order: design number (numeric) **or** mix short-code when pack type = mix; design name (text); pack size as four large tap buttons `3 / 6 / 12 / મિક્સ (Mix)`; price with a `₹` prefix (numeric); "add photo" (camera/file).
- Selecting `Mix` swaps the "design number" field for a "mix short-code" field (e.g. `FEST`) and switches generation to the mix pattern.
- Live preview block showing the auto-generated SKU code + a rendered Code 128 barcode that updates as fields change.
- `react-hook-form` + `zod` validation: design number/mix-code required and non-empty; pack size required; price >= 0; design name required.
- On save: generate `sku_code`, upload photo if present, insert row. If the unique index rejects a duplicate (same design+pack), catch it and show a friendly bilingual message + a link to open the existing SKU instead of erroring out.
- After save, route to the SKU's detail screen with a "print label" call to action.

### 5. SKU library screen (`/skus`)
- Responsive grid of cards: photo (or placeholder), design name, design number / mix code, pack size, price, `sku_code`.
- Search box filtering by design number, mix code, or design name (client-side filter is fine at v1 volumes).
- "Create SKU" button → `/skus/new`.
- Tapping a card → detail screen.
- Show active SKUs by default; a simple toggle to include inactive ones.

### 6. SKU detail / edit (`/skus/[id]`)
- Show all fields + barcode + photo.
- Editable: design name, price, photo, active toggle. Locked (read-only, with a short hint why): pack type, design number/mix code, pack size, SKU code.
- "Print label" action (single) and "deactivate" action (sets `is_active = false`; never hard delete here — soft-delete via `deleted_at` reserved for genuine mistakes by super_admin only).

### 7. Label printing
- Single-label print view: renders the label content from data-model §4 (brand, `Design: <no> — <name>`, `Pack: <n> pcs`, Code 128 barcode of `sku_code`, then `sku_code` as text). **No price.**
- Bulk print view (`/skus/print` or a "print sheet" action from the library with multi-select): lays out selected SKUs as a grid on **A4 sticker sheets** using `@media print` CSS (no PDF library needed for v1; user prints from the browser).
  - Default grid: configurable, default to a common A4 layout (e.g. 3 columns × 8 rows = 24 labels). Put the columns/rows in a single constants file so it's a one-line change later (and trivially swappable for thermal label dimensions if hardware changes).
  - Each printed label is self-contained and sized to the cell; barcode must render crisply at print resolution (render `jsbarcode` to SVG, not a tiny canvas).

### 8. i18n
- Add Gujarati (primary) + English (secondary) keys for every new label/button/validation message. Match the existing `next-intl` catalog structure.

---

## Acceptance criteria (must all pass before merge)

1. A new single SKU (design `1325`, name `Lotus gold`, pack `6`, price `240`, with a photo) creates `JP-1325-06` and appears in the library with its photo.
2. A new mix SKU (code `FEST`, name `Festive mix`, pack `12`) creates `JP-MIX-FEST-12`.
3. Attempting to recreate `JP-1325-06` (same design + pack) is blocked with a friendly message and a link to the existing SKU — no crash, no duplicate row.
4. Editing price and design name works; pack size / design number / SKU code are visibly locked.
5. Printing a single label and a bulk A4 sheet produces labels with brand, design number + name, pack size, a scannable Code 128 barcode, and the SKU code text — and **no price**.
6. A phone barcode-scanner app decodes a printed label back to the exact `sku_code` string (sanity check that the symbology is valid — scanning is not a product feature yet).
7. Center-manager / accountant roles can view and print but cannot create or edit (RLS verified).
8. All screens are mobile-first, Gujarati-primary, with large tap targets; usable one-handed.

---

## Git / deploy

- Commit in logical chunks (migration, util+tests, create screen, library, detail, label printing, i18n) with clear messages.
- Open a PR; on merge to main, confirm Vercel auto-deploys and the flow works in production.
- After deploy, hand it to floor staff and collect: what's confusing, what's slow, what's missing. That feedback drives the next session (stock-in).

---

## Session note to write back

Append a short `sessions/2026-05-28-ws-e1-create-sku.md` recap on completion: what was built, any deviations from this plan and why, anything deferred, and open questions for the next session. Add an ADR entry to `docs/decisions.md` recording the v1 inventory choices (Code 128, public photo bucket, no price on label, design name on label, locked-after-create fields, design master deferred).
