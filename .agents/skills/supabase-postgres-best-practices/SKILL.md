---
name: supabase-postgres-best-practices
description: Postgres performance optimization and best practices from Supabase. Use this skill when writing, reviewing, or optimizing Postgres queries, schema designs, or database configurations.
license: MIT
metadata:
  author: supabase
  version: "1.1.0"
  organization: Supabase
  date: January 2026
  abstract: Comprehensive Postgres performance optimization guide for developers using Supabase and Postgres. Contains performance rules across 8 categories, prioritized by impact from critical (query performance, connection management) to incremental (advanced features). Each rule includes detailed explanations, incorrect vs. correct SQL examples, query plan analysis, and specific performance metrics to guide automated optimization and code generation.
---

# Supabase Postgres Best Practices

Comprehensive performance optimization guide for Postgres, maintained by Supabase. Contains rules across 8 categories, prioritized by impact to guide automated query optimization and schema design.

## When to Apply

Reference these guidelines when:
- Writing SQL queries or designing schemas
- Implementing indexes or query optimization
- Reviewing database performance issues
- Configuring connection pooling or scaling
- Optimizing for Postgres-specific features
- Working with Row-Level Security (RLS)

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Query Performance | CRITICAL | `query-` |
| 2 | Connection Management | CRITICAL | `conn-` |
| 3 | Security & RLS | CRITICAL | `security-` |
| 4 | Schema Design | HIGH | `schema-` |
| 5 | Concurrency & Locking | MEDIUM-HIGH | `lock-` |
| 6 | Data Access Patterns | MEDIUM | `data-` |
| 7 | Monitoring & Diagnostics | LOW-MEDIUM | `monitor-` |
| 8 | Advanced Features | LOW | `advanced-` |

## How to Use

Read individual rule files for detailed explanations and SQL examples:

```
references/query-missing-indexes.md
references/query-partial-indexes.md
references/security-rls-basics.md
```

`AGENTS.md` lists every reference file by category.

Each rule file contains:
- Brief explanation of why it matters
- Incorrect SQL example with explanation
- Correct SQL example with explanation
- Optional EXPLAIN output or metrics
- Additional context and references
- Supabase-specific notes (when applicable)

## JouveERP conventions (override the generic examples)

The reference files are upstream Supabase guidance with generic examples. Where they differ,
JouveERP's conventions win:

- **Single company, role-based access — no per-user ownership of business data.** Business tables
  are gated by role: policies use `(select public.user_has_role(array['owner','admin',...]))` in
  BOTH `using` and `with check`, `to authenticated`, with the role list mirroring the matrix in
  `lib/auth/permissions.ts`. Only self-scoped rows (profiles, notifications, push subscriptions,
  dashboard layouts, AI chat sessions, a driver's own trips) pin `user_id = (select auth.uid())`.
- **RLS in the same migration that creates the table** (`YYYYMMDDHHMMSS_<scope>.sql`, timestamp
  greater than the max on `main`, never edit a merged migration) — see `/new-migration`.
- **Grants are explicit.** `anon` gets nothing. Functions get `revoke all ... from public, anon,
  authenticated` before any targeted grant (on Supabase, `from public` alone leaves the default
  per-role grants standing).
- **`security definer` always carries `set search_path`** (prefer `''` with qualified names) and
  checks the caller's role inside.
- **Money is `numeric(18, 2)`, never float**, and every amount sits next to its currency.
- **Every FK and filter column is indexed**; tables with `updated_at` get the `set_updated_at()`
  trigger.
- **PostgREST `max_rows` is 1000**: aggregate in SQL (views/RPCs) instead of summing rows in JS;
  page large reads by keyset.
- **The service role is server-only** (server actions after `requireUserContext()` + `userCan`,
  Inngest functions); RLS does not apply to it, so the action's gate is the boundary.
- Writes that span several tables (receipts, payment orders, opening balances) go through one RPC,
  and cancellations through the existing triggers — never re-implemented in TypeScript.
- After a migration, regenerate `lib/db/database.types.ts` (`pnpm db:types:generate`, local stack
  only); CI's `DB types drift` job diffs it. pgTAP tests go in `supabase/tests/` when added.

The adversarial review of policies, grants, and definer functions is `enforce-role-isolation`;
this skill is the machinery it builds on.

## References

- https://www.postgresql.org/docs/current/
- https://supabase.com/docs
- https://wiki.postgresql.org/wiki/Performance_Optimization
- https://supabase.com/docs/guides/database/overview
- https://supabase.com/docs/guides/auth/row-level-security
