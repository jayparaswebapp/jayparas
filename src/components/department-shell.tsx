import type { ReactNode } from 'react';
import { Header } from './header';

export function DepartmentShell({
  title,
  hint,
  comingSoon,
  children,
}: {
  title: string;
  hint?: string;
  comingSoon: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <Header />
      <main className="mx-auto w-full max-w-screen-md flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold text-neutral-900">{title}</h1>
        {hint ? <p className="mt-2 text-sm text-neutral-600">{hint}</p> : null}
        <div className="mt-6 rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          {comingSoon}
        </div>
        {children}
      </main>
    </div>
  );
}
