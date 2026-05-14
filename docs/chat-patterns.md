# Chat — Patrones de implementación

> Spec ejecutable para construir el subsistema de chat interno entre
> empleados. Pensado para tener todas las decisiones tomadas antes de abrir
> el primer PR de la fase. Mismo formato que `docs/files-patterns.md` y
> `docs/user-avatars.md`. Acompañar a esos dos: chat depende del
> `UserAvatar` y se integra con `file_attachments` para los adjuntos.

---

## 0. Alcance

Pestaña nueva **/chat** en la app. Mensajería interna entre empleados.

**Tipos de conversación, todos en una misma tabla `chat_channels`:**

| Kind | Miembros | Usos |
|---|---|---|
| `self` | 1 (vos) | Bloc de notas: pegar info, links, fotos que querés tener a mano. Se crea automáticamente la primera vez que entrás. |
| `dm` | 2 | Mensaje directo a otro empleado. Idempotente: abrir un DM con alguien con quien ya tenés uno no crea uno nuevo. |
| `group` | ≥2 con nombre | Conversación de equipo (logística, finanzas, dueños, etc.). |

**v1 incluye:**

- Crear / abrir conversación (self, DM, grupo).
- Enviar mensajes de texto.
- Reaccionar a un mensaje con emoji.
- Responder a un mensaje específico (reply).
- Editar / borrar mensajes propios.
- Adjuntar archivos (queda como TODO si la fase de files no está
  terminada, pero el modelo lo deja listo — los adjuntos aparecen en
  `/files` cuando ambas fases estén). En mobile, el botón de adjuntar
  + cámara permite **tomar una foto directo desde el chat** (típico
  caso: chofer manda foto de un remito firmado al grupo de logística).
- Avatar de usuario (depende de `docs/user-avatars.md`).
- Realtime con Supabase Realtime (no servicios extra — decisión #8 del
  roadmap se respeta).
- Unread counts.
- Layout responsivo: en mobile la sidebar de canales se colapsa a
  drawer (`Sheet` shadcn que ya está en el design system §1.5), el
  thread ocupa pantalla completa y el composer queda fijado al bottom.

**v1 NO incluye (defer explícito):**

- Threads anidados (reply abre vista lateral). v1: reply es solo una
  "cita" inline del mensaje original.
- Canales públicos (todos los users por default). El negocio es chico;
  cuando crezca a >15 personas se reabre.
- @-mentions con notificación. Se deja el hook para sumarlo en v2.
- Typing indicators ("está escribiendo…"). v1: agregable después con
  Realtime broadcast (presence channel), no bloquea.
- Push notifications / email digests.
- Búsqueda de mensajes.
- Mensajes con markdown formatting. v1: texto plano + autolink de URLs.

---

## 1. Modelo de datos

Cinco tablas. Una para conversaciones, una para membresía, una para
mensajes, una para reacciones, y se extiende `file_attachments` (del spec
de files) con una FK más para adjuntos.

### 1.1 `chat_channels`

```sql
create type public.chat_channel_kind as enum ('self', 'dm', 'group');

create table public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  kind public.chat_channel_kind not null,
  name text,                          -- nullable: solo grupos lo usan
  description text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Denormalización: timestamp del último mensaje. Permite ordenar la
  -- lista del sidebar sin un subquery por fila. Se actualiza via trigger
  -- on insert en chat_messages.
  last_message_at timestamptz,

  -- Pair key para DMs: armada como '{min_uuid}|{max_uuid}'. Permite un
  -- UNIQUE que hace `openOrCreateDm` idempotente. Para self/group queda
  -- NULL.
  dm_pair_key text generated always as (null) stored,

  constraint chat_channels_name_required_for_group
    check (kind <> 'group' or (name is not null and length(trim(name)) > 0)),
  constraint chat_channels_no_name_for_self_or_dm
    check (kind = 'group' or name is null)
);

create index idx_chat_channels_last_message
  on public.chat_channels (last_message_at desc nulls last);

create unique index chat_channels_dm_pair_unique
  on public.chat_channels (dm_pair_key)
  where dm_pair_key is not null;
```

> **Nota sobre `dm_pair_key`.** Lo dejo declarado como `generated always
> as (null)` en la tabla y lo escribimos a mano desde el RPC
> `open_or_create_dm` (next §5.2) porque el valor depende de
> `chat_channel_members`, no de columnas de la propia fila. Si Postgres
> en alguna versión permite generadas con subqueries cambiamos, pero por
> ahora es más simple computarlo en el RPC.
>
> Implementación realista: hacer la columna `text` normal (no generated)
> y cargarla en el RPC.

