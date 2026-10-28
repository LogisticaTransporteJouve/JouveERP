---
name: enforce-role-isolation
description: >-
  The strict enforcement lens for JouveERP's role-based access — a `"use server"` action or route
  that reaches `getServiceClient()` without `requireUserContext()` + `userCan(ctx.access, "<perm>")`, a
  gate that a per-user deny does not reach, an `Access` built outside `resolveAccess`, a write gated
  by a read permission, a new table without RLS in the same migration, a policy calling
  `user_has_role()` unwrapped or an UPDATE policy with no `WITH CHECK`, a `SECURITY DEFINER` function
  without `SET search_path` or an internal role check, a `REVOKE ... FROM PUBLIC` that leaves anon and
  authenticated granted, a function ACL that over- or under-grants its real callers, a spoofable
  identifier, an access-path replacement that widens what a role sees, an AI tool that bypasses the
  action gate, a permission missing from the matrix or its test, a secret or PII reaching a new sink
  or a PR-controlled CI step. Plugs into any review or planning pass. Use for "enforce role isolation",
  "check the RLS policies", "check permissions", "can a warehouse user reach this", "review this
  migration for security", "IDOR", "who can call this function", "userCan". CONDITIONAL, unlike the
  always-on lenses: a no-op on a diff with no DB or authz surface.
---

# Enforce Role Isolation — the holding-a-session-is-not-holding-the-permission law

This is a **language guide**, not a workflow. Load it as the lens for a pass whose sole job is to
prove a change cannot be driven past a role boundary. JouveERP is **single-company, single-tenant**
(one CUIT, one `business_units` row `dz_sons`): there is no per-user or per-tenant ownership of
business data. What separates users is their **role** — `owner`, `admin`, `finance`, `operations`,
`warehouse`, `driver` (table `user_roles`) — the permissions each role holds in
`lib/auth/permissions.ts`, minus any permission the owner denied that user individually (table
`user_permission_denies`, see "The access model"). A warehouse user must not issue invoices, a driver must not read the
ledger, and nothing the AI assistant does may exceed what the user asking could do by hand. A few
rows ARE personal and pin to the session user (see "Self-scoped rows"). The bar is deliberately
unforgiving, because every shape below reads like ordinary code.

> **Postgres/Supabase fundamentals are not restated here.** How RLS works, the initplan
> `(select ...)` performance form, least-privilege grants and constraint design live in
> `.agents/skills/supabase-postgres-best-practices/references/` —
> `security-rls-basics.md`, `security-rls-performance.md`, `security-privileges.md`,
> `schema-constraints.md`. **This guide is the adversarial half: the shapes that satisfy those
> references and are still exploitable here.**

## The two boundaries

1. **The server action gate (always).** Every `"use server"` action runs `requireUserContext()` →
   `userCan(ctx.access, ...)` first. Most actions (~60 of ~70 files) then use the user-scoped
   `createClient()` from `lib/supabase/server.ts`, so RLS ALSO enforces the role ceiling and the
   gate is defence in depth (and the ONLY place a per-user deny is enforced). A minority use
   `getServiceClient()` — the service-role client, which **bypasses RLS** — and on those paths the
   action's own gate is the ONLY boundary:

   ```ts
   "use server";
   export async function cancelInvoiceAction(input: CancelInvoiceInput): Promise<ActionResult<void>> {
     const ctx = await requireUserContext();                 // 1. who (throws if no session)
     if (!userCan(ctx.access, "invoices:cancel")) {          // 2. may they do THIS operation
       return { ok: false, error: "No tenés permiso." };
     }
     const parsed = cancelInvoiceSchema.safeParse(input);    // 3. untrusted input → Zod
     if (!parsed.success) return { ok: false, error: "Datos inválidos." };
     const supabase = getServiceClient();                    // 4. only now, bypass RLS
     // ... explicit columns, never select *
     await logAudit("invoice.cancel", ctx.userId, { invoiceId: parsed.data.id }, parsed.data.id);
     return { ok: true, data: undefined };
   }
   ```

