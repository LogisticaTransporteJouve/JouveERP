# Comment-value calibration — hand-labelled exemplars

JouveERP-shaped comments, labelled by the `enforce-comment-value` classifier. The paths are where such
a comment would live in this app (`features/*`, `lib/*`, `supabase/`), not citations of existing lines
— replace them with real hand-labelled comments from this repo as reviews produce them. Read before a
first pass, and whenever a verdict feels uncertain. A lens edit that flips a label here is a
regression — fix the lens, not the label.

## DELETE — Q1: derivable within one screen

| Where | Comment | Why |
|---|---|---|
| `features/receipts/actions/...` | `// Update existing receipt` above `if (existing) { const updates = {…} }` | The branch and the variable both say it. |
| `features/invoices/components/...` | `// Reset selection` above `setSelectedIds(new Set()); setPage(0)` | Restates two self-naming statements. |
| repo-wide | `// Get current user` above `requireUserContext()` | Pure echo. |
| `features/payment-orders/schemas/schema.test.ts` | `// 1. build the input  // 2. parse it` … numbered running commentary | REFACTOR-INSTEAD when it narrates production logic; DELETE in a test whose steps are already one call each. |

## KEEP + ANCHOR — Q2: unrecoverable from this repo

| Where | Comment (abridged) | Why it pays |
|---|---|---|
| `features/ai/document/post-inference.ts` | `REQUIRED: every extracted invoice carries its currency. Validate here so a missing currency fails LOUD instead of defaulting to ARS and silently mis-booking a USD purchase.` | External-format contract + a named hazard + why the validation is where it is. Nothing in the code says ARS is the silent default. Textbook anchored KEEP. |
| `features/suppliers/actions/...` | `Chunk with .range(): PostgREST caps responses at max_rows (1000, supabase/config.toml) without an error, so an unchunked read silently drops rows past it.` | Failure mode of an external system + a silent-data-loss consequence. Deleting this loses the only record of why the loop exists. |
| `lib/afip/wsfev1.ts` | `AFIP returns Resultado "A" with Observaciones on a partial approval; treat it as approved and surface the observations, never as an error.` | External-service behaviour that contradicts what the field name suggests — exactly the line a competent reader would "fix". Passes the bug-filing test. |
| `lib/inngest/functions/issue-invoice.ts` | `Before requesting a CAE on retry, read the last authorized number: the previous attempt may have reached AFIP and timed out on our side.` | External-system failure mode behind a non-obvious extra call. |
| `features/ai/model.ts` | `… raising it spends the fallback budget on transient errors; lowering it fails over on the first 429.` on a retry constant | Load-bearing constant rationale + which way to move it. Keep-and-anchor: it should name the tuning signal, not just the direction. |

## REWRITE — right fact, wrong form
- `features/dashboard/components/...` — `// Fetch balances from the server (skeleton shows while this
  runs)`. The first clause restates the call below it; the parenthetical is the non-obvious half.
  Verdict is REWRITE to `// skeleton shows while this runs`, NOT delete. A comment that is part noise
  is rewritten to its load-bearing clause, never dropped whole.
- A KEEP that restates a constant's **value** instead of its **name**: `// stale after 24 hours` will
  drift the moment `EXCHANGE_RATE_STALE_HOURS` changes. Reference the name.
- A `TODO` with no reference: `// TODO: handle the CAEA retry case` → REWRITE with an issue reference
  or a pointer to `docs/pendientes.md`, not DELETE.
- Three sentences of preamble around one load-bearing clause → cut to the clause.

## HOIST
- The same "BCRA publishes the rate for the previous business day" note repeated at sibling
  call-sites → once, on the shared definition.
- A per-line note describing a seam's contract → onto the exported function (e.g.
  `buildExtractionModel` in `features/ai/model.ts`).

## Low priority — leave unless doing a full-file pass
`// ========` dividers, `// Constants`, `// Handlers`, `// Zod schemas`, the numbered section banners
in large migrations. They make no claim, so they cannot rot. They are noise, not liability — never
spend review attention on them.

## Never touch
`// eslint-disable-next-line ...` · license headers · shebangs · public-API JSDoc · test-intent
comments and expected-value arithmetic (e.g. in an invoice test,
`// neto 1.000 + IVA 21% 210 + percepción IIBB 3% 30 = 1.240` is the proof of the assertion) ·
anything in `lib/db/database.types.ts` (generated) or `supabase/migrations/`.
