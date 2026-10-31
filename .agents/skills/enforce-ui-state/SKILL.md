---
name: enforce-ui-state
description: >-
  The UI-state lens for JouveERP's frontend: does client state stay correct across user, scope
  and record switches, failures, overlapping requests and unmounts? Does every user action render
  each outcome (pending, success, `{ ok: false }`, partial, no-op)? Does what a control shows match
  what its `userCan` gate and server guards allow? Does the layout hold at phone width and with the
  longest Spanish label, and is it accessible, monochrome and built from the house patterns
  (TanStack Query, centered `Dialog`, sonner, lucide)? Use for "stale state", "stuck loading",
  "disabled but clickable", "button shows but the action fails", "toast twice", "overflow on
  mobile", "a11y regression", "is this the right pattern", and as an adv-review seat. CONDITIONAL: a
  no-op on a diff with no UI surface.
---

# Enforce UI State: client state, outcomes and layout hold under every condition

**Delivery.** A conditional lens with no condensed copy. adv-review's routing table names this
file, and the review seat that owns it Reads this SKILL.md itself. It fires on a diff that touches
`app/**` pages or layouts, `features/*/components/`, `features/*/hooks/`, `features/*/lib/*-keys.ts`,
`components/`, or `hooks/`. Otherwise the seat emits exactly:
`ui-state: N/A — no UI surface in diff.`

**The law: every piece of client state is keyed, written and cleared for every identity and
outcome. Every user action renders each outcome distinctly. What a control shows is derived from
the same predicate as what it does.**

## House facts the diff doesn't show

- **Reads.** Pages are server components that prefetch and wrap in `Hydrate` (`lib/query/`);
  client reads are `useSuspenseQuery` / `useSuspenseInfiniteQuery` with
  `queryFn: () => runAction(() => xAction(...))` (`lib/query/run-action.ts`, which turns
  `{ ok: false, error }` into a thrown `Error`). Defaults in `lib/query/query-client.ts`:
  `staleTime: 30_000`, `retry: 1`, no refetch on focus. Query keys live in
  `features/<f>/lib/<f>-keys.ts`.
- **Writes.** `useMutation` with `runAction`; invalidation lives in the hook, toasts in the
  component (`toast` from `sonner`, Spanish copy). The exemplar is `useCancelInvoice` in
  `features/invoices/hooks/use-invoices.ts`: it invalidates on `onSettled`, and invalidates every
  other feature's keys the write changes (aging, receipts, shipments, storage billing).
  `getMutationId` (`lib/query/get-mutation-id.ts`) reads the id for a detail invalidation.
- **Identity dimensions** in a single-company app: the signed-in user (and the user a background
  job acts as), the channel/division scope (`lib/scope.ts`, where `null` means "all"), the date
  range (`lib/date-range.ts`), the record id, and the user's permissions.
- **Patterns.** CRUD lives in a centered `Dialog` (`components/ui/dialog.tsx`), not a Sheet;
  destructive confirmation uses `components/ui/alert-dialog.tsx`. The UI is neutral with one
  hue: `primary` is the Jouve brand indigo (primary buttons, active nav, focus ring); every other
  oklch token in `app/globals.css` is a gray, `--destructive` included: danger is said with copy and a
  `lucide-react` icon, never a color class. Fonts are Geist Sans/Mono. Copy is Spanish
  (Argentina). Close a Popover before opening a Dialog from it (focus traps; see
  `docs/frontend-patterns.md`).
- **Gates.** Pages compute `userCan(ctx.access, "<perm>")` and pass a boolean down (`canWrite`);
  the action re-checks it server-side, and RLS and triggers decide the rest.

## 1. The async-state ledger

Build it for any client state the diff adds or changes: `useState`, `useRef`, a query key, URL
search params, `localStorage`, a module-level `Map`, or a React `cache()` on the server.

| State | Keyed by | Written by | Cleared by |
|---|---|---|---|
| each piece | user, scope, date range, record, AI session | every writer, including each async completion's success *and* error arm | one cell per exit: success, error, cancel, dialog close, unmount, record or scope change, superseded request |