```sql
-- Versión practicable:
alter table public.chat_channels
  drop column dm_pair_key;
alter table public.chat_channels
  add column dm_pair_key text;
-- (mismo unique index sobre la columna real)
```

### 1.2 `chat_channel_members`

```sql
create table public.chat_channel_members (
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',  -- 'member' | 'admin' (solo grupos)
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  is_muted boolean not null default false,
  primary key (channel_id, user_id),
  constraint chat_channel_members_role_valid
    check (role in ('member', 'admin'))
);

create index idx_chat_channel_members_user
  on public.chat_channel_members (user_id);
```

### 1.3 `chat_messages`

```sql
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  -- Reply: apunta al mensaje original, en el mismo canal. La constraint la
  -- valida un trigger (no se puede en CHECK porque cruza tablas).
  reply_to_message_id uuid references public.chat_messages(id) on delete set null,
  body text not null,
  edited_at timestamptz,
  deleted_at timestamptz,             -- soft delete (preserva replies)
  created_at timestamptz not null default now()
);

create index idx_chat_messages_channel_created
  on public.chat_messages (channel_id, created_at desc);

-- Replies en el mismo canal:
create or replace function public.chat_messages_validate_reply()
returns trigger language plpgsql as $$
declare same_channel uuid;
begin
  if new.reply_to_message_id is null then return new; end if;
  select channel_id into same_channel
    from public.chat_messages where id = new.reply_to_message_id;
  if same_channel is null or same_channel <> new.channel_id then
    raise exception 'reply_to_message_id must reference a message in the same channel';
  end if;
  return new;
end;
$$;

create trigger trg_chat_messages_validate_reply
  before insert on public.chat_messages
  for each row execute function public.chat_messages_validate_reply();

-- Bumpea last_message_at del canal en cada insert:
create or replace function public.chat_messages_bump_channel()
returns trigger language plpgsql as $$
begin
  update public.chat_channels
    set last_message_at = new.created_at,
        updated_at = now()
    where id = new.channel_id;
  return new;
end;
$$;

create trigger trg_chat_messages_bump_channel
  after insert on public.chat_messages
  for each row execute function public.chat_messages_bump_channel();
```

**Soft-delete vs hard-delete:** soft. Razones:

- Si borramos hard y otro mensaje le respondió, perdemos el contexto del
  reply.
- Realtime: si llega un DELETE event a clientes que no tenían el mensaje
  cargado, no rompe nada — el update a `deleted_at` viaja como UPDATE.

**Render del soft-delete:** `<i class="text-muted-foreground">Mensaje
eliminado</i>` en lugar del body, sin reacciones, sin reply.

### 1.4 `chat_message_reactions`

```sql
create table public.chat_message_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji),
  constraint chat_message_reactions_emoji_format
    check (length(emoji) between 1 and 16)
);

create index idx_chat_message_reactions_message
  on public.chat_message_reactions (message_id);
```

**PK compuesto:** un user solo puede reaccionar una vez por emoji por
mensaje (toggle behavior). El insert con conflict → delete = "destogglear".

**Storage del emoji:** texto plano UTF-8. La validación de "es un emoji
válido" se hace en el frontend (picker controlado). Si alguien manda `lol`
en `emoji` por POST raw, no se rompe nada — solo se ve raro. Si más
adelante hace falta restringir, se agrega un check con regex de emoji.

### 1.5 Extender `file_attachments` (cuando llegue la fase de files)

```sql
-- supabase/migrations/<ts>_attachments_add_chat_message_fk.sql
alter table public.file_attachments
  add column chat_message_id uuid references public.chat_messages(id) on delete cascade;

create index idx_file_attachments_chat_message
  on public.file_attachments (chat_message_id)
  where chat_message_id is not null;

-- Reconstruir "exactly one target":
alter table public.file_attachments
  drop constraint file_attachments_exactly_one_target;
alter table public.file_attachments
  add constraint file_attachments_exactly_one_target check (
    (invoice_id is not null)::int +
    (receipt_id is not null)::int +
    (cheque_id is not null)::int +
    (retention_id is not null)::int +
    (chat_message_id is not null)::int = 1
  );
```

Para que un mensaje del chat tenga adjunto, basta con un row en
`file_attachments(file_id, chat_message_id, kind='chat_attachment')`. La
vista `v_file_attachments_resolved` ya devuelve `target_type =
'chat_message'` por la `case` documentada en el spec de files.

---

## 2. RLS

Predicate compartido: **vos sos miembro del canal**. Todos los reads y
writes del subsistema chequean esto.

