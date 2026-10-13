---
name: enforce-ports-and-adapters
description: >-
  The strict enforcement lens for ports-and-adapters / dependency-injection boundaries — shared code
  branching on a concrete implementation, adapter logic leaking outside its adapter, a dependency
  constructed inline instead of injected. Plugs into any review or planning pass. Use for "enforce
  ports and adapters", "check the DI boundary", "no leaking adapters", "is anything branching that
  shouldn't", "can this feature import that action", "does this belong in lib/". In JouveERP it also owns
  the feature-slice import rules (no business-logic action crosses features except
  issueFiscalInvoiceAction; shared logic goes to lib/; AI providers stay behind features/ai/model.ts;
  AFIP behind lib/afip).
---

# Enforce Ports & Adapters — the boundary law

This is a **language guide**, not a workflow. Load it as the lens for a review pass whose
sole job is to prove a change respects ports-and-adapters / dependency injection. The bar
is deliberately unforgiving.

> The port is the boundary _special case_ of a shared interface — the seam where a DRY-extraction lands
> on an architecture boundary. The general "when must I extract a 2nd occurrence" law lives in
> `enforce-clean-code`; this guide owns placement/naming/direction once the seam is a boundary.

## The one law

**Adapter-specific logic lives ONLY inside its adapter, behind the shared contract. Nothing
else in the codebase — end to end — may know which concrete implementation is in play, and
nothing else may branch on it. Everything flows through the port.**

- The **port** is the shared contract (an interface / injected dependency / typed seam).
- An **adapter** is one concrete implementation of that port, injected at call time.
- Consumers (handlers, tests, components, helpers, scripts, seeds — _everything_) talk to
  the **port only**. They receive the adapter by injection and never construct, import, or
  name a concrete one.

## The four co-equal laws

This lens enforces FOUR laws. All four must be CHECKED and REPORTED on every change — a law
you did not mention is UNCHECKED, not passed. They are co-equal in scope; they are severity-
tiered only for what blocks a merge:

1. **No-branch** — nothing outside an adapter branches on the concrete implementation.
2. **Placement** — the thing lives where the sibling slice or seam puts it (Placement law).
3. **Feature-direction** — every first-party import respects the layer map (Repo hierarchy): no business-logic action crosses features (except `issueFiscalInvoiceAction`), `lib/` never imports feature actions.
4. **Contract-vocab** — the core speaks only the contract's words (Naming law).

HARD blockers (any one = the change does not merge): a branch on the concrete impl; adapter-
specific code in shared/consumer code; a dependency constructed inline; reaching past the
port; an import that breaks the layer map (a cross-feature write action, `lib/` → feature action); a **provider/adapter name or coined word
leaked into a core identifier, file, shared type, or comment** (a boundary leak, not cosmetics).

RAISE-and-downgradable (a defect, always reported; may drop to a tracked follow-up only if
pre-existing AND purely cosmetic, stated not defaulted): a **version/lineage marker** in a name
(`v2`/`old`/`legacy`/`base`/`generic`), or an invented parallel term where a house term exists,
when it leaks nothing about a concrete implementation.

When applied via a subagent wave, this lens is delivered as the condensed block at
`.claude/skills/_shared/ports-lens/condensed-lens.md` (pasted per subagent), which carries the
load-proof echo (`ports-lens loaded: … | touched layers: <list|none>`; missing = NON-CLEAN)
and the per-law verdict contract (four verdicts if a port surface is touched, else one
`ports: N/A` line). This file is the orchestrator's full reference; the condensed block is what
reaches each subagent.

## What is FORBIDDEN — remove on sight, do not tolerate

Every violation below must be FIXED in this change. The ONLY thing you may defer is a fix that is
_literally unexpressible_ today (the seam does not yet exist) — and even then you must RAISE it and
list it under the PR body's `## Follow-ups`, never silently tolerate it. "Hard to fix", "out of scope", "the
architecture makes it awkward" are NOT exemptions. A pre-existing violation outside this change's
blast radius is still RAISED + logged as a follow-up; it does not block this PR, but it never
disappears.

1. **A branch on the concrete implementation anywhere outside an adapter.** `if (isKindX)`,
   `provider === "..."`, `flavor === "..."`, a ternary that swaps behavior by variant, a
   `switch` over implementation types in shared code — ALL are defects. The code must NEVER
   EVER branch on which adapter it is. If two implementations differ, that difference is the
   adapter's job to encode behind the port; the consumer sees one uniform contract.
