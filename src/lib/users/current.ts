import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type UserRole = 'super_admin' | 'supervisor' | 'centre_manager' | 'accountant';

export interface CurrentAppUser {
  id: string;
  authUserId: string;
  fullName: string;
  mobile: string;
  role: UserRole;
}

/**
 * Resolve the calling user's app_users row. Redirects to /login if no session,
 * or signs out if the auth user has no app_users row (mirrors dashboard self-heal).
 */
export async function requireAppUser(): Promise<CurrentAppUser> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: row, error } = await supabase
    .from('app_users')
    .select('id, auth_user_id, full_name, mobile, role, is_active, deleted_at')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (error || !row || !row.is_active || row.deleted_at) {
    await supabase.auth.signOut();
    redirect('/login');
  }

  return {
    id: row.id,
    authUserId: row.auth_user_id,
    fullName: row.full_name,
    mobile: row.mobile,
    role: row.role as UserRole,
  };
}

export async function requireRole(allowed: readonly UserRole[]): Promise<CurrentAppUser> {
  const user = await requireAppUser();
  if (!allowed.includes(user.role)) redirect('/dashboard');
  return user;
}
