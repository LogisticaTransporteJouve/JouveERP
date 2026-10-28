---
name: enforce-outcomes
description: >-
  The outcomes lens: does every value keep its meaning from where it enters to where it lands? It
  traces each read's four outcomes (value, empty, pending, failed) to their sinks, each boundary
  input to the sink that consumes it, and each narrowing of a multi-state value to its full member
  list. It catches a PostgREST error shown as an empty list, a failed balance read coerced to `0`,
  a capped read reported as complete, a blank string that beats a fallback, a Zod schema looser or
  stricter than the column or RPC it feeds, and an enum member (channel, currency, NC/ND, AFIP
  error code) that falls to the wrong side. Use for "what happens when this fails", "is this zero
  real", "swallowed error", "input validation", "is every case handled", and as an adv-review seat.
---

# Outcomes — every value keeps its meaning end to end

**The law: no two outcomes that mean different things reach a sink looking the same, and no input
reaches a sink that can't take it.**

**Delivery.** This lens is Read-delivered, not pasted: `/adv-review`'s routing table names this
file, and the seat assigned to it Reads this `SKILL.md` in full and emits the coverage table below.
Invoked directly (`/enforce-outcomes`), run it over `git diff origin/main...HEAD`, fix every finding
in this change, and list any downgraded item under the PR's `## Follow-ups`.

**Ownership.** Whether a permission gate exists is `enforce-role-isolation`'s; whether every peer
learned the change is `enforce-reach`'s; how a pending, empty or failed state is drawn on screen is
`enforce-ui-state`'s; constraints and money columns are `enforce-data-integrity`'s. This lens owns
whether the outcome *reaches* each sink distinct.

## 1. Outcome table: every read the diff adds or changes

A read is a supabase-js select or `.rpc(`, a server action called through `runAction`, a TanStack
`useSuspenseQuery` / `useQuery` / `useSuspenseInfiniteQuery`, a `Map.get` or lookup, a Zod parse or
coercion, an optional field read, an AFIP call (`lib/afip/`), an AI provider call, an Inngest
`step.run` return value, or a script's exit code.

| Outcome | For example |
|---|---|
| value | rows, a saldo, `true`, a CAE |
| empty | `[]`, `.maybeSingle()` → `data: null`, a real `0`, `""` |
| pending / not applicable | query loading or disabled (`useQuery` `data` is `undefined`), field absent on this channel or kind, `arsEquivalent(...)` → `null` (USD with no rate) |
| failed / partial | `error` set, thrown, `{ ok: false, error }`, zero rows updated, PostgREST `max_rows` truncation (1000, `supabase/config.toml`), a `paginateRange` drain that hit `MAX_DRAIN_ROWS` |

Follow each outcome to its **sink**: a persisted write, a TanStack cache entry, an `ActionResult`
`ok`, a toast or status stamp (`invoices.status`, `notified_at`), Spanish user-facing text, the AI
tool result the model reads (`AiToolResult` in `features/ai/registry/result.ts`, including
`meta.partial`), an exported file (`lib/export/`, `lib/pdf/`), or a decision (a gate, filter or
classification).

**A finding is:**
- two outcomes reaching one sink indistinguishably when the sink means something different for each;
- `failed` reaching any sink without its own state;
- a write whose error, zero affected rows or partial result does not reach the caller's success signal.

**Jouve facts that decide most findings:**
- **`ActionResult<T>`** (`lib/query/run-action.ts`) is `{ ok: true; data } | { ok: false; error }`.
  `runAction` throws on `ok: false`, so a suspense query's failure goes to the nearest error
  boundary (`app/(dashboard)/error.tsx`). An action that catches its own failure and returns
  `{ ok: true, data: [] }` turns *failed* into *empty*, and no boundary ever sees it.
- **PostgREST error vs empty data.** `const { data } = await supabase.from(...)` with `error` never
  read makes a failed read and an empty table identical (`data ?? []`). `.maybeSingle()` returns
  `data: null` with no error for zero rows; "not found" and "failed" need separate branches.
- **Silent truncation.** A non-drained read that can grow with the data is capped at 1000 rows with
  no error. Totals, statements, libros IVA and exports drain through `paginateRange`
  (`lib/supabase/paginate.ts`, total order required); an AI tool that reads a capped list sets
  `partial` via `reachedCap` (`features/ai/registry/result.ts`) so the model does not report a
  partial sum as the total.
- **`?? 0` on money.** A saldo, total or deuda built with `?? 0`, `|| 0`, `Number(x)` or SQL
  `COALESCE(..., 0)` must be a measured zero. A failed read, a missing exchange rate or an absent
  row rendered as `$0` is a wrong number on a financial screen. Keep "not computable" as `null` the
  way `arsEquivalent` / `toArs` in `lib/fx.ts` do, and let the sink render it as unknown.
- **Pending vs empty on the client.** `useQuery` (non-suspense) returns `data: undefined` while
  loading; `data ?? []` renders "Sin resultados" before the fetch finishes. Suspense hooks avoid
  that only if the component does not also read a disabled or dependent query.
- **Inngest step return values** are JSON-serialized and memoized. A `Date`, `Map` or `undefined`
  field comes back changed on replay; a step that returns `null` for "failed" is indistinguishable
  from "nothing to do" in the next step.

