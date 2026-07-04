-- L.7 — CAEA (contingencia AFIP, RG 5782/2025). Un código por quincena
-- (periodo YYYYMM + orden 1|2) que cubre todos los PV del CUIT. Se solicita
-- por adelantado (cron), se usa para emitir offline en PVs de contingencia
-- (sales_points con EmisionTipo CAEA en el ABM de ARCA) y se informa el uso
-- hasta fch_tope_inf (FECAEARegInformativo / FECAEASinMovimientoInformar).

set row_security = off;

create table public.caea_codes (
  id                     uuid primary key default gen_random_uuid(),
  periodo                int not null check (periodo between 202001 and 209912),
  orden                  smallint not null check (orden in (1, 2)),
  caea                   text not null check (caea ~ '^[0-9]{14}$'),
  fch_vig_desde          date not null,
  fch_vig_hasta          date not null,
  fch_tope_inf           date not null,
  fch_proceso            text,
  observaciones          jsonb,
  -- PVs de contingencia ya informados "sin movimiento" para este CAEA.
  no_movement_pvs        jsonb not null default '[]'::jsonb,
  created_at             timestamptz not null default now(),

  constraint caea_codes_periodo_orden_unique unique (periodo, orden)
);

comment on table public.caea_codes is
  'CAEA otorgados por AFIP (FECAEASolicitar), uno por quincena. fch_tope_inf = deadline del régimen informativo.';

alter table public.caea_codes enable row level security;

create policy "Finance can view caea_codes"
  on public.caea_codes for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

-- Escrituras: solo service role (crons Inngest + acciones que usan el
-- service client detrás de afip:admin). Sin policy de insert/update para
-- authenticated.

-- Emisión bajo CAEA: el comprobante guarda el código en `cae` y discrimina
-- por emission_type (QR: tipoCodAut A). cbte_fch_hs_gen es obligatorio al
-- informar (RG 5782, código 1440); caea_informed_at marca el registro hecho.
alter table public.invoices
  add column emission_type text not null default 'cae'
    check (emission_type in ('cae', 'caea')),
  add column cbte_fch_hs_gen timestamptz,
  add column caea_informed_at timestamptz;

comment on column public.invoices.emission_type is
  'cae = FECAESolicitar online; caea = contingencia (código anticipado, se informa después).';

create index invoices_caea_pending_idx
  on public.invoices (emission_type, caea_informed_at)
  where emission_type = 'caea' and caea_informed_at is null;

set row_security = on;
