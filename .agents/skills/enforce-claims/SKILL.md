---
name: enforce-claims
description: >-
  The claims lens: every sentence and test that asserts something about the code is checked against
  the code. Sources: the PR body (`## Resumen`, `## Follow-ups`), docs (`docs/`, the HTML user
  manual), skills and `.agents/skills/_shared/` lenses, `CLAUDE.md` / `AGENTS.md`, comments, Spanish (Argentina)
  UI copy, AI system prompts and chat skills, AI CFO tool descriptions and `.describe()` strings in
  `features/ai/registry/`, and tests (which claim "this regression would fail"). It builds a claim
  ledger with evidence, sweeps for text whose subject the diff changed, checks prompt contracts
  against the receiving agent's real tools, and mutates each new Vitest/pgTAP/Playwright test by
  reading. Use for "does the PR body match the diff", "stale docs", "is this prompt still true",
  "is this toast true", "can this test fail", "overclaim", and as an adv-review seat.
---

# Claims — text and tests are held to what the code does

**The law: a claim is a contract. Every assertion about the code, in prose or in a test, holds
against the code at the head, is scoped to where it holds, or is removed.**

**Delivery.** This lens is Read-delivered, not pasted: `/adv-review`'s routing table names this
file, and the seat assigned to it Reads this `SKILL.md` in full and emits the coverage table below.
Invoked directly (`/enforce-claims`), run it over `git diff origin/main...HEAD` plus the PR body,
fix every false or overbroad claim in this change, and list any downgraded item under the PR's
`## Follow-ups`.

**Ownership.** Whether a comment is worth keeping at all is `enforce-comment-value`'s; whether every
peer learned a change is `enforce-reach`'s. This lens owns whether what the text says is *true*.

## 1. Claim ledger

1. **Collect the claim sources**:
   - the PR title and body (`.github/pull_request_template.md` sections, `## Resumen` first, plus
     `## Follow-ups`) and commit messages;
   - every changed hunk in `docs/` (including `docs/manual/`), `.agents/skills/` (SKILL.md files
     and `.agents/skills/_shared/` lenses), `CLAUDE.md`, `AGENTS.md`, `README.md` and `.cursor/rules/`;
   - every added or changed comment and JSDoc, Zod `.describe()` and error message, AI tool
     `description` (`features/ai/registry/actions/`), system prompt text (`features/ai/agent.ts`,
     `features/ai/headless.ts`), chat skill `content` (`features/ai/skills/registry.ts`), toast,
     label, empty state, confirm dialog and the Spanish `error` of an `ActionResult`;
   - text whose *subject* the diff changed (§2).
2. **Split each source into atomic claims and type each one.** The type decides the check:
   - **exists** (a path, section, skill, command, `package.json` script, flag, migration, function,
     cron, Inngest function, permission or AI tool): `git ls-files` or `git grep` at the head. One
     hit, or it is a finding. Backticked paths in skills are also gated by
     `.github/scripts/check-skill-refs.py`; the gate checks existence, not truth.
   - **behaves** ("includes", "excludes", "rounds", "defaults to", "retries", "is owner-only", "runs
     daily at 08:00"): open the implementing code and list every parameter, flag, channel
     (`lib/channels.ts`), currency, voucher kind (factura/NC/ND), emission path (CAE/CAEA/internal)
     or role that changes that behaviour. The claim holds on each, or it is scoped.
   - **can** ("the assistant can register a cobro", "finance can cancel a receipt", "re-run the cron
     to recover"): resolve the tool in *that* agent's registry (`AI_ACTIONS` in
     `features/ai/registry/catalog.ts`, filtered by `permission` and `sideEffect`) and read its
     input schema and `run`. For a user action, find the route or button and its `userCan` gate in
     `lib/auth/permissions.ts`.
   - **operational** (lock duration, timeout, `retries`, `maxDuration`, deploy order, migration
     approval, backup retention, data flow to AFIP or an AI provider): read the config, workflow or
     provider doc that governs it (`.github/workflows/`, `app/api/inngest/route.ts`,
     `supabase/config.toml`). If the repo can't verify it, the text says "unverified" or drops it.
   - **state** (a count such as "N permisos" or "N Inngest functions", a status table, "unreachable",
     "inert until …", "pre-existing"): recompute it now.
3. **Root cause.** When the body names a root cause, find what in the PR observes that mechanism (a
   test that fails without the fix, a log slug), not just the symptom going away.

## 2. Subject-changed sweep

For every value, symbol, permission, role, flag, file name, step id, event name, audit event type,
env var or behaviour the diff changes or removes, grep its name *and* its old literal value across
comments, docs, `docs/manual/`, skills, `.agents/skills/_shared/` lenses, prompts, chat skills, tool descriptions,
UI copy and tests, including outside the diff. Every hit that still states the old fact is a
finding. A Spanish term (comprobante, recibo, orden de pago, asiento) is swept in both its UI form
and its identifier form.

## 3. Prompt contract (model-facing text)

Model-facing text: the chat system prompt and `HEADLESS_*` prompts, chat skills, AI tool
descriptions and `.describe()` strings, tool-result `summary` prose (`features/ai/registry/result.ts`),
extraction prompts (`features/ai/document/`), and the skills and lenses in `.agents/skills/` (their
receiver is a coding agent). For every change to it:
1. **Identify every agent that receives the text.** A tool description reaches the chat agent and
   every headless run that exposes the tool (weekly summary, workflows, analyst); a `.agents/skills/_shared/` lens
   reaches every skill that pastes it.
2. **Every tool or flag the text names** resolves in *that* agent's registered tools and input
   schema: name, defaults, required fields, the permission that exposes it, and whether it is
   `read`, `propose` or `execute`. A prompt that tells a headless run to propose a change is false
   when headless runs get read actions only.
3. **Sibling sources.** Grep the topic across the system prompt, chat skills, tool descriptions,
   `.describe()` strings and result summaries. Reconcile contradictions in the same PR (confirm
   them first; see Verify before raising).
4. **Render each interpolated string** once per value of each parameter (each role list, each
   currency, empty and capped results), and read the real sentence.
5. **User or document text inside a prompt** is fenced as untrusted with `wrapUntrusted` /
   `neutralizePromptText` (`features/ai/lib/prompt-text.ts`). Examples never use real CUITs, names
   or amounts.
6. **A model swap** (in `features/ai/model.ts`) lists every option each caller sends on that chain
   (forced tool choice, temperature, structured output, cache breakpoints) and checks it against
   the new model's documented constraints. A `catch` that swallows the 400 hides the break; the
   routing evals (`features/ai/evals/`) are the regression net.
7. **Cost.** For always-on prompt text or a new tool, state what it adds to every turn and what new
   decision the agent must now make. Ask whether a narrower prompt, a keyword-gated chat skill, or an
   existing tool's output covers it.
8. **Skill and agent docs.** Every step's tool is allowed for that agent (read-only seats cannot
   write). Every absolute ("never", "always", "read-only", "draft only") holds in every mode and for
   every calling skill. Every numeric floor is re-derived. Every cross-reference resolves. The
   description promises nothing the body forbids.

