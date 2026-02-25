create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  title text not null,
  messages jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table conversations enable row level security;
create policy "Users see own conversations" on conversations for all using (auth.uid() = user_id);
create index idx_conversations_user on conversations (user_id, updated_at desc);
