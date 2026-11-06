import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  filterValue,
  recordingSupabase,
} from "@/tests/helpers/recording-supabase";

// A per-user deny of stock_movements:write stops entering, dispatching,
// removing or moving a pallet; editing its notes still works, and only while
// the stock fields still hold what the edit was checked against.

let denied: string[] = [];
let updatedRows: { id: string }[] = [];
const stored = {
  warehouse_id: "11111111-1111-4111-8111-111111111111",
  status: "en_deposito",
  quantity: 4,
  entry_date: "2026-10-01",
  exit_date: null,
};
let fake = recordingSupabase();

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
  createClient: async () => fake.client,
}));

const { createPalletAction, deletePalletAction, updatePalletAction } =
  await import("./pallets-actions");

const ID = "22222222-2222-4222-8222-222222222222";

function updates() {
  return fake.calls.filter((c) => c.op === "update");
}

beforeEach(() => {
  denied = [];
  updatedRows = [{ id: ID }];
  fake = recordingSupabase((call) =>
    call.op === "update"
      ? { data: updatedRows, error: null }
      : { data: stored, error: null },
  );
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
    expect(updates()).toEqual([]);
  });

  it("lets the dialog save a notes-only edit (every field sent, unchanged)", async () => {
    denied = ["stock_movements:write"];
    const res = await updatePalletAction({ id: ID, ...stored, notes: "x" });
    expect(res.ok).toBe(true);
    expect(updates()).toHaveLength(1);
  });

  it("updates only while the stock fields still hold the values it checked", async () => {
    denied = ["stock_movements:write"];
    await updatePalletAction({ id: ID, ...stored, notes: "x" });
    const [call] = updates();
    expect(filterValue(call!, "eq", "warehouse_id")).toBe(stored.warehouse_id);
    expect(filterValue(call!, "eq", "status")).toBe(stored.status);
    expect(filterValue(call!, "eq", "quantity")).toBe(stored.quantity);
    expect(filterValue(call!, "eq", "entry_date")).toBe(stored.entry_date);
    expect(call!.filters).toContainEqual(["is", "exit_date", null]);
  });

  it("refuses the edit when the pallet moved after the check", async () => {
    denied = ["stock_movements:write"];
    updatedRows = [];
    const res = await updatePalletAction({ id: ID, ...stored, notes: "x" });
    expect(res).toEqual({
      ok: false,
      error: "El pallet cambió mientras lo editabas: volvé a abrirlo.",
    });
  });

  it("does not pin the stock fields for a user who may move stock", async () => {
    await updatePalletAction({ id: ID, ...stored, quantity: 5 });
    const [call] = updates();
    expect(call!.filters).toEqual([["eq", "id", ID]]);
  });
});