2. **RLS (enforced on most paths).** Because most actions use the user-scoped client, an RLS role
   list narrower than the permission matrix silently breaks the feature, and a wider one leaks it —
   policy drift is a first-class finding, not a footnote. Every table has RLS enabled **in the migration that creates it**. RLS is
   what guards the user-scoped server client (`createClient()`), the browser client (Realtime,
   Storage, any direct PostgREST call) and anything that forgets step 2 above. Policies gate on the
   helper `public.user_has_role(text[])` (SECURITY DEFINER, reads `user_roles` for
   `(select auth.uid())`):

   ```sql
   alter table public.<t> enable row level security;

   create policy "<t> select" on public.<t>
     for select to authenticated
     using ((select public.user_has_role(array['owner','admin','finance'])));

   create policy "<t> write" on public.<t>
     for all to authenticated
     using      ((select public.user_has_role(array['owner','admin','finance'])))
     with check ((select public.user_has_role(array['owner','admin','finance'])));
   ```

   The role list mirrors the matrix: the roles that hold `<resource>:read` for select, the roles that
   hold the write permission for writes. Existing migrations call `public.user_has_role(...)`
   unwrapped; that is pre-existing debt (raise it, do not copy it) — new policies wrap it in
   `(select ...)` so it is evaluated once per statement instead of once per row.

## The access model — role ceiling in the DB, per-user denies in the app

The rule is stated once in `CLAUDE.md` (rationale in `docs/decisions.md`); this is how to attack it.

- **Every gate is `userCan(ctx.access, "<perm>")`.** `ctx.access` is a branded `Access` (roles +
  denied permissions) built ONLY by `resolveAccess` in `lib/auth/` (the context loader, the
  headless-user loader, the users helper; denies come from the one loader `lib/auth/denies.ts`).
  `userCan` is "a role grants it AND it is not denied"; a `<resource>:read` deny implies every
  `<resource>:*`; `owner` is deny-immune. Constructing an `Access` anywhere else (`as Access`,
  `satisfies Access`, an object literal) forges permissions — `eslint.fences.mjs` bans it.
- **Denies are app-level; the DB enforces only the role ceiling.** RLS policies and DEFINER role
  checks still read `user_roles` only — a denied permission is NOT enforced by Postgres. So a deny
  holds only where an app gate checks it: every server action, route handler, page, AI tool,
  headless/Inngest job acting for a user, notification or summary fan-out, and search scope (the
  entity types a user may read, `lib/auth/entity-permissions.ts`). A new path that reads data for a
  user without `userCan(access, …)` is a deny bypass even when RLS lets the role through. Say this
  honestly in UI/docs: a deny hides a module in the app; it is not a barrier against direct
  PostgREST access with the user's token.
- **Role-level questions use the matrix helpers, not `userCan`.** "Which roles hold P" (fan-out
  recipients, the "por rol" column in the access dialog) uses `roleGrants` / `rolePermissions`,
  imported only inside `lib/auth/**` and `features/admin-users/**`; the per-user answer then still
  passes through the deny loader + `userCan`. A hand-copied role array (`['owner','admin','finance']`
  in TS) that mirrors the matrix is a drift defect.
- **Role literals.** A gate may test a role literal only for `"owner"` (deny-immune:
  `ctx.access.roles.includes("owner")` for owner-only operations such as opening balances). Any
  other role literal (`"admin"`, `"finance"`, …) in a gate sits next to a `userCan` — never instead
  of one.
- **Role assignment** goes through `assignableRoles(actor)` / `removableRoles(actor)` (an admin never
  adds or removes `owner`; an actor cannot grant a role whose permissions they are themselves
  denied), and the writes go through the single atomic SECURITY DEFINER writer, never a direct
  `user_roles` insert from an action.

## Self-scoped rows

Some rows belong to one user and pin `user_id = (select auth.uid())` in USING and WITH CHECK (and the
action filters `.eq("user_id", ctx.userId)` because the service client bypasses that policy):
`user_profiles`, `push_subscriptions`, `dashboard_layouts`, `notifications`, the AI assistant's
`ai_chat_sessions` / `ai_chat_messages`; team-chat rows are scoped by `chat_channel_members`; a
driver sees only their own trips (`drivers.user_id`, migration `*_driver_self_access.sql`). For these,
an id the client sends (`conversationId`, `notificationId`) is data, never proof of ownership.

## The one law

