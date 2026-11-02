import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";

// The warehouse role loads pallets but not the clients module: the pallet
// client picker must still list clients for it, and only behind pallets:read.

let roles: Role[] = ["warehouse"];
const clients = [{ id: "c1", legal_name: "Cliente Depósito" }];
const fromSpy = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      fromSpy(table);
      const b = {
        select: () => b,
        eq: () => b,
        order: async () => ({ data: clients, error: null }),
      };
      return b;
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { listPalletClientOptionsAction } = await import("./pallets-actions");

beforeEach(() => fromSpy.mockClear());

describe("listPalletClientOptionsAction", () => {
  it("lists clients for the warehouse role", async () => {
    roles = ["warehouse"];
    expect(await listPalletClientOptionsAction()).toEqual({
      ok: true,
      data: clients,
    });
  });

  it("refuses a role without pallets:read before reading", async () => {
    roles = ["operations"];
    const res = await listPalletClientOptionsAction();
    expect(res.ok).toBe(false);
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
