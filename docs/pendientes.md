# Pendientes y faltantes — JouveERP

> Estado al **2026-06-16**. Surge de una auditoría docs vs código (roadmap,
> `docs/*`, `features/*`, migraciones, tests). El roadmap maestro
> (`docs/roadmap.md`) está **desactualizado** — varias cosas marcadas pendientes
> ya están hechas, y una fase entera (HR) no figura. Este doc es la lista de
> trabajo real; cuando se resuelva cada punto, se sincroniza el roadmap.

---

## 1. Roadmap desactualizado — corregir (alto valor, bajo riesgo)

El doc maestro miente sobre el estado actual. Viola su propia regla §7.13
("si se shippea una fase, el roadmap se actualiza en el mismo PR").

- [ ] **Fase K cerrada, marcada parcial.** K.7–K.11 están hechas y mergeadas;
      el roadmap §3.2 las muestra ⏳/❌. PR #48 está mergeado, no draft.
      Evidencia: migraciones `20260516102448`, `…120000`, `…140000`, `…1601xx`.
- [ ] **Fase N (HR / Personal-Sueldos) construida y SIN documentar.** No está en
      el orden de ejecución (§6), no tiene sección ni breakdown; única mención =
      comentario en `lib/auth/permissions.ts`. Cubre: empleados, sueldos
      (períodos + pagos + extras), asistencia, vacaciones/licencias, documentos
      de empleado, + 2 crons Inngest. → Agregar sección de fase + estado.
      Evidencia: migraciones `20260517100000`–`140000`, `20260518100000`;
      `features/hr/`, `features/employee-documents/`.
- [ ] **Treasury** sin sección propia en el roadmap (feature construido).

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
      insumo del cash-flow de la IA. No está en el roadmap. (ver
      `docs/ai-overview.md` §5/§9.)
- [ ] **Document Intelligence (escaneo + OCR + extracción + clasificación)** —
      adjuntar/escanear un archivo (factura, recibo, OP, remito, cheque, …), la
      IA detecta qué es, extrae todos los datos y, si es factura, genera los
      ítems. Es roadmap **I.2** (cierra el POC `claude-proxy/`). Diseño en
      `docs/ai-overview.md` (sección Document Intelligence). **A construir.**
- [ ] **Specs de arquitectura faltantes** para los 2 subsistemas más grandes:
      `docs/accounting-patterns.md` (chart-of-accounts, journal-entries,
      libro-mayor, libro-iva, balance, transactions, cost-centers, inflation) y
      `docs/hr-patterns.md`. Hoy solo hay manual HTML para usuario final.
- [ ] **`CLAUDE.md`** en root — guía para devs / Claude Code (existe `README.md`,
      no `CLAUDE.md`).
- [ ] **Tests faltantes** en features con `actions/` sin tests, varios sensibles:
      `admin-users` (RBAC), `afip-admin` (credenciales AFIP), `aging`, `backups`,
      `search`, `treasury`. (23/30 dominios sí tienen `schema.test.ts`.)
- [ ] **Email del aging semanal sin proveedor.** `aging-weekly-summary` calcula
      el resumen pero el envío es TODO — falta elegir/configurar proveedor
      transaccional (Resend/SES). El cron corre y no manda nada.
- [ ] **`claude-proxy/`** citado en el roadmap (Fase I) como POC untracked → no
      existe en el repo. Resolver: crear o quitar la referencia.

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
