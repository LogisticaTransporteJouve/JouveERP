---
title: Enable Row Level Security for Per-User Data
impact: CRITICAL
impactDescription: Database-enforced owner isolation, prevent data leaks
tags: rls, row-level-security, role-isolation, security
---

## Enable Row Level Security for Per-User Data

Row Level Security (RLS) enforces data access at the database level, ensuring users only see their own data.

**Incorrect (application-level filtering only):**

```sql
-- Relying only on application to filter
select * from orders where user_id = $current_user_id;

-- Bug or bypass means all data is exposed!
select * from orders;  -- Returns ALL orders
```

**Correct (database-enforced RLS):**

```sql
-- Enable RLS on the table
alter table orders enable row level security;

-- Create policy for users to see only their orders
create policy orders_user_policy on orders
  for all
  using (user_id = current_setting('app.current_user_id')::bigint);

-- Force RLS even for table owners
alter table orders force row level security;

-- Set user context and query
set app.current_user_id = '123';
select * from orders;  -- Only returns orders for user 123
```

Policy for authenticated role (Supabase; the shape JouveERP uses for self-scoped rows such as
notifications or push subscriptions):

```sql
create policy orders_user_policy on orders
  for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
```

Role-gated policy (JouveERP's house form for business tables — see `enforce-role-isolation`):

```sql
create policy invoices_write on invoices
  for all
  to authenticated
  using      ((select public.user_has_role(array['owner','admin','finance'])))
  with check ((select public.user_has_role(array['owner','admin','finance'])));
```

`using` decides which rows the caller may read and touch; `with check` decides what a written row may
become. Without `with check` on `update`, Postgres reuses `using`, and the caller can rewrite
`user_id` on his own row. See `enforce-role-isolation` for the shapes that pass this rule and are
still exploitable.

Reference: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
