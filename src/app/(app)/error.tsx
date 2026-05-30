'use client';

import { useEffect } from 'react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app error boundary]', error);
  }, [error]);

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8">
      <div className="mx-auto max-w-screen-md space-y-4">
        <h1 className="text-xl font-semibold text-neutral-900">Something broke</h1>
        <pre className="overflow-auto rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-900">
          {error.message || 'Unknown error'}
          {error.digest ? `\n\ndigest: ${error.digest}` : ''}
          {error.stack ? `\n\n${error.stack}` : ''}
        </pre>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
        >
          Retry
        </button>
      </div>
    </main>
  );
}
