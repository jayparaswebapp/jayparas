'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Ctrl/Cmd + A on the customers list jumps to the "New customer" page.
 * Skipped while typing in an editable field so Select-All still works there.
 */
export function NewCustomerShortcut() {
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
      router.push('/billing/customers/new');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);
  return null;
}
