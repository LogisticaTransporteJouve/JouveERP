SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Flota › Tarifas: the flete tariffs as the business keeps them in its
-- spreadsheets (general, consumidor final, muebles, and one per special
-- client), to follow each increase. A reference only: no carga, liquidación
-- or invoice reads them (owner, 2026-11-06: «sin estar relacionado a algo,
-- más que nada para tener control de los aumentos»).
--
--   freight_tariff_lists     a tarifario («General», «Consumidor final»,
--                            «Errequet»…), optionally of a client.
--   freight_tariff_versions  each period's prices («Noviembre/Diciembre 26»,
--                            valid from a date), with the increase over the
--                            previous one when it came from one.
--   freight_tariff_lines     a line of a version: section («1 pallet»),
--                            concept («0 a 199 kg»), a price in pesos or a
--                            percentage («% x remito»), and a note
--                            («Tarifa + $62.600»).
--
-- apply_freight_tariff_increase copies the latest version of each list into
-- a new one with every price raised by a percentage (percentages are kept),
-- in one transaction.
--
-- Writes go through the service role from actions gated by
-- freight_tariffs:write; RLS mirrors the roles of freight_tariffs:read.
--
-- Rollback: older code does not know these tables.

create table public.freight_tariff_lists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  client_id   uuid references public.clients (id) on delete set null,
  notes       text check (notes is null or char_length(notes) <= 500),
  sort_order  bigint not null default 0,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index freight_tariff_lists_name_key
  on public.freight_tariff_lists (lower(btrim(name)));
create index freight_tariff_lists_client_idx
  on public.freight_tariff_lists (client_id);
create index freight_tariff_lists_created_by_idx
  on public.freight_tariff_lists (created_by);

create trigger freight_tariff_lists_set_updated_at
  before update on public.freight_tariff_lists
  for each row execute function public.set_updated_at();

comment on table public.freight_tariff_lists is
  'Tarifarios de flete (general, consumidor final, por cliente): referencia para seguir los aumentos; no los lee ninguna carga ni liquidación.';

create table public.freight_tariff_versions (
  id            uuid primary key default gen_random_uuid(),
  list_id       uuid not null references public.freight_tariff_lists (id) on delete cascade,
  label         text not null check (char_length(btrim(label)) between 1 and 80),
  valid_from    date not null,
  -- The increase over the previous version when this one came from it.
  increase_pct  numeric(7, 3) check (increase_pct is null or increase_pct between -100 and 1000),
  notes         text check (notes is null or char_length(notes) <= 500),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint freight_tariff_versions_list_from_key unique (list_id, valid_from)
);

create index freight_tariff_versions_created_by_idx
  on public.freight_tariff_versions (created_by);

comment on table public.freight_tariff_versions is
  'Precios de un tarifario de flete desde una fecha; increase_pct = aumento sobre la versión anterior cuando salió de ella.';

create table public.freight_tariff_lines (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.freight_tariff_versions (id) on delete cascade,
  section     text check (section is null or char_length(section) <= 120),
  concept     text not null check (char_length(btrim(concept)) between 1 and 200),
  price       numeric(14, 2) check (price is null or price >= 0),
  percent     numeric(7, 3) check (percent is null or percent between 0 and 100),
  note        text check (note is null or char_length(note) <= 300),
  sort_order  bigint not null default 0
);

create index freight_tariff_lines_version_idx
  on public.freight_tariff_lines (version_id, sort_order);

comment on table public.freight_tariff_lines is
  'Línea de una versión de tarifario de flete: sección, concepto, precio en pesos o porcentaje, y nota.';

------------------------------------------------------------------------------
-- RLS: read by the roles of freight_tariffs:read; writes via service role.
------------------------------------------------------------------------------

alter table public.freight_tariff_lists enable row level security;
alter table public.freight_tariff_versions enable row level security;
alter table public.freight_tariff_lines enable row level security;

create policy "Freight tariff readers view lists" on public.freight_tariff_lists
  for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance', 'operations'])));
create policy "Freight tariff readers view versions" on public.freight_tariff_versions
  for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance', 'operations'])));
create policy "Freight tariff readers view lines" on public.freight_tariff_lines
  for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance', 'operations'])));

revoke all on table public.freight_tariff_lists from public, anon, authenticated;
revoke all on table public.freight_tariff_versions from public, anon, authenticated;
revoke all on table public.freight_tariff_lines from public, anon, authenticated;
grant select on table public.freight_tariff_lists to authenticated;
grant select on table public.freight_tariff_versions to authenticated;
grant select on table public.freight_tariff_lines to authenticated;
grant all on table public.freight_tariff_lists to service_role;
grant all on table public.freight_tariff_versions to service_role;
grant all on table public.freight_tariff_lines to service_role;

