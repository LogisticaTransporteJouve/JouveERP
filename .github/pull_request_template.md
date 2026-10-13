## Resumen

<!-- Qué resuelve este PR y por qué, en 1-3 oraciones. -->

## Cambios

-

## RLS / permisos tocados

- [ ] No toca tablas, RPCs ni server actions (saltear esta sección)
- [ ] Toda tabla nueva tiene RLS habilitado y policies en la **misma** migración (`public.user_has_role(...)`)
- [ ] Toda server action nueva llama `requireUserContext()` + `userCan(ctx.roles, "<perm>")`
- [ ] Permisos nuevos agregados a la matriz de `lib/auth/permissions.ts` y `lib/auth/permissions.test.ts` sigue al 100%

## Migración

- [ ] No incluye migración
- [ ] Incluye migración: timestamp mayor al último de `main`, nombre `YYYYMMDDHHMMSS_<scope>.sql`, y `lib/db/database.types.ts` regenerado
- [ ] **`[DESTRUCTIVE]`** — borra/renombra columnas o tablas, o reescribe datos

<!-- Si es [DESTRUCTIVE], completá el plan de rollback: -->

**Plan de rollback:**

## Impacto AFIP / fiscal

<!-- ¿Toca facturación electrónica (WSAA/WSFEv1), CAE, numeración, libros IVA, asientos automáticos o percepciones/retenciones? Si no, poné "Ninguno". -->

## Uso de IA

<!-- ¿Se generó código con IA? ¿Qué partes revisaste a mano? ¿Toca la feature de IA (chat, insights, Document Intelligence)? -->

## Cómo probar

1.
