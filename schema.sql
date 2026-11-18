-- Выполните целиком в Supabase SQL Editor на новом проекте.
create extension if not exists pgcrypto;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check (username ~ '^[[:alnum:]_-]{3,30}$'),
 faction text not null check(faction in ('army','commandant')),
 role text not null default 'user' check(role in ('user','admin')),
 created_at timestamptz not null default now()
);
create table public.order_counters (
 faction text primary key check(faction in ('army','commandant')),
 next_number integer not null default 1 check(next_number>0)
);
insert into public.order_counters(faction) values ('army'),('commandant');
create table public.orders (
 id uuid primary key default gen_random_uuid(),
 faction text not null check(faction in ('army','commandant')),
 number integer not null check(number>0),
 title text not null check(length(trim(title)) between 1 and 250),
 document_date date not null,
 author_id uuid not null references public.profiles(id),
 author_name text not null,
 image_path text not null unique,
 status text not null default 'pending' check(status in ('pending','published')),
 created_at timestamptz not null default now(),
 published_at timestamptz,
 unique(faction,number)
);
create index orders_public_idx on public.orders(faction,status,number desc);
create table public.order_history (
 id bigint generated always as identity primary key,
 order_id uuid,
 faction text not null,
 order_number integer not null,
 actor_id uuid,
 actor_name text not null,
 action text not null check(action in ('published','deleted')),
 created_at timestamptz not null default now()
);
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin');
$$;
create or replace function public.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare n text; f text;
begin
 n:=nullif(trim(new.raw_user_meta_data->>'username'),'');
 f:=new.raw_user_meta_data->>'faction';
 if n is null or n !~ '^[[:alnum:]_-]{3,30}$' or f not in ('army','commandant') then
  raise exception 'Invalid registration profile';
 end if;
 insert into public.profiles(id,username,faction,role) values(new.id,n,f,'user');
 return new;
end $$;
create trigger auth_profile_created after insert on auth.users for each row execute function public.create_profile();
-- Не позволяем менять роль, ник и подразделение через пользовательский API.
create or replace function public.guard_profile_update() returns trigger language plpgsql set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Admin required'; end if;
 if new.id<>old.id or new.username<>old.username or new.role<>old.role then raise exception 'Only faction updates allowed'; end if;
 return new;
end $$;
create trigger guard_profile before update on public.profiles for each row execute function public.guard_profile_update();
create or replace function public.reserve_order(p_faction text,p_title text,p_document_date date)
returns table(id uuid,number integer,image_path text)
language plpgsql security definer set search_path='' as $$
declare u public.profiles%rowtype; n integer; oid uuid; p text;
begin
 select * into u from public.profiles where profiles.id=(select auth.uid());
 if not found then raise exception 'Login required'; end if;
 if p_faction not in ('army','commandant') or (u.role<>'admin' and u.faction<>p_faction) then raise exception 'Wrong faction'; end if;
 if p_title is null or length(trim(p_title)) not between 1 and 250 or p_document_date is null then raise exception 'Invalid document'; end if;
 update public.order_counters set next_number=next_number+1 where faction=p_faction returning next_number-1 into n;
 if n is null then raise exception 'Unknown faction'; end if;
 oid:=gen_random_uuid();p:=p_faction||'/'||oid::text||'.png';
 insert into public.orders(id,faction,number,title,document_date,author_id,author_name,image_path)
 values(oid,p_faction,n,trim(p_title),u.id,u.username,p);
 return query select oid,n,p;
end $$;
create or replace function public.publish_order(p_order_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; u public.profiles%rowtype;
begin
 select * into u from public.profiles where id=(select auth.uid());
 select * into o from public.orders where id=p_order_id for update;
 if o.id is null or o.status<>'pending' or (o.author_id<>u.id and u.role<>'admin') then raise exception 'Not permitted'; end if;
 if not exists(select 1 from storage.objects where bucket_id='order-images' and name=o.image_path) then raise exception 'PNG not uploaded'; end if;
 update public.orders set status='published',published_at=now() where id=o.id;
 insert into public.order_history(order_id,faction,order_number,actor_id,actor_name,action) values(o.id,o.faction,o.number,u.id,u.username,'published');
end $$;
create or replace function public.admin_delete_order(p_order_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; u public.profiles%rowtype;
begin
 select * into u from public.profiles where id=(select auth.uid());
 if u.role is distinct from 'admin' then raise exception 'Admin required'; end if;
 select * into o from public.orders where id=p_order_id for update;
 if o.id is null then raise exception 'Order not found'; end if;
 insert into public.order_history(order_id,faction,order_number,actor_id,actor_name,action) values(o.id,o.faction,o.number,u.id,u.username,'deleted');
 delete from public.orders where id=o.id;
 -- PNG удаляется отдельно администратором из Storage; ссылка после удаления не показывается в реестре.
end $$;
alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_counters enable row level security;
alter table public.order_history enable row level security;
create policy profile_read on public.profiles for select to authenticated using(id=(select auth.uid()) or public.is_admin());
create policy profile_admin_update on public.profiles for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy orders_public_read on public.orders for select to anon,authenticated using(status='published' or author_id=(select auth.uid()) or public.is_admin());
create policy history_admin_read on public.order_history for select to authenticated using(public.is_admin());
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('order-images','order-images',true,10485760,array['image/png']) on conflict(id) do nothing;
create policy order_image_upload on storage.objects for insert to authenticated
with check(bucket_id='order-images' and exists(
 select 1 from public.orders o where o.image_path=name and o.status='pending' and o.author_id=(select auth.uid())
));
-- Public read is intentional: published documents are accessible to everyone.
-- Не размещайте на сайте документы с секретной или персональной информацией.
revoke all on public.order_counters from anon,authenticated;
revoke all on public.order_history from anon;
revoke all on function public.reserve_order(text,text,date) from public;
revoke all on function public.publish_order(uuid) from public;
revoke all on function public.admin_delete_order(uuid) from public;
grant execute on function public.reserve_order(text,text,date),public.publish_order(uuid),public.admin_delete_order(uuid) to authenticated;
-- ПОСЛЕ регистрации пользователя с ником local выполните ОДИН РАЗ в SQL Editor:
-- update public.profiles set role='admin' where username='local';
-- ВАЖНО: сначала отключите триггер guard_profile на время повышения,
-- либо используйте отдельную защищённую bootstrap-функцию ниже.
create or replace function public.bootstrap_local_admin() returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.profiles where role='admin') then raise exception 'Admin already exists'; end if;
 if (select count(*) from public.profiles where username='local')<>1 then raise exception 'Register local first'; end if;
 -- internal setting permits one-time bootstrap; no user-facing EXECUTE grant
 perform set_config('app.bootstrap_admin','yes',true);
 update public.profiles set role='admin' where username='local';
end $$;
create or replace function public.guard_profile_update() returns trigger language plpgsql set search_path='' as $$
begin
 if current_setting('app.bootstrap_admin',true)='yes' then return new; end if;
 if not public.is_admin() then raise exception 'Admin required'; end if;
 if new.id<>old.id or new.username<>old.username or new.role<>old.role then raise exception 'Only faction updates allowed'; end if;
 return new;
end $$;
revoke all on function public.bootstrap_local_admin() from public,anon,authenticated;
-- Запустите вручную в SQL Editor: select public.bootstrap_local_admin();