```sql
-- Helper reusable:
create or replace function public.user_is_channel_member(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_channel_members
    where channel_id = p_channel and user_id = auth.uid()
  );
$$;
revoke all on function public.user_is_channel_member(uuid) from public;
grant execute on function public.user_is_channel_member(uuid) to authenticated;

-- chat_channels:
alter table public.chat_channels enable row level security;

create policy "chat_channels_select_if_member"
  on public.chat_channels for select to authenticated
  using (public.user_is_channel_member(id));

create policy "chat_channels_insert_self_creator"
  on public.chat_channels for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "chat_channels_update_if_admin_or_creator"
  on public.chat_channels for update to authenticated
  using (
    created_by = (select auth.uid())
    or exists (
      select 1 from public.chat_channel_members m
      where m.channel_id = chat_channels.id
        and m.user_id = (select auth.uid()) and m.role = 'admin'
    )
  );

-- chat_channel_members:
alter table public.chat_channel_members enable row level security;

create policy "members_select_if_in_channel"
  on public.chat_channel_members for select to authenticated
  using (public.user_is_channel_member(channel_id));

-- Insert: el RPC create_group / open_or_create_dm corre con security definer.
-- Para joins manuales (futuro) habilitar acá. v1: no policy de insert.

create policy "members_update_self_last_read"
  on public.chat_channel_members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- chat_messages:
alter table public.chat_messages enable row level security;

create policy "messages_select_if_member"
  on public.chat_messages for select to authenticated
  using (public.user_is_channel_member(channel_id));

create policy "messages_insert_if_member"
  on public.chat_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.user_is_channel_member(channel_id)
  );

create policy "messages_update_self"
  on public.chat_messages for update to authenticated
  using (sender_id = (select auth.uid()))
  with check (sender_id = (select auth.uid()));

-- (No delete policy — el "delete" es UPDATE con deleted_at.)

-- chat_message_reactions:
alter table public.chat_message_reactions enable row level security;

create policy "reactions_select_if_member"
  on public.chat_message_reactions for select to authenticated
  using (exists (
    select 1 from public.chat_messages m
    where m.id = message_id and public.user_is_channel_member(m.channel_id)
  ));

create policy "reactions_insert_self"
  on public.chat_message_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.chat_messages m
      where m.id = message_id and public.user_is_channel_member(m.channel_id)
    )
  );

create policy "reactions_delete_self"
  on public.chat_message_reactions for delete to authenticated
  using (user_id = (select auth.uid()));
```

---

## 3. Realtime

**Stack:** Supabase Realtime (`postgres_changes`). Mismo patrón que el
hook `hooks/use-realtime-invalidate.ts` ya rodando. **Sin SSE relay
propio** — decisión #8 del roadmap ("todo en Next.js + Inngest, sin
servicios extra") se respeta. Es chat de empresa familiar, no Slack — la
escala lo permite.

```sql
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.chat_message_reactions;
alter publication supabase_realtime add table public.chat_channels;
-- chat_channel_members NO va a la publication: cambios de membresía son
-- raros y el refetch del listado en mount alcanza.
```

**Filtros server-side por canal** (`filter: 'channel_id=eq.<uuid>'`) —
postgres_changes respeta RLS, así que cada user solo recibe eventos de
canales donde es miembro, pero filtrar igual achica el tráfico.

**Suscripciones por feature:**

| Hook | Suscribe a | Invalida queryKey |
|---|---|---|
| `useChannelMessages(channelId)` | `chat_messages filter channel_id=eq.<id>` | `chatKeys.messages(channelId)` |
| `useChannelReactions(channelId)` | `chat_message_reactions` (sin filtro de fila — RLS hace el trabajo) | `chatKeys.reactions(channelId)` |
| `useChannelList()` | `chat_channels` (recibe updates de `last_message_at` para reordenar) | `chatKeys.list()` |

**Typing indicators (v2):** Supabase Realtime tiene
`channel.send({ type: 'broadcast', event: 'typing', payload: {...} })` —
ephemeral, sin DB. Cuando se sume, vivirá en un hook
`useTypingIndicator(channelId)`.

---

## 4. Server actions

Layout: `features/chat/actions/`. Cada función chiquita y testeable. Los
side-effects no triviales (open-or-create DM) van por RPC para que el
unique constraint del par funcione transaccionalmente.

### 4.1 `listChannelsAction`

```ts
// features/chat/actions/list-channels.ts
"use server";

import { requireUserContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export type ChannelListItem = {
  id: string;
  kind: "self" | "dm" | "group";
  display_name: string;     // ya resuelto: nombre del grupo o del otro user
  avatar_url: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  is_muted: boolean;
};

export async function listChannelsAction(): Promise<ChannelListItem[]> {
  const ctx = await requireUserContext();
  const supabase = await createClient();

  // RPC que arma el listado con joins, unread count y display_name
  // resuelto. Lo escribimos en SQL para evitar N+1.
  const { data, error } = await supabase
    .rpc("list_chat_channels_for_user", { p_user: ctx.userId });
  if (error) throw new Error(error.message);
  return (data ?? []) as ChannelListItem[];
}
```

