create table if not exists response_cache (
  id bigserial primary key,
  question_hash text not null unique,
  question text not null,
  answer text not null,
  language text not null default 'en',
  created_at timestamptz not null default now(),
  hit_count int not null default 0
);

create index if not exists idx_response_cache_hash on response_cache (question_hash);
