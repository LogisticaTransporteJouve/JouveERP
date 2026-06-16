-- AI.8 — Document Intelligence: borradores de extracción de documentos.
--
-- Un documento subido/escaneado (factura, recibo, OP, remito, cheque…) se
-- clasifica + se le extraen los datos con Claude (pipeline Inngest, AI.8b) y se
-- guarda acá como BORRADOR `pending_review`. El usuario revisa lado a lado con el
-- preview y, al confirmar, se crea la entidad con los server actions de alta
-- existentes (la extracción solo pre-llena; nunca crea nada sola).
--
-- docs/ai-overview.md §5-bis / §6.

set row_security = off;

create table public.ai_document_extractions (
  id             uuid primary key default gen_random_uuid(),
  file_id        uuid not null references public.files (id) on delete cascade,
  detected_type  text,
  confidence     numeric(4, 3),
  payload        jsonb not null default '{}'::jsonb,
  matches        jsonb not null default '{}'::jsonb,
  status         text not null default 'pending_review'
                   check (status in ('pending_review', 'confirmed', 'discarded', 'failed')),
  created_entity jsonb,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.ai_document_extractions is
  'Borradores de extracción de documentos (Document Intelligence). payload = datos extraídos por tipo + items[]; matches = {supplier_id?, client_id?, duplicate_of?}; created_entity = {table,id} tras confirmar.';

create index ai_document_extractions_status_idx
  on public.ai_document_extractions (status, created_at desc);
create index ai_document_extractions_file_idx
  on public.ai_document_extractions (file_id);

create trigger ai_document_extractions_set_updated_at
  before update on public.ai_document_extractions
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- RLS — borradores propios o ai:admin (owner/admin). Escritura del pipeline
-- vía service role (bypass RLS); el usuario gestiona los suyos.
------------------------------------------------------------------------------
alter table public.ai_document_extractions enable row level security;

create policy "ai_extractions_select"
  on public.ai_document_extractions for select
  to authenticated
  using (
    created_by = auth.uid()
    or public.user_has_role(array['owner', 'admin'])
  );

create policy "ai_extractions_insert"
  on public.ai_document_extractions for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "ai_extractions_update"
  on public.ai_document_extractions for update
  to authenticated
  using (
    created_by = auth.uid()
    or public.user_has_role(array['owner', 'admin'])
  )
  with check (
    created_by = auth.uid()
    or public.user_has_role(array['owner', 'admin'])
  );

create policy "ai_extractions_delete"
  on public.ai_document_extractions for delete
  to authenticated
  using (
    created_by = auth.uid()
    or public.user_has_role(array['owner', 'admin'])
  );
