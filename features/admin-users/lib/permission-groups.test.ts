import { describe, expect, it } from "vitest";

import { PERMISSIONS, permissionResource } from "@/lib/auth/permissions";

import {
  MODULE_RESOURCES,
  PERMISSION_GROUPS,
  permissionLabel,
  permissionsOf,
} from "./permission-groups";

describe("permission groups", () => {
  it("label every resource of the matrix", () => {
    const resources = new Set(PERMISSIONS.map(permissionResource));
    expect([...resources].sort()).toEqual(
      Object.keys(PERMISSION_GROUPS).sort(),
    );
  });

  it("label every permission's verb", () => {
    for (const permission of PERMISSIONS) {
      expect(permissionLabel(permission)).not.toBe(
        permission.slice(permission.indexOf(":") + 1),
      );
    }
  });

  it("put every permission in exactly one group", () => {
    const grouped = Object.keys(PERMISSION_GROUPS).flatMap((r) =>
      permissionsOf(r as keyof typeof PERMISSION_GROUPS),
    );
    expect(grouped.sort()).toEqual([...PERMISSIONS].sort());
  });

  it("offer hiding a module only where it has a read permission", () => {
    expect(MODULE_RESOURCES).toContain("accounts");
    expect(MODULE_RESOURCES).not.toContain("padron");
    expect(MODULE_RESOURCES).not.toContain("afip");
    expect(MODULE_RESOURCES).not.toContain("email");
    expect(MODULE_RESOURCES).not.toContain("ai");
  });
});
