import { useTranslations } from 'next-intl';
import type { OrderStatus } from '@/lib/orders/load';

const STYLE: Record<OrderStatus, string> = {
  new: 'bg-sky-100 text-sky-800',
  packing: 'bg-amber-100 text-amber-800',
  ready: 'bg-emerald-100 text-emerald-800',
  partial: 'bg-violet-100 text-violet-800',
  billed: 'bg-neutral-200 text-neutral-700',
  cancelled: 'bg-red-100 text-red-700',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations('orders.status');
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STYLE[status]}`}
    >
      {t(status)}
    </span>
  );
}
