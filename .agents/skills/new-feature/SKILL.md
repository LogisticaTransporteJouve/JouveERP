---
name: new-feature
description: "Create or extend a feature slice in JouveERP (features/<domain>/{actions,components,hooks,lib,schemas,types}). Use when adding a business domain, a read/write server action, a TanStack hook, or a dashboard page. Triggers on 'nueva feature', 'nuevo dominio', 'server action', 'agregar módulo', 'feature slice'."
---

# Nueva feature (JouveERP)

## Estructura del slice

```
features/<f>/
  actions/      # "use server" — server actions
  components/   # UI del feature (client)
  hooks/        # use-*.ts (TanStack + runAction)
  lib/          # <f>-keys.ts (query keys), utils sin React
  schemas/      # Zod + schema.test.ts
  types/        # interfaces TS
  index.ts      # barrel
```

Solo importa de `@/components/ui/*`, `@/lib/*`, `@/lib/auth/*`, `@/hooks/*`.
**Cross-feature:** se pueden importar tipos, schemas, query keys, pickers y actions de
lectura que alimentan un picker. **Actions de negocio (escritura) no cruzan** — única
excepción documentada: `issueFiscalInvoiceAction`. Si hace falta lógica compartida, subila a
`@/lib/` (ver `/enforce-ports-and-adapters`).
Estudiá `features/invoices/` y `features/aging/` como template.

## Server action (template)

`ActionResult<T>` y `runAction` viven en `lib/query/run-action.ts`.

```ts
"use server";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { getServiceClient } from "@/lib/supabase/service";
import type { ActionResult } from "@/lib/query/run-action";

export async function getXAction(input: GetXInput): Promise<ActionResult<X>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "<perm>:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("...")
    .select("col1, col2") // nunca select *
    /* filtros */;
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: /* map */ };
}
```

## Cliente (hook + page)

- Hook: `useSuspenseQuery({ queryKey: xKeys.list(...), queryFn: () => runAction(() => getXAction(...)) })`.
  Query keys en `features/<f>/lib/<f>-keys.ts`.
- Página: `app/(dashboard)/<ruta>/page.tsx` server component con `prefetchQueries`
  + `Hydrate` (template: `app/(dashboard)/receipts/page.tsx`).
- CRUD en **`Dialog`** centrado (no Sheet). Monocromo, `lucide`, Geist.

## Permisos, auditoría, tests

- Permisos nuevos → `lib/auth/permissions.ts` (`PERMISSIONS` + `ROLE_PERMISSIONS`)
  y **cubrir en `lib/auth/permissions.test.ts`** (matriz 100%).
- Mutaciones sensibles → `logAudit()` (`lib/actions/audit.ts`).
- Zod en `schemas/` + `schema.test.ts`.

## Checklist

- [ ] Slice completo; ninguna action de negocio importada de otra feature.
- [ ] Actions devuelven `ActionResult<T>`, con `userCan` + sin `select *`.
- [ ] Permisos en matriz + test.
- [ ] Zod + schema.test.ts.
- [ ] Si hay tabla nueva → usar `/new-migration` (RLS + types).
