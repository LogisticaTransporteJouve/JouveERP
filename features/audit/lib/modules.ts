// What module an audit event belongs to and where its record lives. The
// module is the event type's first word (`invoice.cancelled` → `invoice`), as
// every logAudit call names it.

type AuditModule = {
  label: string;
  /** The record's page: a detail page when the module has one, else its
   *  list. Absent when no page shows the record. */
  href?: (id: string) => string;
};

const AUDIT_MODULES: Record<string, AuditModule> = {
  account: { label: "Cuentas", href: () => "/accounts" },
  accounting_period: {
    label: "Períodos contables",
    href: () => "/accounting/journal",
  },
  afip: { label: "AFIP", href: () => "/admin/afip/puntos-de-venta" },
  ai: { label: "Asistente IA" },
  audit: { label: "Auditoría", href: () => "/admin/audit" },
  attendance: { label: "Asistencia", href: () => "/hr/attendance" },
  backup: { label: "Backups", href: () => "/admin/backups" },
  bank_statement_line: {
    label: "Conciliación bancaria",
    href: () => "/treasury/reconciliation",
  },
  caea: { label: "CAEA" },
  chart_account: { label: "Plan de cuentas", href: () => "/accounting/chart" },
  check: { label: "Cheques recibidos", href: () => "/checks" },
  check_sale: { label: "Venta de cheques", href: () => "/checks" },
  client: { label: "Clientes", href: (id) => `/clients/${id}` },
  cost_center: {
    label: "Centros de costo",
    href: () => "/accounting/cost-centers",
  },
  driver: { label: "Choferes", href: () => "/drivers" },
  driver_settlement: { label: "Rendiciones", href: () => "/rendiciones" },
  employee: { label: "Empleados", href: (id) => `/employees/${id}` },
  employee_document: {
    label: "Documentos de empleados",
    href: () => "/hr/document-expirations",
  },
  exchange_rate: {
    label: "Cotizaciones",
    href: () => "/accounting/exchange-rates",
  },
  file: { label: "Archivos", href: () => "/files" },
  import_run: { label: "Importador", href: () => "/admin/imports" },
  fleet_document: {
    label: "Documentos de flota",
    href: () => "/fleet-documents",
  },
  freight_settlement: { label: "Liquidaciones", href: () => "/liquidaciones" },
  fuel_load: { label: "Combustible", href: () => "/fuel" },
  inflation_adjustment: {
    label: "Ajuste por inflación",
    href: () => "/accounting/inflation",
  },
  invoice: { label: "Comprobantes", href: (id) => `/invoices/${id}` },
  invoice_item: { label: "Ítems de comprobante" },
  issued_check: { label: "Cheques propios", href: () => "/issued-checks" },
  journal_entry: { label: "Libro diario", href: () => "/accounting/journal" },
  late_interest: { label: "Intereses por mora", href: () => "/aging/mora" },
  leave: { label: "Licencias", href: () => "/hr/vacations" },
  libro_iva: { label: "Libro IVA" },
  loan: { label: "Préstamos", href: (id) => `/loans/${id}` },
  maintenance: { label: "Mantenimiento", href: () => "/maintenance" },
  management_bucket: {
    label: "Resultado de gestión",
    href: () => "/management",
  },
  pallet: { label: "Pallets", href: () => "/pallets" },
  payment_order: {
    label: "Órdenes de pago",
    href: (id) => `/payment-orders/${id}`,
  },
  payroll: { label: "Sueldos", href: () => "/hr/payroll" },
  product: { label: "Productos", href: () => "/products" },
  purchase_invoice: { label: "Compras", href: (id) => `/purchases/${id}` },
  receipt: { label: "Recibos", href: (id) => `/receipts/${id}` },
  recurring_payment: {
    label: "Pagos recurrentes",
    href: () => "/recurring-payments",
  },
  recurring_task: { label: "Tareas recurrentes", href: () => "/tasks" },
  shipment: { label: "Cargas", href: () => "/cargas" },
  storage: { label: "Facturación de depósito", href: () => "/storage-billing" },
  storage_area: { label: "Áreas de depósito", href: () => "/warehouses" },
  storage_tariff: {
    label: "Tarifas de depósito",
    href: () => "/storage-tariffs",
  },
  supplier: { label: "Proveedores", href: (id) => `/suppliers/${id}` },
  supplier_category: {
    label: "Categorías de proveedores",
    href: () => "/suppliers/categories",
  },
  task: { label: "Tareas", href: () => "/tasks" },
  transaction: { label: "Caja", href: () => "/transactions" },
  trip: { label: "Viajes", href: (id) => `/trips/${id}` },
  user: { label: "Usuarios", href: () => "/admin/users" },
  vehicle: { label: "Vehículos", href: () => "/vehicles" },
  warehouse: { label: "Depósitos", href: () => "/warehouses" },
};

/** The module of an event type: its first word. */
export function auditModuleOf(eventType: string): string {
  const dot = eventType.indexOf(".");
  return dot < 0 ? eventType : eventType.slice(0, dot);
}

export function auditModuleLabel(module: string): string {
  return AUDIT_MODULES[module]?.label ?? module;
}

/** Where the event's record lives, or null when no page shows it. */
export function auditRecordHref(
  eventType: string,
  targetResourceId: string | null,
): string | null {
  if (!targetResourceId) return null;
  const href = AUDIT_MODULES[auditModuleOf(eventType)]?.href;
  return href ? href(targetResourceId) : null;
}

/** The distinct modules of `eventTypes`, sorted by label. */
export function auditModulesOf(
  eventTypes: readonly string[],
): { id: string; label: string }[] {
  const ids = [...new Set(eventTypes.map(auditModuleOf))];
  return ids
    .map((id) => ({ id, label: auditModuleLabel(id) }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}