RPC asociado (resumen, no la versión final):

```sql
create or replace function public.list_chat_channels_for_user(p_user uuid)
returns table (
  id uuid, kind public.chat_channel_kind,
  display_name text, avatar_url text,
  last_message_at timestamptz, last_message_preview text,
  unread_count int, is_muted boolean
) language sql stable security definer set search_path = public as $$
  with my_channels as (
    select c.*, m.last_read_at, m.is_muted
    from public.chat_channels c
    join public.chat_channel_members m on m.channel_id = c.id
    where m.user_id = p_user
  ),
  unread as (
    select c.id as channel_id, count(*) as cnt
    from my_channels c
    join public.chat_messages msg on msg.channel_id = c.id
    where msg.created_at > c.last_read_at
      and msg.deleted_at is null
      and msg.sender_id <> p_user
    group by c.id
  ),
  last_msgs as (
    select distinct on (channel_id) channel_id, body, created_at
    from public.chat_messages
    where deleted_at is null
    order by channel_id, created_at desc
  ),
  dm_others as (
    select c.id as channel_id, up.first_name, up.last_name, up.avatar_path
    from my_channels c
    join public.chat_channel_members m on m.channel_id = c.id and m.user_id <> p_user
    join public.user_profiles up on up.user_id = m.user_id
    where c.kind = 'dm'
  )
  select
    c.id,
    c.kind,
    case
      when c.kind = 'self'  then 'Mis notas'
      when c.kind = 'group' then c.name
      when c.kind = 'dm'    then coalesce(d.first_name || ' ' || d.last_name, 'Usuario')
    end as display_name,
    d.avatar_path as avatar_url,
    c.last_message_at,
    left(coalesce(lm.body, ''), 80) as last_message_preview,
    coalesce(u.cnt, 0)::int as unread_count,
    c.is_muted
  from my_channels c
  left join unread u on u.channel_id = c.id
  left join last_msgs lm on lm.channel_id = c.id
  left join dm_others d on d.channel_id = c.id
  order by c.last_message_at desc nulls last;
$$;
revoke all on function public.list_chat_channels_for_user(uuid) from public;
grant execute on function public.list_chat_channels_for_user(uuid) to authenticated;
```

### 4.2 `openOrCreateDmAction(otherUserId)` — idempotente

```sql
create or replace function public.open_or_create_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_pair_key text;
  v_channel_id uuid;
begin
  if v_me is null then raise exception 'unauthenticated'; end if;
  if v_me = p_other then raise exception 'use_self_channel_for_self_dm'; end if;

  v_pair_key := least(v_me::text, p_other::text) || '|' || greatest(v_me::text, p_other::text);

  select id into v_channel_id
  from public.chat_channels
  where dm_pair_key = v_pair_key;

  if v_channel_id is null then
    insert into public.chat_channels (kind, created_by, dm_pair_key)
    values ('dm', v_me, v_pair_key)
    returning id into v_channel_id;

    insert into public.chat_channel_members (channel_id, user_id)
    values (v_channel_id, v_me), (v_channel_id, p_other);
  end if;

  return v_channel_id;
end;
$$;
revoke all on function public.open_or_create_dm(uuid) from public;
grant execute on function public.open_or_create_dm(uuid) to authenticated;
```

```ts
// features/chat/actions/open-or-create-dm.ts
export async function openOrCreateDmAction(otherUserId: string) {
  await requireUserContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_or_create_dm", { p_other: otherUserId });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, channelId: data as string };
}
```

### 4.3 `createGroupAction({ name, memberIds })`

```ts
const Schema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(280).optional(),
  memberIds: z.array(z.string().uuid()).min(1).max(50),
});

export async function createGroupAction(input: unknown) {
  const ctx = await requireUserContext();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Datos inválidos." };

  const supabase = await createClient();
  const { data: channel, error } = await supabase
    .from("chat_channels")
    .insert({
      kind: "group",
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !channel) return { ok: false as const, error: error?.message ?? "Error" };

  const members = [ctx.userId, ...parsed.data.memberIds].map((uid) => ({
    channel_id: channel.id,
    user_id: uid,
    role: uid === ctx.userId ? "admin" : "member",
  }));
  const { error: memErr } = await supabase.from("chat_channel_members").insert(members);
  if (memErr) {
    await supabase.from("chat_channels").delete().eq("id", channel.id);
    return { ok: false as const, error: memErr.message };
  }
  return { ok: true as const, channelId: channel.id };
}
```

