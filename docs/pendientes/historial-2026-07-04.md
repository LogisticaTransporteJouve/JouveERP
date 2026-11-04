# Historial de la tanda 2026-07-04

## 1. Lo único pendiente a 2026-07-04 (configuración, no código)

- [ ] **Email del aging semanal — env vars.** El cableado por Resend está
      shippeado (`lib/email/client.ts`); faltan `RESEND_API_KEY`, `EMAIL_FROM`
      y `FINANCE_EMAIL` en el entorno de producción. Sin ellas el cron loguea y
      saltea el envío (graceful).
- [ ] **CAEA — alta del punto de venta de contingencia.** Todo el flujo (código
      por quincena, emisión offline, régimen informativo) está shippeado, pero
      requiere crear una única vez el PV **"CAEA — Contingencias"** en
      _Administración de Puntos de Venta y Domicilios_ de ARCA. Hasta entonces
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
- [x] **Asientos manuales** (`source_table = null`) + cuenta **RECPAM 4.2.2** + aplicación **RG 4667** (generar/vincular/desvincular asiento desde la
      página de inflación) (#196). Decisión: el ajuste se calcula afuera y se
      carga manual — no hay RPC de reexpresión automática.
- [x] **H.5 tarifas** — snapshot de tarifas aplicadas en `storage_billing_runs` + aumento masivo por % con historial (#197). La emisión AFIP de storage ya
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
      nueva sin caso de uso; la FTS `search_global` cubría free-text (retirada
      2026-11-04).
- [x] ~~**Write-tools IA + NL→SQL**~~ (decisión 2026-07-04): el agente queda
      read-only; las escrituras pasan por los flujos normales con confirmación
      humana (Document Intelligence incluida). Vale a 2026-07-04: hoy el
      chat tiene propuestas que escriben tras confirmar; solo las corridas
      headless siguen read-only.

## 4. Hecho anteriormente (referencia)

- [x] **AI.0–AI.8** completo (chat + 25 tools a 2026-07-04 + persistencia + artifacts +
      medidor/tope + Document Intelligence + insights proactivos) + anomalías,
      conciliación de extractos y skills de chat.
- [x] **Fase K** (compras/pagos), **Fase L** (contabilidad, ahora completa),
      **Fase N** (RRHH), **Fase G** (flota), **Fase H** (pallets/depósito),
      **Fase R** (pagos recurrentes), **Treasury**, **M.2 multimoneda**
      (exchange_rates + cron BCRA + asientos multimoneda).
- [x] Tests (a 2026-07-04): 47/47 dominios con `schema.test.ts`; matriz de permisos con
      cobertura 100%.
