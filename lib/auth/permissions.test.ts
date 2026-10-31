import { describe, expect, it } from "vitest";

import {
  CLIENT_AGING_PERMISSIONS,
  PERMISSIONS,
  SUPPLIER_AGING_PERMISSIONS,
  TREASURY_PERMISSIONS,
  ROLES,
  OWNER_ONLY_PERMISSIONS,
  ROLE_PERMISSIONS,
  assignableRoles,
  effectivePermissions,
  highestRole,
  isFiscalOnly,
  isRole,
  removableRoles,
  resolveAccess,
  scopeIsFiscalFor,
  userCan,
  userCanAll,
  type Permission,
  type Role,
} from "@/lib/auth/permissions";

describe("permission matrix coverage", () => {
  it("every declared permission is granted to at least one role", () => {
    for (const permission of PERMISSIONS) {
      const granted = ROLES.some((role) =>
        ROLE_PERMISSIONS[role].includes(permission),
      );
      expect(granted, `${permission} has no holder`).toBe(true);
    }
  });

  it("ROLE_PERMISSIONS does not contain unknown permissions", () => {
    const declared = new Set<Permission>(PERMISSIONS);
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(declared.has(permission), `${role} → ${permission}`).toBe(true);
      }
    }
  });

  it("owner holds every permission", () => {
    for (const permission of PERMISSIONS) {
      expect(ROLE_PERMISSIONS.owner.includes(permission)).toBe(true);
    }
  });

  it("admin holds every permission except the owner-only ones", () => {
    for (const permission of PERMISSIONS) {
      expect(ROLE_PERMISSIONS.admin.includes(permission)).toBe(
        !OWNER_ONLY_PERMISSIONS.includes(permission),
      );
    }
  });

  it("only the owner deletes movements and rewrites opening balances", () => {
    for (const role of ROLES) {
      for (const permission of OWNER_ONLY_PERMISSIONS) {
        expect(
          ROLE_PERMISSIONS[role].includes(permission),
          `${role} → ${permission}`,
        ).toBe(role === "owner");
      }
    }
  });
});

describe("userCan", () => {
  it("returns false for empty or missing role list", () => {
    expect(userCan(resolveAccess([]), "clients:read")).toBe(false);
    expect(userCan(null, "clients:read")).toBe(false);
    expect(userCan(undefined, "clients:read")).toBe(false);
  });

  it("union of roles inherits the union of permissions", () => {
    expect(userCan(resolveAccess(["finance"]), "vehicles:write")).toBe(false);
    expect(userCan(resolveAccess(["operations"]), "invoices:issue")).toBe(
      false,
    );

    expect(
      userCan(resolveAccess(["finance", "operations"]), "vehicles:write"),
    ).toBe(true);
    expect(
      userCan(resolveAccess(["finance", "operations"]), "invoices:issue"),
    ).toBe(true);
  });

  it("driver's surface is intentionally minimal until G.3", () => {
    expect(userCan(resolveAccess(["driver"]), "trips:read")).toBe(true);
    expect(userCan(resolveAccess(["driver"]), "trips:write")).toBe(false);
    expect(userCan(resolveAccess(["driver"]), "fuel:read")).toBe(false);
  });

  it("warehouse cannot write products (read-only by design)", () => {
    expect(userCan(resolveAccess(["warehouse"]), "products:read")).toBe(true);
    expect(userCan(resolveAccess(["warehouse"]), "products:write")).toBe(false);
  });

  it("finance can read clients but cannot manage drivers", () => {
    expect(userCan(resolveAccess(["finance"]), "clients:write")).toBe(true);
    expect(userCan(resolveAccess(["finance"]), "drivers:write")).toBe(false);
  });

  it("fleet (incl. fleet_documents) is managed by owner/admin/operations", () => {
    for (const role of ["owner", "admin", "operations"] as const) {
      expect(userCan(resolveAccess([role]), "fleet_documents:read")).toBe(true);
      expect(userCan(resolveAccess([role]), "fleet_documents:write")).toBe(
        true,
      );
    }
    expect(userCan(resolveAccess(["finance"]), "fleet_documents:write")).toBe(
      false,
    );
    expect(userCan(resolveAccess(["driver"]), "fleet_documents:read")).toBe(
      false,
    );
  });

  it("recurring_payments is managed by owner/admin/finance only", () => {
    for (const role of ["owner", "admin", "finance"] as const) {
      expect(userCan(resolveAccess([role]), "recurring_payments:read")).toBe(
        true,
      );
      expect(userCan(resolveAccess([role]), "recurring_payments:write")).toBe(
        true,
      );
    }
    expect(
      userCan(resolveAccess(["operations"]), "recurring_payments:read"),
    ).toBe(false);
    expect(
      userCan(resolveAccess(["warehouse"]), "recurring_payments:write"),
    ).toBe(false);
  });

  it("audit:read is restricted to owner and admin", () => {
    expect(userCan(resolveAccess(["owner"]), "audit:read")).toBe(true);
    expect(userCan(resolveAccess(["admin"]), "audit:read")).toBe(true);
    expect(userCan(resolveAccess(["finance"]), "audit:read")).toBe(false);
    expect(userCan(resolveAccess(["operations"]), "audit:read")).toBe(false);
    expect(userCan(resolveAccess(["warehouse"]), "audit:read")).toBe(false);
    expect(userCan(resolveAccess(["driver"]), "audit:read")).toBe(false);
  });

  it("ai:chat and ai:read reach owner/admin/finance/operations, not warehouse/driver", () => {
    for (const role of ["owner", "admin", "finance", "operations"] as const) {
      expect(userCan(resolveAccess([role]), "ai:chat")).toBe(true);
      expect(userCan(resolveAccess([role]), "ai:read")).toBe(true);
    }
    expect(userCan(resolveAccess(["warehouse"]), "ai:chat")).toBe(false);
    expect(userCan(resolveAccess(["warehouse"]), "ai:read")).toBe(false);
    expect(userCan(resolveAccess(["driver"]), "ai:read")).toBe(false);
  });

  it("ai:admin is restricted to owner and admin", () => {
    expect(userCan(resolveAccess(["owner"]), "ai:admin")).toBe(true);
    expect(userCan(resolveAccess(["admin"]), "ai:admin")).toBe(true);
    expect(userCan(resolveAccess(["finance"]), "ai:admin")).toBe(false);
    expect(userCan(resolveAccess(["operations"]), "ai:admin")).toBe(false);
  });
});