### 4.4 `getOrCreateSelfChannelAction()`

```ts
// Llamada al mount de /chat. Idempotente.
export async function getOrCreateSelfChannelAction() {
  const ctx = await requireUserContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_or_create_self_channel");
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, channelId: data as string };
}
```

```sql
create or replace function public.get_or_create_self_channel()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid;
begin
  select c.id into v_id
  from public.chat_channels c
  join public.chat_channel_members m on m.channel_id = c.id
  where c.kind = 'self' and m.user_id = v_me;
  if v_id is not null then return v_id; end if;

  insert into public.chat_channels (kind, created_by) values ('self', v_me) returning id into v_id;
  insert into public.chat_channel_members (channel_id, user_id, role) values (v_id, v_me, 'admin');
  return v_id;
end;
$$;
grant execute on function public.get_or_create_self_channel() to authenticated;
```

### 4.5 `sendMessageAction({ channelId, body, replyToId? })`

```ts
const Schema = z.object({
  channelId: z.string().uuid(),
  body: z.string().min(1).max(4000),
  replyToId: z.string().uuid().optional(),
});

export async function sendMessageAction(input: unknown) {
  const ctx = await requireUserContext();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Datos inválidos." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      channel_id: parsed.data.channelId,
      sender_id: ctx.userId,
      body: parsed.data.body,
      reply_to_message_id: parsed.data.replyToId ?? null,
    })
    .select("id, created_at")
    .single();
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, messageId: data.id, createdAt: data.created_at };
}
```

### 4.6 `editMessageAction({ messageId, body })`

Solo el sender. RLS lo enforcea; el código solo manda el UPDATE y mapea
el error.

### 4.7 `deleteMessageAction(messageId)` — soft delete

```ts
const { error } = await supabase
  .from("chat_messages")
  .update({ deleted_at: new Date().toISOString(), body: "" })  // body limpiado por privacidad
  .eq("id", messageId)
  .eq("sender_id", ctx.userId);
```

### 4.8 `toggleReactionAction({ messageId, emoji })`

```ts
// Si ya existe → delete. Si no → insert.
const { data: existing } = await supabase
  .from("chat_message_reactions")
  .select("message_id")
  .eq("message_id", messageId)
  .eq("user_id", ctx.userId)
  .eq("emoji", emoji)
  .maybeSingle();

if (existing) {
  await supabase.from("chat_message_reactions")
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", ctx.userId)
    .eq("emoji", emoji);
  return { ok: true, state: "removed" as const };
}
await supabase.from("chat_message_reactions").insert({
  message_id: messageId, user_id: ctx.userId, emoji,
});
return { ok: true, state: "added" as const };
```

### 4.9 `markChannelReadAction(channelId)`

```ts
await supabase
  .from("chat_channel_members")
  .update({ last_read_at: new Date().toISOString() })
  .eq("channel_id", channelId)
  .eq("user_id", ctx.userId);
```

Cliente lo llama en debounce 1.5s mientras el thread esté en foco
(`useEffect` + `visibilitychange`).

### 4.10 `addMembersAction({ channelId, userIds })` / `removeMemberAction`

Solo admin del canal. Solo aplica a grupos (DMs y self no admiten cambios
de membresía).

---

## 5. Frontend

### 5.1 Rutas

```
app/(dashboard)/chat/
  layout.tsx                # ChatLayout: sidebar + main, server component
  page.tsx                  # redirect a /chat/<self_channel_id>
  loading.tsx
  [channelId]/page.tsx      # server component, prefetch de mensajes
  [channelId]/loading.tsx
```

El sidebar de canales lo monta el `layout.tsx` con prefetch — la nav
entre canales no remonta el sidebar, solo el `page.tsx`. Patrón de
Next App Router clásico (nested layouts).

### 5.2 Componentes

```
features/chat/
  actions/
    list-channels.ts
    open-or-create-dm.ts
    create-group.ts
    get-or-create-self-channel.ts
    send-message.ts
    edit-message.ts
    delete-message.ts
    toggle-reaction.ts
    mark-read.ts
    add-members.ts
    remove-member.ts
  components/
    channel-list.tsx          # sidebar
    channel-list-item.tsx     # un row del sidebar
    message-thread.tsx        # virtual list de mensajes
    message-bubble.tsx        # un mensaje con su autor, reacciones, reply context
    message-composer.tsx      # textarea + adjuntar + send
    reaction-bar.tsx          # reacciones de un mensaje (grupo de chips)
    reaction-picker.tsx       # popover con set fijo de emojis
    reply-context.tsx         # "Replying to: [preview]"
    new-chat-dialog.tsx       # selector user / group
    channel-settings-dialog.tsx
  hooks/
    use-channel-list.ts
    use-channel-messages.ts   # infinite query + realtime
    use-channel-reactions.ts
    use-send-message.ts
    use-mark-read.ts
    use-toggle-reaction.ts
  lib/
    chat-keys.ts              # TanStack query keys
    autolink.ts               # URLs → <a>
  schema.ts                   # Zod
  types.ts
```

