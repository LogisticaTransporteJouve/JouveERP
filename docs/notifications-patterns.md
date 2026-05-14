# Notifications — Patrones de implementación

> Spec ejecutable del subsistema de notificaciones in-app. Mismo formato
> que `docs/files-patterns.md`, `docs/chat-patterns.md` y
> `docs/user-avatars.md`. v1 single-CUIT, in-app puro, sin email digest
> ni push notifications — el schema deja preparados los canales para
> sumarlos sin re-trabajar la tabla.

---

## 0. Alcance

**Lo que cubre:**

- Notificaciones in-app de eventos del chat (mensajes recibidos,
  replies a tu mensaje). Easy de extender para otros eventos del ERP
  cuando aparezca el caso (factura emitida, viaje asignado, doc por
  vencer, etc.).
- Realtime delivery con Supabase Realtime — sin servicios extra
  (decisión #8 del roadmap).
- Badge con conteo de unread en el header global.
- Popover con lista, click para navegar al recurso + mark as read.
- "Marcar todas como leídas".
- Mute por canal (chat).

**Lo que NO cubre — diferido a propósito:**

- Email digest. Schema preparado (`metadata` admite campos extra) pero
  el worker de envío + tabla `emails_sent` quedan para cuando se
  cablée un provider (Resend recomendado).
- Push notifications (Web Push API + service worker).
- Notification preferences por tipo (tabla
  `notification_settings`). En v1 cada user recibe todo lo que tiene
  permiso de ver. Cuando aparezcan tipos ruidosos (ej: "factura
  emitida" en alta concurrencia) se reabre.
- @-mentions automáticas (el tipo `chat_mention` está cableado en el
  schema pero el generador automático todavía no — depende de sumar
  @-mentions al chat).
- Centro de notificaciones full-page con búsqueda y filtros. v1 es un
  popover; si la cantidad crece y duele, se agrega `/inbox`.

---

## 1. Modelo de datos

Una sola tabla. No `notification_settings`, no `emails_sent`, no
`organization_id` (single-CUIT).

```sql
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  type text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),

  constraint notifications_type_known
    check (type in ('chat_message', 'chat_reply', 'chat_mention'))
);

create index idx_notifications_recipient_created
  on public.notifications (recipient_id, created_at desc);

create index idx_notifications_recipient_unread
  on public.notifications (recipient_id)
  where read_at is null;
```

**Por qué `metadata jsonb` y no columnas tipadas:** los payloads
varían por tipo. Si lo modeláramos con columnas, hoy necesitaríamos 4
columnas y mañana 8. La pérdida de tipos en `metadata->>` se
compensa con un mapping en TS por tipo (un type guard por `type`).

**Por qué un check enum-like de string** (`type IN ('chat_message',
…)`) y no un PG enum: agregar un tipo nuevo con `alter type … add
value` requiere salir de transacción en versiones viejas de Postgres,
y el set casi nunca se usa para filtrar performance — es para
tagging. Strings con check alcanzan.

**Por qué `sender_id` nullable:** algunos tipos vienen del sistema (no
hay un humano detrás — "tu cert AFIP vence en 30 días", "el cron de
aging encontró 5 clientes vencidos"). Esos van con `sender_id IS NULL`
y la UI renderiza el avatar del sistema (genérico monocromo).

---

## 2. RLS

Solo el recipient puede leer / marcar como leídas las propias.
**Sin INSERT policy:** los inserts vienen de triggers de Postgres o
del service-role; nunca de un usuario directo. Eso evita que un user
malicioso cree notifs para otros.

```sql
alter table public.notifications enable row level security;

create policy "notifications_select_recipient"
  on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));

create policy "notifications_update_recipient"
  on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));
```

---

## 3. Generación

Trigger por feature. Cada uno corre `security definer` con
`search_path = public` para insertar sin chocar contra la falta de
INSERT policy.

### 3.1 Chat — `notify_on_chat_message`

Dispara `AFTER INSERT` en `chat_messages`:

1. Busca todos los `chat_channel_members` del canal excepto el sender.
2. Filtra `is_muted = true`.
3. Inserta una notif `chat_message` por cada uno.
4. Si el mensaje es reply (`reply_to_message_id IS NOT NULL`),
   suma una notif `chat_reply` al sender original (si todavía es
   miembro y no se silenció).

```sql
create or replace function public.notify_on_chat_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_member record;
  v_origin_sender uuid;
begin
  for v_member in
    select user_id, is_muted from public.chat_channel_members
    where channel_id = new.channel_id and user_id <> new.sender_id
  loop
    if v_member.is_muted then continue; end if;

    insert into public.notifications (recipient_id, sender_id, type, metadata)
    values (
      v_member.user_id, new.sender_id, 'chat_message',
      jsonb_build_object(
        'message_id', new.id,
        'channel_id', new.channel_id,
        'preview', left(new.body, 240)
      )
    );
  end loop;

  if new.reply_to_message_id is not null then
    -- … notif chat_reply al sender original (ver migración) …
  end if;
  return new;
end;
$$;
```

**Sin notif para self-chat:** el self-channel tiene un solo miembro
(el sender). El `WHERE user_id <> new.sender_id` lo deja vacío.

### 3.2 Patrón para agregar tipos nuevos

Cuando aparezca otro evento que requiera notificar:

1. **Agregar el tipo** al check: `alter table public.notifications drop
   constraint notifications_type_known; alter table public.notifications
   add constraint notifications_type_known check (type in (...))`.
2. **Escribir el trigger** o el código que llame
   `insert into public.notifications`. Trigger si el evento es un
   `INSERT/UPDATE` de una tabla; código si es desde un workflow Inngest.
3. **Sumar el helper de display** en `features/notifications/lib/format.ts`
   (`getNotificationTitle`, `getNotificationHref`).
4. **Migración chiquita** que extiende `metadata` documentando los
   campos esperados (ej: `{"invoice_id": uuid, "cae": text}`).

Ejemplos futuros sugeridos:

| Tipo | Disparador | Recipients | Metadata |
|---|---|---|---|
| `invoice_emitted` | Workflow Inngest `issue-invoice` post-CAE | Todos con `invoices:read` | invoice_id, cae, numero |
| `invoice_failed` | Workflow Inngest `issue-invoice.onFailure` | Creador del draft | invoice_id, error |
| `aging_weekly` | Cron `aging-weekly-summary` | Todos con `clients:read` | total_open, top_buckets |
| `cert_expiring` | Cron (futuro) diariamente | Owners + admins | days_left, cert_serial |
| `trip_assigned` | Server action de Fase G | Chofer | trip_id, vehicle, date |

---

## 4. Realtime

Mismo patrón que el resto del chat: `postgres_changes` filtrado por
`recipient_id`. Postgres respeta RLS, así que cada cliente solo recibe
sus propias notifs.

```sql
alter publication supabase_realtime add table public.notifications;
```

```ts
// features/notifications/hooks/use-notifications.ts
export function useNotificationsRealtime(recipientId: string) {
  useRealtimeInvalidate([
    {
      table: "notifications",
      filter: `recipient_id=eq.${recipientId}`,
      queryKeys: [
        notificationsKeys.unreadCount(),
        notificationsKeys.list("all"),
        notificationsKeys.list("unread"),
      ],
    },
  ]);
}
```

**Por qué invalidar y no insertar localmente:** el INSERT del trigger
pasa una payload que ya tiene todos los joins (sender_profile, etc.)
de nuestro RPC `list_my_notifications`. Refetchear es ~200ms en LAN y
mantiene el código simple.

---

## 5. RPCs y server actions

### 5.1 RPCs

```
list_my_notifications(p_filter text, p_limit int) → setof
  Devuelve mis notifs con sender_profile + email joined.
  p_filter ∈ {'all','unread','read'}, default 'all'.
  p_limit ∈ [1, 200], default 50.

get_my_unread_notification_count() → int
  Solo el conteo. Usado por el badge — refresca cada 5s.

mark_all_my_notifications_read() → int
  Bulk update, devuelve cuántas se marcaron.
```

`mark` de una sola notif va por UPDATE directo aprovechando la RLS
(no hace falta RPC).

### 5.2 Server actions

`features/notifications/actions/notifications-actions.ts`:

- `listNotificationsAction({ filter, limit })` → resuelve avatar URLs
  con `resolveAvatarUrl`.
- `getUnreadCountAction()` → llama al RPC.
- `markNotificationReadAction(id)` → UPDATE directo.
- `markAllReadAction()` → llama al RPC.

Todas devuelven `ActionResult<T>` para `runAction`.

### 5.3 Mark-when-active heuristic

Cuando entrás a un canal del chat, `mark_chat_channel_read(p_channel)`
no solo actualiza `chat_channel_members.last_read_at` — también marca
las notifs `chat_*` con `metadata->>'channel_id' = p_channel` como
leídas. Esto evita que el bell quede con badge alto mientras estás
mirando el mensaje.

```sql
update public.notifications
  set read_at = now()
  where recipient_id = v_me
    and read_at is null
    and type in ('chat_message', 'chat_reply', 'chat_mention')
    and metadata->>'channel_id' = p_channel::text;
```

---

## 6. UI

### 6.1 `<NotificationBell>` (header global)

Vive en `app/(dashboard)/layout.tsx` al lado del `<ScopeSelector>`.

- Ícono `Bell` (lucide).
- Badge con `unread_count` (max display `99+`).
- Click abre `<Popover>` con la lista de las últimas 50.
- "Marcar todas" arriba a la derecha (solo si hay unread).
- Cada item: avatar + título tipado + preview + tiempo relativo +
  punto azul si unread.
- Click en item: `mark_read` + redirect al recurso (`getNotificationHref`
  resuelve la URL según `type` + `metadata`).

### 6.2 Helpers

```
getNotificationHref(notif)
  chat_message  → /chat/{channel_id}
  chat_reply    → /chat/{channel_id}
  chat_mention  → /chat/{channel_id}
  (otros tipos) → null (no navega)

getNotificationTitle(notif)
  chat_message  → "te mandó un mensaje"
  chat_reply    → "respondió a tu mensaje"
  chat_mention  → "te mencionó"

getNotificationPreview(notif) → metadata.preview ?? ""
formatNotificationTime(iso) → "ahora" | "5m" | "2h" | "3d" | "dd/MM"
```

---

## 7. Permisos

No hay permission específica para "ver notificaciones" — cada user
ve solo las suyas (RLS lo enforcea). Los **permisos de
read del recurso** son lo que decide si una notif tiene sentido
generarse. Ej: si en el futuro existe `invoice_emitted`, el trigger
debe chequear que el recipient tenga `invoices:read` antes de
insertar, o filtrar por roles en el RPC que dispara el insert.

Para v1 (solo chat), no hay tema: si sos miembro del canal, podés
ver el mensaje, así que podés recibir la notif.

---

## 8. Tests

| Tipo | Qué cubre |
|---|---|
| Unit (Vitest) | `getNotificationHref` por cada type, fallback a null. |
| Unit | `getNotificationTitle` produce strings distintos por type. |
| Unit | `getNotificationPreview` extrae `metadata.preview` o "". |
| Unit | `formatNotificationTime` para "ahora" / minutos / horas / días. |
| Integration | Insert en `chat_messages` dispara N notifs (con N = miembros - 1, excluyendo muted). |
| Integration | Reply dispara una notif extra al origin sender. |
| Integration | `mark_chat_channel_read` marca las notifs del canal. |
| RLS | User A no ve notifs de user B; no puede insertar notifs como otro. |

---

## 9. Plan de PRs

1. **`feat: notifications schema + chat trigger`** (incluido en el PR de
   chat porque están acoplados al modelo de membresía).
2. **`feat: notification bell + popover`** (idem).
3. *(futuro)* `feat: notification preferences (per-type opt-out)` —
   tabla `notification_settings` y UI en `/profile`.
4. *(futuro)* `feat: notifications via email (Resend)` — worker
   Inngest que pickup `email_enabled = true AND email_sent_id IS NULL`,
   render del template, send, persist resultado.
5. *(futuro)* `feat: invoice_emitted notifications` — agrega type al
   check + trigger en el workflow Inngest `issue-invoice`.

---

## 10. Decisiones cerradas

1. **Tabla única vs por tipo.** Única. Discriminator `type` + `metadata
   jsonb`. Cuesta menos extender que mantener una tabla por categoría.
2. **In-app primero, email después.** Sí. El badge realtime es lo que
   más valor tiene. Email se cabléa cuando aparezca el caso de "el
   user no está en la app y necesita enterarse".
3. **Realtime vs polling.** Realtime. Polling cada 30s es ruido en BD;
   la suscripción es 0 carga hasta que llega un evento.
4. **Mark-as-read sincrónico desde el cliente.** Sí, vía UPDATE
   directo (RLS lo permite). Sin optimistic update por ahora — el
   refresh es <100ms y la inconsistencia visible es despreciable.
   Si crece la lista a >50 unread habituales, sumar `onMutate` con
   setQueryData manual.
5. **TTL / cleanup de notifs viejas.** No en v1. Si la tabla crece,
   se suma una cron Inngest semanal que borra
   `read_at IS NOT NULL AND created_at < now() - '90 days'`.

---

## 11. Métricas de éxito

| Métrica | Objetivo |
|---|---|
| Latencia INSERT en `chat_messages` con N=10 miembros (incluye trigger de notifs) | < 50 ms p95 |
| Latencia realtime push (insert → badge actualizado en otro cliente) | < 1.5 s p95 |
| Latencia `getUnreadCountAction` | < 80 ms p95 |
| Notifs perdidas tras crash del cliente y reconexión | 0 (Postgres es source of truth, no perdemos eventos) |
| Falsos positivos por race condition con `mark_chat_channel_read` | < 1% |

---

## 12. Cosas a NO hacer

1. **No usar Realtime Broadcast (in-memory channel send) para notifs.**
   Las notifs son durables — si el cliente está offline, las quiere
   ver cuando vuelve. Postgres + Realtime postgres_changes + RLS dan
   eso gratis.
2. **No filtrar por permisos en RLS de notifications.** El check de
   permisos vive en el generador (trigger / código), no en el read.
   Una vez insertada, el recipient siempre puede leerla. Esto evita
   que cambios de rol post-creación oculten o re-expongan notifs
   viejas de forma inconsistente.
3. **No mostrar la notif en el current channel.** Cuando estás en
   `/chat/<id>`, el `mark_chat_channel_read` debounced limpia los
   inserts en cuanto llegan. El badge parpadea ~1.5s — si molesta,
   sumar un check `metadata.channel_id !== currentChannelId` antes
   de incrementar localmente.
4. **No agregar `organization_id` "por si acaso".** Single CUIT.
   Cuando se introduzca multi-org (no es probable), se agrega como
   columna nullable + se ajusta RLS.
5. **No mezclar notifs de UI con audit_events.** Son sistemas
   distintos: `audit_events` es WORM para compliance (RLS read-only
   para admins), `notifications` es transient para UX (read-write
   para el recipient).
