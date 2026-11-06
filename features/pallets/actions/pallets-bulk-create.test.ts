import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import { recordingSupabase } from "@/tests/helpers/recording-supabase";

// Bulk entry numbers its codes in the database (create_pallets_bulk, one load
// per prefix at a time): the action no longer reads the highest code and
// inserts the next ones itself, which two loads at once both did.

const logAudit = vi.fn();
let fake = recordingSupabase();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["warehouse"], []),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));

const { createPalletsBulkAction } = await import("./pallets-actions");

const INPUT = {
  warehouse_id: "11111111-1111-4111-8111-111111111111",
  client_id: "33333333-3333-4333-8333-333333333333",
  entry_date: "2026-11-06",
  count: 3,
  code_prefix: "PAL",
};

beforeEach(() => {
  logAudit.mockReset();
  fake = recordingSupabase((call) =>
    call.op === "rpc" ? { data: 3, error: null } : { data: [], error: null },
  );
});

describe("createPalletsBulkAction", () => {
  it("creates the pallets through create_pallets_bulk, in one call", async () => {
    const res = await createPalletsBulkAction(INPUT);
    expect(res).toEqual({ ok: true, data: { created: 3 } });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      table: "create_pallets_bulk",
      op: "rpc",
      payload: {
        p_code_prefix: "PAL",
        p_count: 3,
        p_warehouse_id: INPUT.warehouse_id,
        p_client_id: INPUT.client_id,
        p_entry_date: "2026-11-06",
      },
    });
    expect(logAudit).toHaveBeenCalledWith("pallet.bulk_created", "u1", {
      count: 3,
    });
  });

  it("returns the database guard's message", async () => {
    fake = recordingSupabase(() => ({
      data: null,
      error: {
        code: "22023",
        message: "Se cargan de 1 a 500 pallets por vez.",
        hint: "jouve_guard",
      },
    }));
    const res = await createPalletsBulkAction(INPUT);
    expect(res).toEqual({
      ok: false,
      error: "Se cargan de 1 a 500 pallets por vez.",
    });
    expect(logAudit).not.toHaveBeenCalled();
  });
});
