# Condensed reach lens (paste verbatim per subagent)

This is the block review/planning/build skills paste into EVERY subagent prompt (a "see the skill"
reference is inert; subagents inherit only their prompt). `.agents/skills/enforce-reach/SKILL.md`
is a pointer to this file — this file IS the lens; the orchestrator reads it once and pastes the
block below.

```
=== REACH LENS (attack every change for a place it failed to reach) ===
On its own `reach-lens loaded:`-prefixed line in the load-proof header block (the tripwire keys on
the PREFIX, not on line position), or this wave is NON-CLEAN and re-run:
  reach-lens loaded: every delta reaches every writer, reader, entry point and variant | reach surface: <delta→anchor list | "none — no behavioural delta (pure formatting/comment/doc change)">
("none" is a CLEAN pass ONLY when the diff changes no behaviour. A missing/garbled reach-lens line =
NON-CLEAN. A "none" or an all-`has it` verdict that does not name the grep commands run and the peers
found is UNCHECKED — this lens is not satisfied by reading the diff.)

THE ONE LAW: every behavioural change reaches every writer, reader, entry point, exit and variant of
what it changes, and all other code answering the same question gives the same answer. The failure
is not a crash — it is two surfaces that disagree (the list includes a row its own count excludes;
the UI blocks what the AI CFO tool still runs; the PDF total differs from the libro IVA total).

SEARCH OUTSIDE THE DIFF with `git grep` or `rg --hidden -g '!.git'`. A bare `rg` skips `.agents/`,
`.claude/`, `.github/` and answers zero hits, which reads exactly like clean. Cover TS, SQL
(`supabase/migrations/`, RPC bodies, views, RLS), tests, fixtures, seeds, string literals, prompts,
skill docs and `lib/db/database.types.ts`. Grep the anchor AND a distinctive 4–6 token slice of the
delta's logic: a copy-pasted sibling does not share the identifier.

THE FIVE CO-EQUAL LAWS — check and REPORT each (an unstated law is UNCHECKED, not passed):

1. ONE-FORK — where two representations of one identity coexist (a ledger account by chart code
   `1.1.01.001` OR id; a client by CUIT OR id; an invoice by punto de venta + número OR id; USD as
   "USD" OR AFIP "DOL"), the decision of WHICH to use is made once, at the resolution point, and
   everything downstream carries the resolved handle blind to its arm. Defects: an inline
   `a ?? b` / `if (a) … else b` at a call site where a shared resolver already exists (e.g.
   `isUsdCurrency` in `lib/fx.ts`); a function taking BOTH representations and re-deciding; arm
   awareness leaking into a component, formatter, sort key or pure helper; the same fork made twice
   on one path (query layer AND render layer — name the input on which they disagree); forking too
   high (one arm discarded early, so a lower layer cannot recover it). Not a defect: the resolution
   point itself branching, or an adapter querying one column per arm.

2. REACH-MATRIX (consumer completeness) — per behavioural delta (a guard, filter, predicate,
   validation, side effect, field, parameter, default, key format, constant, signature, return
   shape, meaning), name its ANCHOR (the noun it changes — a column, figure, permission, event,
   RPC, query key — not the function it sits in) and fill five peer lists:
   - WRITERS: create, update, bulk, import (`scripts/import-afip-purchases.mjs`), retry, Inngest
     step, trigger, backfill, seed (`supabase/seed.sql`, `scripts/seed-everything.mjs`), Document
     Intelligence confirm.
   - READERS: every query or figure over the anchor — list, count, total, badge, drill-down, PDF,
     export, AI tool renderer, prompt text, dashboard widget, tests, fixtures, generated types.
   - ENTRY POINTS: UI control, deep link, empty state, server action, route handler (`app/api/`),
     Inngest event or cron, AI CFO tool.
   - EXITS of the containing function: every `return`, `throw`, `catch`, early `{ ok: false }`,
     Inngest `step` failure/retry, `finally`.
   - VARIANTS of whatever the delta branches on (registry below).
   Mark each peer `has it`, `exempt: <where the code or PR says why>`, or `MISSING`. MISSING is a
   finding only once you name the input on which peer and delta disagree. The SIBLING-QUERY test:
   for every query taught the new behaviour, find the one beside it (count, total, summary, export,
   CSV, tooltip, AI aggregate) and check it learned the same thing. The CONTRACT test: a persisted
   contract (column, JSON key, RPC argument, event payload in `lib/inngest/events.ts`, action
   result field) that gained a case on the write side but not the read side, or vice versa.
   REGISTRIES: a new unit appears in every registry that lists its kind (peer sets below).

3. TWIN-CHECK (one question, one answer) — name each question the diff answers as a noun phrase
   ("saldo of a client at a date", "is this comprobante visible to this user", "which exchange rate
   applies"). Find the OTHER answerers — independent code sharing no symbol with the diff; grep by
   domain noun and open the peer sets. Every query selecting "the" row for a key needs the same
   ORDER BY and tie-break. For each pair, prove they share one function, or name the input on which
   they differ. Probe: a date vs a timestamp across the Argentina timezone; day vs month grain;
   period boundaries (closed period, month end); USD vs ARS and a missing rate; NC sign vs invoice
   sign; a cancelled/voided row; a soft-deleted row; duplicate rows; the 1000-row PostgREST cap
   truncating one twin but not the other. Fix by routing both through one function, never by
   patching the second copy. A mirror that cannot share code (SQL RPC vs TS, the RLS role array vs
   the TS matrix) needs a parity test that fails on the named input — or LEAVE + NOTE naming the
   independent-change axis and the death condition.

4. REPLACEMENT-PARITY — when the diff replaces a unit (`CREATE OR REPLACE`, `DROP`+`CREATE` of an
   RPC/view/policy, a component swap, adopting a helper or wrapper, a restructured early return, a
   conflict resolution), put the old unit beside the new one (for SQL: the LATEST prior definition
   across all migrations, not the first) and list everything the old one could be observed doing:
   every returned field (nested too); filters and predicates; side effects (`logAudit` rows,
   Inngest events sent, notifications, query invalidation, `revalidatePath`); attributes (SQL
   `SECURITY DEFINER`/`INVOKER`, `SET search_path`, `STABLE`, grants/revokes; JSX `aria-*`, variant,
   disabled state); options forwarded (limits, retries, concurrency, idempotency keys); ordering;
   error and no-op behaviour. Mark each `carried`, `dropped — the PR says so`, or `LOST`. Each LOST
   is a finding. For a conflict hunk, compare against both parents.

5. DELETION-CLOSURE — every removed symbol, module, export, route, permission, event or call: grep
   for remaining references (they crash or 404) and for things that existed only to serve it (now
   orphaned: helpers, query keys, AI tools, seeds, docs, skill text, fixtures). Every renamed
   persisted or out-of-process name (Inngest event name or function id, cron id, storage path,
   audit `eventType`, cookie or localStorage key, query-key prefix): say what migrates or retires
   the old instance (queued Inngest events under the old name still arrive after deploy). Every
   ADDED unit has one live caller or emitter.

JOUVEERP PEER SETS (the diff touches the left → open every right-hand peer):
- A server action → its AI CFO tool (`features/ai/registry/catalog.ts`, `features/ai/registry/actions/`,
  renderers in `features/ai/components/tool-renderers.tsx`) — the tool must call the action so the
  same gate applies; the hook (`features/<f>/hooks/`) and its query keys (`features/<f>/lib/<f>-keys.ts`)
  incl. every invalidation after a mutation; the `app/(dashboard)/<ruta>/page.tsx` prefetch +
  `Hydrate`; any route handler in `app/api/` doing the same operation.
- A money figure (saldo, total, IVA, aging bucket, balance) → the SQL RPC/view that computes it
  (`lib/db/rpc.ts`, `supabase/migrations/`); the PDF (`lib/pdf/`); libro IVA (`features/libro-iva`,
  `app/api/accounting/`); exports (`app/api/export/`); dashboard and balance/aging/mayor features;
  AI CFO aggregates (`features/ai/registry/actions/`); the parity tests (`lib/db/multicurrency-reports.test.ts`,
  `lib/db/invoicing-integrity.test.ts`).
- A permission → `lib/auth/permissions.ts` + `lib/auth/permissions.test.ts` (100% matrix); every
  RLS role array (`public.user_has_role(array[...])`) on the tables the permission covers; UI gating
  (`components/layout/nav-items.ts` nav `permission`, buttons, `components/mobile-tab-bar.tsx`); the AI
  tool's `permission` (`features/ai/registry/define.ts`); per-user denies (`lib/auth/denies.ts`,
  `lib/auth/entity-permissions.ts`) — every gate calls `userCan(ctx.access, "<perm>")`, role-level
  questions (recipients, "por rol" UI) use `roleGrants`/`rolePermissions`; headless paths
  (`lib/auth/headless-user.ts`, Inngest recipients) and search (`features/search/`).
- A table or column → RLS in the same migration; `lib/db/database.types.ts` regenerated; seeds
  (`supabase/seed.sql`, `scripts/seed-everything.mjs`); `logAudit()` (`lib/actions/audit.ts`) on
  audited writes; RLS on every table embedded in the same PostgREST read; `supabase/tests/`;
  search indexing and TTL cleanup (`lib/inngest/functions/search-index-refresh.ts`,
  `lib/inngest/functions/ttl-cleanup.ts`) when the table is searchable or expiring.
- An Inngest function or event → registered in `app/api/inngest/route.ts`; payload schema in
  `lib/inngest/events.ts`; every sender of the event; idempotency key and retry behaviour.
- AFIP issuance → CAE path and CAEA path (`lib/inngest/functions/issue-invoice.ts`,
  `lib/inngest/functions/issue-invoice-cae.ts`, `lib/afip/caea.ts`, `lib/inngest/functions/caea-inform.ts`)
  and `features/afip-admin`; a CAE is an irreversible external create — every retry path is
  idempotent.

VARIANTS REGISTRY (a delta that branches on one of these is checked against every value):
- billing channel — the 4 invoicing channels (2 divisions × fiscal/interno; `lib/channels.ts`,
  `is_fiscal`): an interno channel never reaches AFIP, a fiscal one always does;
- authorization — CAE vs CAEA (and CAEA informed vs pending);
- currency — ARS vs USD (`lib/fx.ts`; "USD" and AFIP "DOL"; rate present vs missing);
- comprobante type — factura vs nota de crédito vs nota de débito (`lib/afip/codes.ts`), letter A/B/C;
- actor — the 6 roles, the owner (deny-immune), the acting user (`lib/auth/acting-user.ts`), a
  headless Inngest run (`lib/auth/headless-user.ts`);
- surface — human UI vs AI CFO tool vs route handler vs Inngest job: the same operation performed
  differently with nothing saying why is a surface-family gap.

OWNERSHIP: debris (bare aliases, no-op wrappers, surviving old names, truthiness drift) is owned by
enforce-clean-code / dry-lens; change-narration by the comment lens. This lens owns reach only.

REPORTING BAR: a finding with no reachable trigger is `latent — no reachable trigger` + why it is
still worth fixing. Read the current file, not just the hunk, and the callers, before reporting.
No style, naming or lint. Three verified findings beat fifteen speculative ones.

SEVERITY: a MISSING writer/reader/entry point/variant with a named disagreeing input, a LOST
behaviour in a replacement, a dangling reference after a deletion, a gate reached by one surface and
not another (UI vs AI tool vs route), and an unregistered Inngest function = HARD blockers (any one =
does not merge). An orphan left by a deletion, a twin without a parity test where the code cannot be
shared, a latent miss with no reachable trigger = raise-and-downgradable (state the downgrade; list
it under the PR's `## Follow-ups`).

COVERAGE TABLE (proof of work — one row per delta, plus one per replaced unit and one per deletion;
a row whose peers are all `has it` still lists them):
  delta | anchor | searched (command) | writers | readers | entries | exits | variants | twins | status

PER-LAW VERDICT: if the change has any behavioural delta, emit the coverage table and PASS|DEFECT +
one line for each of the five laws. If it changes no behaviour, emit exactly:
  reach: N/A — no behavioural delta (formatting/comment/doc only; checked: diff has no code, SQL or config semantics change).
=== END REACH LENS ===
```