2. **Adapter-specific anything living outside the adapter.** Even the smallest thing — a
   component, an inline expression, a one-line helper, a test seed literal, a fixture tweak,
   a default value chosen for one variant — must not sit in shared/consumer code. If it is
   specific to one implementation, it belongs in that implementation's adapter, full stop.
3. **A dependency constructed inline instead of injected.** `new ConcreteAdapter()` /
   `makeX()` reached for directly by a consumer, a hardcoded singleton, a module-scope
   concrete instance, a direct import of a concrete adapter class where the port should be
   passed in. Inject it; never inline it.
4. **Reaching past the port.** A consumer (especially a test) that hand-rolls storage
   access, raw SQL, private internals, or any side channel the port does not expose — to
   "just get the data" — has broken the boundary. All data enters and leaves through the
   port.
5. **A comment that references what its file must know nothing of.** In-line comments obey
   the same law as code: a shared/consumer file's comments must not name a concrete adapter,
   describe one variant's private shape, or explain a branch that should not exist. If the
   comment has to mention the implementation, the code is already leaking. Comments stay
   short and stay inside the contract's vocabulary.

## The ONLY sanctioned exception

A genuine, product-level dual/multi contract that the **port itself declares** — i.e. the
output/input shape is legitimately variant because the real product ships it that way, and
the consumer is asserting the port's own declared bifurcated behavior, not smuggling in
implementation knowledge for convenience. This exception is narrow:

- Knowing an **output field is nullable/variant per the contract** = allowed.
- Branching to **fake or reconstruct behavior the port does not actually expose**, or to
  make an assertion merely "pass for both", = FORBIDDEN.