## 4. User-facing copy (Spanish, Argentina)

For each user-facing string the diff adds or changes:
1. Find the condition that routes to it, including `else` and default edges and generic catch-alls
   (`"No se pudo guardar"` returned for every failure, including a permission denial).
2. Every word is true for every input that reaches it, and any recovery step it names actually
   unblocks each one ("Probá de nuevo en unos minutos" is false for a deterministic AFIP rejection).
3. A string in a shared helper is true for every caller, or takes the subject as a parameter.
4. A renamed term is renamed in UI, toasts, PDFs (`lib/pdf/`), exports, emails, the manual and AI
   prompts alike.
5. Copy speaks the accountant's language (comprobante, CAE, saldo, asiento, cobro, período), not
   implementation ("RPC", "sync", "Inngest", "el provider", "row").
6. House voice: Argentine Spanish with voseo ("Revisá", "Probá"), consistent with nearby copy; the
   fewest words that read as a complete thought. The UI is monochrome, so danger is carried by copy
   and icon: a destructive confirm says what is lost and whether it can be undone.
7. A place the user must go to act (AFIP admin, a period to reopen, a missing exchange rate) is a
   link wherever the surface can render one.

## 5. Tests: mutation by reading

For each test, CI gate, census, ratchet or source pin the diff adds or changes (Vitest
`**/*.test.ts(x)`, `tests/integration/`, Playwright `tests/e2e/`, pgTAP `supabase/tests/`, the
self-tests in `.github/scripts/` and `scripts/*.test.mjs`):
1. **Name the regression it pins** in one line: "if someone removes X, this fails". If none can be
   named, the test pins nothing: raise it, or ask for it to be deleted.
2. **Apply that regression in your head and trace it to the assertion.**
   - **Does the fixture reach the changed line?** Check arity, argument order, discriminants, literal
     codes against the production constant (`AfipErrorCode`, `lib/db/pg-error-codes.ts`, a
     permission string), every precondition, and anything that intercepts first (an RLS SELECT
     policy on a `WHERE`-qualified UPDATE, a `userCan` mock that returns `true` for everything, a
     helper that raises the same SQLSTATE for every role).
   - **Does the double enforce what the regression removes?** A supabase-js fake that discards
     chained `.eq`/`.in` arguments, or a `vi.mock` that answers any call to the table, can't fail.
   - **Does the asserted value change?** Reject comparing a value with itself, two in-file literals,
     substrings the code writes unconditionally, presence instead of value, and `<=` ratchets.
3. **Recompute expected values** from the constants they depend on (IVA rates, `round2`, AFIP
   codes, cutoffs).
4. **Text-scanning gates.** Write 4–6 realistic forms of the pattern (multiline, aliased,
   commented-out, quoted, another extension); check each is caught, and that empty input fails.
5. **Name pins resolve at the head.** A NULL from `has_function_privilege` on a stale signature, an
   ENOENT, an `undefined` import or a zero-match regex is a silent pass.

Vitest isolates module state per test file by default (`vitest.config.ts` does not turn isolation
off), but state leaks between cases in one file: module-level caches, warn-once flags and
`vi.mock` factories persist unless reset. `vi.mock` is hoisted above imports.

## Coverage table (proof of work)

```
claim or test | source file:line | type | evidence (file:line or command) | holds / scoped / false
```

A ledger without an evidence column has not run.

## Verify before raising

- **A contradiction** between prompt or doc rules: first read every block the agent or reader
  receives. An explicit exception in the assembled text is not a contradiction.
- **"The model will prefer X"** is not a defect without an eval or a transcript; without one, it is
  at most a request for a case in `features/ai/evals/`.
- **A doc claim**: confirm the doc names the item or mechanism you are checking it against.
  `docs/roadmap.md` is known stale (`CLAUDE.md` says so); a stale roadmap line is a finding only if
  the diff touches it or relies on it.
