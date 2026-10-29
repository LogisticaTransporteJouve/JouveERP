# Pendientes y faltantes — JouveERP

> Estado al **2026-07-04**. Surge de una auditoría docs vs código (roadmap,
> `docs/*`, `features/*`, migraciones, tests). Este doc es la lista de trabajo
> real; cuando se resuelve cada punto, se sincroniza el roadmap.

> **Update 2026-07-04** — tanda de cierre (PRs #195–#201): mappers
> crear-desde-escaneo para **todos** los tipos con destino (recibo, OP, factura
> de venta, NC/ND de compra), **asientos manuales** + cuenta RECPAM + aplicación
> RG 4667, **tarifas de storage versionadas** (aumento % + snapshot en cada
> facturación), **flujo de caja con USD** al TC oficial, **L.6 export Libro IVA
> Digital** (TXT posicional) y **L.7 CAEA** de contingencia. Con esto el
> backlog de código queda **vacío**.

---

## 1. Lo único pendiente (configuración, no código)

- [ ] **Email del aging semanal — env vars.** El cableado por Resend está
      shippeado (`lib/email/client.ts`); faltan `RESEND_API_KEY`, `EMAIL_FROM`
      y `FINANCE_EMAIL` en el entorno de producción. Sin ellas el cron loguea y
      saltea el envío (graceful).
- [ ] **CAEA — alta del punto de venta de contingencia.** Todo el flujo (código
      por quincena, emisión offline, régimen informativo) está shippeado, pero
      requiere crear una única vez el PV **"CAEA — Contingencias"** en
      *Administración de Puntos de Venta y Domicilios* de ARCA. Hasta entonces
      `FECAEASolicitar` responde 15003 y el panel de `/admin/afip` lo muestra.
- [ ] **Tarifas de storage — cargar los valores reales.** El CRUD + versionado
      está; los importes vigentes son estimados hasta que se confirmen con el
      cliente. Se actualizan con "Aumentar %" o editando desde
      `/storage-tariffs`.

## 2. Cerrado en la tanda 2026-07-04

- [x] **Document Intelligence — crear desde escaneo** para recibo, orden de
      pago, factura de venta (emite por el flujo normal, con guard de
      duplicados) y NC/ND de compra (#195). Remitos quedan como archivo (no hay
      entidad remito en el ERP); extractos van por conciliación.
- [x] **Asientos manuales** (`source_table = null`) + cuenta **RECPAM 4.2.2**
      + aplicación **RG 4667** (generar/vincular/desvincular asiento desde la
      página de inflación) (#196). Decisión: el ajuste se calcula afuera y se
      carga manual — no hay RPC de reexpresión automática.
- [x] **H.5 tarifas** — snapshot de tarifas aplicadas en `storage_billing_runs`
      + aumento masivo por % con historial (#197). La emisión AFIP de storage ya
      estaba cableada vía `issueFiscalInvoiceAction` (el doc estaba desactualizado).
- [x] **Flujo de caja USD** — cuentas, cheques, aging, recurrentes y cuotas en
      USD convertidos al último TC oficial; las vistas de aging ahora exponen
      `moneda` (#198). Antes los USD del aging se sumaban como si fueran ARS.
- [x] **L.6 — export Libro IVA Digital** (TXT posicional, diseño RG 3685;
      importable en Portal IVA / IVA Simple RG 5705) (#199).
- [x] **L.7 — CAEA contingencia** (RG 5782/2025): solicitud por quincena,
      emisión offline en PV de contingencia, régimen informativo automático,
      QR con `tipoCodAut A`, panel admin (#200).

## 3. Descartados (decisiones)

- [x] ~~**M.5** — aprobaciones de montos altos~~ (decisión #20, 2026-06-22).
- [x] ~~**M.6** — portal cliente~~ (decisión #19, 2026-06-22).
- [x] ~~**RAG / embeddings (pgvector)**~~ (decisión 2026-07-04): infra paga
      nueva sin caso de uso; la FTS `search_global` cubre free-text.
- [x] ~~**Write-tools IA + NL→SQL**~~ (decisión 2026-07-04): el agente queda
      read-only; las escrituras pasan por los flujos normales con confirmación
      humana (Document Intelligence incluida).

## 4. Hecho anteriormente (referencia)

- [x] **AI.0–AI.8** completo (chat + 25 tools + persistencia + artifacts +
      medidor/tope + Document Intelligence + insights proactivos) + anomalías,
      conciliación de extractos y skills de chat.
- [x] **Fase K** (compras/pagos), **Fase L** (contabilidad, ahora completa),
      **Fase N** (RRHH), **Fase G** (flota), **Fase H** (pallets/depósito),
      **Fase R** (pagos recurrentes), **Treasury**, **M.2 multimoneda**
      (exchange_rates + cron BCRA + asientos multimoneda).
- [x] Tests: 47/47 dominios con `schema.test.ts`; matriz de permisos con
      cobertura 100%.

---

## Accesos por usuario — follow-ups (2026-10-28)

- [ ] **Aprobar la migración `20261028140000_user_permission_denies`** apenas
      mergea el PR; después quitar las tolerancias de ventana de deploy en
      `lib/auth/denies.ts` (tabla faltante) y `features/search/actions/search-actions.ts`
      (firma vieja de `search_global`).
- [ ] **Denegaciones en la DB** (overlays RESTRICTIVE por tabla + storage + RPC
      DEFINER). Hoy la DB aplica solo el techo del rol; ver `docs/decisions.md`.
- [ ] Suite pgTAP rol × tabla contra `ROLE_PERMISSIONS` (y auditar el desvío
      `['owner','finance']` en RLS vs admin en TS).
- [x] `issue-invoice.ts`: "sin CAEA vigente" y "sin `cbte_tipo_afip`" fallan sin
      reintentos.
- [x] `issueFiscalInvoiceAction`: la `idempotency_key` la manda el formulario;
      un doble submit devuelve el mismo borrador.
- [ ] Datos de un módulo oculto que otro módulo muestra (facturas/recibos en la
      cuenta del cliente y el aging, saldos de cuentas en tesorería, libro IVA):
      decidir si se filtran por el permiso del recurso.
- [ ] Document Intelligence: el matching (`features/ai/document/store.ts`,
      `features/ai/reconciliation/gather.ts`) lee con service client sin filtrar
      por el acceso de quien subió el documento.
