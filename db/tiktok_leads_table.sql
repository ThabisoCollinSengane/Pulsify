-- TikTok leads: posts found about Durban events that admin can reach out to
create table if not exists public.tiktok_leads (
  id           uuid primary key default gen_random_uuid(),
  url          text unique not null,
  caption      text,
  author_handle text,
  thumbnail_url text,
  status       text not null default 'new' check (status in ('new','contacted','ignored')),
  created_at   timestamptz not null default now()
);

-- RLS: only authenticated users with role='admin' can read/write
alter table public.tiktok_leads enable row level security;

create policy "admin_select" on public.tiktok_leads
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin_insert" on public.tiktok_leads
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin_update" on public.tiktok_leads
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin_delete" on public.tiktok_leads
  for delete using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
