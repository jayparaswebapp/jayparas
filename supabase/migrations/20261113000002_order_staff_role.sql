-- New login type for staff who take and pack orders. Kept in its own
-- migration: Postgres can't use a new enum value in the same transaction
-- that adds it.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'order_staff';
