-- Fix infinite recursion in user_profiles RLS
drop policy if exists "Users see own profile" on user_profiles;
drop policy if exists "Admins see all" on user_profiles;

-- Simple policy: users can read their own profile
create policy "Users read own profile"
  on user_profiles for select
  using (auth.uid() = id);

-- Admins can do everything - use a security definer function to avoid recursion
create or replace function is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select is_admin from user_profiles where id = uid), false);
$$;

create policy "Admins manage all profiles"
  on user_profiles for all
  using (is_admin(auth.uid()));
