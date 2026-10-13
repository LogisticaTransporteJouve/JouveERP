# Condensed algorithmic-performance lens (paste verbatim per subagent)

This is the block review/planning/build skills paste into EVERY subagent prompt (a "see the skill"
reference is inert; subagents inherit only their prompt). There is no separate fat performance
skill in JouveERP — this file IS the lens; the orchestrator reads it once and pastes the block below.

```
=== ALGORITHMIC-PERFORMANCE LENS (attack every change for cost that scales with total data) ===
On its own `perf-lens loaded:`-prefixed line in the load-proof HEADER BLOCK (header order: catalog,
ports-lens, dry-lens, perf-lens; the tripwire keys on the PREFIX, not on line position), or this wave
is NON-CLEAN and re-run:
  perf-lens loaded: work bounded by page/working-set, not total data | data touches: <table/array list | "none — no query/loop/large-list in diff">
("none" is a CLEAN pass ONLY when stated. A bare "none" or a missing/garbled perf-lens line = NON-CLEAN.
A wrongful "none"/"N/A" on a diff that DOES add a query, a loop over rows, a fan-out, or a large-list
render/matcher is a first-class DEFECT.)

THE ONE LAW: hot-path work must be BOUNDED — its cost may not scale with a table's total rows. Every
growing-table access filters on a selective key (date range, client/supplier/account/channel id,
status) served by an index, and pages by KEYSET, not offset. Unknown-size work is paged + resumable +
concurrency-capped. Set logic and aggregation live in the DB, not an app loop.
("Fast on dev data" is not a pass — size for the company a few years out: tens of thousands of
invoices and receipts, hundreds of thousands of transactions and journal lines, every audit event.)

LARGE-TABLE REGISTRY (treat as large; add any new table that grows per day/operation):
`transactions`, `journal_entry_lines`, `invoices`, `receipts`, `audit_events`, `ai_usage` — plus
their children (invoice/receipt items, journal entries, purchase invoices, payment orders, chat
messages, notifications). Every access to them bounds the date range or filters by a parent id, is
served by an index whose leading column(s) match the filter, and pages by (date|created_at, id).

JOUVE / SUPABASE HAZARDS (each one has bitten this codebase — check them every time):
- POSTGREST max_rows = 1000 (`supabase/config.toml`). An un-ranged `.select()` over a large table is
  SILENTLY TRUNCATED at 1000 rows — no error. NEVER sum, count, balance or aggregate an unpaginated
  result in JS: a saldo, a libro IVA total, a trial balance, an aging bucket computed over a
  truncated array is a WRONG NUMBER, not a slow one. Aggregate in SQL (a view or an RPC) and return
  the aggregate; if rows really are needed, page with `.range()` / keyset until exhausted.
- `count: "exact"` runs a full COUNT over the filtered set on every call — use it only on a
  bounded filter or where the UI truly needs the total; prefer `count: "estimated"`/"planned" or
  has-next-page (fetch limit+1) for infinite lists.
- Independent queries in one action/RSC run in `Promise.all`, never sequential awaits (each
  PostgREST round-trip is ~tens of ms).
- RLS initplan: `auth.uid()` and `public.user_has_role(...)` inside a policy are wrapped as
  `(select auth.uid())` / `(select public.user_has_role(array[...]))` so Postgres evaluates them once
  per statement, not once per row. A new policy that calls them bare is a DEFECT.
- Every FK column used in a filter or join has an index (Postgres does not create one).
- Inngest: a function that touches many rows declares `concurrency` (and `throttle`/`rateLimit`
  where it calls AFIP, an AI provider or email), and splits work into one `step.run` per page/chunk
  with a guarded cursor, so a retry resumes instead of restarting; never one giant step.
Signal: the `authenticated` role's statement_timeout bounds every PostgREST query; a hot query near
it is the red flag.

THE FIVE CO-EQUAL LAWS — check and REPORT each (an unstated law is UNCHECKED, not passed):
1. SELECTIVE-KEY-PRESENT — every large-table query carries a selective, indexed filter (date range,
   parent id, status) — never an unfiltered read of a registry table. Service-role queries
   (`getServiceClient()`, Inngest functions) bypass RLS, so the filter must be explicit there.
   Missing it = full scan (and, past 1000 rows, a truncated result) = DEFECT.
2. KEYSET-NOT-OFFSET — pagination over a large/mutating set uses WHERE (k)>(cursor) ORDER BY k LIMIT n,
   never LIMIT/OFFSET (offset = O(n^2) drain + skip/dup under concurrent writes). One shared keyset
   helper in `lib/` once a second caller exists — never a hand-rolled cursor per call site.
3. NO-FULL-MATERIALIZATION — presence via EXISTS/NOT EXISTS; totals/balances via SQL aggregation
   (view/RPC), never by summing rows in JS; no DISTINCT+JOIN+GROUP BY / correlated LATERAL over a
   whole history before LIMIT; no whole-table read into memory/browser then filter in code.
4. NO-N+1 — no per-row DB/AFIP/model call in a loop (e.g. one exchange-rate lookup per invoice, one
   insert per journal line); batch by chunked IN(...) / a bulk insert / a set-based RPC / a join.
5. BOUNDED-WORK — unknown-size work is paged + resumable (one Inngest step per page/chunk); fan-out
   is concurrency-capped (Inngest `concurrency`, a pull-pool, a per-page chunk), never an unbounded
   Promise.all(rows.map) over a whole result; big lists are virtualized and hot lookups use Map/Set
   (O(1)), not nested .find/.filter (O(n^2)); real domain-id React keys, not the array index.

SEVERITY: unfiltered large-table read / JS aggregation over a possibly-truncated result / OFFSET on a
large set / whole-set materialization on a hot path / N+1 / unbounded fan-out or single-step job over
a large table / whole-table-into-memory / bare `auth.uid()`/`user_has_role()` in a new policy = HARD
blockers (any one = does not merge). Large single-shot .limit(N) ceiling, a loop bounded by small fixed
cardinality (4 channels, 6 roles), an O(n^2) matcher over a small-today list, sequential awaits of
independent queries, an avoidable `count: "exact"` = raise-and-downgradable (defer only if
pre-existing AND off this change's hot path; state it, don't default).

ONLY sanctioned exceptions (each on probation, one-line justified):
(a) a statement_timeout-bounded, IDEMPOTENT-RESUMABLE batch/backfill (never a hot path) — name the
    bound; (b) a large single-shot .limit(N) read where the set PROVABLY cannot exceed N (and N <=
    1000) — name the cap + why bounded. "Small table today" is NOT an exception if it grows per
    day/operation.

FIX every violation in this change. The only deferrable is one off this change's hot path / blast radius
(a pre-existing scan the diff doesn't touch) — RAISE it + list it under the PR's `## Follow-ups`,
never tolerate silently.

PER-LAW VERDICT: if the change adds/edits a query, a loop over data, a fan-out, a paged job, or a large-
list render/matcher, emit PASS|DEFECT + one line for each of the five laws. If it touches NO such
surface, emit exactly:
  perf: N/A — no data-scaling surface (no query, no loop over rows, no fan-out, no large-list render).
=== END ALGORITHMIC-PERFORMANCE LENS ===
```