### 5.3 `ChannelList` (sidebar)

Tres secciones colapsables: **Mis notas** (self), **Mensajes directos**
(DMs), **Grupos**. Ordenados internamente por `last_message_at desc`.

Cada item:

- `UserAvatar` del otro (DM) / iniciales del grupo / icono pin (self).
- Nombre + preview del último mensaje (1 línea, truncado).
- Hora del último mensaje (formato relativo: "ahora", "5m", "ayer",
  fecha).
- Badge con unread count si > 0.
- Si `is_muted`: estilo `opacity-60` + ícono mute en hover.

Header del sidebar: botón "**+ Nuevo**" → abre `NewChatDialog`.

### 5.4 `MessageThread`

Virtualización con `@tanstack/react-virtual` (no incluido aún en
dependencies — sumarlo en el PR de chat UI). Render top→bottom: top tiene
los mensajes más viejos (scroll up para más historia).

**Pagination:** infinite query con `useInfiniteQuery`. Cursor = `created_at`
del primer mensaje cargado. Page size 50.

**Auto-scroll a bottom:** al abrir el canal, al llegar un mensaje propio,
y al llegar un mensaje del otro **si el user está ya en el bottom**. Si
está scrolleando arriba, no interrumpir — mostrar pill "↓ Nuevos mensajes"
que al clickear scrollea al bottom.

**Marcar como leído:** ver §4.9. Solo si el thread está visible
(`document.visibilityState === 'visible'`).

**Agrupación de mensajes consecutivos:** si dos mensajes seguidos son del
mismo autor y dentro de 5 min, render compacto (no se repite avatar ni
nombre). Patrón Slack/Linear.

### 5.5 `MessageBubble`

Estructura:

```
[avatar] [nombre · hora]            (solo si es primero del grupo)
         [reply context si reply_to]
         [body]                     (autolink + emoji nativos)
         [reaction-bar]             (chips: emoji + count + tooltip con users)
         [actions on hover: reply | react | edit | delete]
```

**Actions on hover:** mini-toolbar en la esquina sup-derecha del bubble.
Solo aparece si pasás el mouse encima (desktop) o long-press (mobile —
defer).

**Edit:** inline. El body se vuelve un textarea con "Guardar" + "Cancelar".

**Delete:** Dialog de confirmación monocromo (sin rojo, `TriangleAlert`
icon + copy "Eliminar mensaje para siempre"). Post-confirm: render
"Mensaje eliminado" tachado.

### 5.6 `MessageComposer`

```
┌─────────────────────────────────────────────────────┐
│ [reply context, si está respondiendo]    [X cancel] │
├─────────────────────────────────────────────────────┤
│ [textarea autosize, max 5 rows]                     │
│                                                     │
│ [📎] [😀]                  [Enter to send] [Send →] │
└─────────────────────────────────────────────────────┘
```

- **Enter:** envía. **Shift+Enter:** nueva línea. Standard.
- **Textarea autosize:** crece hasta 5 rows, después scroll interno.
- **Botón adjuntar:** abre file picker (multiple). Reusa `FileDropzone`
  del spec de files cuando esa fase exista. Hasta entonces, deshabilitar
  con tooltip "Disponible cuando se implemente la fase de archivos".
- **Botón cámara (solo mobile):** input separado con
  `capture="environment"` y `accept="image/*"` que abre la cámara
  trasera directo. Visibilidad condicionada por `pointer-coarse:`
  (tailwind variant nativa, sin user-agent sniffing). Patrón completo
  documentado en `docs/files-patterns.md` §8.1.
- **Botón emoji:** popover con un set fijo de ~32 emojis comunes. Sin
  full emoji picker en v1 — agregar `@emoji-mart/react` si los usuarios
  piden más en v2.
- **Optimistic update:** al enviar, append local con `status='pending'`,
  reemplazo por el real cuando llega el realtime event (match por
  `client_temp_id` que mandamos en metadata extendida — o el más simple:
  match por `(sender_id, body, created_at∈[now-2s, now+2s])`).

### 5.7 `ReactionPicker` y `ReactionBar`

