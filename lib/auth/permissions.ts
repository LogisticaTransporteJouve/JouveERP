// Permission matrix for JouveERP. The role list mirrors the seed in
// supabase/migrations/20260508201626_roles_and_audit.sql exactly. The
// permission list covers Phases B–J of the roadmap up front so adding a new
// feature usually means picking an existing permission rather than editing
// this file. Every entry is exhaustively checked by lib/auth/permissions.test.ts.

export const ROLES = [
  "owner",
  "admin",
  "finance",
  "operations",
  "warehouse",
  "driver",
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // RBAC
  "users:read",
  "users:invite",
  "users:assign_role",
  "audit:read",

  // Channels and business units
  "channels:read",
  "channels:write",

  // Clients
  "clients:read",
  "clients:write",

  // Suppliers (K.1)
  "suppliers:read",
  "suppliers:write",

  // Purchase invoices (K.2)
  "purchase_invoices:read",
  "purchase_invoices:write",
  "purchase_invoices:cancel",

  // Payment orders (K.3)
  "payment_orders:read",
  "payment_orders:write",

  // Issued checks (K.6 — cheques propios emitidos)
  "issued_checks:read",
  "issued_checks:write",

  // Files (K.10 — adjuntos a entidades)
  "files:read",
  "files:write",
  "files:admin",

  // AFIP
  "padron:lookup",
  "afip:admin",

  // Caja: accounts and transactions
  "accounts:read",
  "accounts:write",
  "transactions:read",
  "transactions:write",

  // Comprobantes (Phase E)
  "invoices:read",
  "invoices:issue",
  "invoices:cancel",

  // Cobranzas, recibos, cheques, retenciones, NC/ND (Phase F)
  "receipts:read",
  "receipts:write",
  "cheques:read",
  "cheques:write",
  "retentions:read",
  "retentions:write",
  "credit_debit_notes:read",
  "credit_debit_notes:issue",

  // Flota y viajes (Phase G)
  "drivers:read",
  "drivers:write",
  "vehicles:read",
  "vehicles:write",
  "trips:read",
  "trips:write",
  "fuel:read",
  "fuel:write",
  "maintenance:read",
  "maintenance:write",
  "trip_documents:read",
  "trip_documents:write",

  // Contabilidad (Phase L)
  "accounting:read",
  "accounting:write",

  // Personal / Sueldos (Phase N)
  "hr:read",
  "hr:write",
  "hr:admin",

  // Pallets (Phase H)
  "warehouses:read",
  "warehouses:write",
  "pallets:read",
  "pallets:write",
  "products:read",
  "products:write",
  "stock_movements:read",
  "stock_movements:write",
  "storage_billing:read",
  "storage_billing:issue",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// Roles ordered by privilege (most → least). Used to enforce that admins
// cannot grant the owner role while owners can grant anything.
const ROLE_PRIVILEGE: Record<Role, number> = {
  owner: 0,
  admin: 1,
  finance: 2,
  operations: 2,
  warehouse: 3,
  driver: 4,
};

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Owner: everything. Admins differ only in role-assignment scope.
  owner: PERMISSIONS,

  admin: PERMISSIONS,

  finance: [
    "clients:read",
    "clients:write",
    "suppliers:read",
    "suppliers:write",
    "purchase_invoices:read",
    "purchase_invoices:write",
    "purchase_invoices:cancel",
    "payment_orders:read",
    "payment_orders:write",
    "issued_checks:read",
    "issued_checks:write",
    "files:read",
    "files:write",
    "padron:lookup",
    "accounts:read",
    "accounts:write",
    "transactions:read",
    "transactions:write",
    "invoices:read",
    "invoices:issue",
    "invoices:cancel",
    "receipts:read",
    "receipts:write",
    "cheques:read",
    "cheques:write",
    "retentions:read",
    "retentions:write",
    "credit_debit_notes:read",
    "credit_debit_notes:issue",
    "channels:read",
    "accounting:read",
    "accounting:write",
    "hr:read",
    "hr:write",
    "storage_billing:read",
    "storage_billing:issue",
  ],

  operations: [
    "clients:read",
    "suppliers:read",
    "files:read",
    "files:write",
    "drivers:read",
    "drivers:write",
    "vehicles:read",
    "vehicles:write",
    "trips:read",
    "trips:write",
    "fuel:read",
    "fuel:write",
    "maintenance:read",
    "maintenance:write",
    "trip_documents:read",
    "trip_documents:write",
    "channels:read",
  ],

  warehouse: [
    "warehouses:read",
    "warehouses:write",
    "pallets:read",
    "pallets:write",
    "products:read",
    "stock_movements:read",
    "stock_movements:write",
    "files:read",
    "files:write",
  ],

  // Driver-level access stays minimal until G.3 adds `:own` scoping.
  driver: ["trips:read"],
};

export function userCan(
  roles: readonly Role[] | null | undefined,
  permission: Permission,
): boolean {
  if (!roles || roles.length === 0) return false;
  return roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
}

export function canAssignRole(
  actorRoles: readonly Role[] | null | undefined,
  targetRole: Role,
): boolean {
  if (!actorRoles || actorRoles.length === 0) return false;

  // Owners can assign any role, including granting and revoking owner.
  if (actorRoles.includes("owner")) return true;

  // Admins can assign any role except owner. Anyone else cannot assign roles.
  if (actorRoles.includes("admin")) return targetRole !== "owner";

  return false;
}

export function highestRole(roles: readonly Role[]): Role | null {
  if (roles.length === 0) return null;
  let best: Role = roles[0]!;
  for (const role of roles) {
    if (ROLE_PRIVILEGE[role] < ROLE_PRIVILEGE[best]) best = role;
  }
  return best;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