describe("userCanAll", () => {
  it("requires every permission", () => {
    const finance = resolveAccess(["finance"], []);
    expect(userCanAll(finance, CLIENT_AGING_PERMISSIONS)).toBe(true);
    expect(userCanAll(finance, SUPPLIER_AGING_PERMISSIONS)).toBe(true);
  });

  it("operations keeps clients:read but no longer reaches aging", () => {
    const operations = resolveAccess(["operations"], []);
    expect(userCan(operations, "clients:read")).toBe(true);
    expect(userCanAll(operations, CLIENT_AGING_PERMISSIONS)).toBe(false);
    expect(userCanAll(operations, SUPPLIER_AGING_PERMISSIONS)).toBe(false);
  });

  it("a deny on any one permission closes the gate", () => {
    const access = resolveAccess(["finance"], ["receipts:read"]);
    expect(userCanAll(access, CLIENT_AGING_PERMISSIONS)).toBe(false);
  });

  it("a single permission behaves like userCan", () => {
    const operations = resolveAccess(["operations"], []);
    expect(userCanAll(operations, "clients:read")).toBe(true);
    expect(userCanAll(operations, "invoices:read")).toBe(false);
  });

  it("an empty list or a missing access never grants", () => {
    expect(userCanAll(resolveAccess(["owner"], []), [])).toBe(false);
    expect(userCanAll(null, ["clients:read"])).toBe(false);
  });
});

