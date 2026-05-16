-- email_send_log: historial de envíos por email de comprobantes (facturas
-- y recibos). Permite:
--   - mostrar "última vez enviado a X@..." en el detalle
--   - reintentar envíos fallidos sin perder trazabilidad
--   - auditar quién mandó qué a quién
--
-- También agrega `receipts.notified_at` (espejo de `invoices.notified_at`)
-- para marcar rápido si ya hubo al menos un envío exitoso.

set row_security = off;

------------------------------------------------------------------------------
-- email_send_log
------------------------------------------------------------------------------

create table public.email_send_log (
  id                    uuid primary key default gen_random_uuid(),
  entity_type           text not null check (entity_type in ('invoice', 'receipt')),
  entity_id             uuid not null,
  recipient             text not null,
  subject               text not null,
  body                  text,
  status                text not null check (status in ('sent', 'failed')),
  provider_message_id   text,
  error                 text,
  sent_by               uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),

  constraint email_send_log_recipient_format check (
    recipient ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  constraint email_send_log_subject_len check (
    char_length(subject) between 1 and 200
  ),
  constraint email_send_log_body_len check (
    body is null or char_length(body) <= 4000
  )
);

create index email_send_log_entity_idx
  on public.email_send_log (entity_type, entity_id, created_at desc);

create index email_send_log_sent_by_idx
  on public.email_send_log (sent_by, created_at desc)
  where sent_by is not null;

comment on table public.email_send_log is
  'Historial de envíos por email de comprobantes (facturas y recibos). El polimorfismo soft (entity_type/entity_id) es aceptable acá porque solo las server actions escriben (no usuarios) y el set de tipos es chico y estable.';

------------------------------------------------------------------------------
-- receipts.notified_at — espejo de invoices.notified_at
------------------------------------------------------------------------------

alter table public.receipts
  add column if not exists notified_at timestamptz;

comment on column public.receipts.notified_at is
  'Última vez que el recibo se envió por email exitosamente. NULL si nunca se envió. El detalle completo del envío vive en email_send_log.';

------------------------------------------------------------------------------
-- RLS
------------------------------------------------------------------------------

alter table public.email_send_log enable row level security;

-- Lectura: owner/admin/finance (mismos roles que pueden enviar). El JOIN
-- contra invoices/receipts queda implícito por permisos de la entity.
create policy "email_send_log_select_finance"
  on public.email_send_log
  for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

-- Insert/update/delete: solo service_role (las server actions corren con
-- service client después de validar permisos del actor).

set row_security = on;
