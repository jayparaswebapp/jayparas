'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SubNavItem {
  href: string;
  label: string;
}

export function SubNav({ items }: { items: SubNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-screen-md items-center gap-1 overflow-x-auto px-2 py-1">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                'inline-flex min-h-tap items-center whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium',
                active ? 'bg-brand-100 text-brand-900' : 'text-neutral-600 hover:bg-neutral-100',
              ].join(' ')}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
