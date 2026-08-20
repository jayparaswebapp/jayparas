import { requireRole } from '@/lib/users/current';
import { createClient } from '@/lib/supabase/server';
import { buildInvoiceRegister } from '@/lib/export/invoice-register';

// Financial export — always run fresh, never cache, restrict to the roles
// that own the books. requireRole redirects everyone else to /dashboard.
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  await requireRole(['super_admin', 'supervisor', 'accountant']);

  const supabase = createClient();
  const { searchParams } = new URL(request.url);

  const { bytes, filename } = await buildInvoiceRegister(supabase, {
    line: searchParams.get('line') ?? undefined,
    status: searchParams.get('status') ?? undefined,
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    q: searchParams.get('q') ?? undefined,
  });

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
