---
title: Optimize RLS Policies for Performance
impact: HIGH
impactDescription: 5-10x faster RLS queries with proper patterns
tags: rls, performance, security, optimization
---

## Optimize RLS Policies for Performance

Poorly written RLS policies can cause severe performance issues. Use subqueries and indexes strategically.

**Incorrect (function called for every row):**

```sql
create policy orders_policy on orders
  using (auth.uid() = user_id);  -- auth.uid() called per row!

-- With 1M rows, auth.uid() is called 1M times
```

**Correct (wrap functions in SELECT):**

```sql
create policy orders_policy on orders
  using ((select auth.uid()) = user_id);  -- Called once, cached

-- 100x+ faster on large tables
```

Use security definer functions for complex checks (for example, asserting that a child row's
parent belongs to the caller):

```sql
-- Helper in a non-exposed schema (runs as definer, bypasses RLS)
create or replace function private.owns_import(p_import_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.imports
    where id = p_import_id and user_id = (select auth.uid())
  );
$$;

revoke all on function private.owns_import(uuid) from public, anon, authenticated;
grant execute on function private.owns_import(uuid) to authenticated;

-- Use in policy (indexed lookup, not per-row check)
create policy holdings_owner on holdings
  for all to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (select private.owns_import(import_id)));
```

The helper derives identity from the session, never from a parameter, so a caller cannot ask about
another user. A composite foreign key `(import_id, user_id) references imports (id, user_id)` gives
the same guarantee without a function.

Always add indexes on columns used in RLS policies:

```sql
create index orders_user_id_idx on orders (user_id);
```

Reference: [RLS Performance](https://supabase.com/docs/guides/database/postgres/row-level-security#rls-performance-recommendations)
