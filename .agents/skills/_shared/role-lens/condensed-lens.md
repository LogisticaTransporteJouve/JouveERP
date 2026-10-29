# Condensed role-isolation lens (paste verbatim per subagent)

This is the block review/planning skills paste into every subagent prompt (a "see the skill"
reference is inert; subagents inherit only their prompt). The fat `enforce-role-isolation/SKILL.md`
(the house-form migration and action, full severity table) is the orchestrator's Read. Unlike the
other lenses this one is CONDITIONAL — a no-op on a diff with no DB or authz surface.

```
=== ROLE-ISOLATION LENS (attack every DB/authz change for a path around the role gate) ===
On its own `role-lens loaded:`-prefixed line in the load-proof HEADER BLOCK (header order: catalog,
ports-lens, dry-lens, perf-lens, comment-lens, telemetry-lens, role-lens; the tripwire keys on the
PREFIX, not on line position), or this wave is NON-CLEAN and re-run:
  role-lens loaded: holding a session is not holding the permission | db/authz surface: <list | "none — no policy/grant/DEFINER/service-client/use-server/route/tool/permission change in diff">
("none" is a CLEAN pass — this lens is CONDITIONAL and a diff with no DB/authz surface is never
penalised for it. A missing/garbled role-lens line = NON-CLEAN. A wrongful "none" on a diff that DOES
touch a migration, a policy/grant, a DEFINER function, a storage bucket, `getServiceClient()`, a
`"use server"` file, a route handler, an AI tool, `lib/auth/**`, a workflow or the lockfile is a
first-class DEFECT.)

FIRES ON: supabase/migrations/**; CREATE POLICY | GRANT | REVOKE | SECURITY DEFINER | CREATE OR REPLACE
FUNCTION; a storage bucket or its policies; any call to `getServiceClient()` (lib/supabase/service.ts —
service role, BYPASSES RLS); any `"use server"` file (features/*/actions/**); app/**/route.ts (incl.
app/api/inngest, app/api/ai/chat, app/api/export, the PDF routes); a data-reading server page; an
Inngest function acting for or notifying users; an AI tool (features/ai/registry/**) or agent/skill
wiring; lib/auth/** (permissions matrix, context, denies); .github/workflows/**, .github/scripts/**,
pnpm-lock.yaml. Nothing in that list touched → N/A.

MODEL: single company, single tenant (one `business_units` row, `dz_sons`) — NO per-user ownership of
business data. Access is ROLE-based: roles `owner, admin, finance, operations, warehouse, driver`
(table `user_roles`), permissions `<resource>:<verb>` in `lib/auth/permissions.ts` (`PERMISSIONS` +
`ROLE_PERMISSIONS`, covered 100% by `lib/auth/permissions.test.ts`), MINUS per-user denies the owner
sets (`user_permission_denies`). Every server action gates first: `requireUserContext()` →
`userCan(ctx.access, "<perm>")`. Most actions then use the user-scoped `createClient()`, so RLS
ALSO enforces the ROLE CEILING (and policy drift vs the matrix breaks or leaks features); on the
minority that use `getServiceClient()` the gate is the ONLY boundary.
ACCESS MODEL (rule in CLAUDE.md): `ctx.access` is a branded `Access` (roles + denied) built ONLY by
`resolveAccess` in lib/auth/ (denies from the one loader lib/auth/denies.ts); `as Access` /
`satisfies Access` / a literal elsewhere forges permissions (eslint.fences.mjs bans it). `userCan` =
role grants it AND not denied; a `<resource>:read` deny implies every `<resource>:*`; owner is
deny-immune. DENIES ARE APP-LEVEL — RLS and DEFINER role checks read `user_roles` only, so a deny
holds only where an app gate checks it: every action, route, page, AI tool, headless/Inngest job
acting for a user, notification/summary fan-out, and search scope. A user-facing path without
`userCan(access, …)` is a deny bypass even when RLS admits the role. Role-level questions
(recipients, "por rol" UI) use `roleGrants`/`rolePermissions` (lib/auth/**, features/admin-users/**
only), never a hand-copied role array. A gate tests a role literal only for "owner"
(`ctx.access.roles.includes("owner")`); any other role literal sits next to a `userCan`. Role
assignment uses `assignableRoles`/`removableRoles` and the one atomic DEFINER writer. RLS
also guards Realtime, Storage and direct PostgREST: every table has RLS in its creating migration, policies gate on
`(select public.user_has_role(array[...]))`. A few rows ARE self-scoped and pin to the session:
`user_profiles`, `push_subscriptions`, `dashboard_layouts`, `notifications`, the AI assistant's
`ai_chat_sessions`/`ai_chat_messages`, team-chat rows scoped by `chat_channel_members`, and the
driver's own trips (`drivers.user_id`).

THE ONE LAW: every path that reads or writes business data must check the caller's ROLE PERMISSION
for that exact operation before it touches the data, and every path that bypasses RLS carries that
check itself. Being logged in is not authorization; a role id, user id or permission the caller
supplied is not authorization.
(FUNDAMENTALS are NOT restated — `.agents/skills/supabase-postgres-best-practices/references/`:
security-rls-{basics,performance}.md, security-privileges.md, schema-constraints.md. This lens is the
adversarial half: the shapes that SATISFY those references and are still exploitable.)

THE SIX CO-EQUAL LAWS — check and REPORT each (an unstated law is UNCHECKED, not passed):
1. ACTION-GATES-BEFORE-BYPASS — every export of a `"use server"` file is an independently invokable
   network endpoint. Each one calls `requireUserContext()` and `userCan(ctx.access, "<perm>")` BEFORE
   `getServiceClient()`, with the permission that matches the OPERATION (a write/cancel/approve uses
   `:write`/`:cancel`/…, never the `:read` one; issuing a fiscal invoice is not `invoices:read`).
   A helper that takes ids and writes through the service client belongs in a plain module with
   `import "server-only"`, never as an export of a `"use server"` file. Route handlers follow the
   same order (the PDF/export/chat routes); `app/api/inngest` relies on Inngest's signing key and is
   never called with user-chosen payloads. Self-scoped rows (profile, push subscription, dashboard
   layout, notifications, AI chat sessions, team-chat membership, driver's trips) also filter by `ctx.userId` — an id from the client is
   data, never proof of ownership.
   IDENTIFIERS: for every id the path accepts (param, body, search param, header, cookie, stored id
   array, acting-user cookie) NAME ITS SOURCE (caller-writable — user_metadata, a payload `userId`,
   free-text email — = spoofable) and POINT TO THE LINE binding it to the caller (identity from
   `requireUserContext()`, never input). Re-resolve on write any id picked from a scoped list; clamp
   and dedupe caller-supplied lists (entity types, channel ids, roles) to what the caller's Access allows.
   REPLACED ACCESS PATH (RPC → direct read, new join/embed, visibility helper, role array → matrix
   helper): diff the visible set PER ROLE before/after — wider leaks, narrower is a silent empty.
2. RLS-IN-THE-SAME-MIGRATION — every new table: `enable row level security` + policies in the
   migration that creates it. Policies gate on `(select public.user_has_role(array['owner','admin',…]))`
   — wrapped in `select` (initplan, once per statement); the role list mirrors the matrix's holders of
   the matching permission. Write policies carry an explicit `WITH CHECK` (an UPDATE without one
   silently reuses USING). Self-scoped tables pin `user_id = (select auth.uid())` in USING AND
   WITH CHECK. A table with RLS enabled and no policy is closed — fine only if every access is via the
   service client after a `userCan` gate; say so. Append-only tables (`audit_events`, `ai_usage`) get
   no UPDATE/DELETE grant or policy.
3. DEFINER-AND-GRANTS — a SECURITY DEFINER function: `SET search_path` (prefer `''` with qualified
   names; `public` only when nothing it calls lives in `extensions`), checks the caller's role INSIDE
   (`public.user_has_role(...)` / `auth.uid()`), never trusts a `p_user_id`/`p_role` parameter.
   `CREATE OR REPLACE` silently DROPS proconfig — carry `SET search_path` forward. ⚠️ `REVOKE ... FROM
   PUBLIC` alone is a NO-OP on Supabase (default privileges grant every new public function to anon and
   authenticated EXPLICITLY):
     REVOKE ALL ON FUNCTION public.f(...) FROM PUBLIC, anon, authenticated;
   then GRANT EXECUTE only to the role that calls it (`authenticated` for an RPC the UI calls,
   nothing — service_role only — for a function only server code calls). A changed signature is a NEW
   object with fresh default grants. Any grant to `anon` = defect. Realtime delivers what the SELECT
   policy allows; storage bucket policies gate by role (and by path for self-scoped objects).
   A NEW DEFINER carries `revoke all on function … from public, anon, authenticated` in the SAME file
   (scripts/check-migrations.sh / `pnpm check:migrations` enforces it, incl. `alter function … security
   definer`). ACL BOTH WAYS: final ACL = default explicit EXECUTE to anon+authenticated − named REVOKEs
   + GRANTs; grep the real callers (TS `.rpc(`, SQL views/functions/triggers, Inngest functions). A role
   in the ACL but not a caller = OVER-GRANT; a caller missing EXECUTE on the whole INVOKER chain =
   UNDER-GRANT (invisible until production). Both are findings.
   POSTGRES FACTS: partitions don't inherit RLS (each PARTITION OF needs its own enable + policies; a
   parent REVOKE doesn't reach leaf grants); a column-level REVOKE does not subtract from a table GRANT;
   FK actions (ON DELETE CASCADE/SET NULL) run outside the caller's RLS and a RESTRICTIVE policy does
   not block them; TRUNCATE ignores RLS — never grant it to authenticated.
4. MATRIX-IS-THE-SOURCE — a new permission goes into `PERMISSIONS` + `ROLE_PERMISSIONS` and is covered
   by `lib/auth/permissions.test.ts` (every permission has a holder, no unknown ones, the role-specific
   assertions). The RLS role list for a table and the matrix's holders of its permission agree — a
   policy that lets `operations` write what the matrix gives only to `finance` (or the reverse) is a
   drift defect. Role assignment goes through `assignableRoles`/`removableRoles` (admins never add or
   remove `owner`; an actor never grants a role whose permissions they are denied). No role check by
   string compare scattered in components — UI hides by `userCan(access, …)`, the server enforces.
5. AI-AND-JOBS-GO-THROUGH-THE-GATE — AI tools (`features/ai/registry/`) wrap existing READ actions so
   the agent inherits their `userCan` gate; a tool that queries `getServiceClient()` directly, takes a
   role/user id from the MODEL's arguments, or exposes a write without the action's gate is an
   authorization bypass with a natural-language front door. Document Intelligence writes only after
   the user's explicit confirmation through a gated action. Inngest functions run as service role
   with no session: the event that triggers them is sent only from a gated action, they carry the
   acting user's id from that event (for `logAudit`), and they never widen what the triggering
   action allowed; a job acting FOR a user loads that user's Access (roles + denies) and gates with
   `userCan`; a cron notifying users picks recipients by permission (matrix + deny loader + userCan).
   Sensitive mutations call `logAudit()`.
   VERIFIED-TO-FAIL: every fix ships a test observed to fail pre-fix (an action test with a role that
   lacks the permission — and, for deny reach, one holding it with that permission denied — gets the
   denial; the matrix test; pgTAP in `supabase/tests/`) AND asserts the legitimate role still succeeds.
6. SECRETS-AND-EGRESS — every new sink (logger/captureException context, an error body returned to the
   client, an AI prompt or tool result, email/push payload, export, committed file/fixture, outbound
   URL): what can flow into it? Whole objects (`error`, `req`, a provider response, `{...row}`) carry
   everything; fixtures carry no real CUIT/email/name. CI (.github/workflows/**, .github/scripts/**,
   pnpm-lock.yaml): no secret in scope of a step running PR-controlled code; no PR-controlled
   `${{ github.event.* / github.head_ref / inputs.* }}` inside `run:` (use env:); no `pull_request` job
   with write permissions; third-party actions pinned by full SHA; the lockfile diff touches only the
   intended packages.

SEVERITY: an action/route that reaches `getServiceClient()` without `requireUserContext()` + the
matching `userCan` / a write gated by a `:read` permission / a `"use server"` export of ungated
primitives / a new table without RLS in the same migration / an UPDATE policy without WITH CHECK /
a bare (unwrapped) `user_has_role()`/`auth.uid()` in a NEW policy / a DEFINER without search_path or
without an internal role check / a FROM PUBLIC-only revoke on a NEW function / any anon grant / a
self-scoped row read or written without the `ctx.userId` filter / an AI tool bypassing an action /
a permission missing from the matrix or its test / a service-role key reachable from the client /
a user-facing path or job without `userCan(access, …)` (deny bypass) / an Access built outside
resolveAccess / a non-owner role literal gating without userCan / a new DEFINER without the public,
anon, authenticated revoke in its file / an over- or under-grant / a spoofable id or unclamped list /
a replaced path that widens a role's visible set / a secret in scope of PR-controlled CI code or a
PR-controlled `${{ }}` in run: / an unpinned action / a TRUNCATE grant / a new partition without RLS
= HARD blockers (any one = does not merge). Pre-existing unwrapped `user_has_role()` calls and
FROM-PUBLIC-only revokes the diff does not touch = raise-and-downgradable (list under Follow-ups).

FIX every violation in this change. The only deferrable is a pre-existing one outside this change's
reach — RAISE it and list it under the PR's `## Follow-ups`, never tolerate it silently.

PER-LAW VERDICT: if the change touches any surface in FIRES ON, emit PASS|DEFECT + one line for each of
the six laws. If it touches none, emit exactly:
  role: N/A — no db/authz surface (no migration/policy/grant/DEFINER/bucket, no service client, no "use server" file, no route handler, no AI tool, no permission change, no CI/lockfile change).
=== END ROLE-ISOLATION LENS ===
```
