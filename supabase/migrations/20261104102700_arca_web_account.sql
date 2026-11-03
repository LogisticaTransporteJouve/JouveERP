SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- The ARCA web user (clave fiscal) the robot signs in with to download Mis
-- Comprobantes → Recibidos. One row. The password lives in Supabase Vault
-- (vault.secrets, encrypted at rest); this table keeps only the CUIT, the
-- secret's id and how the last sign-ins went. Only the service role reads
-- the password, from one job step; owner and admin edit it from
-- Admin → AFIP and see only the status.
--
-- Needs the supabase_vault extension (installed on every Supabase project;
-- the owner confirms it on production before this ships).

create table public.arca_web_account (
  id                   boolean primary key default true check (id),
  cuit                 text not null check (cuit ~ '^\d{11}$'),
  secret_id            uuid,
  status               text not null default 'active'
                         check (status in ('active', 'sign_in_failing')),
  consecutive_failures bigint not null default 0 check (consecutive_failures >= 0),
  last_success_at      timestamptz,
  last_error_code      text check (last_error_code is null or char_length(last_error_code) <= 40),
  updated_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now()
);

comment on table public.arca_web_account is
  'Usuario de ARCA para Mis Comprobantes (una fila). La clave está en Vault (secret_id); acá solo el estado.';

create index arca_web_account_updated_by_idx on public.arca_web_account (updated_by);

alter table public.arca_web_account enable row level security;

-- Same roles as afip:admin (lib/auth/permissions.ts).
create policy "AFIP admins view the ARCA web account" on public.arca_web_account
  for select to authenticated
  using ( (select public.user_has_role(array['owner', 'admin'])) );

revoke all on table public.arca_web_account from public, anon, authenticated;
grant select (id, cuit, status, consecutive_failures, last_success_at, last_error_code, updated_by, updated_at)
  on table public.arca_web_account to authenticated;
grant all on table public.arca_web_account to service_role;

------------------------------------------------------------------------------
-- Credentials
------------------------------------------------------------------------------

-- Saves the CUIT and, when given, a new password (a null password keeps the
-- stored one). A new password or CUIT resets the failure state. Never echoes
-- the password, not even in an error.
create or replace function public.set_arca_web_credentials(
  p_cuit     text,
  p_user_id  uuid,
  p_password text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
  v_cuit   text;
begin
  if p_cuit is null or p_cuit !~ '^\d{11}$' then
    raise exception 'CUIT inválido.' using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_password is not null and (char_length(p_password) = 0 or char_length(p_password) > 200) then
    raise exception 'La clave no es válida.' using errcode = '22023', hint = 'jouve_guard';
  end if;

  select secret_id, cuit into v_secret, v_cuit from public.arca_web_account where id;

  if p_password is null and v_secret is null then
    raise exception 'Falta la clave.' using errcode = '22023', hint = 'jouve_guard';
  end if;

  if p_password is not null then
    -- A secret left by an earlier row (deleted by hand) is reused, not
    -- created again: the name is unique in Vault.
    if v_secret is null then
      select id into v_secret from vault.secrets where name = 'arca_web_password';
    end if;
    if v_secret is null then
      v_secret := vault.create_secret(p_password, 'arca_web_password',
                                      'Clave fiscal del usuario de ARCA para Mis Comprobantes');
    else
      perform vault.update_secret(v_secret, p_password);
    end if;
  end if;

  insert into public.arca_web_account as a (id, cuit, secret_id, updated_by, updated_at)
  values (true, p_cuit, v_secret, p_user_id, now())
  on conflict (id) do update
     set cuit = excluded.cuit,
         secret_id = excluded.secret_id,
         updated_by = excluded.updated_by,
         updated_at = now(),
         status = case when p_password is not null or a.cuit <> excluded.cuit
                       then 'active' else a.status end,
         consecutive_failures = case when p_password is not null or a.cuit <> excluded.cuit
                                     then 0 else a.consecutive_failures end,
         last_error_code = case when p_password is not null or a.cuit <> excluded.cuit
                                then null else a.last_error_code end;
end;
$$;

revoke all on function public.set_arca_web_credentials(text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_arca_web_credentials(text, uuid, text) to service_role;

-- The password, for the job step that signs in. Null when not configured or
-- when ARCA rejected it: no caller retries a rejected clave (that would lock
-- the user) until someone saves a new one.
create or replace function public.get_arca_web_password()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
    from public.arca_web_account a
    join vault.decrypted_secrets s on s.id = a.secret_id
   where a.id and a.status = 'active';
$$;

revoke all on function public.get_arca_web_password() from public, anon, authenticated;
grant execute on function public.get_arca_web_password() to service_role;

-- Records a sign-in: a success clears the failures; a rejected clave
-- (SIGN_IN_REJECTED) stops every automatic attempt until the clave changes.
create or replace function public.record_arca_web_sign_in(
  p_ok         boolean,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ok then
    update public.arca_web_account
       set status = 'active',
           consecutive_failures = 0,
           last_success_at = now(),
           last_error_code = null
     where id;
  else
    update public.arca_web_account
       set consecutive_failures = consecutive_failures + 1,
           last_error_code = left(p_error_code, 40),
           status = case when p_error_code = 'SIGN_IN_REJECTED'
                         then 'sign_in_failing' else status end
     where id;
  end if;
end;
$$;

revoke all on function public.record_arca_web_sign_in(boolean, text) from public, anon, authenticated;
grant execute on function public.record_arca_web_sign_in(boolean, text) to service_role;
