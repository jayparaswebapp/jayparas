import { useTranslations } from 'next-intl';
import type { ProductGroupOption } from '@/lib/skus/product-groups';

/**
 * "Product group" picker for SKU forms. Empty = Rakhi product. Picking a
 * group = Kite product (company comes from the group).
 */
export function ProductGroupSelect({
  groups,
  defaultValue,
}: {
  groups: ProductGroupOption[];
  defaultValue?: string | null;
}) {
  const t = useTranslations('skus.productGroup');
  return (
    <div>
      <label htmlFor="product_group_id" className="label-base">
        {t('label')}
      </label>
      <select
        id="product_group_id"
        name="product_group_id"
        defaultValue={defaultValue ?? ''}
        className="input-base"
      >
        <option value="">{t('none')}</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
            {g.company_name ? ` — ${g.company_name}` : ''}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-neutral-500">{t('hint')}</p>
    </div>
  );
}
