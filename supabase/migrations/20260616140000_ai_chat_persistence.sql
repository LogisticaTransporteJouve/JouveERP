-- AI.3b — Persistencia del chat de IA (historial de sesiones + mensajes).
--
-- El chat MVP (AI.3) ya streamea respuestas pero no guarda nada: al recargar la
-- página se pierde la conversación. Esto agrega las dos tablas del historial
-- (`ai_chat_sessions` / `ai_chat_messages`) con RLS por dueño de la fila + acceso
-- total para owner/admin (ai:admin), siguiendo docs/ai-overview.md §6.
--
-- Cada mensaje guarda el `UIMessage` completo del AI SDK en `content` (jsonb),
-- así el cliente reconstruye la conversación tal cual (texto + tool parts) con
-- `validateUIMessages`. Los token/costo NO viven acá: van a `ai_usage` en AI.6.
--
-- Nombres `ai_chat_*` a propósito: `chat_sessions`/`chat_messages` son del chat
-- humano entre usuarios, no de la IA.

set row_security = off;

------------------------------------------------------------------------------
-- 1. ai_chat_sessions
------------------------------------------------------------------------------
create table public.ai_chat_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text,
  message_count integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.ai_chat_sessions is
  'Conversaciones del asistente de IA. Una fila por sesión de chat; el título se autogenera (Haiku) en el primer turno.';

create index ai_chat_sessions_user_idx
  on public.ai_chat_sessions (user_id, updated_at desc);

create trigger ai_chat_sessions_set_updated_at
  before update on public.ai_chat_sessions
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 2. ai_chat_messages
------------------------------------------------------------------------------
create table public.ai_chat_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ai_chat_sessions (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant', 'system')),
  content    jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.ai_chat_messages is
  'Mensajes de una sesión de IA. `content` guarda el UIMessage completo (texto + tool parts) del AI SDK para reconstruir la conversación.';

create index ai_chat_messages_session_idx
  on public.ai_chat_messages (session_id, created_at);

------------------------------------------------------------------------------
-- 3. Trigger: mantener message_count + updated_at de la sesión padre
------------------------------------------------------------------------------
create or replace function public.ai_chat_bump_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_chat_sessions
    set message_count = message_count + 1,
        updated_at = now()
    where id = new.session_id;
  return new;
end;
$$;

create trigger ai_chat_messages_bump
  after insert on public.ai_chat_messages
  for each row execute function public.ai_chat_bump_session();

------------------------------------------------------------------------------
-- 4. RLS — dueño de la fila o ai:admin (owner/admin) ve/gestiona todo
------------------------------------------------------------------------------
alter table public.ai_chat_sessions enable row level security;
alter table public.ai_chat_messages enable row level security;

-- sessions
create policy "ai_sessions_select"
  on public.ai_chat_sessions for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.user_has_role(array['owner', 'admin'])
  );

create policy "ai_sessions_insert"
  on public.ai_chat_sessions for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "ai_sessions_update"
  on public.ai_chat_sessions for update
  to authenticated
  using (
    user_id = auth.uid()
    or public.user_has_role(array['owner', 'admin'])
  )
  with check (
    user_id = auth.uid()
    or public.user_has_role(array['owner', 'admin'])
  );

create policy "ai_sessions_delete"
  on public.ai_chat_sessions for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.user_has_role(array['owner', 'admin'])
  );

-- messages (acceso vía pertenencia de la sesión padre)
create policy "ai_messages_select"
  on public.ai_chat_messages for select
  to authenticated
  using (
    exists (
      select 1
      from public.ai_chat_sessions s
      where s.id = ai_chat_messages.session_id
        and (
          s.user_id = auth.uid()
          or public.user_has_role(array['owner', 'admin'])
        )
    )
  );

create policy "ai_messages_insert"
  on public.ai_chat_messages for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.ai_chat_sessions s
      where s.id = ai_chat_messages.session_id
        and s.user_id = auth.uid()
    )
  );

create policy "ai_messages_delete"
  on public.ai_chat_messages for delete
  to authenticated
  using (
    exists (
      select 1
      from public.ai_chat_sessions s
      where s.id = ai_chat_messages.session_id
        and (
          s.user_id = auth.uid()
          or public.user_has_role(array['owner', 'admin'])
        )
    )
  );