**Seed the table with greps** over the diff and touched files:
- `const { data` with no `error` nearby;
- a `catch` that returns `[] | null | {} | false | undefined` or `{ ok: true`;
- `?? 0`, `|| 0`, `COALESCE(`, `Number(`, `parseFloat(`;
- `?? ''` on identity strings (CUIT, `doc_nro`, `numero`);
- `.every(` on a possibly empty list;
- literal `ok: true` or `return true`;
- `.update(` or `.delete(` without `.select(` or `count`;
- `.limit(` or an unbounded select feeding a sum, with no `paginateRange` or `reachedCap`;
- `|| true`, `IF EXISTS`.

**Read beyond the diff.** For SQL, push a NULL row through each predicate: `NULL IN`, `>=`, `=`,
NULLS ordering, `COUNT(DISTINCT)`, `SUM` over zero rows (NULL, not 0).

**Ask:**
- If this read fails, what does the user, the export or the model see, and what gets written?
- Is this 0 a measured zero?
- Does an empty scope stamp "done" (a cron marking every item notified, a period "sin movimientos")?
- Does `??` let `""` beat the fallback? Trim and check, don't only null-check.

## 2. Boundary input to sink

**Inputs** are every field, flag, argument or env var the diff adds or changes at a trust boundary:
- a server action's input, parsed by the Zod schema in `features/<f>/schema.ts`;
- an AI tool's `input` schema (`features/ai/registry/actions/`), which is model-written;
- a route handler's params, query string or body (`app/api/`);
- an Inngest event payload (schemas in `lib/inngest/events.ts`);
- a document-extraction result (OCR/LLM output) before it becomes a draft;
- script `argv` (`scripts/`) and env readers (`lib/afip/env.ts`);
- names read back from storage and reused as paths.

Follow each one to its **sink**: a typed column, check constraint or RPC argument; a string-built
PostgREST filter (`.or(` with interpolation, `.in(` with a built list, `.ilike(`); a storage path; a
CSV or XLSX cell; an AFIP field (`doc_nro`, `cbte_tipo_afip`, `punto_venta`, amounts); a pool size
or loop bound; a unique key.

Per sink:
1. Does the boundary accept **exactly** what the sink accepts? Looser means a 500, a constraint
   error shown as "No se pudo guardar", or an injection; stricter means a valid value is refused
   (a schema rejecting a legal CUIT, a negative amount on an NC that the column allows).
2. Is an interpolated (not bound) value escaped? A user search in `.ilike(` goes through an escaping
   helper such as `containsPattern` (`features/files/lib/hub.ts`); a value inside `.or(\`...\`)` is
   a number or UUID that the schema already narrowed, never free text. Storage keys come from
   `buildStorageKey` (`lib/files/storage-path.ts`), never from the original filename. Resolve a
   path and compare it to its base; never pattern-match it.
3. Can two distinct inputs reach one sink key after case-folding, trimming, leading-zero
   normalization (`doc_nro`) or truncation?

**Diff against the sibling action.** Compare how the neighbouring action in the same feature
handles the same field type: money parsing (`parseArAmount` in `lib/format.ts`, the schema's
preprocess), date format (`YYYY-MM-DD`), UUID check, array guard, error message. Any difference is
the finding. Then check the transport:
- A route handler's query string and `FormData` arrive as strings (or arrays for repeated keys).
- `z.coerce` and `z.preprocess` must not turn junk into a valid member: `z.coerce.number()` makes
  `""` into `0`, and `0` may be a valid amount.
- Every member of a paired or mutually exclusive set is checked (`fch_serv_desde` with
  `fch_serv_hasta`, `invoice_origin_id` with an NC/ND kind).
- Each list element is validated, so one valid element can't mask an invalid one.

Validate configuration once at startup (`lib/afip/env.ts` style), not with clamps scattered through
the code.

## 3. Narrowing: list every member

Wherever the diff narrows a multi-state value, write out the source type's **full** member list and
map each member. Narrowing includes:
- a boolean derived from an enum or status (`status === "emitted"`, `channel.is_fiscal`);
- a `catch` that maps to one outcome;
- `instanceof` or a `code` switch over `AfipErrorCode` (`lib/afip/errors.ts`: `CONFIG`, `INPUT`,
  `TRANSPORT`, `SOAP_FAULT`, `SERVICE`);
- a `Record<Kind, ...>` lookup with `?? 0` or `?? default` for unknown keys;
- a dedup or group key;
- a classification set (the four billing channels, `ARS`/`USD`, factura/NC/ND, CAE/CAEA/internal,
  the six roles).

Take the members from the enum, union, Postgres check constraint or schema
(`lib/db/database.types.ts`), not from the cases the code mentions. For error classification,
include wrapper shapes (`NonRetriableError` with `cause`, non-`Error` rejections, a PostgREST error
object that is not an `Error`). A member with no explicit mapping, or a failure mapped to the
success side, is the finding.

- **Keys**: can two entities share the value (a client's `legal_name`, an account label)? Then the
  key must be the id.
- **Loose types**: should a bare `string` be a literal union from an existing source of truth? Is a
  const map pinned with `satisfies Record<Union, ...>` to the union it must cover? When a callback
  or port signature widens (e.g. `AfipCaePort`), grep every implementation.

## Coverage table (proof of work)

```
read/input/narrowing | outcomes or members listed | sink(s) | callee read? | status
```

A seat that returns no table has not run this lens.

## Verify before raising

- **A zero or a fail-closed can be domain-correct.** Failing closed on an unreadable check before a
  destructive operation (cancelling a receipt, closing a period) is never "error masking".
- **Nullability in generated `lib/db/database.types.ts`** is not a finding unless a caller is shown
  to coerce the value.
- **A `?? 0` on a value the schema or a `NOT NULL DEFAULT 0` column already guarantees** is noise;
  cite the guarantee and move on.
