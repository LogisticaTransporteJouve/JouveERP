-- K.8 — Items por línea en facturas de compra.
--
-- Hoy `purchase_invoices` es header-only (`imp_neto + imp_iva + imp_trib +
-- imp_total`). Para el libro IVA Compras detallado (L.4) hace falta
-- discriminar IVA por alícuota — esto requiere un detalle por línea.
--
-- Items son OPCIONALES:
--   * Cuando hay items → los totales del header se recalculan desde la
--     suma de items vía RPC `replace_purchase_invoice_items`.
--   * Cuando no hay (caso típico: las 1313 facturas importadas de AFIP
--     en K.2) → el header queda con los totales que se cargaron a mano.
--     La UI las marca como "sin detalle".
--
-- Mirror exacto del schema de `invoice_items` (lado ventas) — misma tabla
-- de alícuotas AFIP (3=0%, 4=10.5%, 5=21%, 6=27%, 8=5%, 9=2.5%).

set row_security = off;

------------------------------------------------------------------------------
-- 1. Table
------------------------------------------------------------------------------
create table public.purchase_invoice_items (
  id                    uuid       primary key default gen_random_uuid(),
  purchase_invoice_id   uuid       not null references public.purchase_invoices (id) on delete cascade,
  sort_order            int        not null default 0,
  description           text       not null,
  quantity              numeric(15, 4) not null check (quantity > 0),
  unit_price            numeric(15, 4) not null check (unit_price >= 0),
  iva_rate_id           int        check (iva_rate_id in (3, 4, 5, 6, 8, 9)),
  line_neto             numeric(15, 2) not null,
  line_iva              numeric(15, 2) not null default 0,
  line_total            numeric(15, 2) not null,
  created_at            timestamptz not null default now()
);

comment on table public.purchase_invoice_items is
  'Line items of a purchase invoice. iva_rate_id maps to AFIP alícuota IDs (3=0%, 4=10.5%, 5=21%, 6=27%, 8=5%, 9=2.5%). Optional — facturas sin items quedan con los totales del header.';

create index purchase_invoice_items_invoice_idx
  on public.purchase_invoice_items (purchase_invoice_id);

------------------------------------------------------------------------------
-- 2. RLS — mismo patrón que purchase_invoices
------------------------------------------------------------------------------
alter table public.purchase_invoice_items enable row level security;

create policy "Authenticated users can view purchase invoice items"
  on public.purchase_invoice_items for select
  to authenticated
  using (true);

create policy "Owners, admins and finance can insert purchase invoice items"
  on public.purchase_invoice_items for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners, admins and finance can update purchase invoice items"
  on public.purchase_invoice_items for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners, admins and finance can delete purchase invoice items"
  on public.purchase_invoice_items for delete
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

------------------------------------------------------------------------------
-- 3. RPC — replace items atomically + recalc header totals
------------------------------------------------------------------------------
-- Una sola llamada que (1) borra los items existentes, (2) inserta los
-- nuevos, (3) recalcula imp_neto/imp_iva/imp_trib/imp_total en el header.
--
-- p_items shape:
--   [{"description": "Gasoil grado 3", "quantity": 200, "unit_price": 850,
--     "iva_rate_id": 5, "line_neto": 170000, "line_iva": 35700,
--     "line_total": 205700, "sort_order": 0}, ...]
--
-- Si p_items es un array vacío, borra los items y deja el header como
-- está (no toca imp_*). Esto permite "limpiar items y volver a header-only".

create or replace function public.replace_purchase_invoice_items(
  p_invoice_id uuid,
  p_items      jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item        jsonb;
  v_count       int;
  v_sum_neto    numeric(15, 2);
  v_sum_iva     numeric(15, 2);
  v_sum_total   numeric(15, 2);
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a jsonb array';
  end if;

  delete from public.purchase_invoice_items
   where purchase_invoice_id = p_invoice_id;

  v_count := jsonb_array_length(p_items);

  if v_count = 0 then
    return;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.purchase_invoice_items (
      purchase_invoice_id, sort_order, description,
      quantity, unit_price, iva_rate_id,
      line_neto, line_iva, line_total
    ) values (
      p_invoice_id,
      coalesce((v_item ->> 'sort_order')::int, 0),
      v_item ->> 'description',
      (v_item ->> 'quantity')::numeric,
      (v_item ->> 'unit_price')::numeric,
      nullif(v_item ->> 'iva_rate_id', '')::int,
      (v_item ->> 'line_neto')::numeric,
      coalesce((v_item ->> 'line_iva')::numeric, 0),
      (v_item ->> 'line_total')::numeric
    );
  end loop;

  -- Recalc header totals from items. imp_trib (ITC, percepciones, etc.)
  -- queda como está — no va por línea, es header-level. imp_total =
  -- sum(line_total) + imp_trib existente.
  select
    coalesce(sum(line_neto),  0),
    coalesce(sum(line_iva),   0),
    coalesce(sum(line_total), 0)
    into v_sum_neto, v_sum_iva, v_sum_total
  from public.purchase_invoice_items
  where purchase_invoice_id = p_invoice_id;

  update public.purchase_invoices
     set imp_neto  = v_sum_neto,
         imp_iva   = v_sum_iva,
         imp_total = v_sum_total + coalesce(imp_trib, 0),
         updated_at = now()
   where id = p_invoice_id;
end;
$$;

comment on function public.replace_purchase_invoice_items(uuid, jsonb) is
  'Atomic replace items + recalc header totals. imp_trib (header-level) preserved. Empty array clears items but leaves header totals untouched.';

set row_security = on;
