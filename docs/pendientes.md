# Pendientes y faltantes — JouveERP

> Estado al **2026-06-16**. Surge de una auditoría docs vs código (roadmap,
> `docs/*`, `features/*`, migraciones, tests). El roadmap maestro
> (`docs/roadmap.md`) está **desactualizado** — varias cosas marcadas pendientes
> ya están hechas, y una fase entera (HR) no figura. Este doc es la lista de
> trabajo real; cuando se resuelva cada punto, se sincroniza el roadmap.

---

## 1. Roadmap desactualizado — corregir (alto valor, bajo riesgo) ✅ sincronizado 2026-06-16

`docs/roadmap.md` se sincronizó con el código: §3 (estado al 2026-06-16),
§3.5 (Fase N), §5 (Fase I → `ai-overview.md`, nueva Fase R) y §6 (orden de
ejecución) reflejan ahora la realidad.

- [x] **Fase K cerrada.** §3.2 lista K.1–K.11 ✅ (PR #48 mergeado).
- [x] **Fase N (HR / Personal-Sueldos) documentada.** Nueva §3.5 con breakdown
      N.1–N.5 + evidencia (migraciones `…517100000`–`140000`, `…518100000` +
      crons `vacation-balances-grant`, `document-expiry-alerts`).
- [x] **Treasury** con fila propia en §3.1.

## 2. Planeado, no construido (correcto — futuro)

- [ ] **L.6** — exports CITI / SIAP (TXT posicional AFIP).
- [ ] **L.7** — CAEA fallback (alta contingencia AFIP).
- [ ] **M.2** — multimoneda USD. Parcial: columnas `currency (ARS,USD)` ya están
      en 6 tablas (`transactions`, `accounts`, `receipts`, `payment_orders`,
      `checks`, `issued_checks`); falta tabla `exchange_rates` + job BCRA + lógica
      de conversión.
- [ ] **M.5** — aprobaciones de montos altos.
- [ ] **M.6** — portal cliente (read-only).
- [ ] **Fase G** — flota y viajes (perms `drivers/vehicles/trips/fuel/...` ya
      reservados en `permissions.ts`, sin tablas).
- [ ] **Fase H** — pallets/depósito (perms reservados, sin tablas).

## 3. Huecos reales (ni hecho ni planeado)

- [ ] **Pagos recurrentes** — feature CRUD normal (`recurring_payments`),
      insumo del cash-flow de la IA. Ya está en el roadmap como **Fase R**.
      **A construir.** (ver `docs/ai-overview.md` §5/§9.)
- [ ] **Document Intelligence (escaneo + OCR + extracción + clasificación)** —
      adjuntar/escanear un archivo (factura, recibo, OP, remito, cheque, …), la
      IA detecta qué es, extrae todos los datos y, si es factura, genera los
      ítems. Ya está en el roadmap como **AI.8** (Fase I, reemplaza al ex
      `claude-proxy/`). Diseño en `docs/ai-overview.md` §5-bis. **A construir.**
- [ ] **Specs de arquitectura faltantes** para los 2 subsistemas más grandes:
      `docs/accounting-patterns.md` (chart-of-accounts, journal-entries,
      libro-mayor, libro-iva, balance, transactions, cost-centers, inflation) y
      `docs/hr-patterns.md`. Hoy solo hay manual HTML para usuario final.
- [x] **`CLAUDE.md`** en root — guía para devs / Claude Code. Importado en PR #83.
- [ ] **Tests faltantes** en features con `actions/` sin tests, varios sensibles:
      `admin-users` (RBAC), `afip-admin` (credenciales AFIP), `aging`, `backups`,
      `search`, `treasury`. (23/30 dominios sí tienen `schema.test.ts`.)
- [ ] **Email del aging semanal sin proveedor.** `aging-weekly-summary` calcula
      el resumen pero el envío es TODO — falta elegir/configurar proveedor
      transaccional (Resend/SES). El cron corre y no manda nada.
- [x] **`claude-proxy/`** — referencia muerta resuelta: quitada del roadmap
      (§5 Fase I + §Operativo), su caso de uso queda como **AI.8**.

## 4. Staleness menor de docs

- [ ] `sumary-frontend-patterns.md`: pnpm 10.28.2 vs real 10.30.2.
- [ ] `ai-patterns.md`: nombres de modelo "Sonnet 4.6" (doc a futuro, no crítico).

## 5. IA (`features/ai/`) — greenfield, pendiente de build

- [x] Diseño Fase 0: `docs/ai-overview.md` (decisiones D1–D5 cerradas).
- [ ] AI.0 deps + permisos + `audit_events.actor_type`.
- [ ] AI.1 capa de tools (lectura) · AI.2 agente + chat route · AI.3 página +
      historial · AI.4 tools restantes + artifacts · AI.5 insight cash-flow ·
      AI.6 costo/límites/medidor.
- [ ] **AI.8 Document Intelligence** (el punto 3 de arriba).
- [ ] Pendiente input del usuario: tope diario (≈500K tok/día) — el resto cerrado.

---

### Prioridad sugerida
1. Sincronizar roadmap con la realidad (punto 1).
2. Document Intelligence — diseño + build (punto 3).
3. Specs `accounting-patterns.md` + `hr-patterns.md`.
4. `CLAUDE.md` + tests de `admin-users`/`afip-admin`.