Every use of the exception is on probation and must, in one line, state BOTH: (1) the exact port
field that DECLARES the variance (the contract's own nullable/variant surface), and (2) the death
condition — the event on which it must be deleted (the day the contract unifies). Missing EITHER of
the two = defect, not exception. A variance the port does not itself declare is smuggled
implementation knowledge; treat it as a hard blocker, never as license.

## Placement law — the boundary is physical, not just logical

Correct behavior in the wrong file is still a defect. Where a thing LIVES is part of the
contract. This is as strictly enforced as the no-branching law.

1. **Mirror the nearest existing sibling EXACTLY — never invent a shape.** Before adding a slice,
   a seam or a job, find the sibling already in the repo and copy its skeleton: a feature mirrors
   `features/invoices/` / `features/aging/` (`actions/`, `components/`, `hooks/`, `lib/<f>-keys.ts`,
   flat `schema.ts` + `schema.test.ts`, optional `index.ts`); an external integration mirrors `lib/afip/` (typed results, a
   typed error with a stable `code`, env parsing in its own `env.ts`); a job mirrors an existing
   `lib/inngest/functions/*`. A new folder shape, a novel file name, or a "dumped" file next to
   unrelated code is a defect even if it compiles. The codebase has one house form; grow it, do not
   fork it.
2. **The contract lives at the seam; the implementation stays behind it.** The exported, typed
   surface (builder functions, result types, error class) sits in the seam's module; the provider
   SDK, the SOAP envelope, the HTTP shape live only inside it and never leak up into a feature.
3. **Placement follows dependency direction.** `lib/` is base: shared logic two features need goes
   up into `lib/`, never sideways into one of them. A pure helper (no React, no Supabase) used only
   by one feature lives in that feature's `lib/`. A `"use server"` action lives in the owning
   feature's `actions/` and nowhere else. Code that needs the service-role client is server-only
   (`import "server-only"` where the sibling has it) and never reaches a client component.
4. **Construction lives in one place.** The Supabase clients are built in `lib/supabase/`, the
   Inngest client in `lib/inngest/client.ts`, AI models in `features/ai/model.ts`, AFIP clients in
   `lib/afip/`. A consumer never constructs one inline from `process.env`.

## Naming law — the core speaks only the contract's vocabulary

Names are load-bearing. A leaked word is a leaked boundary.

1. **Mirror the house naming.** Actions are `<verb><Noun>Action` in `<feature>-actions.ts`; hooks
   `use-<noun>.ts`; query keys `<f>Keys` in `<f>-keys.ts`; Inngest functions and their ids in
   kebab-case matching the file. Do not coin a parallel term ("Manager", "Service", "Handler") for
   a role the house already names. Mirror the language COMPLETELY: suffixes, variable names, barrel
   comments.
2. **Consumer code uses ONLY domain words — never a provider's.** Identifiers, variables and
   comments outside a seam read in the business vocabulary (comprobante, CAE, recibo, asiento,
   canal, orden de pago — code identifiers in English, e.g. `invoice`, `receipt`, `journalEntry`).
   A word invented for one provider's flavor must not appear in consumer code, even as a variable
   name or comment aside.
3. **A provider/implementation name appears ONLY inside its seam.** `anthropic`, `gemini`,
   `openai`, `wsfev1`, `wsaa`, `sentry`, `resend`/the mail provider, `inngest` (outside `lib/inngest`
   and the registration route) never appear in a feature identifier, shared type, or shared comment.
   (Real product identifiers the seam itself declares — AFIP code tables, the CAE/CAEA nouns the
   domain uses, model ids exported from `model.ts` for metering — are exempt.)
4. **Name by what a thing IS — no version/lineage markers.** No `v2`/`old`/`new`/`legacy`/
   `next`/`base`/`generic` in identifiers, files, dirs, or comments. Rename on sight.
5. **Concrete implementation named for its provider + domain, in the module's file-casing.** Mirror
   how siblings name theirs (`lib/afip/wsfev1.ts`, `lib/afip/padron.ts`); do not improvise.

## Repo hierarchy, ownership & boundaries (JouveERP — one Next.js app)

JouveERP is a single Next.js 16 app, not a monorepo: the boundaries are directories, not packages,
and **nothing machine-enforces them** (ESLint carries no import-boundary rule) — this lens and review
are the guard. Use this map verbatim; do NOT invent a cleaner-but-false one.

### The layer map (allowed directions)

```
base:      lib/**                    shared infra + pure helpers (auth, supabase, query, afip, inngest,
                                     pdf, email, files, logger, observability, format, scope)
           components/ui/**, hooks/** design system + generic hooks
feature:   features/<domain>/        actions/ components/ hooks/ lib/ schema.ts schema.test.ts [index.ts]
                                     → may import base; may import ANOTHER feature's types, schemas,
                                       query keys, pickers and read actions (see below)
app:       app/**                    routes (server components that prefetch + Hydrate), route
                                     handlers, app/api/inngest/route.ts (Inngest registration)
                                     → may import features and base; NOTHING imports app/
```

- **`lib/` is base.** It never imports a feature's actions, hooks or components. Type/schema imports
  from features exist today (`lib/afip/codes.ts` → `clients/schema`, `lib/pdf/*` → feature schemas)
  and Inngest functions in `lib/inngest/functions/` call into `features/ai/document` and
  `features/ai/insights`; those are tolerated, pre-existing edges — do not widen them with an action
  or component import.
- **A feature slice is self-contained.** Its business logic (the `"use server"` actions and the pure
  helpers they call) lives inside it. Shared logic two features need goes UP to `lib/`, never
  sideways into another feature.
- **What may cross features** (CLAUDE.md): types, Zod schemas, query keys, pickers
  (`accounts/schema`, `clients/schema`, `invoices/components/client-picker`), and a READ action used
  to feed a picker or hook. `features/ai/tools/` is the sanctioned consumer of read actions: each AI
  tool wraps an existing read action so the agent inherits that action's `userCan` gate.
- **What may NOT cross:** a write / business-logic action. The only documented exception is
  `issueFiscalInvoiceAction` (`features/invoices/actions`), called by `shipments`, `storage-billing`
  and `ai/document`. Pre-existing edges such as `loans` → `createTransactionAction` are follow-ups,
  not precedent.
- **No cycles, ever.** An external SDK (`inngest`, `@ai-sdk/*`, `@react-pdf/renderer`) is an external
  dependency, not an internal edge — but WHERE it is imported is a placement question (below).

### The live seams

- **AI providers — `features/ai/model.ts`.** The only file that imports `@ai-sdk/anthropic`,
  `@ai-sdk/google` or `@ai-sdk/openai`. It exports the model builders (`buildChatModel`,
  `buildTitleModel`, `buildClassifierModel`, `buildExtractionModel`), the model ids and
  `runWithFallback` / `isRetryableModelError`. Consumers (the chat agent, insights, Document
  Intelligence) take a model from a builder and never name a provider, never branch on which one
  served, and never parse a provider-specific error. Usage is metered from `servedModel()` into
  `ai_usage`. Adding a provider or changing the fallback order touches `model.ts` only.
- **AFIP — `lib/afip/`.** WSAA (`wsaa.ts`), WSFEv1 (`wsfev1.ts`), CAEA (`caea.ts`,
  `caea-periods.ts`), padrón (`padron.ts`), codes and QR. SOAP envelopes, certificate handling and
  environment (homologación / producción) are private to it; results come out typed and errors come
  out as `AfipError` with a stable `code` (`lib/afip/errors.ts` — only `TRANSPORT` is retryable).
  Callers match on `code`, never on a SOAP message string. The CAE request runs from the Inngest
  function `lib/inngest/functions/issue-invoice.ts`; a feature never calls WSFEv1 inline.
- **Background jobs — `lib/inngest/`.** One client (`client.ts`), event names + Zod payloads in
  `events.ts`, functions in `functions/`, registered ONLY in `app/api/inngest/route.ts`. Features
  trigger work with `inngest.send({ name, data })` using the exported event constant; they never
  import a function's internals or a step id. Job state that the UI shows lives in a table the UI
  reads (or follows over Supabase Realtime), never by asking the engine.
- **Database access — `lib/supabase/`.** `getServiceClient()` (service role, bypasses RLS — only
  after `requireUserContext()` + `userCan`, see `enforce-role-isolation`), `createClient()` for the
  user-scoped server client, `client.ts` for the browser. A consumer never constructs a Supabase
  client inline from env vars.
- **Observability — `lib/logger.ts` + `lib/observability.ts`.** Server code logs and reports through
  them; nothing else imports `@sentry/nextjs` except the `sentry.*.config.ts` files and
  `instrumentation.ts`.
- **PDF / email — `lib/pdf/`, `lib/email/`.** Templates and renderers live there; features call the
  render/send helpers and never import `@react-pdf/renderer` or the mail client directly.

## How to attack a change with this lens

1. **Grep for the tells.** Provider-package imports outside their seam (`rg -n "@ai-sdk/(anthropic|google|openai)" features lib app`,
   `rg -n "@sentry/nextjs"`, `rg -n "from \"@/lib/afip/(wsfev1|wsaa)\""`); cross-feature action
   imports (`rg -n "from \"@/features/[a-z-]+/actions" features` and compare the importing feature);
   provider/flavor/kind branches in shared code; `!` or an unchecked cast on an injected seam;
   module-scope concrete clients; comments naming a concrete provider outside its seam.
2. **Trace every branch.** For each conditional that varies by provider or environment, ask: could
   the seam absorb this so the consumer stops branching? If yes, it is a defect — the branch must
   move into the seam. Only stop when no consumer branch remains that the seam could absorb.
3. **Check the direction — against the layer map.** Does a new import point from `lib/` into a
   feature's actions or components? From one feature into another feature's write action (other
   than `issueFiscalInvoiceAction`)? Into `app/`? Each is a violation.
4. **Read the comments as code.** Flag any comment that leaks implementation vocabulary into a file
   that should be implementation-blind.
5. **Check placement against the sibling.** Locate the nearest existing slice or seam (for a new
   feature: `features/invoices/`, `features/aging/`; for a new job: an existing
   `lib/inngest/functions/*`; for a new external integration: `lib/afip/`). Does the new code sit
   where the sibling puts it? A mismatch is a defect.
6. **Grep shared code for leaked vocabulary.** Search `lib/` and the consumer side for every
   provider name; any hit outside its seam in an identifier, file name, or comment is a defect.

## Verdict language (use verbatim in review output)

- "Defect — adapter-specific logic in consumer code; move behind the seam."
- "Defect — branches on the concrete provider; the seam must absorb this."
- "Defect — dependency constructed inline; use the seam's builder/client instead."
- "Defect — reaches past the seam; route through its exported contract."
- "Defect — comment references implementation the file must be blind to; remove/rewrite."
- "Defect — wrong placement; does not sit where the sibling slice/seam puts it."
- "Defect — business-logic action imported across features; move the shared logic to `lib/`."
- "Defect — `lib/` imports a feature's actions/components; base must not know features."
- "Defect — AI provider package imported outside `features/ai/model.ts`."
- "Defect — WSFEv1/WSAA called outside the invoice-issuing path; go through the Inngest event."
- "Defect — Inngest function not registered in `app/api/inngest/route.ts`, or a feature reaching into a function's internals."
- "Defect — caller matches an AFIP/provider message string instead of a typed error code."
- "Defect — invented parallel vocabulary; mirror the house naming."
- "Defect — concrete/provider name (or coined word) leaked into implementation-blind code."
- "Defect — version/lineage marker in a name; rename by what it is."
- "Sanctioned exception — `issueFiscalInvoiceAction` (documented) / seam-declared variant; justified, dies on unification."

A change is clean under this lens ONLY when zero defects remain and every exception is a
one-line-justified, documented or seam-declared variant. Nothing less passes.
