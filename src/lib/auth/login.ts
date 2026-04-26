'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { mobileToSyntheticEmail } from './synthetic-email';

const RATE_LIMIT_WINDOW_MIN = 15;
const RATE_LIMIT_MAX_FAILS = 5;

const LoginSchema = z.object({
  mobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'invalidMobile'),
  pin: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'invalidPin'),
  next: z.string().optional(),
});

export type LoginErrorCode =
  | 'invalidMobile'
  | 'invalidPin'
  | 'invalidCredentials'
  | 'userNotFound'
  | 'rateLimited'
  | 'unknown';

export type LoginState = { ok: false; error: LoginErrorCode } | { ok: true };

export async function loginAction(_prev: LoginState | null, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    mobile: formData.get('mobile'),
    pin: formData.get('pin'),
    next: formData.get('next'),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message;
    const code: LoginErrorCode = first === 'invalidMobile' || first === 'invalidPin' ? first : 'unknown';
    return { ok: false, error: code };
  }

  const { mobile, pin, next } = parsed.data;
  const admin = createAdminClient();

  // 1. Rate-limit check (5 fails / 15 min / mobile).
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60_000).toISOString();
  const { count } = await admin
    .from('login_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('mobile', mobile)
    .eq('success', false)
    .gte('attempted_at', since);

  if ((count ?? 0) >= RATE_LIMIT_MAX_FAILS) {
    return { ok: false, error: 'rateLimited' };
  }

  // 2. Confirm an active app_users row exists (gives a friendlier error than a raw auth fail).
  const { data: userRow } = await admin
    .from('app_users')
    .select('id, is_active, deleted_at')
    .eq('mobile', mobile)
    .is('deleted_at', null)
    .maybeSingle();

  if (!userRow || !userRow.is_active) {
    await admin.from('login_attempts').insert({ mobile, success: false });
    return { ok: false, error: 'userNotFound' };
  }

  // 3. Authenticate. Cookies are set on the SSR client.
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: mobileToSyntheticEmail(mobile),
    password: pin,
  });

  if (error) {
    await admin.from('login_attempts').insert({ mobile, success: false });
    return { ok: false, error: 'invalidCredentials' };
  }

  await admin.from('login_attempts').insert({ mobile, success: true });
  redirect(next && next.startsWith('/') ? next : '/dashboard');
}

export async function signOutAction() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
