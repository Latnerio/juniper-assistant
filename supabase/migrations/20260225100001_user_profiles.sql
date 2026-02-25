create table user_profiles (
  id uuid primary key references auth.users,
  email text,
  is_admin boolean default false,
  created_at timestamptz default now()
);
alter table user_profiles enable row level security;
create policy "Users see own profile" on user_profiles for select using (auth.uid() = id);
create policy "Admins see all" on user_profiles for all using (
  exists (select 1 from user_profiles where id = auth.uid() and is_admin = true)
);

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into user_profiles (id, email) values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