**Every path that reads or writes business data must check the caller's role permission for that
exact operation before it touches the data, and every path that bypasses RLS carries that check
itself. Being logged in is not authorization; a role, user id or permission the caller supplied is
not authorization.**

## The six co-equal laws

All six must be CHECKED and REPORTED on a change with a DB/authz surface — a law you did not
mention is UNCHECKED, not passed.

1. **Action-gates-before-bypass** — `requireUserContext()` + the matching `userCan` before
   `getServiceClient()`, on every `"use server"` export and route handler.
2. **RLS-in-the-same-migration** — RLS + role-gated policies (wrapped helper, explicit WITH CHECK)
   in the creating migration.
3. **Definer-and-grants** — DEFINER functions pin `search_path` and check the role inside; revokes
   name `anon` and `authenticated`; nothing is granted to `anon`.
4. **Matrix-is-the-source** — permissions live in the matrix, are tested at 100%, and agree with the
   policies.
5. **AI-and-jobs-go-through-the-gate** — AI tools wrap gated actions; jobs are triggered only from
   gated actions; every fix is verified to fail.
6. **Secrets-and-egress** — no secret, PII or financial value reaches a new sink; no secret is in
   scope of PR-controlled CI code; actions stay SHA-pinned.

---

## Law 1 — Action-gates-before-bypass

> **Attack question:** for every export of every `"use server"` file and every route handler in the
> diff, what stops a user with the weakest role (or no role) from calling it directly with any input?

- **Every export is an endpoint.** Next.js exposes every export of a `"use server"` module as a POST
  endpoint whether or not the UI calls it. A helper exported from an actions file "because another
  action uses it" is an ungated endpoint. Shared primitives live in a plain module with
  `import "server-only"`; only gated entry points are exported from `"use server"` files.
- **Order matters.** `requireUserContext()` → `userCan` → Zod parse → `getServiceClient()`. A gate
  placed after the first query, inside one branch, or only in the hook/component is no gate.
- **The permission must match the operation.** `:read` for reads; the write/cancel/approve/issue
  permission for mutations. A mutation gated by the resource's `:read` permission is a privilege
  escalation for every role that reads it. A multi-resource action (a receipt that also creates
  transactions and a journal entry) checks the permission for the operation the user initiated —
  and must not be reachable by a role that holds none of them.
- **`userCan` on the server, not just the UI.** Hiding a button with `userCan` in a component is UX;
  the server check is the boundary.
- **Route handlers** (`app/api/**/route.ts` — PDFs, export, AI chat) follow the same sequence and
  return 401/403 before touching data. `app/api/inngest/route.ts` is protected by Inngest's signing
  key (`INNGEST_SIGNING_KEY` in production); never add a path that runs a function with a payload a
  user chose.
- **Self-scoped rows** filter by `ctx.userId` in the action as well as in RLS.
- **Every identifier the path accepts** (parameters, body fields, search params, headers, cookies,
  callback params, stored id arrays, the acting-user cookie):
  1. **Name its source.** If the caller can write that source, the identifier is spoofable —
     `user_metadata`, a hidden form field, a `userId` in the payload, free-text email.
  2. **Point to the line that binds it** to the caller: identity from `requireUserContext()`, never
     from the input; a self-scoped id filtered by `ctx.userId` in the same query.
  3. **Re-resolve on write** any id picked from a scoped list (a picker, a search result), and clamp
     caller-supplied lists (entity types, channel ids, role lists) to the set the caller's `Access`
     allows — dedupe them, never trust them to be a subset.
- **When an access path is REPLACED** (an RPC swapped for a direct read, a new join or embed, a new
  visibility helper, a role-array → matrix-helper swap), diff the visible set **per role** before and
  after. A wider set leaks; a narrower one returns a silent empty that reads as "no data". When a
  change alters scope (a role relaxation, a new deny reach), list the dependents that must follow:
  child rows, storage objects, cached lists, notification recipients, AI tool lists.
- **The service-role key is server-only**: `SUPABASE_SERVICE_ROLE_KEY` is never `NEXT_PUBLIC_`, and
  `lib/supabase/service.ts` is never reachable from a client component.

## Law 2 — RLS-in-the-same-migration

