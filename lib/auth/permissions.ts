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
  "users:manage_access",
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

  // Issued checks (K.6 — own checks issued)
  "issued_checks:read",
  "issued_checks:write",

  // Files (K.10 — attachments on entities)
  "files:read",
  "files:write",
  "files:admin",

  // AFIP
  "padron:lookup",
  "afip:admin",

  // Emailing vouchers (invoices / receipts)
  "email:send",

  // Cash register: accounts and transactions
  "accounts:read",
  "accounts:write",
  "transactions:read",
  "transactions:write",

  // Recurring payments (Phase R) — input for the AI cash-flow
  "recurring_payments:read",
  "recurring_payments:write",

  // Comprobantes (Phase E)
  "invoices:read",
  "invoices:issue",
  "invoices:cancel",

  // Collections, receipts, checks, retentions, NC/ND (Phase F)
  "receipts:read",
  "receipts:write",
  "cheques:read",
  "cheques:write",
  "retentions:read",
  "retentions:write",
  "credit_debit_notes:read",
  "credit_debit_notes:issue",

  // Fleet and trips (Phase G)
  "drivers:read",
  "drivers:write",
  "vehicles:read",
  "vehicles:write",
  "trips:read",
  "trips:write",
  "shipments:read",
  "shipments:write",
  "fuel:read",
  "fuel:write",
  "maintenance:read",
  "maintenance:write",
  "fleet_documents:read",
  "fleet_documents:write",

  // Accounting (Phase L)
  "accounting:read",
  "accounting:write",

  // Personnel / Payroll (Phase N)
  "hr:read",
  "hr:write",
  "hr:admin",

  // IA Intelligence (Phase I / AI.0)
  "ai:chat",
  "ai:read",
  "ai:admin",

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

// Roles ordered by privilege (most → least), for highestRole.
const ROLE_PRIVILEGE: Record<Role, number> = {
  owner: 0,
  admin: 1,
  finance: 2,
  operations: 2,
  warehouse: 3,
  driver: 4,
};

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,

  // Admins differ from the owner in role-assignment scope and in not
  // managing per-user access.
  admin: PERMISSIONS.filter((p) => p !== "users:manage_access"),

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
    "email:send",
    "accounts:read",
    "accounts:write",
    "transactions:read",
    "transactions:write",
    "recurring_payments:read",
    "recurring_payments:write",
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
    "ai:chat",
    "ai:read",
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
    "shipments:read",
    "shipments:write",
    "fuel:read",
    "fuel:write",
    "maintenance:read",
    "maintenance:write",
    "fleet_documents:read",
    "fleet_documents:write",
    "channels:read",
    "ai:chat",
    "ai:read",
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

// What a user may do: the union of their roles' permissions minus the
// permissions denied to them one by one (user_permission_denies). Gates take
// an Access, never a bare role list, so no gate can skip the denies. The brand
// is type-only: an Access is a plain object at runtime (it crosses from server
// components to client components as props) and only resolveAccess builds one.
declare const accessBrand: unique symbol;
export type Access = {
  readonly roles: readonly Role[];
  readonly denied: readonly Permission[];
} & { readonly [accessBrand]: true };

export type Resource = Permission extends `${infer R}:${string}` ? R : never;

const PERMISSIONS_BY_RESOURCE = new Map<string, Permission[]>();
for (const permission of PERMISSIONS) {
  const resource = permissionResource(permission);
  PERMISSIONS_BY_RESOURCE.set(resource, [
    ...(PERMISSIONS_BY_RESOURCE.get(resource) ?? []),
    permission,
  ]);
}

export function permissionResource(permission: Permission): Resource {
  return permission.slice(0, permission.indexOf(":")) as Resource;
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * The effective access for `roles` with `deniedRaw` taken away. An owner keeps
 * every permission (the owner cannot be denied anything, and set_user_access
 * clears an owner's denies). A deny of `<resource>:read` takes the whole
 * resource: writing what you cannot read is not offered. Unknown strings (a
 * permission removed from the matrix) are dropped.
 */
/**
 * Whether denying `<resource>:read` hides the whole module (every action of
 * the resource). Not for `ai`: `ai:read` (documents, insights) and `ai:chat`
 * (the assistant) are separate features an owner denies one by one.
 */
export function readDenyHidesModule(resource: Resource): boolean {
  return resource !== "ai";
}

export function resolveAccess(
  roles: readonly Role[],
  deniedRaw: readonly string[] = [],
): Access {
  const denied = new Set<Permission>();
  if (!roles.includes("owner")) {
    for (const raw of deniedRaw) {
      if (!isPermission(raw)) continue;
      denied.add(raw);
      const resource = permissionResource(raw);
      if (raw.endsWith(":read") && readDenyHidesModule(resource)) {
        for (const p of PERMISSIONS_BY_RESOURCE.get(resource) ?? []) {
          denied.add(p);
        }
      }
    }
  }
  // The one place an Access is made: the brand has no runtime value to set.
  return { roles: [...roles], denied: [...denied] } as unknown as Access;
}

/** Every permission the roles grant, before any per-user deny. */
export function rolePermissions(
  roles: readonly Role[],
): ReadonlySet<Permission> {
  return new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]));
}

export function roleGrants(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** The permissions `roles` minus `denied` leave, as resolveAccess counts them. */
export function effectivePermissions(
  roles: readonly Role[],
  denied: readonly string[],
): ReadonlySet<Permission> {
  const access = resolveAccess(roles, denied);
  return new Set(PERMISSIONS.filter((p) => userCan(access, p)));
}

export function userCan(
  access: Access | null | undefined,
  permission: Permission,
): boolean {
  if (!access || access.denied.includes(permission)) return false;
  return access.roles.some((role) => roleGrants(role, permission));
}

// Owners can assign any role, including granting and revoking owner; admins
// any role except owner; nobody else.
function roleLevelAssignable(actorRoles: readonly Role[], role: Role): boolean {
  if (actorRoles.includes("owner")) return true;
  if (actorRoles.includes("admin")) return role !== "owner";
  return false;
}

/**
 * Roles the actor may give someone: within their role-level scope, and none
 * that carries a permission denied to the actor (an admin could otherwise mint
 * a second account without their denies).
 */
export function assignableRoles(actor: Access): Role[] {
  if (!userCan(actor, "users:assign_role")) return [];
  return ROLES.filter(
    (role) =>
      roleLevelAssignable(actor.roles, role) &&
      !ROLE_PERMISSIONS[role].some((p) => actor.denied.includes(p)),
  );
}

/** Roles the actor may take away; removing a role only narrows access. */
export function removableRoles(actor: Access): Role[] {
  if (!userCan(actor, "users:assign_role")) return [];
  return ROLES.filter((role) => roleLevelAssignable(actor.roles, role));
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
  return (
    typeof value === "string" && (ROLES as readonly string[]).includes(value)
  );
}
