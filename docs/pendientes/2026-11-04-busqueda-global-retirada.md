# Búsqueda global retirada (2026-11-04)

- [x] Sale la búsqueda global ⌘K: UI, `searchGlobalAction`, la herramienta
      `searchGlobal` del AI CFO y la función Inngest `search-index-refresh`
      (`docs/decisions/2026-11-04-se-retira-la-busqueda-global-k.md`). Solo código; la DB no cambia.
- [ ] **Migración de contrato:** borrar la vista materializada
      `search_index`, `search_global`, `refresh_search_index*`, los triggers
      `search_index_mark_dirty` y `search_index_state` cuando la próxima
      promoción quede firme. Con ella, sacar los pgTAP que los cubren
      (`supabase/tests/user_access_test.sql`, `receipts_letter_x_test.sql`,
      `definer_hardening_test.sql`, `schema_rls_and_grants_test.sql`) y
      regenerar `lib/db/database.types.ts`. Después ya no se puede volver a un
      SHA anterior a este cambio.