Defects to read off it:
- **Missing identity dimension** in a query key, storage key, reset dependency or component `key`
  (a list keyed without the scope or date range shows the previous scope's rows).
- **Async writer with no "still current?" check**: an `AbortController`, a request counter, or a
  captured-id vs live-id comparison. Choose deliberately between the value captured at start and
  the live one.
- **Empty "cleared by" cell**: a form that reopens with the last record's draft, an error that
  survives a successful retry.
- **Pending write lost on unmount** instead of completed or flushed.

**Invalidation.** For each new or changed query key, grep the key factory and list every mutation
on the same resource, in every feature. Each invalidates the key on *settle* (`onSettled`), not
only on success, whenever a failure can leave the server changed: a partial batch, an action that
writes then returns `{ ok: false }`, an Inngest job started before the error (an emission). An
`onSuccess`-only invalidation is correct only when the action is all-or-nothing. A write that
changes a figure another feature shows (aging, balances, libro IVA, dashboard) invalidates that
feature's key too.

**Effects.** Dependencies are primitives or stable references, never a whole query or mutation
result or an unmemoized object. An effect whose only job is `setState(derive(props))` is a defect:
compute in render, or key the component.

## 2. State × outcome for every user action

1. **Outcomes**: pending, success, failure (thrown *and* returned `{ ok: false, error }`), partial
   success, no-op or early return, an async state that settles later (an invoice in `emitting`
   until the CAE arrives, polled by `useInvoiceStatusPoll`), background refetch.
2. **UI state the action touches**: `isPending` flags, dialog open or closed, form values
   (react-hook-form), status text and badges, toasts, focus target.
3. **Fill the table; read the code for each cell.** Look for:
   - a cell with no assignment: a stuck spinner or no terminal state;
   - a dialog closed or a form reset before the outcome is known (close and reset on success
     only);
   - a failure rendered as an empty list or as still loading;
   - a partial result or an async-pending state rendered as done ("Comprobante emitido" before the
     CAE);
   - two toasts for one outcome (grep the hook and the callee for `toast` first);
   - a submit button still clickable while pending (double submit).
4. **Query status.** A non-suspense `useQuery` that unmounts, disables or shows a negative
   distinguishes four states: no data yet, error with cached data, placeholder or initial data,
   settled empty. Ask whether an `enabled: false` query can stay disabled forever, and whether a
   refetch replaces loaded data with a spinner. A suspense query's error goes to the nearest error
   boundary: check that one exists at a level that keeps the rest of the page usable.
5. **Predicate parity.** For each control, indicator or message, write down the predicate that
   shows or enables it and the predicate that decides its effect: the action's
   `userCan(ctx.access, ...)`, the server-side status checks, the DB trigger (closed period,
   fiscal cancel needs an NC, allocated invoice). Open the second outside the diff. They must
   match: the house example passes `canWrite={userCan(ctx.access, "files:write") && !isCancelled}`
   when the server also refuses writes on a cancelled document. If they differ, derive both from
   one function, or keep the control visible but disabled with the reason in Spanish copy (a
   `components/ui/tooltip.tsx` or inline text). Never hide a control the user may use, and never
   show one the server will refuse.
6. **Broad or destructive writes** (cancel, delete, NC, close a period, bulk actions) confirm up
   front in an `AlertDialog` naming what is affected and the side effects (a cancelled recibo
   deletes its treasury movements; a closed period blocks every later asiento in it).

## 3. Layout and accessibility

**Extremes.** Evaluate at phone width (the app has a `components/mobile-tab-bar.tsx` layout), the
longest real Spanish label and the longest real amount (`formatMoney` from `lib/format.ts` with
millions and a negative sign), the largest font, dark mode, and every variant (fiscal vs internal
channel, ARS vs USD, factura vs NC/ND), not at the default.

**Budgets.** Grep the changed constant, class or component and its consumers: every call site of a
changed `components/ui` primitive (`data-table.tsx`, `dialog.tsx`, `combobox.tsx`), `calc(100vh-`
sites, and table column widths.

**CSS traps:**
- nested `opacity` multiplies;
- nested flex scroll needs `min-h-0` on every ancestor;
- shadcn `data-[size=…]` and `data-[state=…]` selectors beat plain utilities;
- an SVG without `viewBox` doesn't scale;
- concatenated class strings need a space (use `cn` from `lib/utils.ts`);
- a color class (`text-red-*`, `bg-green-*`) breaks the single-hue rule: use tokens (`primary` for brand), copy and an
  icon.

**Accessibility.** On any changed interactive element:
- an icon-only button has an `aria-label` in Spanish; a labelled one's `aria-label` contains the
  visible text;
- every `aria-describedby` or `aria-controls` target is mounted in every branch;
- focus has an explicit destination when the focused element unmounts (a Dialog returns focus to
  its trigger);
- Escape propagation is never stopped;
- "disabled" also covers keyboard selection;
- no interactive content inside a `<button>`;
- every `<button>` in a `<form>` has a `type`;
- meaning is never carried by color alone (monochrome makes this the default; keep it).

Apply each fix to every sibling instance in the file.

## 4. New surface, option or interruption: two questions

Only when the diff adds a new surface, option, setting, default-open panel or interruption. Ask the
author, naming the precedent; these are not blockers.
1. **Lighter precedent?** Name the existing pattern in this app (a Dialog form, a table filter, a
   detail tab, an AI chat answer) and, for a structural choice, how an established accounting or
   ERP product handles it. Does the PR argue for the heavier mechanism? The AI assistant is
   conversational first: ask before adding chrome to it.
2. **Symmetry.** Does an added verb have its inverse and the same entry points (create ↔ cancel,
   close period ↔ reopen)? Does an option the AI assistant can also set (`features/ai/registry/`)
   have a default, so the agent isn't forced to decide it per item?

## Coverage table (proof of work)

```
state or action | keyed by / outcomes listed | writers and clears, or cells | predicate parity (show vs effect) | status
```

## Verify before raising

- **Overflow**: confirm the diff changed the budget or the content bound.
- **A one-frame transient render** that offers no action is not a finding.
- **"These should share a token" or "this should also show"** needs a spec, test or doc tying the
  two together.
- **A Radix uncontrolled `Select` with `defaultValue`** updates its own displayed value.
- **Pre-existing color classes** elsewhere are not this diff's finding; a new one is.
