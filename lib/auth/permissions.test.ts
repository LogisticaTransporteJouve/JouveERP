import { describe, expect, it } from "vitest";

import {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  canAssignRole,
  highestRole,
  isRole,
  userCan,
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

  it("admin holds every permission too — separation lives in canAssignRole", () => {
    for (const permission of PERMISSIONS) {
      expect(ROLE_PERMISSIONS.admin.includes(permission)).toBe(true);
    }
  });
});

describe("userCan", () => {
  it("returns false for empty or missing role list", () => {
    expect(userCan([], "clients:read")).toBe(false);
    expect(userCan(null, "clients:read")).toBe(false);
    expect(userCan(undefined, "clients:read")).toBe(false);
  });

  it("union of roles inherits the union of permissions", () => {
    expect(userCan(["finance"], "vehicles:write")).toBe(false);
    expect(userCan(["operations"], "invoices:issue")).toBe(false);

    expect(userCan(["finance", "operations"], "vehicles:write")).toBe(true);
    expect(userCan(["finance", "operations"], "invoices:issue")).toBe(true);
  });

  it("driver's surface is intentionally minimal until G.3", () => {
    expect(userCan(["driver"], "trips:read")).toBe(true);
    expect(userCan(["driver"], "trips:write")).toBe(false);
    expect(userCan(["driver"], "fuel:read")).toBe(false);
  });

  it("warehouse cannot write products (read-only by design)", () => {
    expect(userCan(["warehouse"], "products:read")).toBe(true);
    expect(userCan(["warehouse"], "products:write")).toBe(false);
  });

  it("finance can read clients but cannot manage drivers", () => {
    expect(userCan(["finance"], "clients:write")).toBe(true);
    expect(userCan(["finance"], "drivers:write")).toBe(false);
  });

  it("fleet (incl. fleet_documents) is managed by owner/admin/operations", () => {
    for (const role of ["owner", "admin", "operations"] as const) {
      expect(userCan([role], "fleet_documents:read")).toBe(true);
      expect(userCan([role], "fleet_documents:write")).toBe(true);
    }
    expect(userCan(["finance"], "fleet_documents:write")).toBe(false);
    expect(userCan(["driver"], "fleet_documents:read")).toBe(false);
  });

  it("recurring_payments is managed by owner/admin/finance only", () => {
    for (const role of ["owner", "admin", "finance"] as const) {
      expect(userCan([role], "recurring_payments:read")).toBe(true);
      expect(userCan([role], "recurring_payments:write")).toBe(true);
    }
    expect(userCan(["operations"], "recurring_payments:read")).toBe(false);
    expect(userCan(["warehouse"], "recurring_payments:write")).toBe(false);
  });

  it("audit:read is restricted to owner and admin", () => {
    expect(userCan(["owner"], "audit:read")).toBe(true);
    expect(userCan(["admin"], "audit:read")).toBe(true);
    expect(userCan(["finance"], "audit:read")).toBe(false);
    expect(userCan(["operations"], "audit:read")).toBe(false);
    expect(userCan(["warehouse"], "audit:read")).toBe(false);
    expect(userCan(["driver"], "audit:read")).toBe(false);
  });

  it("ai:chat and ai:read reach owner/admin/finance/operations, not warehouse/driver", () => {
    for (const role of ["owner", "admin", "finance", "operations"] as const) {
      expect(userCan([role], "ai:chat")).toBe(true);
      expect(userCan([role], "ai:read")).toBe(true);
    }
    expect(userCan(["warehouse"], "ai:chat")).toBe(false);
    expect(userCan(["warehouse"], "ai:read")).toBe(false);
    expect(userCan(["driver"], "ai:read")).toBe(false);
  });

  it("ai:admin is restricted to owner and admin", () => {
    expect(userCan(["owner"], "ai:admin")).toBe(true);
    expect(userCan(["admin"], "ai:admin")).toBe(true);
    expect(userCan(["finance"], "ai:admin")).toBe(false);
    expect(userCan(["operations"], "ai:admin")).toBe(false);
  });
});

describe("canAssignRole", () => {
  it("owner can grant any role, including owner", () => {
    for (const target of ROLES) {
      expect(canAssignRole(["owner"], target)).toBe(true);
    }
  });

  it("admin can grant any role except owner", () => {
    expect(canAssignRole(["admin"], "owner")).toBe(false);
    for (const target of ROLES.filter((r) => r !== "owner")) {
      expect(canAssignRole(["admin"], target)).toBe(true);
    }
  });

  it("non-admin roles cannot assign anything", () => {
    const nonPrivileged: Role[] = ["finance", "operations", "warehouse", "driver"];
    for (const actor of nonPrivileged) {
      for (const target of ROLES) {
        expect(canAssignRole([actor], target)).toBe(false);
      }
    }
  });

  it("returns false for empty actor roles", () => {
    expect(canAssignRole([], "finance")).toBe(false);
    expect(canAssignRole(null, "finance")).toBe(false);
    expect(canAssignRole(undefined, "finance")).toBe(false);
  });
});

describe("highestRole", () => {
  it("returns the most privileged role from a union", () => {
    expect(highestRole(["finance", "owner", "driver"])).toBe("owner");
    expect(highestRole(["operations", "warehouse"])).toBe("operations");
    expect(highestRole(["driver"])).toBe("driver");
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