> **Attack question:** if a user opened the browser console and called PostgREST directly with their
> own JWT, what could they read or write on this table?

- `alter table ... enable row level security` + policies in the **same** migration that creates the
  table. A follow-up migration "adding RLS later" leaves a window where the table is open to every
  authenticated user (and, with Supabase's default grants, to `anon`).
- Policies are `to authenticated`, never `to public`/`anon`.
- **UPDATE with no `WITH CHECK`** silently reuses USING. Every write policy states WITH CHECK
  explicitly.
- **Wrap the helpers**: `(select public.user_has_role(array[...]))`, `(select auth.uid())`. A bare
  call in a NEW policy is a defect (per-row evaluation on large tables — see the perf lens).
- **RLS enabled with no policy** = closed to everyone but the service role. Acceptable when every
  access is via a gated action; say so in the migration comment.
- **Append-only tables** (`audit_events`, `ai_usage`): no UPDATE/DELETE grant or policy. A
  role-gated SELECT for `audit:read` holders only.
- **Realtime** (`alter publication supabase_realtime add table ...`) delivers exactly what the SELECT
  policy allows to each subscriber — a loose SELECT policy leaks over the socket too.
- **Storage** bucket policies on `storage.objects` gate by role (and by `<user_id>/` path prefix for
  personal objects such as avatars).

## Law 3 — Definer-and-grants

> **Attack question:** who can execute this function, and what does it trust?

- Every `SECURITY DEFINER` function has `SET search_path` (prefer `''` with fully qualified names;
  `public` only when nothing it calls lives in `extensions`, e.g. `gen_random_bytes`).
- It checks the caller's role **inside** (`if not public.user_has_role(array[...]) then raise
  exception ...`) unless it is only ever executed by `service_role` — in which case it is granted to
  nobody else. It never authorizes from a `p_user_id` / `p_role` parameter; derive from
  `(select auth.uid())`.
- **Function ACLs in both directions.** Final ACL = Supabase's default privileges (an *explicit*
  EXECUTE for `anon` and `authenticated`) − REVOKEs that name roles + GRANTs. Then grep the expected
  callers — TS `.rpc(` calls, SQL views/functions/triggers that call it, Inngest functions, `docs/`
  runbooks. **A role in the ACL but not among the callers is an over-grant. A caller without EXECUTE
  on the whole chain is an under-grant** (an `authenticated` RPC whose INVOKER body calls a function
  revoked from `authenticated`); both are findings, and under-grants stay invisible until production.
- **A new `SECURITY DEFINER` function carries `revoke all on function … from public, anon,
  authenticated` in the SAME migration file** (then the minimal grant). `scripts/check-migrations.sh`
  (`pnpm check:migrations`) enforces it statically for added migrations, including `alter function …
  security definer`.
- **A DEFINER's precondition lives in SQL**, not only in its intended caller: a service-role-only
  writer that trusts `p_actor` / role-list parameters says so in a one-line comment and is granted
  to `service_role` alone.
- **`CREATE OR REPLACE` silently drops `proconfig`.** Re-declaring a function without its existing
  `SET search_path` reverts it. Check `select proconfig from pg_proc where proname = '<f>'` first.
- **`REVOKE ... FROM PUBLIC` is not enough on Supabase.** The platform's default privileges grant
  every new function in `public` to `anon` and `authenticated` **explicitly**; `FROM PUBLIC` removes
  only the implicit entry. Revoke from the roles by name, then grant back what is needed:

  ```sql
  revoke all on function public.f(uuid, date) from public, anon, authenticated;
  grant execute on function public.f(uuid, date) to authenticated;   -- only if the UI calls it as an RPC
  ```

  Most existing migrations revoke `from public` only — pre-existing, raise it; new functions name the
  roles. A changed signature is a NEW object with fresh default grants: re-revoke.
- **Tables**: never `grant ... to anon`. A DEFINER function that returns identifiers to any caller
  without a role check is an enumeration oracle.

## Law 4 — Matrix-is-the-source

> **Attack question:** which roles can do this — and does every layer agree?

- A new capability = a new (or an existing, reused) permission in `PERMISSIONS`, granted in
  `ROLE_PERMISSIONS`, and covered by `lib/auth/permissions.test.ts` — the test enforces that every
  permission has a holder, no unknown permission exists, `owner`/`admin` hold everything, and the
  role-specific expectations. Coverage of the matrix is 100%: add the assertion for the new
  permission's intended holders and non-holders.
- The policy's role array and the matrix's holders of the permission agree. Drift in either
  direction is a defect: RLS wider than the matrix makes the browser a bypass; RLS narrower breaks
  the user-scoped paths.
- Role assignment goes through `assignableRoles` / `removableRoles` (admins cannot add or remove
  `owner`); `user_roles` and `user_permission_denies` are writable only through the gated access
  action and its atomic writer.
- No ad-hoc `ctx.access.roles.includes("finance")` gates — ask `userCan` for a permission. The one
  house exception is an explicitly owner-only operation (client/supplier opening balances), which
  checks `ctx.access.roles.includes("owner")` by design (owner is deny-immune). Any other role
  literal sits beside a `userCan`.
- Role-level questions (recipients, "por rol" UI) go through `roleGrants` / `rolePermissions`, never
  a hand-copied role array.

## Law 5 — AI-and-jobs-go-through-the-gate

> **Attack question:** can the assistant, a scanned document, or a background job do something the
> user could not do by hand?

- **AI tools** (`features/ai/registry/`, one `defineAiAction` per action in `actions/`, listed in `catalog.ts`) wrap existing READ actions so the
  agent inherits each action's `userCan` gate and its column selection. A tool that calls
  `getServiceClient()` itself, accepts a user id / role / channel override from the MODEL's
  arguments, or performs a write is an authorization bypass with a natural-language front door.
  Model arguments are untrusted input — validate them with the action's Zod schema.
- **Document Intelligence** (scan → extract → confirm): extraction output is untrusted; it is
  persisted as a draft, and the business write (purchase invoice, expense) happens only when the
  user confirms through a gated action.
- **Inngest functions** run as service role with no session. They are triggered by events sent only
  from gated actions (or by cron); the event carries the acting user's id for `logAudit`; they never
  do more than the triggering action authorized (e.g. `issue-invoice` issues the invoice the action
  created, nothing else). A job acting FOR a user (an AI workflow run, a headless agent) loads that
  user's `Access` (roles + denies) and gates each step with `userCan`; a cron that notifies users
  picks recipients by permission (matrix + deny loader + `userCan`), never a hand-copied role list.
- **Audit**: sensitive mutations (invoice issue/cancel, payments, role changes, period close) call
  `logAudit()`.
- **Verified-to-fail.** A security test never observed to fail proves nothing. Every fix ships a test
  observed to fail against the pre-fix state AND asserting the legitimate role still succeeds: an
  action-level Vitest test with a role lacking the permission — and, for deny reach, a role holding
  it with that permission denied via `resolveAccess` — (expects the denial, and no service call),
  the matrix test, and a pgTAP test in `supabase/tests/` run with
  `supabase test db` (only against an already-running local stack). Matcher discriminator: a USING
  violation filters silently (0 rows), a WITH CHECK violation raises `42501`.

## Law 6 — Secrets-and-egress

> **Attack question:** what can flow into each new sink, and what can a PR author make CI run with
> a secret in scope?

- **Egress.** For every new sink — a `logger.*` / `captureException` context, an HTTP error body
  returned to the client, an AI prompt or tool result, an email/push payload, an export, a committed
  file, an outbound URL — ask what can flow into it. Whole objects (`error`, `req`, a provider
  response, `{...invoice}`) carry everything. Committed fixtures and seeds carry no real CUIT, email
  or name; git history is permanent. (Signal hygiene itself is the telemetry lens's; this law owns
  the authorization question "who can now read this value".)
- **CI.** When `.github/workflows/**`, `.github/scripts/**` or `pnpm-lock.yaml` change:
  - no secret is in scope of a step that runs PR-controlled code (scripts, `pnpm install` lifecycle
    scripts, tests) on a `pull_request` trigger;
  - no PR-author-controlled value (`github.event.*`, `github.head_ref`, `inputs.*`) is pasted into
    `run:` through `${{ }}` — pass it through `env:` and quote it;
  - no `pull_request` job holds write permissions; production jobs stay behind the environment gate;
  - every third-party action is pinned by full commit SHA with a version comment, as the workflows
    already are;
  - the lockfile diff touches only the intended packages.

## Postgres facts that bite here

- **Partitions don't inherit RLS.** `relrowsecurity` is per table: each partition (`PARTITION OF`)
  needs its own `enable row level security` + policies, and a REVOKE on the parent doesn't reach a
  leaf's grants.
- **A column-level REVOKE does not subtract from a table-level GRANT.** Hiding a column means revoking
  the table privilege and granting the other columns explicitly.
- **FK actions run outside the caller's RLS.** `ON DELETE CASCADE` / `SET NULL` delete or rewrite
  child rows the caller could not touch directly, and a RESTRICTIVE policy does not block them.
- **`TRUNCATE` ignores RLS.** A `TRUNCATE` grant to `authenticated` empties the table whatever the
  policies say; never grant it.

---

## Severity

**HARD blockers** (any one = the change does not merge): a `"use server"` export or route handler
that reaches `getServiceClient()` without `requireUserContext()` + the matching `userCan`; a mutation
gated by a `:read` permission; an exported ungated primitive in a `"use server"` file; a new table
without RLS + policies in its creating migration; an UPDATE policy without `WITH CHECK`; a bare
`user_has_role()` / `auth.uid()` in a new policy; a DEFINER function without `SET search_path` or
without an internal role check (when executable by `authenticated`); a `FROM PUBLIC`-only revoke on a
new function; any grant to `anon`; a self-scoped row read or written without the `ctx.userId` filter;
an AI tool that bypasses an action or takes an identity/role from the model; a permission missing from
the matrix or its test; RLS role lists that drift from the matrix; the service-role key reachable from
the client; a fix shipped without a test observed to fail pre-fix; a user-facing read/write path,
job or fan-out that skips `userCan(access, …)` (deny bypass); an `Access` constructed outside
`resolveAccess`; a non-`owner` role literal gating without a `userCan`; a new DEFINER without the
`public, anon, authenticated` revoke in its file; an over- or under-grant against the real callers;
a spoofable identifier or an unclamped caller-supplied list; an access-path replacement that widens a
role's visible set; a secret in scope of PR-controlled CI code or a PR-controlled `${{ }}` in `run:`;
an unpinned third-party action; a `TRUNCATE` grant to `authenticated`; a new partition without RLS.

**Raise-and-downgradable** (a defect, always reported; drops to a `## Follow-ups` entry only if
pre-existing AND outside this change's reach — state the downgrade, never default to it): existing
unwrapped `user_has_role()` calls; existing `FROM PUBLIC`-only revokes; a broader standing grant the
diff does not touch; an access-path replacement that only NARROWS a visible set (a silent empty) with
a stated reason.

## When this lens fires

CONDITIONAL, unlike the ports/DRY/perf/comment/telemetry lenses. It activates when the diff touches
any of: `supabase/migrations/**`; a `CREATE POLICY` / `GRANT` / `REVOKE` / `SECURITY DEFINER` /
`CREATE OR REPLACE FUNCTION`; a storage bucket or its policies; any use of `getServiceClient()`; a
`"use server"` file; `app/**/route.ts`; a server-component page that reads data; an Inngest
function that acts for a user or notifies users; `features/ai/registry/**` or the agent wiring;
`lib/auth/**`; `.github/workflows/**`, `.github/scripts/**` or `pnpm-lock.yaml`.
It is a **no-op otherwise** — a diff with none of that surface passes this lens clean.

## Coverage table (your proof of work)

```
object (table/function/action/route/job/workflow) | who may (role × verb, deny reach, or callers vs ACL) | identifiers → binding line | bypass boundary (RLS / own gate / signing key) | status
```

## Delivery

When applied via a subagent wave, this lens is delivered as the condensed block at
`.claude/skills/_shared/role-lens/condensed-lens.md` (pasted verbatim per subagent), which carries
the load-proof echo (`role-lens loaded: … | db/authz surface: <list|none>`; missing = NON-CLEAN)
and the per-law verdict contract (six laws). This file is the orchestrator's full reference.

It sharpens the defect catalog's **[authorization / role-gating / IDOR]** class rather than replacing
it: the catalog names the class, this guide carries the attack questions and the shapes.
