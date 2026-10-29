import {
  PERMISSIONS,
  permissionResource,
  type Permission,
  type Resource,
} from "@/lib/auth/permissions";

/** Spanish label of each module, in the order the access dialog lists them. */
export const PERMISSION_GROUPS: Record<Resource, string> = {
  clients: "Clientes",
  invoices: "Comprobantes emitidos",
  credit_debit_notes: "Notas de crédito y débito",
  receipts: "Recibos y cobranzas",
  retentions: "Retenciones",
  cheques: "Cheques de terceros",
  suppliers: "Proveedores",
  purchase_invoices: "Comprobantes de compra",
  payment_orders: "Órdenes de pago",
  issued_checks: "Cheques propios",
  accounts: "Cuentas y cajas",
  transactions: "Movimientos de caja",
  recurring_payments: "Pagos recurrentes",
  accounting: "Contabilidad",
  channels: "Canales de facturación",
  storage_billing: "Facturación de depósito",
  drivers: "Choferes",
  vehicles: "Vehículos",
  trips: "Viajes",
  shipments: "Envíos",
  fuel: "Combustible",
  maintenance: "Mantenimiento",
  fleet_documents: "Documentos de flota",
  warehouses: "Depósitos",
  pallets: "Pallets",
  products: "Productos",
  stock_movements: "Movimientos de stock",
  hr: "Recursos humanos",
  files: "Archivos",
  ai: "Inteligencia artificial",
  email: "Envío de emails",
  padron: "Padrón AFIP",
  afip: "Configuración AFIP",
  users: "Usuarios",
  audit: "Auditoría",
};

/** Spanish label of each action verb. */
const VERB_LABELS: Record<string, string> = {
  read: "Ver",
  write: "Crear y editar",
  issue: "Emitir",
  cancel: "Anular",
  admin: "Administrar",
  chat: "Usar el asistente",
  lookup: "Consultar",
  send: "Enviar",
  invite: "Invitar",
  assign_role: "Asignar roles",
  manage_access: "Gestionar accesos",
};

export function permissionLabel(permission: Permission): string {
  const verb = permission.slice(permission.indexOf(":") + 1);
  return VERB_LABELS[verb] ?? verb;
}

export function permissionsOf(resource: Resource): Permission[] {
  return PERMISSIONS.filter((p) => permissionResource(p) === resource);
}

/**
 * Modules that can be hidden whole: denying `<resource>:read` takes every
 * action of the resource (resolveAccess). `ai` is left out because its
 * `ai:read` (documents, insights) and `ai:chat` (the assistant) are separate
 * features an owner hides one by one.
 */
export const MODULE_RESOURCES: readonly Resource[] = (
  Object.keys(PERMISSION_GROUPS) as Resource[]
).filter(
  (resource) =>
    resource !== "ai" &&
    (PERMISSIONS as readonly string[]).includes(`${resource}:read`),
);
