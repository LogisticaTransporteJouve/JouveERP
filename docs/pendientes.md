# Pendientes y faltantes — JouveERP

> Estado al **2026-06-22**. Surge de una auditoría docs vs código (roadmap,
> `docs/*`, `features/*`, migraciones, tests). Este doc es la lista de trabajo
> real; cuando se resuelve cada punto, se sincroniza el roadmap.

> **Update 2026-06-22** — gran sesión de build (PRs #83–#114). Shipped:
> **AI.0–AI.8** completo (chat + 25 tools + persistencia + artifacts + medidor/tope
> + Document Intelligence + insights proactivos), **Fase R** (pagos recurrentes),
> **Fase G completa** (G.1–G.7: choferes, vehículos, viajes, combustible,
> mantenimiento, documentos de flota, reportes, acceso del chofer a sus viajes),
> **Fase H** (pallets/depósito: warehouses, products, pallets, tarifas y
> facturación de storage), fixes contabilidad/RRHH, **backfill de tests** en las
> 6 features que no tenían, y las specs `accounting-patterns.md` + `hr-patterns.md`.
> Lo que sigue abajo es lo que **realmente** queda.

---

## 1. Roadmap desactualizado — corregir (alto valor, bajo riesgo) ✅ sincronizado 2026-06-22

`docs/roadmap.md` se sincroniza con el código en esta misma tanda.

- [x] **Fase K cerrada.** §3.2 lista K.1–K.11 ✅ (PR #48 mergeado).
- [x] **Fase N (HR / Personal-Sueldos) documentada** + `docs/hr-patterns.md`.
- [x] **Treasury** con fila propia en §3.1.
- [x] **Fase G (Flota) completa** (G.1–G.7).
- [x] **Fase H (Pallets/Depósito)** construida (masters + tarifas + facturación).
- [x] **AI.0–AI.8** completo (ver §5).

## 2. Planeado, no construido — **bloqueado en decisión/spec del usuario**

- [ ] **L.6** — exports CITI / SIAP (TXT posicional AFIP). *Necesita el formato
      posicional exacto de AFIP.*
- [ ] **L.7** — CAEA fallback (alta contingencia AFIP). *Necesita spec AFIP.*
- [ ] **M.2** — multimoneda USD. Parcial: columnas `currency (ARS,USD)` ya están
      en 6 tablas (`transactions`, `accounts`, `receipts`, `payment_orders`,
      `checks`, `issued_checks`); falta tabla `exchange_rates` + job de cotización
      + lógica de conversión. **En progreso** (modelo estándar: cotización oficial
      BCRA a fecha de operación).
- [x] ~~**M.5** — aprobaciones de montos altos~~ **descartado** (decisión #20, 2026-06-22): no hace falta.
- [x] ~~**M.6** — portal cliente~~ **descartado** (decisión #19, 2026-06-22): no va.
- [ ] **H.5 / emisión de factura de storage vía AFIP.** La facturación de storage
      existe pero la tarifa es un estimado documentado; falta confirmar tarifas
      reales + cablear la emisión AFIP.
- [ ] **Inflación RG 4667 — generación del asiento de ajuste.** La tabla
      `inflation_adjustments` (coeficiente por período) existe; falta el RPC que
      genera el asiento de reexpresión. *Necesita el método regulatorio + qué
      cuentas se tratan como no-monetarias.*

## 3. Huecos reales (ni hecho ni planeado)

- [x] **Pagos recurrentes** (`recurring_payments`) — **Fase R** construida.
- [x] **Document Intelligence** (escaneo + OCR + extracción + clasificación) —
      **AI.8** construida.
- [x] **Specs de arquitectura** — `docs/accounting-patterns.md` (Fase L+D) y
      `docs/hr-patterns.md` (Fase N) escritas.
- [x] **`CLAUDE.md`** en root — guía para devs / Claude Code (PR #83).
- [x] **Tests faltantes** — backfill completo: `admin-users`, `afip-admin`,
      `aging`, `backups`, `search`, `treasury` ahora tienen `schema.test.ts`
      (extrayendo la validación/lógica pura a `schema.ts`). 47/47 dominios con
      tests (`shipments` cubierto — antes era el único sin `schema.test.ts`).
- [x] **Email del aging semanal — cableado (2026-07).** `aging-weekly-summary`
      ahora envía el resumen por Resend (`lib/email/client.ts`) a `FINANCE_EMAIL`.
      Solo resta **config de entorno** (`RESEND_API_KEY`, `EMAIL_FROM`,
      `FINANCE_EMAIL`); sin esas vars el cron loguea y saltea el envío (graceful).
- [x] **`claude-proxy/`** — referencia muerta resuelta; su caso de uso es **AI.8**.

## 4. Staleness menor de docs

- [x] `sumary-frontend-patterns.md`: pnpm `10.28.2` → `10.30.2` (real).
- [ ] `ai-patterns.md`: nombres de modelo "Sonnet 4.6" (doc a futuro, no crítico).

## 5. IA (`features/ai/`) — ✅ AI.0–AI.8 shipped

- [x] Diseño Fase 0: `docs/ai-overview.md` (decisiones D1–D5 cerradas).
- [x] AI.0 deps + permisos + `audit_events.actor_type`.
- [x] AI.1 tools (lectura) · AI.2 agente + chat route · AI.3 página + historial ·
      AI.4 tools restantes + artifacts · AI.5 insights (cash-flow + receivables) ·
      AI.6 costo/límites/medidor.
- [x] **AI.8 Document Intelligence**.
- [x] Tope diario configurado (medidor + cap en `features/ai`).

---

### Prioridad sugerida (lo que queda)
1. **M.2 multimoneda** con modelo estándar (BCRA) — en progreso.
2. Cablear proveedor de email (Resend) para el aging semanal.
3. El resto (L.6/L.7, RG 4667, H.5 emisión, envío de email) **espera
   specs/decisiones**. (M.5 aprobaciones y M.6 portal: descartados, #20 / #19.)
