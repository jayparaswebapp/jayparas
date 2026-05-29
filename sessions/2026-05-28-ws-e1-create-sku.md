# Session: ws-e1-create-sku

**Date:** 2026-05-28 (IST)
**Workstream:** WS-E1 — Inventory: Create SKU + library + label printing
**Duration (rough):** ~3h (split across two real-world sessions either side of a usage-limit pause)

## Goals (from `/workstream/2026-05-28-ws-e1-create-sku.md`)

Ship the first usable inventory slice — staff can create a sellable pack (SKU) with a photo, browse the SKU library, and print a QR label. Nothing else. Stock movements, sales, batches, mix recipes, design master are all deferred.

## What was built

### Migrations (`supabase/migrations/20260528000001…000003`)

1. `20260528000001_skus.sql` — `skus` table with the `skus_type_fields_chk` check constraint, three partial unique indexes (`skus_single_uq`, `skus_mix_uq`, `skus_code_uq`), two helper indexes for search, the `updated_at` trigger (reuses the foundation `set_updated_at()`), the audit trigger (reuses `write_audit_log()` from migration 6), and RLS policies — read for any authenticated role, write for super_admin / supervisor.
2. `20260528000002_sku_photos_storage.sql` — `sku-photos` Storage bucket (public). Three write policies on `storage.objects` (insert / update / delete) gated to super_admin / supervisor. Public reads work via Supabase's storage API without an explicit SELECT policy.
3. `20260528000003_sku_rpc.sql` — SECURITY DEFINER RPCs following the ADR-005 pattern from migration 8:
   - `create_sku` (super_admin + supervisor) — accepts the client-generated `sku_code` and inserts; raises `sku_duplicate` on the partial-unique-index conflict.
   - `update_sku` (super_admin + supervisor) — only takes `design_name`, `price`, `photo_path`. Locked fields are not parameters.
   - `set_sku_active` (super_admin only) — toggles `is_active` with required reason.

### Server-side libraries

- `src/lib/skus/code.ts` — pure `generateSkuCode({ pack_type, design_no | mix_code, pack_size })` utility. Single → `JP-1325-06` (pack size zero-padded to 2); Mix → `JP-MIX-FEST-12`. Trims and upper-cases mix codes.
- `src/lib/skus/code.test.ts` — 7 assertions via `node:assert/strict`, runnable as a plain `tsx` script (no test framework introduced).
- `src/lib/skus/label.ts` — three pure helpers for the printed label rows:
  - `labelItemName` → `"<design_name> <design_no>"` for single, `"<design_name> <mix_code>"` for mix.
  - `labelRate` → `"₹132/-"` for whole rupees, `"₹132.50"` for paise.
  - `labelUnit` → `"<n> Doz"` when divisible by 12, otherwise `"<n> Pcs"`. Two suffixes only (locked by the user; no fractional `1/2 Doz`).
- `src/lib/skus/label.test.ts` — 12 assertions covering all three helpers across single, mix, and edge cases.
- `src/lib/skus/label-grid.ts` — single source of truth for roll geometry (25 × 15 mm, 2-up, gaps, `@page` width) and font sizes (Variant C — Bigger; name 8pt bold / rate 8pt / unit 7pt bold / QR 9 mm).
- `src/lib/storage/sku-photos.ts` — `validateSkuPhotoFile`, `buildSkuPhotoPath` (random hex per ADR-007 pattern), `maybeDownscalePhoto` (optional `createImageBitmap` + canvas downscale to 1024 px max edge before upload), `uploadSkuPhoto`, `getSkuPhotoPublicUrl`.
- `src/lib/rpc/errors.ts` — `sku_duplicate` key added to `RPC_ERROR_KEYS`, mapped to `skus.errors.duplicate`.
- `src/lib/format/locale-shared.ts` — **new file**. Pure `formatRupees` + `pickLocalised`, split out of `src/lib/format/locale.ts` because the latter imports `next/headers` (server-only) and webpack drags that into every client component that touches the module. Client components now import from `locale-shared`; server components keep importing from `locale` (which re-exports the pure helpers for backwards compatibility).

