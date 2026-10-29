---
name: verify
description: >-
  JouveERP verify recipe — drive a change at a real local surface (Next dev server, local Supabase,
  Inngest dev server, Playwright) instead of trusting a green typecheck. Covers seeding a user,
  signing in as a role that lacks the permission, probing PostgREST under that user's JWT, checking
  per-user denies through the app, sending an Inngest event, and `pnpm test:e2e`. Use for "verify
  this works", "prove it in the app", "check a finance user can't do this", "run it locally", and
  from /auto-implement's verify step. Local stack only — never production.
---

# Verifying a change locally

**Rails.** Local stack only: never point anything at the production Supabase project, Vercel, or
AFIP producción; never run `supabase db push`/`link` (blocked by `.claude/settings.json`). Agents
cannot read `.env*` — take local keys from `supabase status -o env`. **Cap: 3 attempts** per
verification; after the third failure stop and report what you saw. When a stack piece or a
credential is missing (Docker image cannot pull, no AFIP homologación cert, no AI key), record
`AWAITING-HUMAN: <what is missing> — <the exact command a human runs>` and move on; never fake a pass.

> Recipe not executed in the authoring environment (no PostgREST/Kong image there) — treat the
> commands as the intended shape and fix them in place if one drifts.

## 1. Bring the stack up

```bash
supabase start                 # local Postgres :54322, API :54321, Studio :54323
pnpm seed:dev                  # tomas@jouve.test / Test1234! with the OWNER role (pnpm seed:all adds demo data)
pnpm dev                       # Next on :3000
pnpm dev:inngest               # Inngest dev server; UI on :8288 (only if the change touches lib/inngest/)
```

`pnpm dev:up` runs the last three together.

## 2. A user with a lesser role

`pnpm seed:dev` and `pnpm seed:all` only create `tomas@jouve.test` as **owner** — an owner passes
every gate and is deny-immune, so it proves nothing about authorization. Create a second user and
swap its role (local DB only):

```bash
pnpm seed:dev finance@jouve.test Test1234!     # creates it as owner
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -c "
  delete from public.user_roles where user_id = (select id from auth.users where email = 'finance@jouve.test');
  insert into public.user_roles (user_id, role_id)
    select id, 'finance' from auth.users where email = 'finance@jouve.test';"
```

Pick the role from `lib/auth/permissions.ts` that LACKS the permission under test (`finance`,
`operations`, `warehouse`, `driver`).

## 3. PostgREST probe = the role ceiling only

```bash
eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY)=')"
TOKEN=$(curl -s "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"email":"finance@jouve.test","password":"Test1234!"}' | jq -r .access_token)
curl -s "$API_URL/rest/v1/<table>?select=id&limit=5" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "$API_URL/rest/v1/rpc/<fn>" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{...}'
```

This shows what RLS and grants allow for the user's **roles**. Per-user denies are enforced at the
application gate (`userCan(ctx.access, …)`), not in the database — a PostgREST read that succeeds for
a denied user is EXPECTED and is not a "deny not enforced" finding.

## 4. App probe = roles and per-user denies

Server actions only run inside Next. Sign in at `http://localhost:3000/auth/login` as the lesser
user (or add a deny for that user from the owner's Usuarios → acceso dialog) and drive the page or
action under test: the expected result is the module hidden and the action returning
`{ ok: false }` with the Spanish permission message — never a 500 or the data. Check the AI CFO path
too: ask the chat to run the same operation; the tool must refuse the same way.

## 5. Background jobs

With `pnpm dev:inngest` running, send the event the change consumes (names and payload schemas in
`lib/inngest/events.ts`; the dev server accepts any event key):

```bash
curl -s -X POST http://127.0.0.1:8288/e/dev -H "Content-Type: application/json" \
  -d '{"name":"<event/name>","data":{...}}'
```

Then read the run in the Inngest UI (:8288): steps, retries, output. A function missing from the UI
is not registered in `app/api/inngest/route.ts`. AFIP issuance runs against homologación only; with
no homologación cert record AWAITING-HUMAN.

## 6. End-to-end

```bash
pnpm test:e2e                                   # whole suite, needs §1 running (playwright.config.ts does not start the server)
pnpm test:e2e tests/e2e/<feature>.spec.ts
E2E_USER_EMAIL=finance@jouve.test E2E_USER_PASSWORD=Test1234! pnpm test:e2e tests/e2e/<feature>.spec.ts
```

`tests/e2e/auth.setup.ts` signs in with `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` (default the seeded
owner), so the last form runs the suite as the lesser role. New specs: `/create-e2e-test`.

## Report

One line per check: surface, user/role, command, observed result, PASS | FAIL | AWAITING-HUMAN.
