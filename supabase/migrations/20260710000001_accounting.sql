-- Financial accounting phase 1: Chart of Accounts + Journal Entries.
--
-- Design notes:
--   * Standard double-entry: every journal entry has 2+ lines, sum(debit) =
--     sum(credit). Enforced by the create_journal_entry RPC — we do NOT try
--     to enforce it as a table CHECK because the balance is a set-level
--     constraint, not a row-level one.
--   * Accounts form a tree via parent_id. `is_group=true` means "header only"
--     — journal lines cannot post to a group account, only to leaves. This
--     matches the Tally mental model the shop is coming from.
--   * `is_system=true` flags seeded accounts. They can be deactivated but
--     not deleted, because auto-posting hooks (phase 2) reference them by
--     code.
--   * Account codes follow a rough Tally-like block plan:
--       1xxx = Assets, 2xxx = Liabilities, 3xxx = Income,
--       4xxx = Expenses, 5xxx = Equity.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type') THEN
    CREATE TYPE public.account_type AS ENUM ('asset', 'liability', 'income', 'expense', 'equity');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journal_entry_status') THEN
    CREATE TYPE public.journal_entry_status AS ENUM ('posted', 'cancelled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journal_source_type') THEN
    CREATE TYPE public.journal_source_type AS ENUM (
      'manual', 'invoice', 'payment', 'purchase_bill', 'sales_return', 'll_wage_payment'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name_en text NOT NULL,
  name_gu text NOT NULL,
  account_type public.account_type NOT NULL,
  parent_id uuid REFERENCES public.chart_of_accounts(id),
  is_group boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coa_code_active ON public.chart_of_accounts(code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_coa_parent ON public.chart_of_accounts(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_coa_type ON public.chart_of_accounts(account_type) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_coa_updated_at ON public.chart_of_accounts;
CREATE TRIGGER trg_coa_updated_at BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.journal_entry_counters (
  financial_year text PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number text,
  entry_date date NOT NULL DEFAULT current_date,
  narration text,
  source_type public.journal_source_type NOT NULL DEFAULT 'manual',
  source_id uuid,
  status public.journal_entry_status NOT NULL DEFAULT 'posted',
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.app_users(id),
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_je_number_active ON public.journal_entries(entry_number) WHERE entry_number IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_je_date ON public.journal_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_je_source ON public.journal_entries(source_type, source_id) WHERE source_id IS NOT NULL;
DROP TRIGGER IF EXISTS trg_je_updated_at ON public.journal_entries;
CREATE TRIGGER trg_je_updated_at BEFORE UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id),
  debit numeric(14, 2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14, 2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Row-level check: a line is either a debit OR a credit, never both,
  -- and never zero. Set-level balance (sum(debit)=sum(credit)) is
  -- enforced by the create RPC.
  CONSTRAINT journal_line_dr_xor_cr CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_jl_entry ON public.journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_jl_account ON public.journal_lines(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jl_entry_lineno ON public.journal_lines(journal_entry_id, line_no);

-- Rolled-up per-account balance view — used by the ledger + trial balance
-- reports in phase 3. Ignores cancelled entries.
DROP VIEW IF EXISTS public.account_balances;
CREATE VIEW public.account_balances AS
SELECT
  a.id AS account_id,
  a.code,
  a.account_type,
  coalesce(sum(l.debit), 0)::numeric(16, 2) AS total_debit,
  coalesce(sum(l.credit), 0)::numeric(16, 2) AS total_credit,
  (coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0))::numeric(16, 2) AS balance_dr_minus_cr
FROM public.chart_of_accounts a
LEFT JOIN public.journal_lines l ON l.account_id = a.id
LEFT JOIN public.journal_entries e ON e.id = l.journal_entry_id AND e.status = 'posted' AND e.deleted_at IS NULL
WHERE a.deleted_at IS NULL
GROUP BY a.id, a.code, a.account_type;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.chart_of_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_counters  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read coa" ON public.chart_of_accounts;
CREATE POLICY "authenticated read coa" ON public.chart_of_accounts FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "super_admin or accountant write coa" ON public.chart_of_accounts;
CREATE POLICY "super_admin or accountant write coa" ON public.chart_of_accounts FOR ALL USING (
  EXISTS (SELECT 1 FROM public.app_users a WHERE a.auth_user_id = auth.uid() AND a.role IN ('super_admin', 'accountant') AND a.deleted_at IS NULL)
);

DROP POLICY IF EXISTS "authenticated read journal_entries" ON public.journal_entries;
CREATE POLICY "authenticated read journal_entries" ON public.journal_entries FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "super_admin or accountant write journal_entries" ON public.journal_entries;
CREATE POLICY "super_admin or accountant write journal_entries" ON public.journal_entries FOR ALL USING (
  EXISTS (SELECT 1 FROM public.app_users a WHERE a.auth_user_id = auth.uid() AND a.role IN ('super_admin', 'accountant') AND a.deleted_at IS NULL)
);

DROP POLICY IF EXISTS "authenticated read journal_lines" ON public.journal_lines;
CREATE POLICY "authenticated read journal_lines" ON public.journal_lines FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "super_admin or accountant write journal_lines" ON public.journal_lines;
CREATE POLICY "super_admin or accountant write journal_lines" ON public.journal_lines FOR ALL USING (
  EXISTS (SELECT 1 FROM public.app_users a WHERE a.auth_user_id = auth.uid() AND a.role IN ('super_admin', 'accountant') AND a.deleted_at IS NULL)
);

DROP POLICY IF EXISTS "authenticated read je_counters" ON public.journal_entry_counters;
CREATE POLICY "authenticated read je_counters" ON public.journal_entry_counters FOR SELECT USING (auth.uid() IS NOT NULL);

REVOKE SELECT ON public.chart_of_accounts       FROM anon;
REVOKE SELECT ON public.journal_entries         FROM anon;
REVOKE SELECT ON public.journal_lines           FROM anon;
REVOKE SELECT ON public.journal_entry_counters  FROM anon;

-- Audit
DROP TRIGGER IF EXISTS audit_coa ON public.chart_of_accounts;
CREATE TRIGGER audit_coa AFTER INSERT OR UPDATE OR DELETE ON public.chart_of_accounts FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
DROP TRIGGER IF EXISTS audit_journal_entries ON public.journal_entries;
CREATE TRIGGER audit_journal_entries AFTER INSERT OR UPDATE OR DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
DROP TRIGGER IF EXISTS audit_journal_lines ON public.journal_lines;
CREATE TRIGGER audit_journal_lines AFTER INSERT OR UPDATE OR DELETE ON public.journal_lines FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

-- ── Seed Chart of Accounts ─────────────────────────────────────────────────
-- Only seed if the tree is empty. Anything already present is left alone so
-- re-running the migration is idempotent.
DO $$
DECLARE
  v_root_assets uuid;
  v_root_liab uuid;
  v_root_inc uuid;
  v_root_exp uuid;
  v_root_eq uuid;
  v_bank_group uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.chart_of_accounts) THEN
    RETURN;
  END IF;

  -- Assets root
  INSERT INTO public.chart_of_accounts (code, name_en, name_gu, account_type, is_group, is_system)
  VALUES ('1000', 'Assets', 'એસેટ્સ', 'asset', true, true)
  RETURNING id INTO v_root_assets;

  INSERT INTO public.chart_of_accounts (code, name_en, name_gu, account_type, parent_id, is_system) VALUES
    ('1100', 'Cash in hand',        'હાથ પર રોકડ',   'asset', v_root_assets, true),
    ('1300', 'Sundry debtors',      'ગ્રાહકો પાસેથી લેણું', 'asset', v_root_assets, true),
    ('1400', 'GST input credit',    'GST ઇનપુટ ક્રેડિટ', 'asset', v_root_assets, true),
    ('1500', 'Stock in hand',       'સ્ટોક',         'asset', v_root_assets, true);

  -- Bank accounts group — user adds their own bank sub-accounts.
  INSERT INTO public.chart_of_accounts (code, name_en, name_gu, account_type, parent_id, is_group, is_system)
  VALUES ('1200', 'Bank accounts', 'બેન્ક ખાતાઓ', 'asset', v_root_assets, true, true)
  RETURNING id INTO v_bank_group;

  -- Liabilities root
  INSERT INTO public.chart_of_accounts (code, name_en, name_gu, account_type, is_group, is_system)
  VALUES ('2000', 'Liabilities', 'લાયબિલિટીઝ', 'liability', true, true)
  RETURNING id INTO v_root_liab;

  INSERT INTO public.chart_of_accounts (code, name_en, name_gu, account_type, parent_id, is_system) VALUES
    ('2100', 'Sundry creditors',    'સપ્લાયર્સને ચૂકવવાનું', 'liability', v_root_liab, true),
    ('2200', 'GST output payable',  'GST આઉટપુટ ચૂકવવાનું', 'liability', v_root_liab, true),
    ('2300', 'Lead-lady wages payable', 'લીડ લેડી મજૂરી ચૂકવવાની', 'liability', v_root_liab, true),
    ('2400', 'Salaries payable',    'પગાર ચૂકવવાના',    'liability', v_root_liab, true);

  -- Income root
  INSERT INTO public.chart_of_accounts (code, name_en, name_gu, account_type, is_group, is_system)
  VALUES ('3000', 'Income', 'આવક', 'income', true, true)
  RETURNING id INTO v_root_inc;

  INSERT INTO public.chart_of_accounts (code, name_en, name_gu, account_type, parent_id, is_system) VALUES
    ('3100', 'Sales - Rakhi',       'વેચાણ - રાખડી', 'income', v_root_inc, true),
    ('3200', 'Sales - Kite',        'વેચાણ - પતંગ', 'income', v_root_inc, true),
    ('3300', 'Discount received',   'ડિસ્કાઉન્ટ મળ્યું', 'income', v_root_inc, true),
    ('3900', 'Other income',        'અન્ય આવક',    'income', v_root_inc, true);

  -- Expenses root
  INSERT INTO public.chart_of_accounts (code, name_en, name_gu, account_type, is_group, is_system)
  VALUES ('4000', 'Expenses', 'ખર્ચ', 'expense', true, true)
  RETURNING id INTO v_root_exp;

  INSERT INTO public.chart_of_accounts (code, name_en, name_gu, account_type, parent_id, is_system) VALUES
    ('4100', 'Purchases',           'ખરીદી',        'expense', v_root_exp, true),
    ('4200', 'Rent',                'ભાડું',         'expense', v_root_exp, true),
    ('4300', 'Electricity',         'વીજળી',        'expense', v_root_exp, true),
    ('4400', 'Water',               'પાણી',         'expense', v_root_exp, true),
    ('4500', 'Freight',             'ભાડું (ટ્રાન્સપોર્ટ)', 'expense', v_root_exp, true),
    ('4600', 'Packing',             'પેકિંગ',        'expense', v_root_exp, true),
    ('4700', 'Courier',             'કુરિયર',       'expense', v_root_exp, true),
    ('4800', 'Sales returns',       'વેચાણ પરત',    'expense', v_root_exp, true),
    ('4900', 'Miscellaneous',       'પરચૂરણ',       'expense', v_root_exp, true);

  -- Equity root
  INSERT INTO public.chart_of_accounts (code, name_en, name_gu, account_type, is_group, is_system)
  VALUES ('5000', 'Equity', 'મૂડી', 'equity', true, true)
  RETURNING id INTO v_root_eq;

  INSERT INTO public.chart_of_accounts (code, name_en, name_gu, account_type, parent_id, is_system) VALUES
    ('5100', 'Owner''s capital',    'માલિકની મૂડી',  'equity', v_root_eq, true),
    ('5200', 'Drawings',            'ડ્રોઇંગ્સ',      'equity', v_root_eq, true),
    ('5300', 'Retained earnings',   'નફો બાકી',      'equity', v_root_eq, true);
END $$;
