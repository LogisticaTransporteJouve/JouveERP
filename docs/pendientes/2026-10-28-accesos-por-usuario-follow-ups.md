# Accesos por usuario — follow-ups (2026-10-28)

- [ ] **Aprobar la migración `20261028140000_user_permission_denies`** apenas
      mergea el PR; después quitar la tolerancia de ventana de deploy en
      `lib/auth/denies.ts` (tabla faltante). La de `search_global` se fue con la
      búsqueda global (2026-11-04).
- [ ] **Denegaciones en la DB** (overlays RESTRICTIVE por tabla + storage + RPC
      DEFINER). Hoy la DB aplica solo el techo del rol; ver
      `docs/decisions/2026-10-28-accesos-por-usuario-denegaciones-en-la-app-techo-en-la-db.md`.
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
