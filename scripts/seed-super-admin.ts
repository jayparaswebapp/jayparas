/**
 * Idempotently seeds the super-admin user from env vars.
 *   npm run seed:super-admin
 *
 * Required env (loaded from .env.local via dotenv):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   AUTH_EMAIL_DOMAIN              (default: jayparas.internal)
 *   SEED_SUPER_ADMIN_MOBILE        (10-digit Indian mobile)
 *   SEED_SUPER_ADMIN_PIN           (6 digits)
 *   SEED_SUPER_ADMIN_NAME
 */

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

loadEnv({ path: '.env.local' });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function main() {
  const url = required('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const domain = process.env.AUTH_EMAIL_DOMAIN || 'jayparas.internal';
  const mobile = required('SEED_SUPER_ADMIN_MOBILE');
  const pin = required('SEED_SUPER_ADMIN_PIN');
  const name = required('SEED_SUPER_ADMIN_NAME');

  if (!/^[6-9]\d{9}$/.test(mobile)) throw new Error('SEED_SUPER_ADMIN_MOBILE must be a 10-digit Indian mobile.');
  if (!/^\d{6}$/.test(pin)) throw new Error('SEED_SUPER_ADMIN_PIN must be exactly 6 digits.');

  const email = `${mobile}@${domain}`;
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Find existing app_users row by mobile (idempotency anchor).
  const { data: existing, error: findErr } = await admin
    .from('app_users')
    .select('id, auth_user_id, role, is_active, deleted_at')
    .eq('mobile', mobile)
    .maybeSingle();

  if (findErr) throw findErr;

  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`[seed] app_users row already exists (id=${existing.id}). Updating PIN and ensuring active super_admin.`);
    const { error: updErr } = await admin.auth.admin.updateUserById(existing.auth_user_id, {
      password: pin,
      email,
      email_confirm: true,
    });
    if (updErr) throw updErr;
    const { error: rowErr } = await admin
      .from('app_users')
      .update({ full_name: name, role: 'super_admin', is_active: true, deleted_at: null })
      .eq('id', existing.id);
    if (rowErr) throw rowErr;
    // eslint-disable-next-line no-console
    console.log('[seed] done.');
    return;
  }

  // 2. Create new auth user + app_users row.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: pin,
    email_confirm: true,
    user_metadata: { mobile, full_name: name },
  });
  if (createErr) throw createErr;

  const authId = created.user?.id;
  if (!authId) throw new Error('auth.admin.createUser returned no user id');

  const { error: insertErr } = await admin.from('app_users').insert({
    auth_user_id: authId,
    full_name: name,
    mobile,
    role: 'super_admin',
    is_active: true,
  });
  if (insertErr) {
    // Roll back the auth user so the script stays idempotent.
    await admin.auth.admin.deleteUser(authId).catch(() => undefined);
    throw insertErr;
  }

  // eslint-disable-next-line no-console
  console.log(`[seed] super-admin created: mobile=${mobile} name="${name}"`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed] failed:', err);
  process.exit(1);
});
