import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

// A per-user deny of stock_movements:write stops entering, dispatching,
// removing or moving a pallet; editing its notes still works.

let denied: string[] = [];
const updates: unknown[] = [];
const stored = {
  warehouse_id: "11111111-1111-4111-8111-111111111111",
  status: "en_deposito",
  quantity: 4,
  entry_date: "2026-10-01",
  exit_date: null,
};

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["warehouse"], denied),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: stored, error: null }),
        update: (patch: unknown) => {
          updates.push(patch);
          return { eq: async () => ({ error: null }) };
        },
      };
      return b;
    },
  }),
}));

const { createPalletAction, deletePalletAction, updatePalletAction } =
  await import("./pallets-actions");

const ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  denied = [];
  updates.length = 0;
});

describe("pallet stock-movement gate", () => {
  it("refuses entering or removing a pallet when stock movements are denied", async () => {
    denied = ["stock_movements:write"];
    expect((await createPalletAction({})).ok).toBe(false);
    expect((await deletePalletAction({ id: ID })).ok).toBe(false);
  });

  it("refuses moving a pallet when stock movements are denied", async () => {
    denied = ["stock_movements:write"];
    const res = await updatePalletAction({ id: ID, ...stored, quantity: 5 });
    expect(res).toEqual({
      ok: false,
      error: "No tenés permiso para registrar movimientos de stock.",
    });
    expect(updates).toEqual([]);
  });

  it("lets the dialog save a notes-only edit (every field sent, unchanged)", async () => {
    denied = ["stock_movements:write"];
    const res = await updatePalletAction({ id: ID, ...stored, notes: "x" });
    expect(res.ok).toBe(true);
    expect(updates).toHaveLength(1);
  });
});