### Server actions (`src/app/(app)/skus/actions.ts`)

- `createSkuAction` returns `CreateSkuResult` — extended `ActionResult` shape carrying an optional `duplicate: { id, sku_code }` block. When the RPC raises `sku_duplicate`, the action re-queries by `sku_code` to find the existing live row and returns its id so the UI can deep-link to it (per Acceptance Criterion 3).
- `updateSkuAction` — patches the editable fields. Redirects back to `/skus/[id]`.
- `setSkuActiveAction` — super_admin only, requires reason (audit captures the toggle in the same transaction via the RPC's `_bind_audit_context`).

### UI

- `/skus/layout.tsx` — `Header` + a sub-nav with Library / New SKU / Print labels.
- `/skus` — server component fetches active SKUs and resolves photo URLs server-side, then renders `library-view.tsx` (client) for searchable grid with an "include inactive" toggle. Cards link to detail. Per the acceptance criteria, search filters by design number, mix code, or design name (client-side; v1 volumes don't warrant a server-side index).
- `/skus/new` — `sku-create-form.tsx`. Four large pack buttons (3 / 6 / 12 / Mix). Selecting Mix swaps the design-number field for a mix-code field AND surfaces a secondary 3/6/12 row for the mix's pack size. Live preview block shows the auto-generated `sku_code` and the QR (rendered via the `qrcode` lib in a `useEffect`).
- `/skus/[id]` — detail page. Shows photo, status, design name, identifying field, sku_code, price, and the QR. Three sections beneath: locked-fields list (with a hint explaining why), editable form (super_admin + supervisor), and the deactivate / reactivate toggle (super_admin only). The "Print label" action lives in the page header.
- `/skus/[id]/print` — minimal redirect to `/skus/print/sheet?items=<id>:2` so a single-SKU print produces the full 2-up row (no wasted roll).
- `/skus/print` — picker with per-row quantity input. Sticky bottom action bar shows selected count + total labels + "Open print sheet" link.
- `/skus/print/sheet` — renders the rows of 2-up labels into a fixed-width container; `@page { size: 54mm auto; margin: 0 }` and a small `@media print` block hide all chrome (`header`, `nav`, `.no-print`) so the printer only sees labels.
- `components/qr-code.tsx` — client QR component, async `QRCode.toString({ type: 'svg' })` injected via `dangerouslySetInnerHTML` (content is QR svg, no user-content interpolation).
- `components/sku-label.tsx` — single 25 × 15 mm label cell, used identically on screen and in print.
- `src/app/(app)/dashboard/page.tsx` — added a "Go to" shortcuts block (SKUs / Master data / Admin) so staff can reach the new screens without typing URLs.

### Dependencies

- Added: `qrcode` (^1.5.4) + `@types/qrcode`.
- Removed: `jsbarcode` (added briefly during the Code-128 path before the user picked QR).

### i18n

- Added `skus.*` keys in both `en.json` and `gu.json` — library, form, detail, print, label, errors. Plus `nav.skus*` and `dashboard.shortcuts.*`. Every label/error/button goes through `next-intl`.

### Docs

- `docs/decisions.md` — ADR-009 prepended (newest-at-top per the file convention).
- `docs/data-model-inventory.md` — moved here from `workstream/` so the brief's reference path (`docs/data-model-inventory.md`) resolves.

## Decisions made

### Stuck with the brief

- Schema, constraints, unique indexes, RPC + RLS pattern, locked-after-create rules, search-by-anything filter, photo client-side downscale, sub-nav placement (Library / New / Print).

### Deviated from the brief (logged in ADR-009)

- **QR replaces Code 128.** Live decision during the session. The data-model addendum §3 specified Code 128 via `jsbarcode`; the user chose square QR. Switched to the `qrcode` npm package (smaller bundle, SSR-friendly).
- **Price IS printed on the label.** The addendum §4 said "never the price"; the user explicitly overrode to include rate. Documented as a trade-off in ADR-009.
- **Label content slimmed.** Brand line / "Design: <no> — <name>" / "Pack: <n> pcs" / barcode / sku-code-as-text from the brief became a three-row left side (item name / rate / unit) + QR on the right. Driven by 25 × 15 mm space constraints and the user's hand-drawn spec.
- **Per-SKU quantity input is required.** The brief implied "selected = 1 label"; the user wants staff to type a quantity every time (matches real stock-in workflow). Empty / zero excludes the SKU.
- **Single-label print produces the full 2-up row.** Avoids wasting half a row on the continuous roll. `/skus/[id]/print` is a redirect into `/skus/print/sheet?items=<id>:2`.
- **`format/locale.ts` split.** Off-brief but necessary: webpack pulled `next/headers` into client bundles via shared imports. Split into a `locale-shared.ts` (pure helpers, client-safe) and the original `locale.ts` (server-only `getServerLocale` + re-exports). Avoids touching the 13 existing call sites.

### Permissions

- Centre managers and accountants can **view + print** but cannot create, edit, or deactivate. Enforced by both the RLS policies on `skus` and the role checks in the RPC layer; the create/edit/deactivate UIs are gated server-side via `requireRole(['super_admin','supervisor'])` and `requireRole(['super_admin'])`.

## Tested & verified

- `npm run typecheck` — clean.
- `npm run build` — clean (24 routes total; +6 new SKU routes; middleware 79.6 kB).
- `npm run test:skus` — both `code.test.ts` (7 assertions) and `label.test.ts` (12 assertions) green.
- **Not tested in this session:**
  - Migrations applied to production Supabase. The three migration files exist on disk but no `supabase db push` was run. Same gap as called out at the end of the WS-B wrap-up.
  - `sku-photos` bucket creation in production.
  - End-to-end browser smoke for create + library + edit + deactivate + single-print + bulk-print + duplicate-detection. Per-role smoke (centre_manager / accountant view-only) also not run.
  - Real thermal-printer test on actual 25×15 mm roll stock.

## Open questions / blockers

- **Item-name line composition.** I picked `"<design_name> <design_no>"` (e.g. "Dori 85") based on the hand-drawn example. If the user enters the number inside `design_name` directly (e.g. types "Dori 85" as the name), the printed line would still read "Dori 85 85". Worth a smoke test once real data lands.
- **Rate decimal format.** Whole rupees → `"₹132/-"`; paise → `"₹132.50"`. Hand-drawn spec showed the `/-` form only; reasonable extrapolation but unconfirmed for non-integer prices.
- **`/skus/print/sheet` print CSS** uses `header, nav, .no-print { display: none !important }` to hide chrome. Survives the current Header / SubNav structure but would break if those swapped to a `<div role="banner">`-style implementation later. Add a regression-checking screenshot if anyone moves the chrome.

## Next session

The brief's "after deploy, hand it to floor staff and collect feedback" is the natural cutover point. Before that:

1. Apply migrations 9–11 to production Supabase and verify `sku-photos` bucket exists.
2. Browser smoke of every new screen in both locales, exercising:
   - Create single SKU `1325 / Lotus gold / 6 / 240` → expect `JP-1325-06` in the library.
   - Create mix SKU `FEST / Festive mix / 12 / 300` → expect `JP-MIX-FEST-12`.
   - Re-create `JP-1325-06` → expect the duplicate banner + deep link.
   - Edit name & price; confirm locked fields render read-only.
   - Single-label print → preview shows a 2-up row.
   - Bulk-print 3 SKUs with mixed quantities (1, 3, 6) → preview shows 10 labels in 5 rows.
   - Real thermal print of one row to verify QR scan + text legibility at 25 × 15 mm.
3. Centre-manager / accountant role smoke (view + print only, no create / edit / deactivate visible).
4. After staff feedback (per the brief), the next WS-E session is **stock-in** (`stock_movements` ledger + inbound flow).

### Prep before the next session

- A real thermal-printer driver test print of a couple of labels at the actual 25 × 15 mm size. If text or QR is unreadable at Variant C font sizes, we can drop to Variant B without code changes — just toggle `LABEL_FONT` in `src/lib/skus/label-grid.ts`.
- A handful of real SKUs (design number + name + pack size + price + photo if possible) to seed the library on day one.
