import { describe, expect, it } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import { canManageClosedPeriods } from "./period-close";

describe("canManageClosedPeriods", () => {
  it("is owner or admin holding accounting:write", () => {
    expect(canManageClosedPeriods(resolveAccess(["owner"]))).toBe(true);
    expect(canManageClosedPeriods(resolveAccess(["admin"]))).toBe(true);
    expect(canManageClosedPeriods(resolveAccess(["finance"]))).toBe(false);
    expect(
      canManageClosedPeriods(resolveAccess(["admin"], ["accounting:write"])),
    ).toBe(false);
  });
});
