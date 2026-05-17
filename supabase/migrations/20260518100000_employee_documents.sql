-- N.6 — Documentos vencibles de empleados (carnet, libreta, cursos, etc.)
--
-- Tracking de papeles obligatorios que tienen fecha de vencimiento. Cron
-- diario (Inngest `document-expiry-alerts`) genera notificaciones in-app
-- a owner/admin/operations cuando faltan ≤ 30 días para vencer.
--
-- Una sola tabla `employee_documents` con un row por (empleado, tipo, fecha
-- de emisión). Cuando renovás un documento, insertás un row nuevo con la
-- fecha de vencimiento extendida — los viejos quedan como histórico. Un
-- partial unique index restringe a 1 row VIGENTE por (empleado, tipo)
-- para que la UI sepa cuál mostrar al frente sin pelear con renovaciones
-- futuras anticipadas.

set row_security = off;

------------------------------------------------------------------------------
-- 1. enum + table
------------------------------------------------------------------------------
create type public.employee_document_kind as enum (
  'licencia_conducir',
  'lnh',
  'libreta_sanitaria',
  'curso_cargas_peligrosas',
  'curso_mercaderias_peligrosas',
  'aptitud_psicofisica',
  'aptitud_visual',
  'cedula_verde',
  'cedula_azul',
  'seguro_personal',
  'arn',
  'otro'
);

comment on type public.employee_document_kind is
  'Tipo de papel vencible. lnh = Licencia Nacional Habilitante (CNRT). arn = Autorización para Renovar Nacional (transporte).';

create table public.employee_documents (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees (id) on delete cascade,
  kind               public.employee_document_kind not null,
  number             text,
  issued_at          date,
  expires_at         date not null,
  issuing_authority  text,
  notes              text,
  attachment_file_id uuid references public.files (id) on delete set null,
  notified_at        timestamptz,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint employee_documents_issued_before_expires
    check (issued_at is null or expires_at >= issued_at)
);

comment on table public.employee_documents is
  'Papeles vencibles de empleados (carnet, libreta, cursos). Un row por renovación; los viejos quedan como histórico.';

create index employee_documents_employee_idx on public.employee_documents (employee_id);
create index employee_documents_expires_idx on public.employee_documents (expires_at);
create index employee_documents_kind_idx on public.employee_documents (kind);

-- Nota: NO ponemos unique partial sobre `(employee_id, kind) WHERE expires_at
-- >= current_date` porque PG exige funciones IMMUTABLE en predicates y
-- current_date no lo es. Aceptamos que pueda haber múltiples rows del mismo
-- tipo (caso renovación anticipada: cargás el nuevo con el carnet viejo aún
-- vigente). La UI ordena por expires_at asc así muestra el próximo a vencer
-- primero y los renovados como histórico abajo.

create trigger employee_documents_set_updated_at
  before update on public.employee_documents
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 2. RLS
------------------------------------------------------------------------------
alter table public.employee_documents enable row level security;

create policy "hr_read_documents"
  on public.employee_documents for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));

create policy "hr_write_documents"
  on public.employee_documents for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'operations']));

create policy "hr_update_documents"
  on public.employee_documents for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']))
  with check (public.user_has_role(array['owner', 'admin', 'operations']));

create policy "hr_delete_documents"
  on public.employee_documents for delete
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));

------------------------------------------------------------------------------
-- 3. Extender notifications.type para `document_expiring`
------------------------------------------------------------------------------
alter table public.notifications
  drop constraint if exists notifications_type_known;

alter table public.notifications
  add constraint notifications_type_known
  check (type in (
    'chat_message',
    'chat_reply',
    'chat_mention',
    'document_expiring'
  ));

------------------------------------------------------------------------------
-- 4. View v_documents_expiring — convenience para el cron + UI badge
------------------------------------------------------------------------------
create or replace view public.v_documents_expiring with (security_invoker = on) as
select
  d.id,
  d.employee_id,
  d.kind,
  d.number,
  d.expires_at,
  d.notified_at,
  e.legal_name as employee_name,
  e.is_active as employee_is_active,
  (d.expires_at - current_date)::int as days_until_expiry
from public.employee_documents d
join public.employees e on e.id = d.employee_id
where e.is_active = true
  and d.expires_at >= current_date
  and d.expires_at <= current_date + interval '30 days';

comment on view public.v_documents_expiring is
  'Documentos de empleados activos que vencen en los próximos 30 días. Usado por el cron Inngest `document-expiry-alerts` y por el badge de la UI.';
