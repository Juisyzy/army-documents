-- Выполнить ОДИН РАЗ в Supabase SQL Editor существующего проекта.
-- Не запускайте schema.sql заново: он предназначен для пустой базы.
create table if not exists public.order_drafts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 faction text not null check(faction in ('army','commandant')),
 title text not null default 'Без названия',
 content jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists order_drafts_owner_updated_idx on public.order_drafts(user_id,updated_at desc);
alter table public.order_drafts enable row level security;
grant select,insert,update,delete on public.order_drafts to authenticated;
-- Повторный запуск не создаст дубли политик.
drop policy if exists drafts_select_own on public.order_drafts;
drop policy if exists drafts_insert_own on public.order_drafts;
drop policy if exists drafts_update_own on public.order_drafts;
drop policy if exists drafts_delete_own on public.order_drafts;
create policy drafts_select_own on public.order_drafts for select to authenticated using(user_id=(select auth.uid()));
create policy drafts_insert_own on public.order_drafts for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.faction=order_drafts.faction)));
create policy drafts_update_own on public.order_drafts for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.faction=order_drafts.faction)));
create policy drafts_delete_own on public.order_drafts for delete to authenticated using(user_id=(select auth.uid()));
create or replace function public.touch_order_draft() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=now(); return new; end $$;
drop trigger if exists order_drafts_touch on public.order_drafts;
create trigger order_drafts_touch before update on public.order_drafts for each row execute function public.touch_order_draft();
