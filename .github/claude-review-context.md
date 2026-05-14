# Contexto para Claude code review — JouveERP

Buscá violaciones de las reglas listadas abajo activamente. No felicites,
no comentes nits. Issues concretos con `archivo:línea` y agrupados por
severidad: 🔴 Crítico → 🟡 Importante → 🔵 Menor. Si el PR está limpio en
todos los focos, decilo en una sola línea.

---

## Stack y convenciones generales

- **Next.js 16 App Router** + **React 19** + **TypeScript strict**.
- **Supabase** (Postgres + RLS + RPCs + Storage + Realtime).
- **shadcn/ui** + **Tailwind v4** (paleta oklch monocromática, sin colores de marca).
- **TanStack Query** (`useSuspenseQuery` para primer load, `useQuery` para
  opcionales). Mutations invalidan keys cruzadas.
- **Zod 4** + **react-hook-form** para forms.
- **Inngest** para workflows durables.
- Server Components por default; `"use client"` solo si hay estado/efectos.
- Server Actions para mutaciones, **nunca** API routes.
- Conventional commits en inglés (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`).
- Sin `any` ni `as` (regla ESLint activa). Usá type guards o narrowing real.
- Sin colores hardcodeados: solo tokens del design system.
- Comentarios solo cuando el "por qué" no es obvio.

---

## Reglas de negocio críticas (🔴)

### Canales y multi-unidad

- 4 canales fijos: `jouve_fiscal`, `jouve_interno`, `dz_fiscal`, `dz_interno`.
  El AFIP POS mapping vive en memory: `00003=Jouve fiscal`, `00004=DZ fiscal`,
  `00005=deshabilitado`.
- Solo canales `is_fiscal=true` disparan llamada a AFIP. Si ves
  `inngest.send("afip.emit", …)` para un canal `is_fiscal=false` → bug.
- **Nunca asignar `channel_id` directamente a una `transaction`**.
  Las transactions son caja única; el etiquetado del canal va por el
  parent (receipt / payment_order / invoice).

### Numeración per-channel (correlativo)

- Cada tipo de comprobante tiene UNIQUE `(channel_id, punto_venta, numero)`:
  invoices, receipts, payment_orders, purchase_invoices.
- **Antes de insertar**, el número se calcula contra el último del canal.
  Si ves un `insert` con `numero` hardcoded sin pasar por
  `get_next_numero` o `getNext*NumeroAction` → bug de correlativo.
- Formato display: facturas `A00003-00000001`, NC/ND `NC00003-00000001`
  (sin letra, glued). OPs `OP0003-00000001`. Recibos `R0003-00000001`.

### Atomic RPCs con sum validation

- Creación/edición de receipts, payment_orders, opening_balances pasa por
  RPCs (`create_receipt`, `create_payment_order`, `update_*`,
  `apply_*_opening_balance`).
- Estos RPCs validan suma de líneas vs total y crean/borran transactions
  ligadas. **El código no debe escribir tablas hijas (`*_payment_lines`,
  `*_allocations`, `transactions` ligadas) directamente** — siempre vía RPC.
- Si ves `supabase.from("receipt_payment_lines").insert(…)` desde una
  server action → bug, eso lo hace el RPC.

### Cancel → cleanup vía triggers

- `cancel` de receipt / payment_order / invoice ejecuta un trigger
  (`handle_*_cancellation`) que borra las transactions ligadas y revierte
  endosos / issued_checks. **No replicar esa lógica desde TypeScript**.
- Si ves `delete from transactions where payment_order_id = …` en código
  TS → bug, eso ya lo hace el trigger.

### Permisos y RLS

- RBAC roles: `owner`, `admin`, `finance`, `operations`, `warehouse`, `driver`.
  Listado canónico en `lib/auth/permissions.ts`.
- Toda server action de mutación: primer chequeo es
  `if (!userCan(ctx.roles, "<perm>"))` → return `{ ok: false, error }`.
  Action que escribe a Supabase sin gate → bug de seguridad.
- Toda RLS policy: `using (public.user_has_role(array['owner', …]))`.
  Nunca `auth.uid()` directo para permisos de negocio.
- **Solo el owner** puede tocar opening balances de cliente/proveedor.
  El check va en la action (`ctx.roles.includes("owner")`).
- **Solo el owner** puede asignar el rol `owner`. Ver `canAssignRole`.

### Cheques recibidos (cartera)

- Lifecycle: `en_cartera` → `depositado` → `acreditado` (o `rechazado`).
- Endosos a proveedor solo vía OP (`line_kind: "endorse_check"`).
  El endorsement standalone se eliminó. Si ves `endorse_check` RPC suelto
  o un dialog `EndorseChequeDialog` → bug (debería estar todo borrado).
- Status `endosado`, `acreditado`, `rechazado` son terminales. Código que
  permita transicionarlos sin pasar por el cancel del parent → bug.
- `check_movements` es append-only. Nunca UPDATE.

### Cheques propios (issued_checks)

- Linkeable a una OP (`payment_order_id`). Status: `emitted` → `cashed` |
  `rejected` | `cancelled`.
- El movimiento de caja lo hace la OP (transaction `expense`), no el cheque.
- `kind`: `fisico` o `echeq`. UNIQUE `(kind, bank_name, check_number)`.

### Facturación AFIP

- Comprobantes con CAE son inmutables. UPDATE directo sobre `invoices` con
  CAE asignado → bug. Solo se anulan con NC/ND.
- Workflow Inngest `afip.emit` debe usar `idempotency_key` derivada del
  comprobante (no random) para evitar emisiones duplicadas.
- `motivo_nc_nd` requerido cuando `kind in ('nc', 'nd')`. El schema Zod lo
  valida; si ves un insert sin esa validación → bug.

---

## Patrones técnicos (🟡)

### Server Actions

- Patrón canónico:
  ```ts
  "use server";
  export async function fooAction(input: unknown): Promise<ActionResult<T>> {
    const ctx = await requireUserContext();
    if (!userCan(ctx.roles, "foo:read")) {
      return { ok: false, error: "..." };
    }
    const parsed = FooSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
    }
    // ...
  }
  ```
- Action que escribe sin Zod en la primera línea → bug.
- Action que devuelve `Promise<T>` en vez de `Promise<ActionResult<T>>` → bug.

### Hooks con invalidación cruzada

- Mutations relacionadas entre features deben invalidar las queries de
  TODAS las features afectadas. Ejemplos:
  - `useCreatePaymentOrder` invalida `paymentOrdersKeys`, `transactionsKeys`,
    `purchaseInvoicesKeys`, `suppliersKeys`, `checksKeys`, `issuedChecksKeys`.
  - `useCreatePurchaseInvoice` invalida `purchaseInvoicesKeys` y `suppliersKeys`.
- Mutation que solo invalida su propia key → bug de UX (el usuario tiene que
  apretar F5).

### Realtime

- `useRealtimeInvalidate` con filtro server-side (`filter:
  "column=eq.X"`) para evitar recibir cambios de otros recursos.
- Sin filtro → "realtime spam" + pago de bandwidth de más.

### PostgREST y chunking

- `db.max_rows = 1000` capea las queries. Para listados grandes
  (`/suppliers`, `/purchases`, account movements) usar chunking con
  `range()` en loop hasta `chunk.length < CHUNK`.
- `select * from foo` sin paginación, donde `foo` puede tener >1000 rows
  → bug latente.

### Suspense y prefetch

- `useSuspenseQuery` en componentes que necesitan data en primer paint.
  El parent debe hacer prefetch en RSC (`prefetchQueries` + `<Hydrate>`).
- `useQuery` para data opcional (popovers, dialogs, second tabs).
- `useSuspenseQuery` sin prefetch upstream → waterfall en cliente.

### Forms

- `react-hook-form` + `zodResolver`. Submit pasa por la action; errores se
  toastean con `sonner` y no se setean al field salvo Zod field-level.
- `<DatePicker>` para fechas (string ISO YYYY-MM-DD), nunca `<input type="date">`.
- Botones del dialog: cancel a la izquierda, primary a la derecha, ambos
  alineados a la derecha. Disable submit cuando no hay cambios en edit.

### UI

- **Dialog over Sheet** para CRUD (preferencia del owner). No usar Sheet
  para forms de alta/edición.
- `shadcn/ui` primitives. No reinventar inputs / selects / popovers.
- Sidebar ya está agrupado (Ventas / Compras / Tesorería / Admin); ítems
  nuevos van adentro del grupo correcto.

### Migraciones SQL

- Timestamps estrictamente crecientes (CI lo chequea: `migration-order-check.yml`).
- Nuevo índice cuando se agrega una columna usada en `WHERE` / `ORDER BY`
  / FK. Sin índice → bug de performance latente.
- Tipos de plata: `numeric(18, 2)`. Nunca `float`/`real`.
- Triggers de `set_updated_at()` en toda tabla con `updated_at`.
- RLS habilitado en toda tabla nueva, con policies para `select` (rol matrix)
  y writes solo via RPC o también con `user_has_role`.

### Tests

- Server action nuevo sin test en Vitest (`*.test.ts` o `*.test.tsx`) →
  señalarlo (no bloqueante, pero anotarlo).
- Schemas Zod nuevos sin tests de happy/sad path → señalarlo.

---

## Anti-patrones específicos (🔵)

- `useEffect` con set-state derivable de props o state → useMemo.
- `as any` o `as unknown as Foo` para silenciar TS → casi siempre hay un
  type guard mejor.
- `console.log` en código de producción (usar `logger` de `lib/logger`).
- Imports default cuando hay named exports.
- Componentes presentation con `"use client"` sin necesidad real.
- Comentarios que repiten lo que dice el código.

---

## Formato de respuesta esperado

POSTEÁ un comentario en el PR con `gh pr comment <numero> --body "..."`.
No vuelques solo en stdout — necesitamos verlo en la página del PR.

Estructura:

```
## Code review

🔴 Crítico
- archivo.ts:42 — descripción específica de qué viola y qué corregir
- ...

🟡 Importante
- ...

🔵 Menor
- ...

(o "PR limpio." si no hay nada)
```
