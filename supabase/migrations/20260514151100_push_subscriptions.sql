-- Web Push subscriptions. Cada device que el user autoriza guarda su
-- endpoint + keys. Cuando se inserta una notif, el server action que
-- la dispara también envía un push a las subscriptions del recipient.
-- Si VAPID no está seteado en env, el send es no-op (sin VAPID el
-- service worker no funciona igual).

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

create index idx_push_subscriptions_user
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- El user lee/crea/borra solo las propias.
create policy "push_subscriptions_select_self"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "push_subscriptions_insert_self"
  on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "push_subscriptions_update_self"
  on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "push_subscriptions_delete_self"
  on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));
