-- Esquema y políticas RLS para Fechas Importantes en Supabase
-- Ejecuta este script una sola vez en Supabase -> SQL Editor -> Run

create table if not exists public.fechas_importantes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  type text not null check (type in ('birthday', 'anniversary', 'other')),
  custom_label text not null default '',
  name text not null check (char_length(trim(name)) > 0),
  day smallint not null check (day between 1 and 31),
  month smallint not null check (month between 1 and 12),
  year integer null check (year is null or year between 1900 and 2150),
  emoji text not null default '',
  photo text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fechas_importantes_user_id_idx
  on public.fechas_importantes (user_id);

create or replace function public.set_fechas_importantes_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_fechas_importantes_updated_at on public.fechas_importantes;
create trigger trg_fechas_importantes_updated_at
  before update on public.fechas_importantes
  for each row
  execute function public.set_fechas_importantes_updated_at();

alter table public.fechas_importantes enable row level security;

revoke all on table public.fechas_importantes from anon;
grant select, insert, update, delete on table public.fechas_importantes to authenticated;

drop policy if exists "fechas_select_own" on public.fechas_importantes;
create policy "fechas_select_own"
  on public.fechas_importantes
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "fechas_insert_own" on public.fechas_importantes;
create policy "fechas_insert_own"
  on public.fechas_importantes
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "fechas_update_own" on public.fechas_importantes;
create policy "fechas_update_own"
  on public.fechas_importantes
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "fechas_delete_own" on public.fechas_importantes;
create policy "fechas_delete_own"
  on public.fechas_importantes
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

alter table public.fechas_importantes replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.fechas_importantes;
exception
  when duplicate_object then null;
end;
$$;

