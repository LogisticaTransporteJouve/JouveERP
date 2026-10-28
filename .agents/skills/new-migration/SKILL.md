---
name: new-migration
description: "Create a Supabase SQL migration in JouveERP (supabase/migrations/) with RLS in the same migration and regenerated types. Use when adding or altering a table, RPC, trigger, view, index, or RLS policy. Triggers on 'nueva migración', 'add table', 'alter table', 'RLS policy', 'crear tabla', 'migración SQL'."
---

# Nueva migración Supabase (JouveERP)

## Reglas

- **Archivo:** `supabase/migrations/YYYYMMDDHHMMSS_<scope>.sql` (timestamp UTC).
  El timestamp **debe ser mayor** al máximo en `main` — el job `database` de CI
  (`ci.yml`) lo valida. Si hay duda, usá la fecha/hora actual.
- **Header obligatorio** (primeras líneas del archivo):
  `SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '15min';` — siempre `SET LOCAL`:
  un `SET` pelado sobrevive a la transacción de la migración bajo `db push`. **Nunca**
  `set row_security` (postgres ya tiene `rolbypassrls`); si alguna vez hiciera falta, `SET LOCAL`.
- **Una migración = un cambio cohesivo.** **Nunca** editar una migración ya
  mergeada; si hay que ajustar algo, va una **nueva**.
- **RLS en la MISMA migración** que crea la tabla:
  `alter table public.<t> enable row level security;` + las policies.
  Usá el helper existente envuelto en `select` (se evalúa una vez por statement, no por fila):
  `(select public.user_has_role(array[...]))`; para filas propias del usuario,
  `user_id = (select auth.uid())`. Toda policy de escritura lleva `with check` explícito.
- **Funciones:** `security definer` siempre con `set search_path` y chequeo de rol adentro;
  `revoke all on function ... from public, anon, authenticated;` **en el mismo archivo** (también
  para `alter function ... security definer`) y después el `grant` mínimo. `from public` solo no
  alcanza en Supabase. Nunca `grant` a `anon`. Ver `/enforce-role-isolation`.
- **Roles en RLS = techo de rol.** Las policies leen `user_roles`; las denegaciones por usuario se
  aplican en la app (`userCan(ctx.access, "<perm>")`), no en SQL — no agregues predicados de deny.
- **Realtime** solo si la UI necesita refresco cross-user:
  `alter publication supabase_realtime add table public.<t>;`
- **Después de aplicar:** regenerar tipos y commitearlos —
  `pnpm dlx supabase gen types typescript --local --schema public > lib/db/database.types.ts`
  (el job `database` de CI diff-ea; si hay drift, falla).
- **Sin `select *`** en las queries que la consuman.
- **Antes de commitear:** `pnpm check:migrations` (`scripts/check-migrations.sh`: nombre y
  timestamp, header `SET LOCAL`, revoke de DEFINER, squawk sobre los archivos agregados).
  ⚠️ squawk no ve el DDL generado dentro de bloques `DO $$ … $$` (ni `execute format(...)`): ese DDL
  lo revisás a mano (locks, `not valid` + `validate constraint`, índices `concurrently` cuando aplica).

## Template

Estudiá una migración real con tabla + RLS como referencia, p.ej.
`supabase/migrations/20260508201626_roles_and_audit.sql`.

```sql
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

create table public.<t> (
  id          uuid primary key default gen_random_uuid(),
  -- columnas...
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.<t> enable row level security;

create policy "<t> select" on public.<t>
  for select to authenticated
  using ( (select public.user_has_role(array['owner','admin'])) );

create policy "<t> insert" on public.<t>
  for insert to authenticated
  with check ( (select public.user_has_role(array['owner','admin'])) );

-- update / delete según corresponda
```

## Checklist

- [ ] Timestamp > máximo en `main`.
- [ ] Header `SET LOCAL lock_timeout` / `statement_timeout`; sin `set row_security`.
- [ ] DEFINER nuevo con `revoke all ... from public, anon, authenticated` en el mismo archivo.
- [ ] `pnpm check:migrations` verde; DDL dentro de `DO` revisado a mano.
- [ ] RLS habilitada + policies en la misma migración.
- [ ] Helper `(select public.user_has_role(...))` para checks de rol, con la lista de roles
      alineada a `lib/auth/permissions.ts`.
- [ ] Índice en cada FK y columna de filtro; trigger `set_updated_at()` si hay `updated_at`.
- [ ] Tipos regenerados y commiteados.
- [ ] No se editó ninguna migración mergeada.