describe("per-user denies", () => {
  it("a denied permission is refused even though a role grants it", () => {
    const access = resolveAccess(["finance"], ["invoices:issue"]);
    expect(userCan(access, "invoices:issue")).toBe(false);
    expect(userCan(access, "invoices:read")).toBe(true);
  });

  it("denying a resource's read takes every action of that resource", () => {
    const access = resolveAccess(["finance"], ["accounts:read"]);
    expect(userCan(access, "accounts:read")).toBe(false);
    expect(userCan(access, "accounts:write")).toBe(false);
    expect(userCan(access, "transactions:read")).toBe(true);
  });

  it("denying ai:read keeps the assistant: AI features are denied one by one", () => {
    const access = resolveAccess(["finance"], ["ai:read"]);
    expect(userCan(access, "ai:read")).toBe(false);
    expect(userCan(access, "ai:chat")).toBe(true);
  });

  it("an owner cannot be denied anything", () => {
    const access = resolveAccess(["owner"], ["accounts:read", "users:read"]);
    expect(access.denied).toEqual([]);
    expect(userCan(access, "accounts:write")).toBe(true);
  });

  it("drops deny strings that are not permissions", () => {
    expect(
      resolveAccess(["finance"], ["nope:read", "accounts"]).denied,
    ).toEqual([]);
  });

  it("effectivePermissions counts what userCan allows", () => {
    for (const [roles, denied] of [
      [["finance"], ["accounts:read", "invoices:cancel"]],
      [["owner"], ["accounts:read"]],
      [["operations", "warehouse"], ["pallets:write"]],
      [[], []],
    ] as const) {
      const access = resolveAccess(roles, denied);
      expect([...effectivePermissions(roles, denied)].sort()).toEqual(
        PERMISSIONS.filter((p) => userCan(access, p)).sort(),
      );
    }
  });
});

describe("assignableRoles / removableRoles", () => {
  it("owner can give and take any role, including owner", () => {
    expect(assignableRoles(resolveAccess(["owner"]))).toEqual([...ROLES]);
    expect(removableRoles(resolveAccess(["owner"]))).toEqual([...ROLES]);
  });

  it("admin can give and take any role except owner", () => {
    const admin = resolveAccess(["admin"]);
    expect(assignableRoles(admin)).toEqual(ROLES.filter((r) => r !== "owner"));
    expect(removableRoles(admin)).toEqual(ROLES.filter((r) => r !== "owner"));
  });

  it("non-admin roles cannot assign anything", () => {
    const nonPrivileged: Role[] = [
      "finance",
      "operations",
      "warehouse",
      "driver",
      "fiscal_reader",
    ];
    for (const actor of nonPrivileged) {
      expect(assignableRoles(resolveAccess([actor]))).toEqual([]);
      expect(removableRoles(resolveAccess([actor]))).toEqual([]);
    }
  });

  it("an actor denied users:assign_role assigns and removes nothing", () => {
    const admin = resolveAccess(["admin"], ["users:assign_role"]);
    expect(assignableRoles(admin)).toEqual([]);
    expect(removableRoles(admin)).toEqual([]);
  });

  it("an admin cannot give a role that carries a permission denied to them", () => {
    const admin = resolveAccess(["admin"], ["invoices:issue"]);
    expect(assignableRoles(admin)).not.toContain("finance");
    expect(assignableRoles(admin)).not.toContain("admin");
    expect(assignableRoles(admin)).toContain("operations");
    expect(removableRoles(admin)).toContain("finance");
  });
});

describe("fiscal_reader", () => {
  it("reads the fiscal modules and writes nothing", () => {
    const reader = resolveAccess(["fiscal_reader"]);
    for (const p of [
      "invoices:read",
      "purchase_invoices:read",
      "accounting:read",
      "clients:read",
      "suppliers:read",
    ] as const) {
      expect(userCan(reader, p), p).toBe(true);
    }
    for (const p of [
      "receipts:read",
      "payment_orders:read",
      "transactions:read",
      "accounts:read",
      "hr:read",
      "ai:chat",
      "files:read",
    ] as const) {
      expect(userCan(reader, p), p).toBe(false);
    }
    expect(
      [...ROLE_PERMISSIONS.fiscal_reader].filter((p) => !p.endsWith(":read")),
    ).toEqual([]);
  });

  it("does not reach treasury, cash flow or loans through accounting:read", () => {
    expect(
      userCanAll(resolveAccess(["fiscal_reader"]), TREASURY_PERMISSIONS),
    ).toBe(false);
    for (const role of ["owner", "admin", "finance"] as const) {
      expect(userCanAll(resolveAccess([role]), TREASURY_PERMISSIONS)).toBe(
        true,
      );
    }
  });

  it("pins a fiscal-only user to fiscal channels", () => {
    const reader = resolveAccess(["fiscal_reader"]);
    expect(isFiscalOnly(reader)).toBe(true);
    expect(scopeIsFiscalFor(reader, null)).toBe(true);
    expect(scopeIsFiscalFor(reader, false)).toBe(true);
    expect(scopeIsFiscalFor(reader, undefined)).toBe(true);
  });

  it("does not pin a user who also holds another role, or none", () => {
    const both = resolveAccess(["fiscal_reader", "finance"]);
    expect(isFiscalOnly(both)).toBe(false);
    expect(scopeIsFiscalFor(both, null)).toBe(null);
    expect(scopeIsFiscalFor(both, false)).toBe(false);
    expect(isFiscalOnly(resolveAccess([]))).toBe(false);
    expect(isFiscalOnly(null)).toBe(false);
    expect(scopeIsFiscalFor(resolveAccess(["finance"]), undefined)).toBe(null);
  });
});

