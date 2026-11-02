import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
let denied: string[] = [];
const from = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denied),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from }),
}));

const { listCostTagOptionsAction } = await import("./cost-tag-options-actions");

function tables(accounts: unknown[], centers: unknown[]) {
  from.mockImplementation((table: string) =>
    table === "expense_leaf_accounts"
      ? { select: async () => ({ data: accounts, error: null }) }
      : {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: centers, error: null }),
            }),
          }),
        },
  );
}

beforeEach(() => {
  roles = ["finance"];
  denied = [];
  from.mockReset();
});

describe("listCostTagOptionsAction", () => {
  it("is refused to a role that neither loads costs nor reads the books", async () => {
    roles = ["operations"];
    const res = await listCostTagOptionsAction();
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("still answers a purchase loader denied accounting:read", async () => {
    denied = ["accounting:read"];
    tables([], []);
    const res = await listCostTagOptionsAction();
    expect(res.ok).toBe(true);
  });

  it("orders accounts by chart code, segment by segment", async () => {
    tables(
      [
        { id: "b", code: "5.10.1", name: "Peajes" },
        { id: "a", code: "5.2.1", name: "Combustible" },
      ],
      [{ id: "c", code: "ADMIN", name: "Administración" }],
    );
    const res = await listCostTagOptionsAction();
    expect(res.ok && res.data.expenseAccounts.map((a) => a.id)).toEqual([
      "a",
      "b",
    ]);
    expect(res.ok && res.data.costCenters).toHaveLength(1);
  });

  it("reports a failed read as an error, not as no options", async () => {
    from.mockImplementation((table: string) =>
      table === "expense_leaf_accounts"
        ? {
            select: async () => ({ data: null, error: { message: "boom" } }),
          }
        : {
            select: () => ({
              eq: () => ({ order: async () => ({ data: [], error: null }) }),
            }),
          },
    );
    const res = await listCostTagOptionsAction();
    expect(res.ok).toBe(false);
  });
});
