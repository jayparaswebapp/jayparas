import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, pickLocalised, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

type AccountType = 'asset' | 'liability' | 'income' | 'expense' | 'equity';

interface AccountRow {
  id: string;
  code: string;
  name_en: string;
  name_gu: string;
  account_type: AccountType;
  parent_id: string | null;
  is_group: boolean;
  is_system: boolean;
  is_active: boolean;
}

interface BalanceRow {
  account_id: string;
  balance_dr_minus_cr: number;
}

interface TreeNode {
  account: AccountRow;
  balance: number;
  children: TreeNode[];
}

const TYPE_ORDER: AccountType[] = ['asset', 'liability', 'income', 'expense', 'equity'];

/**
 * `balance_dr_minus_cr` is a signed number: positive means debit-side,
 * negative means credit-side. We flip the sign into "natural balance"
 * before display — assets/expenses stay positive when they're debit-heavy,
 * liabilities/income/equity show positive when they're credit-heavy —
 * so a healthy Sales ledger reads as "₹ 10,000" instead of "-₹ 10,000".
 */
function naturalBalance(type: AccountType, drMinusCr: number): number {
  if (type === 'asset' || type === 'expense') return drMinusCr;
  return -drMinusCr;
}

function buildTree(accounts: AccountRow[]): Map<AccountType, TreeNode[]> {
  const byId = new Map<string, TreeNode>();
  for (const a of accounts) byId.set(a.id, { account: a, balance: 0, children: [] });
  const rootsByType = new Map<AccountType, TreeNode[]>();
  for (const node of byId.values()) {
    const parentId = node.account.parent_id;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      const list = rootsByType.get(node.account.account_type) ?? [];
      list.push(node);
      rootsByType.set(node.account.account_type, list);
    }
  }
  // Stable order — by code so 1100 comes before 1200.
  const sorter = (a: TreeNode, b: TreeNode) => a.account.code.localeCompare(b.account.code);
  const sortRec = (n: TreeNode) => {
    n.children.sort(sorter);
    n.children.forEach(sortRec);
  };
  for (const list of rootsByType.values()) {
    list.sort(sorter);
    list.forEach(sortRec);
  }
  return rootsByType;
}

/**
 * Attach each leaf's balance from the view, then roll up sums into group
 * nodes so a header account shows the total of its children.
 */
function attachBalances(nodes: TreeNode[], balances: Map<string, number>): number {
  let total = 0;
  for (const n of nodes) {
    const own = balances.get(n.account.id) ?? 0;
    const childSum = attachBalances(n.children, balances);
    n.balance = n.account.is_group ? childSum : own;
    total += n.balance;
  }
  return total;
}

export default async function ChartOfAccountsPage() {
  const user = await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const [{ data: accountsRaw }, { data: balancesRaw }] = await Promise.all([
    supabase
      .from('chart_of_accounts')
      .select('id, code, name_en, name_gu, account_type, parent_id, is_group, is_system, is_active')
      .is('deleted_at', null),
    supabase.from('account_balances').select('account_id, balance_dr_minus_cr'),
  ]);
  const accounts = (accountsRaw ?? []) as unknown as AccountRow[];
  const balances = new Map<string, number>();
  for (const b of (balancesRaw ?? []) as unknown as BalanceRow[]) {
    balances.set(b.account_id, Number(b.balance_dr_minus_cr));
  }
  const tree = buildTree(accounts);
  for (const list of tree.values()) attachBalances(list, balances);

  const canWrite = user.role === 'super_admin' || user.role === 'accountant';

  return <CoaView tree={tree} canWrite={canWrite} locale={locale} />;
}

function CoaView({
  tree,
  canWrite,
  locale,
}: {
  tree: Map<AccountType, TreeNode[]>;
  canWrite: boolean;
  locale: Locale;
}) {
  const t = useTranslations('accounting.coa');
  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          canWrite ? (
            <Link href="/accounting/coa/new" className="btn-primary !w-auto px-4">
              {t('newAccountButton')}
            </Link>
          ) : null
        }
      />

      <div className="space-y-4">
        {TYPE_ORDER.map((type) => {
          const roots = tree.get(type) ?? [];
          if (roots.length === 0) return null;
          return (
            <section
              key={type}
              className="overflow-hidden rounded-lg border border-neutral-200 bg-white"
            >
              <header className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {t(`type.${type}` as 'type.asset')}
              </header>
              <ul>
                {roots.map((n) => (
                  <TreeRow key={n.account.id} node={n} depth={0} locale={locale} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function TreeRow({ node, depth, locale }: { node: TreeNode; depth: number; locale: Locale }) {
  const t = useTranslations('accounting.coa');
  const label = pickLocalised(locale, node.account.name_en, node.account.name_gu);
  const nat = naturalBalance(node.account.account_type, node.balance);
  const showBal = Math.abs(nat) > 0.005;
  return (
    <>
      <li
        className="flex items-center gap-2 border-t border-neutral-100 px-3 py-2 text-sm first:border-t-0"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <span className="font-mono text-xs text-neutral-400">{node.account.code}</span>
        <span
          className={node.account.is_group ? 'font-semibold text-neutral-900' : 'text-neutral-800'}
        >
          {label}
        </span>
        {!node.account.is_active ? (
          <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] text-neutral-600">
            {t('inactiveLabel')}
          </span>
        ) : null}
        {showBal ? (
          <span className="ml-auto tabular-nums text-neutral-700">
            {formatRupees(Math.abs(nat), locale)}
            {nat < 0 ? (
              <span className="ml-1 text-xs text-neutral-400">({t('crShort')})</span>
            ) : null}
          </span>
        ) : null}
      </li>
      {node.children.map((c) => (
        <TreeRow key={c.account.id} node={c} depth={depth + 1} locale={locale} />
      ))}
    </>
  );
}
