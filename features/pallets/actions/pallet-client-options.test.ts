import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";

// The warehouse role loads pallets but not the clients module: the pallet
// client picker must still list clients for it, and only behind pallets:read.

let roles: Role[] = ["warehouse"];
let clients: { id: string; legal_name: string }[] = [];
let failAt: number | null = null;
const orders: string[] = [];
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
        order: (col: string) => {
          orders.push(col);
          return b;
        },
        // The server caps every response at 1000 rows, whatever is asked.
        range: async (lo: number, hi: number) =>
          failAt === lo
            ? { data: null, error: { message: "boom" } }
            : {
                data: clients.slice(lo, Math.min(hi + 1, lo + 1000)),
                error: null,
              },
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

beforeEach(() => {
  roles = ["warehouse"];
  fromSpy.mockClear();
  clients = [{ id: "c1", legal_name: "Cliente Depósito" }];
  failAt = null;
  orders.length = 0;
});

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

  it("lists every active client past the 1000-row cap, by name then id", async () => {
    clients = Array.from({ length: 1500 }, (_, i) => ({
      id: `c${String(i).padStart(4, "0")}`,
      legal_name: `Cliente ${String(i).padStart(4, "0")}`,
    }));
    const res = await listPalletClientOptionsAction();
    expect(res.ok && res.data.length).toBe(1500);
    expect(orders.slice(0, 2)).toEqual(["legal_name", "id"]);
  });

  it("a failed later page is an error, not a short list", async () => {
    clients = Array.from({ length: 1500 }, (_, i) => ({
      id: `c${i}`,
      legal_name: `Cliente ${i}`,
    }));
    failAt = 1000;
    const res = await listPalletClientOptionsAction();
    expect(res.ok).toBe(false);
  });
});
