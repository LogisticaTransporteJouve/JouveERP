<!-- Título: Conventional Commits en inglés, menos de 70 caracteres. Si la migración es destructiva, el título empieza con `[DESTRUCTIVE]`. Borrá las secciones que no apliquen. -->

## Resumen

<!-- Qué resuelve este PR y por qué, en 1-3 oraciones. -->

## Cambios

-

## RLS / permisos tocados

- [ ] No toca tablas, RPCs ni server actions (saltear esta sección)
- [ ] Toda tabla nueva tiene RLS habilitado y policies en la **misma** migración (`public.user_has_role(...)`)
- [ ] Toda función `SECURITY DEFINER` nueva tiene `set search_path` y `revoke all … from public, anon, authenticated` en la misma migración
- [ ] Toda server action nueva llama `requireUserContext()` + `userCan(ctx.access, "<perm>")`
- [ ] Permisos nuevos agregados a la matriz de `lib/auth/permissions.ts` y `lib/auth/permissions.test.ts` sigue al 100%

## Seguridad

> [!IMPORTANT]
> Es **sensible** si toca: auth o sesiones, RLS o grants, exportar o borrar datos, subir o leer archivos, un proveedor nuevo, un campo con datos fiscales o personales (CUIT, DNI, CBU, montos), o prompts de IA con datos de usuarios.

- [ ] No sensible
- [ ] Sensible: qué datos toca y quién los ve después del cambio:

**STRIDE, qué podría salir mal:**

## Migración

- [ ] No incluye migración
- [ ] Incluye migración: timestamp mayor al último de `main`, nombre `YYYYMMDDHHMMSS_<scope>.sql`, header `SET LOCAL` de timeouts, `pnpm check:migrations` pasa y `lib/db/database.types.ts` regenerado
- [ ] **`[DESTRUCTIVE]`** — borra/renombra columnas o tablas, o reescribe datos

<!-- Si es [DESTRUCTIVE], completá el plan de rollback: -->

**Plan de rollback:**

## Impacto AFIP / fiscal

<!-- ¿Toca facturación electrónica (WSAA/WSFEv1), CAE, numeración, libros IVA, asientos automáticos o percepciones/retenciones? Si no, poné "Ninguno". -->

## Uso de IA

<!-- ¿Se generó código con IA? ¿Qué partes revisaste a mano? ¿Toca la feature de IA (chat, insights, Document Intelligence)? -->

- [ ] Agrega o cambia llamadas a un proveedor de IA (pasan por `features/ai/model.ts`)

## Verificación

- [ ] Test pgTAP (`supabase/tests/`) o de integración (`tests/integration/`) para toda tabla o RPC nueva en `public` (o `n/a`)
- [ ] Sin `.env`, claves, comprobantes reales ni datos personales en el diff

## Cómo probar

1.

## Follow-ups

<!-- Lo que queda fuera de este PR: qué, dónde y por qué. -->
