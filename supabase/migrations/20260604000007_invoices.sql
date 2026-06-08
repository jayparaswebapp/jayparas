-- Invoices: header + lines + per-(business_line, FY) number counters.
--
-- An invoice starts as a draft (no number assigned). Issue snapshots both the
-- customer and the seller into the row, assigns the next sequential number
-- for its business_line + financial_year, and freezes the totals. Cancel
-- preserves the number (gap-free series). Drafts can be hard-deleted.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'business_line') THEN
    CREATE TYPE public.business_line AS ENUM ('rakhi', 'kite');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
    CREATE TYPE public.invoice_status AS ENUM ('draft', 'issued', 'cancelled');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.invoice_number_counters (
  business_line public.business_line NOT NULL,
  financial_year text NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (business_line, financial_year)
);

ALTER TABLE public.invoice_number_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read invoice_number_counters" ON public.invoice_number_counters;
CREATE POLICY "authenticated read invoice_number_counters" ON public.invoice_number_counters
  FOR SELECT USING (auth.uid() IS NOT NULL);
REVOKE ALL ON public.invoice_number_counters FROM anon;

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text,
  business_line public.business_line NOT NULL,
  status public.invoice_status NOT NULL DEFAULT 'draft',

  invoice_date date NOT NULL DEFAULT current_date,
  due_date date,

  customer_id uuid REFERENCES public.billing_customers(id),
  customer_snapshot jsonb,

  seller_snapshot jsonb,
  place_of_supply text,
  intra_state boolean,

  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount_total numeric(14,2) NOT NULL DEFAULT 0,
  taxable_total numeric(14,2) NOT NULL DEFAULT 0,
  cgst_total numeric(14,2) NOT NULL DEFAULT 0,
  sgst_total numeric(14,2) NOT NULL DEFAULT 0,
  igst_total numeric(14,2) NOT NULL DEFAULT 0,
  round_off numeric(14,2) NOT NULL DEFAULT 0,
  grand_total numeric(14,2) NOT NULL DEFAULT 0,

  notes text,
  terms text,

  issued_at timestamptz,
  cancelled_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_invoice_number_active
  ON public.invoices(invoice_number)
  WHERE invoice_number IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON public.invoices(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_status_date ON public.invoices(status, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_business_line ON public.invoices(business_line);

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON public.invoices;
CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  sku_id uuid REFERENCES public.skus(id),
  sku_snapshot jsonb,
  description text NOT NULL,
  hsn_code text,
  qty numeric(12,3) NOT NULL DEFAULT 1,
  uom text NOT NULL DEFAULT 'Pack',
  rate numeric(14,2) NOT NULL DEFAULT 0,
  discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  gst_pct numeric(5,2) NOT NULL DEFAULT 0,
  line_subtotal numeric(14,2) NOT NULL DEFAULT 0,
  line_cgst numeric(14,2) NOT NULL DEFAULT 0,
  line_sgst numeric(14,2) NOT NULL DEFAULT 0,
  line_igst numeric(14,2) NOT NULL DEFAULT 0,
  line_total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON public.invoice_lines(invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_lines_invoice_lineno
  ON public.invoice_lines(invoice_id, line_no);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read invoices" ON public.invoices;
CREATE POLICY "authenticated read invoices" ON public.invoices
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin or supervisor write invoices" ON public.invoices;
CREATE POLICY "super_admin or supervisor write invoices" ON public.invoices
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "authenticated read invoice_lines" ON public.invoice_lines;
CREATE POLICY "authenticated read invoice_lines" ON public.invoice_lines
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin or supervisor write invoice_lines" ON public.invoice_lines;
CREATE POLICY "super_admin or supervisor write invoice_lines" ON public.invoice_lines
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

REVOKE SELECT ON public.invoices FROM anon;
REVOKE SELECT ON public.invoice_lines FROM anon;

DROP TRIGGER IF EXISTS audit_invoices ON public.invoices;
CREATE TRIGGER audit_invoices
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS audit_invoice_lines ON public.invoice_lines;
CREATE TRIGGER audit_invoice_lines
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
