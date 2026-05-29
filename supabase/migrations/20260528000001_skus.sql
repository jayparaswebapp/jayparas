-- WS-E1 migration 1/3: skus — the sellable pack (inventory atom).
-- See docs/data-model-inventory.md §1.
--
-- A SKU is one sellable pack (e.g. design 1325 in a pack of 6), NOT a design.
-- The same design in two pack sizes is two SKUs. A mix pack is a plain named
-- SKU with no recorded recipe (deferred to v2).
--
-- sku_code is app-generated (never user-typed): see src/lib/skus/code.ts and §1
-- "SKU code generation". design_no / mix_code / pack_type / pack_size are locked
-- after creation because they're baked into the printed barcode label that
-- physically sticks on stock — letting them change would invalidate the label.
-- To "change" them, deactivate this SKU and create a new one.

CREATE TABLE IF NOT EXISTS public.skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_code text NOT NULL,
  pack_type text NOT NULL,
  design_no text,
  mix_code text,
  design_name text NOT NULL,
  pack_size integer NOT NULL,
  price numeric(10,2) NOT NULL,
  photo_path text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT skus_pack_type_chk CHECK (pack_type IN ('single','mix')),
  CONSTRAINT skus_pack_size_chk CHECK (pack_size > 0),
  CONSTRAINT skus_price_chk     CHECK (price >= 0),
  -- Exactly one of design_no / mix_code per pack_type.
  CONSTRAINT skus_type_fields_chk CHECK (
    (pack_type = 'single' AND design_no IS NOT NULL AND mix_code IS NULL)
    OR
    (pack_type = 'mix'    AND mix_code  IS NOT NULL AND design_no IS NULL)
  )
);

-- Same single design + pack size cannot exist twice (ignoring soft-deleted).
CREATE UNIQUE INDEX IF NOT EXISTS skus_single_uq
  ON public.skus (design_no, pack_size)
  WHERE pack_type = 'single' AND deleted_at IS NULL;

-- Same mix code + pack size cannot exist twice.
CREATE UNIQUE INDEX IF NOT EXISTS skus_mix_uq
  ON public.skus (mix_code, pack_size)
  WHERE pack_type = 'mix' AND deleted_at IS NULL;

-- sku_code uniqueness among live rows.
CREATE UNIQUE INDEX IF NOT EXISTS skus_code_uq
  ON public.skus (sku_code)
  WHERE deleted_at IS NULL;

-- Library search helpers (small at v1 volumes; still worth having).
CREATE INDEX IF NOT EXISTS skus_active_design_no_idx
  ON public.skus (design_no)
  WHERE deleted_at IS NULL AND pack_type = 'single';
CREATE INDEX IF NOT EXISTS skus_active_mix_code_idx
  ON public.skus (mix_code)
  WHERE deleted_at IS NULL AND pack_type = 'mix';

DROP TRIGGER IF EXISTS trg_skus_updated_at ON public.skus;
CREATE TRIGGER trg_skus_updated_at
  BEFORE UPDATE ON public.skus
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Audit trigger (reuses the generic id-keyed function from migration 6).
DROP TRIGGER IF EXISTS audit_skus ON public.skus;
CREATE TRIGGER audit_skus
  AFTER INSERT OR UPDATE OR DELETE ON public.skus
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

ALTER TABLE public.skus ENABLE ROW LEVEL SECURITY;

-- Read: every authenticated role (super_admin / supervisor / centre_manager / accountant)
-- per data-model-inventory.md §5. The role split is on writes, not reads.
DROP POLICY IF EXISTS "authenticated read skus" ON public.skus;
CREATE POLICY "authenticated read skus" ON public.skus
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Writes: super_admin or supervisor (insert + update). center_manager and
-- accountant are read-only. Deactivate is a regular update of is_active and
-- is gated to super_admin only at the RPC layer (set_sku_active).
DROP POLICY IF EXISTS "super_admin or supervisor write skus" ON public.skus;
CREATE POLICY "super_admin or supervisor write skus" ON public.skus
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

REVOKE SELECT ON public.skus FROM anon;
