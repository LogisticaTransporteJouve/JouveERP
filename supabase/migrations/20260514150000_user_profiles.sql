-- User profiles: nombre, apellido, color de avatar y path al avatar
-- subido. Vive en public para queryable con joins normales (no JSON
-- functions sobre auth schema). Auto-created por trigger en
-- auth.users.

create or replace function public.pick_default_avatar_color(p_user_id uuid)
returns text language sql immutable as $$
  select (array['gray','blue','sage','orange','purple'])[
    abs(hashtext(p_user_id::text)) % 5 + 1
  ];
$$;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  avatar_path text,
  avatar_color text not null default 'gray',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_profiles_avatar_color_valid
    check (avatar_color in ('gray','blue','sage','orange','purple'))
);

create trigger user_profiles_set_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- Auto-create profile cuando se inserta un user en auth.
create or replace function public.handle_new_user_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_profiles (user_id, avatar_color)
  values (new.id, public.pick_default_avatar_color(new.id))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- Backfill para users existentes (los seeded de Fase B en adelante).
insert into public.user_profiles (user_id, avatar_color)
select u.id, public.pick_default_avatar_color(u.id)
from auth.users u
on conflict (user_id) do nothing;

alter table public.user_profiles enable row level security;

-- Cualquier authenticated puede leer todos los profiles (avatar visible
-- en chat, audit, listados de assignees, sidebar).
create policy "user_profiles_select_authenticated"
  on public.user_profiles for select to authenticated using (true);

-- Solo cada user puede editar el propio.
create policy "user_profiles_update_self"
  on public.user_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
