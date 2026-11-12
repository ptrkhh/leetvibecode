-- LeetVibeCode waitlist. Lives in the Authentyc Supabase project; prefixed so it
-- cannot collide with Authentyc's own tables.
create table if not exists lvc_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

-- No policies on purpose: only the server (secret key) can read or write.
alter table lvc_waitlist enable row level security;