**ReactionBar** (debajo del body): chips con `{emoji} {count}`. Si vos ya
reaccionaste con ese emoji, chip resaltado. Click → toggle. Hover →
tooltip con nombres de quienes reaccionaron.

**ReactionPicker** (popover desde el hover-action "react"): set fijo
inicial:

```
👍  ❤️  😂  🎉  😮  😢  🙏  👀  🔥  💯  ✅  ❌
```

Si un emoji no está en el set fijo pero alguien ya reaccionó con él,
aparece igual en la bar.

### 5.8 `NewChatDialog`

Dos tabs: **Persona** (DM) y **Grupo**.

- **Persona:** combobox con todos los usuarios (excluyendo a vos). Al
  seleccionar → `openOrCreateDmAction` → redirect a
  `/chat/<channelId>`. Si ya existía, abre el mismo (idempotente).
- **Grupo:** input nombre + multi-select users + textarea descripción
  opcional → `createGroupAction` → redirect.

---

## 6. Adjuntos (cuando exista la fase de files)

El composer mantiene un buffer local de archivos seleccionados. Al
enviar el mensaje:

1. Crear el mensaje (`sendMessageAction`) → obtener `messageId`.
2. Por cada archivo, llamar a `uploadFileAction` con
   `targetType="chat_message"`, `targetId=messageId`,
   `kind="chat_attachment"`. Esto reusa todo el flow del spec de files
   (rollback, signed URL, OCR opcional).
3. `MessageBubble` renderiza los adjuntos consultando
   `v_file_attachments_resolved` filtrado por `target_type='chat_message'`
   y `target_id=message.id`. Hook `useMessageAttachments(messageId)`.

**Detalle de UX:** mientras los adjuntos suben, el mensaje aparece con
"Subiendo adjuntos…" inline. Si alguno falla, el mensaje queda igual
(texto ya en BD) y se muestra "Falló subida de X adjunto(s) — reintentar"
en lugar de quitarlo. El user puede reintentar individualmente o seguir.

**Aparición en `/files`:** automática. La página `/files` filtra por
`source="manual_upload"` en v1; basta agregar el filtro `source IN
("manual_upload", "chat_attachment")` o quitar el filtro entero. La vista
`v_file_attachments_resolved` ya distingue el `target_type='chat_message'`,
con lo que en el detail de un archivo se ve "Adjuntado a mensaje del chat
[link]".

---

## 7. Permisos

Sumar a `lib/auth/permissions.ts`:

```ts
"chat:read",     // ver y enviar mensajes en canales propios
"chat:write",    // alias de read en v1, separado para futura granularidad
"chat:create_group",
"chat:moderate", // admin de grupo: rename, add/remove members
```

**Asignación inicial:**

| Permiso | owner | admin | finance | operations | warehouse | driver |
|---|---|---|---|---|---|---|
| `chat:read`         | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `chat:write`        | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `chat:create_group` | ✓ | ✓ | ✓ | ✓ |   |   |
| `chat:moderate`     | ✓ | ✓ | (creator) | (creator) | (creator) | (creator) |

> El `chat:moderate` se chequea como **OR**: tenés el permiso global O sos
> creador/admin del grupo. La RLS ya lo cubre por la columna `role` de
> `chat_channel_members`.

---

## 8. Tests

| Tipo | Qué cubre |
|---|---|
| Unit (Vitest) | Schemas Zod (body length, replyToId optional, emoji 1-16 chars). |
| Unit | `autolink` (URLs simples, URLs con paréntesis, no autolinkar dentro de palabras). |
| Unit | `pickDefaultColor` determinístico (mismo user_id → mismo color). |
| Integration (Vitest + Supabase local) | `open_or_create_dm` es idempotente; `get_or_create_self_channel` también; `create_group` con creator-admin. |
| Integration | Trigger `chat_messages_validate_reply` rechaza reply cross-channel. |
| Integration | Trigger `chat_messages_bump_channel` actualiza `last_message_at`. |
| RLS | User A no ve mensajes de canal donde no es miembro; no puede insertar como otro `sender_id`; sí puede `mark_read` solo del propio. |
| Realtime smoke (Vitest local) | Insertar en `chat_messages` dispara el event en el cliente suscrito. |
| E2E (Playwright) | Login → abrir chat → mandar mensaje → reaccionar → reply → editar → soft-delete. Crear grupo. Abrir DM idempotente. |

---

## 9. Plan de PRs

Ordenados de fundación a feature completo. Idealmente uno por semana,
mergeables independientemente. **Total estimado: 6 PRs, ~3500 LOC.**

1. **`feat: user profiles + avatars (foundation)`** — migra `user_profiles`,
   bucket `avatars`, `UserAvatar` component, página `/profile`. Cierra
   primero `docs/user-avatars.md` enterito.