describe("highestRole", () => {
  it("returns the most privileged role from a union", () => {
    expect(highestRole(["finance", "owner", "driver"])).toBe("owner");
    expect(highestRole(["operations", "warehouse"])).toBe("operations");
    expect(highestRole(["driver"])).toBe("driver");
    expect(highestRole(["fiscal_reader", "driver"])).toBe("driver");
  });

  it("returns null for empty", () => {
    expect(highestRole([])).toBe(null);
  });
});

describe("isRole", () => {
  it("guards against arbitrary strings", () => {
    expect(isRole("owner")).toBe(true);
    expect(isRole("ghost")).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(42)).toBe(false);
  });
});

describe("full matrix snapshot (guards against silent privilege creep)", () => {
  // Pins the entire role → permissions grid. Any added/removed grant — e.g.
  // giving `operations` accounting:write — fails this test until the snapshot is
  // consciously updated. Replaces the old spot-checks that let creep through.
  it("owner holds every permission; admin all but the owner-only ones", () => {
    expect([...ROLE_PERMISSIONS.owner].sort()).toEqual([...PERMISSIONS].sort());
    expect([...ROLE_PERMISSIONS.admin].sort()).toEqual(
      PERMISSIONS.filter(
        (p) =>
          p !== "users:manage_access" &&
          p !== "transactions:delete" &&
          p !== "opening_balances:write",
      ).sort(),
    );
  });

  it("pins the exact permission set of every restricted role", () => {
    const restricted = Object.fromEntries(
      (
        [
          "finance",
          "operations",
          "warehouse",
          "driver",
          "fiscal_reader",
        ] as const
      ).map((r) => [r, [...ROLE_PERMISSIONS[r]].sort()]),
    );
    expect(restricted).toMatchInlineSnapshot(`
      {
        "driver": [
          "trips:read",
        ],
        "finance": [
          "accounting:read",
          "accounting:write",
          "accounts:read",
          "accounts:write",
          "ai:chat",
          "ai:read",
          "channels:read",
          "cheques:read",
          "cheques:write",
          "clients:read",
          "clients:write",
          "credit_debit_notes:issue",
          "credit_debit_notes:read",
          "email:send",
          "files:read",
          "files:write",
          "hr:read",
          "hr:write",
          "invoices:cancel",
          "invoices:issue",
          "invoices:read",
          "issued_checks:read",
          "issued_checks:write",
          "padron:lookup",
          "payment_orders:read",
          "payment_orders:write",
          "purchase_invoices:cancel",
          "purchase_invoices:read",
          "purchase_invoices:write",
          "receipts:read",
          "receipts:write",
          "recurring_payments:read",
          "recurring_payments:write",
          "retentions:read",
          "retentions:write",
          "storage_billing:issue",
          "storage_billing:read",
          "suppliers:read",
          "suppliers:write",
          "transactions:read",
          "transactions:write",
        ],
        "fiscal_reader": [
          "accounting:read",
          "channels:read",
          "clients:read",
          "credit_debit_notes:read",
          "invoices:read",
          "purchase_invoices:read",
          "suppliers:read",
        ],
        "operations": [
          "ai:chat",
          "ai:read",
          "channels:read",
          "clients:read",
          "drivers:read",
          "drivers:write",
          "files:read",
          "files:write",
          "fleet_documents:read",
          "fleet_documents:write",
          "fuel:read",
          "fuel:write",
          "maintenance:read",
          "maintenance:write",
          "shipments:read",
          "shipments:write",
          "suppliers:read",
          "trips:read",
          "trips:write",
          "vehicles:read",
          "vehicles:write",
        ],
        "warehouse": [
          "files:read",
          "files:write",
          "pallets:read",
          "pallets:write",
          "products:read",
          "stock_movements:read",
          "stock_movements:write",
          "warehouses:read",
          "warehouses:write",
        ],
      }
    `);
  });
});