------------------------------------------------------------------------------
-- Save a version's lines in one transaction (replace them all).
------------------------------------------------------------------------------

create function public.replace_freight_tariff_lines(p_version_id uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'replace_freight_tariff_lines: p_lines must be a JSON array'
      using errcode = '22023';
  end if;
  perform 1 from public.freight_tariff_versions where id = p_version_id for update;
  if not found then
    raise exception 'La versión del tarifario no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  delete from public.freight_tariff_lines where version_id = p_version_id;
  insert into public.freight_tariff_lines
    (version_id, section, concept, price, percent, note, sort_order)
  select p_version_id,
         nullif(btrim(e.value ->> 'section'), ''),
         btrim(e.value ->> 'concept'),
         (e.value ->> 'price')::numeric,
         (e.value ->> 'percent')::numeric,
         nullif(btrim(e.value ->> 'note'), ''),
         e.ord - 1
    from jsonb_array_elements(p_lines) with ordinality as e(value, ord);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.replace_freight_tariff_lines(uuid, jsonb) is
  'Reemplaza las líneas de una versión de tarifario de flete, en el orden recibido. Solo service role.';

revoke all on function public.replace_freight_tariff_lines(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_freight_tariff_lines(uuid, jsonb) to service_role;

------------------------------------------------------------------------------
-- Apply an increase: a new version of each list from its latest one.
------------------------------------------------------------------------------

-- Every price is raised by p_pct and rounded to a multiple of p_round_to
-- (1, 10 or 100 pesos); percentages and notes are copied as they are. A
-- list whose latest version starts on or after p_valid_from is refused (the
-- increase would not be the newest). Returns the new versions' ids.
create function public.apply_freight_tariff_increase(
  p_list_ids   uuid[],
  p_pct        numeric,
  p_label      text,
  p_valid_from date,
  p_round_to   integer,
  p_user_id    uuid
)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list    uuid;
  v_latest  record;
  v_new     uuid;
begin
  if p_pct is null or p_pct <= -100 or p_pct > 1000 then
    raise exception 'El aumento tiene que ser un porcentaje válido.'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_round_to is null or p_round_to not in (1, 10, 100) then
    raise exception 'El redondeo tiene que ser 1, 10 o 100.'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_label is null or char_length(btrim(p_label)) not between 1 and 80 then
    raise exception 'Poné un nombre para el período (por ejemplo «Enero/Febrero 27»).'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if coalesce(cardinality(p_list_ids), 0) = 0 then
    raise exception 'Elegí al menos un tarifario.'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  foreach v_list in array p_list_ids loop
    select v.id, v.valid_from, l.name
      into v_latest
      from public.freight_tariff_versions v
      join public.freight_tariff_lists l on l.id = v.list_id
     where v.list_id = v_list
     order by v.valid_from desc
     limit 1
     for update of v;
    if not found then
      raise exception 'Un tarifario elegido no tiene precios cargados.'
        using errcode = 'P0002', hint = 'jouve_guard';
    end if;
    if v_latest.valid_from >= p_valid_from then
      raise exception 'El tarifario «%» ya tiene precios desde el %: el aumento tiene que empezar después.',
          v_latest.name, to_char(v_latest.valid_from, 'DD/MM/YYYY')
        using errcode = '23514', hint = 'jouve_guard';
    end if;

    insert into public.freight_tariff_versions
      (list_id, label, valid_from, increase_pct, created_by)
    values
      (v_list, btrim(p_label), p_valid_from, p_pct, p_user_id)
    returning id into v_new;

    insert into public.freight_tariff_lines
      (version_id, section, concept, price, percent, note, sort_order)
    select v_new, l.section, l.concept,
           case when l.price is null then null
                else round(l.price * (1 + p_pct / 100) / p_round_to) * p_round_to
           end,
           l.percent, l.note, l.sort_order
      from public.freight_tariff_lines l
     where l.version_id = v_latest.id;

    return next v_new;
  end loop;
end;
$$;

comment on function public.apply_freight_tariff_increase(uuid[], numeric, text, date, integer, uuid) is
  'Crea, para cada tarifario de flete elegido, una versión nueva desde su última con los precios aumentados un porcentaje y redondeados (los porcentajes no cambian). Todo o nada. Solo service role.';

revoke all on function public.apply_freight_tariff_increase(uuid[], numeric, text, date, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_freight_tariff_increase(uuid[], numeric, text, date, integer, uuid)
  to service_role;
