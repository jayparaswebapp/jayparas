'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Ctrl/Cmd + A jumps to the "New customer" page. Skipped while the user is
 * typing in an editable field so Select-All still works there.
 *
 * `openInNewTab=true` opens /billing/customers/new in a new tab so an
 * in-progress form on the current page (like a draft invoice) is preserved.
 * Default is false — same-tab navigation, used from the customers list.
 */
export function NewCustomerShortcut({
  openInNewTab = false,
}: {
  openInNewTab?: boolean;
} = {}) {
  const router = useRouter();
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== 'a' && e.key !== 'A') return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }
      e.preventDefault();
      if (openInNewTab) {
        window.open('/billing/customers/new', '_blank');
      } else {
        router.push('/billing/customers/new');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router, openInNewTab]);
  return null;
}
