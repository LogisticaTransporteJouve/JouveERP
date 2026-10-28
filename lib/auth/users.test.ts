import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  roleRows: [] as { user_id: string; role_id: string }[],
  denyRows: [] as { user_id: string; permission: string }[],
  denyFilters: [] as Array<[string, readonly string[]]>,
}));

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      const result =
        table === "user_roles"
          ? { data: h.roleRows, error: null }
          : { data: h.denyRows, error: null };
      const b = {
        select: () => b,
        in: (column: string, values: readonly string[]) => {
          if (table === "user_permission_denies") {
            h.denyFilters.push([column, values]);
          }
          return b;
        },
        then: <T>(resolve: (v: typeof result) => T) =>
          Promise.resolve(resolve(result)),
      };
      return b;
    },
  }),
}));

const { listUserIdsWithPermission } = await import("./users");

beforeEach(() => {
  h.roleRows = [];
  h.denyRows = [];
  h.denyFilters = [];
});

describe("listUserIdsWithPermission", () => {
  it("drops holders denied the permission or its whole module", async () => {
    h.roleRows = [
      { user_id: "u1", role_id: "finance" },
      { user_id: "u2", role_id: "finance" },
      { user_id: "u3", role_id: "admin" },
      { user_id: "u4", role_id: "owner" },
    ];
    h.denyRows = [
      { user_id: "u2", permission: "hr:read" },
      { user_id: "u4", permission: "hr:read" },
    ];
    expect(await listUserIdsWithPermission("hr:read")).toEqual([
      "u1",
      "u3",
      "u4",
    ]);
    expect(h.denyFilters).toEqual([
      ["user_id", ["u1", "u2", "u3", "u4"]],
      ["permission", ["hr:read"]],
    ]);
  });
});