2. **`feat: chat schema (channels + members + messages + reactions)`** —
   migraciones, RLS, helper `user_is_channel_member`, triggers
   (validate_reply, bump_channel). RPCs `open_or_create_dm`,
   `get_or_create_self_channel`, `list_chat_channels_for_user`. Sin UI.
   Tests de RLS y de RPCs.
3. **`feat: chat layout + sidebar + self-chat`** — ruta `/chat`,
   `ChatLayout`, `ChannelList` con secciones, `NewChatDialog` tab Persona,
   thread vacío. Permite mandarte mensajes a vos mismo. Realtime hook
   wired.
4. **`feat: chat DMs + send + reply`** — composer, message bubble,
   reply context, infinite scroll, edit, soft-delete. Marcar como leído
   con debounce.
5. **`feat: chat reactions`** — picker, bar, toggle action, realtime
   invalidation.
6. **`feat: chat groups`** — tab Grupo en `NewChatDialog`,
   `channel-settings-dialog` (rename, add/remove, leave), avatares
   apilados en `ChannelListItem`.
7. **(después, cuando la fase de files cierre)** — adjuntos en el
   composer. Migración para sumar `chat_message_id` a `file_attachments`.

---

## 10. Decisiones a cerrar antes de codear

1. **Self-chat como canal aparte (`kind='self'`) vs feature-flag sobre DM
   contigo.** Default propuesto: canal aparte. Razón: hace explícito el
   caso en RPC + RLS, no fuerza un user "fantasma" para emparejar, los
   queries no le hacen excepciones.
2. **Soft-delete vs hard-delete de mensajes.** Default: soft. Razón: §1.3.
3. **Replies inline vs threads laterales.** Default v1: inline ("cita"
   del original arriba del nuevo). Threads laterales se ven después si
   el uso lo pide.
4. **Realtime: Postgres Changes vs Broadcast.** Default: Postgres Changes
   (alineado con `hooks/use-realtime-invalidate.ts`). Broadcast solo para
   typing indicators (v2) y presence (futuro).
5. **Emoji picker: set fijo vs full picker.** Default v1: set fijo de
   12-16. Razón: payload chico, sin dependencias nuevas, UX simple.
6. **Mentions @user.** Default v1: NO. Texto plano. `autolink` solo
   procesa URLs. Mentions se agregan en v2 con la decisión de
   notificación (in-app badge vs email).
7. **Tracking de presencia ("Tomas está conectado").** No en v1. Si se
   suma, vía Supabase Realtime presence channel — sin DB.
8. **Bot del sistema.** ¿Mensajes automáticos del tipo "Nueva factura
   emitida" en un canal `system`? No en v1. Cuando se quiera, vivirá
   como un `sender_id` reservado (UUID conocido o un flag) +
   `kind='system'` en `chat_channels`. Defer.

---

## 11. Métricas de éxito

| Métrica | Objetivo |
|---|---|
| p95 latencia de `sendMessageAction` | < 300 ms |
| p95 latencia de realtime delivery (insert → render en otro cliente) | < 1.5 s |
| p95 latencia de `listChannelsAction` | < 400 ms con 100 canales |
| Unread counts correctos tras 24h de uso real | 100% (no drift) |
| Tasa de errores 500 en send | < 0.2% |

---

## 12. Cosas a NO hacer

1. **No agregar un servicio SSE relay propio** (Redis + Express). Supabase
   Realtime alcanza para esta escala (single CUIT, <50 users). Decisión
   #8 del roadmap.
2. **No modelar DMs con una tabla separada** (`direct_messages` con
   sender + recipient). El modelo "channel con kind=dm + 2 members" da
   N:1 path para reactions/replies/adjuntos sin duplicar código.
3. **No usar jsonb para reacciones.** Una tabla con PK compuesto se
   linkea limpio, RLS funciona out-of-the-box, queries son SQL normal.
4. **No hard-deletar mensajes.** Pierde replies, complica realtime.
   Soft-delete + body vaciado por privacidad.
5. **No bloquear el send esperando los adjuntos.** Mensaje primero,
   adjuntos en paralelo después. Si fallan, retry visible — el contenido
   ya está.
6. **No marcar como leído desde el server (sin foco).** Solo desde el
   cliente cuando el tab está visible. Si no, abrimos badges fantasma
   que dicen "leído" cuando el user no vio nada.
7. **No virtualizar antes del PR 4.** Hasta que un canal tenga 200+
   mensajes nadie nota la diferencia. Si después duele, sumar
   `@tanstack/react-virtual` en su propio PR.
