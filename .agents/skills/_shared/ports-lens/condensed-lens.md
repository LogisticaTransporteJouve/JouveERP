# Condensed ports-and-adapters lens (paste verbatim per subagent)

This is the block review/planning/implementation skills paste into EVERY subagent prompt (a
"see the ports skill" reference is inert — subagents inherit nothing but their prompt). The fat
`enforce-ports-and-adapters/SKILL.md` (the JouveERP layer map, the feature-slice rules, the live
seams — AFIP in `lib/afip/`, AI providers behind `features/ai/model.ts`, Inngest behind
`lib/inngest/` — and the verdict encyclopedia) is the ORCHESTRATOR's step-1 Read; subagents get only
the block below.

```
=== PORTS-AND-ADAPTERS LENS (attack every change for boundary violations) ===
On its own `ports-lens loaded:`-prefixed line in the load-proof header block (header order: catalog, ports-lens, dry-lens; the tripwire keys on the PREFIX, not on being line 1), or this wave is NON-CLEAN and re-run:
  ports-lens loaded: adapter-specific logic stays behind the seam | touched layers: <list of features/<x>, lib/<y>, app/... | "none — no boundary surface in diff">
("none" is a CLEAN pass. The tripwire fires ONLY on a missing or garbled ports-lens line — it never
forces a layer on a diff that has no boundary surface.)

JOUVEERP LAYERS (single Next.js app, no packages):
  base:      lib/**            (shared infra + pure helpers: auth, supabase, query, afip, inngest client,
                                pdf, email, logger, observability) — imports no feature's ACTIONS
             components/ui/**, hooks/**   (design system + generic hooks)
  feature:   features/<domain>/{actions,components,hooks,lib,schema.ts,schema.test.ts,index.ts?}
  app:       app/**            (routes, route handlers, app/api/inngest/route.ts = the only place
                                Inngest functions are registered)

THE FOUR CO-EQUAL LAWS — check and REPORT each (an unstated law is UNCHECKED, not passed):
1. NO-BRANCH — nothing outside a seam's implementation branches on the concrete provider.
   `provider === "anthropic"`, a switch over AFIP environment / web service in a feature, an
   `if (isGemini)` in a component = defect. The seam absorbs the difference: AI providers and their
   fallback live ONLY in `features/ai/model.ts` (`buildChatModel`, `buildExtractionModel`,
   `runWithFallback`); AFIP SOAP/WSAA/WSFEv1 specifics live ONLY in `lib/afip/` and surface typed
   results and `lib/afip/errors.ts` errors; consumers see one uniform contract.
2. PLACEMENT — correct code in the wrong file is a defect. A feature's business logic lives in its
   own `features/<domain>/actions` (+ pure helpers in its `lib/`); logic two features need goes UP to
   `lib/`, never sideways. Query keys in `features/<f>/lib/<f>-keys.ts`. Inngest functions in
   `lib/inngest/functions/`, registered in `app/api/inngest/route.ts`. `@ai-sdk/<provider>` is
   imported only by `features/ai/model.ts`; `lib/afip/wsfev1`/`wsaa` only by the invoice-issuing
   path (`lib/inngest/functions/issue-invoice.ts`, `caea-*`) and `features/afip-admin`.
3. FEATURE-DIRECTION — what may cross between features:
     ALLOWED cross-feature: types, Zod schemas, query keys, pickers (e.g. `accounts/schema`,
       `clients/schema`, `invoices/components/client-picker`), and a READ action consumed to feed a
       picker/hook or wrapped by the AI tool registry (`features/ai/registry/`, which must call the
       action so its `userCan` gate applies).
     FORBIDDEN cross-feature: a WRITE / business-logic action imported by another feature — the
       single documented exception is `issueFiscalInvoiceAction` (invoices → shipments,
       storage-billing, ai/document). Shared write logic goes to `lib/`.
     `lib/` never imports a feature's actions or components (type/schema imports are tolerated,
       pre-existing). Nothing imports from `app/`. No cycles.
   A new forbidden edge = defect. A pre-existing one the diff copies (e.g. `loans` →
   `createTransactionAction`) is not a licence — the new copy is a defect; the old one is a follow-up.
4. CONTRACT-VOCAB — shared code (`lib/`, a feature's public `index.ts`, shared types) speaks the
   domain's words (comprobante, CAE, asiento, canal, recibo). A provider name (anthropic, gemini,
   openai, wsfev1, sentry, inngest) leaked into a consumer identifier, shared type, or comment
   outside its seam = boundary leak (HARD blocker). A version/lineage marker (v2/old/legacy/base/
   generic) or invented parallel term where a house term exists = defect, downgradable to a tracked
   follow-up ONLY if pre-existing and purely cosmetic (state the downgrade; don't default to it).

SEVERITY: no-branch / placement / forbidden cross-feature action / provider-leak = HARD blockers (any
one = does not merge). Lineage-marker / parallel-vocab nit = raise-and-downgradable. All four are
co-equal in must-check; they are severity-tiered only for what blocks a merge.

ONLY sanctioned exceptions: (a) `issueFiscalInvoiceAction` crossing features (documented in
CLAUDE.md); (b) a variance the SEAM ITSELF declares (a nullable/variant field in its typed result).
Justify (b) in one line naming BOTH the declaring field and the death condition. Missing either =
defect. Branching just to make an assertion "pass for both" = FORBIDDEN.

FIX every violation in this change. The only deferrable is one literally unexpressible today
(the seam does not yet exist) — RAISE it and list it under the PR's `## Follow-ups`, never tolerate
it silently.

PER-LAW VERDICT: if the change touches a boundary surface (any cross-feature import, any file in
`lib/afip/`, `lib/inngest/`, `features/ai/model.ts`, `features/ai/registry/`, a `lib/` helper, or
shared/consumer code that could branch on a provider), emit PASS|DEFECT + one line for all four laws.
If it touches NO boundary surface, emit exactly:
  ports: N/A — no boundary surface (no cross-feature import, no seam/lib change).
=== END PORTS LENS ===
```
