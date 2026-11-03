import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

// A per-user deny of retentions:write stops loading or changing retentions
// on a receipt; the receipt's other fields stay editable.

let denied: string[] = [];
let storedRetentions: unknown[] = [];
const rpcCalls: string[] = [];

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"], denied),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const b = {
        select: () => b,
        eq: async () => ({ data: storedRetentions, error: null }),
      };
      return b;
    },
    rpc: async (name: string) => {
      rpcCalls.push(name);
      return { data: null, error: null };
    },
  }),
}));

const { createReceiptAction, updateReceiptAction } =
  await import("./receipts-actions");

const retention = {
  kind: "retencion",
  tax_type: "ganancias",
  jurisdiction: null,
  certificate_number: "A-1",
  certificate_date: "2026-10-01",
  amount: 100,
  notes: null,
};

const update = (retentions: unknown[], total: number) => ({
  id: "33333333-3333-4333-8333-333333333333",
  receipt_date: "2026-10-02",
  total_amount: total,
  payment_lines: [
    { account_id: "44444444-4444-4444-8444-444444444444", amount: 900 },
  ],
  retentions,
});

beforeEach(() => {
  denied = ["retentions:write"];
  storedRetentions = [];
  rpcCalls.length = 0;
});

describe("receipt retentions gate", () => {
  it("refuses a new receipt that carries retentions", async () => {
    const res = await createReceiptAction({
      channel_id: "jouve_fiscal",
      numero: 1,
      client_id: "55555555-5555-4555-8555-555555555555",
      receipt_date: "2026-10-02",
      total_amount: 1000,
      currency: "ARS",
      payment_lines: [
        { account_id: "44444444-4444-4444-8444-444444444444", amount: 900 },
      ],
      retentions: [retention],
    });
    expect(res).toEqual({
      ok: false,
      error: "No tenés permiso para cargar o editar retenciones.",
    });
  });

  it("refuses an edit that adds a retention", async () => {
    const res = await updateReceiptAction(update([retention], 1000));
    expect(res.ok).toBe(false);
    expect(rpcCalls).toEqual([]);
  });

  it("saves an edit that sends the stored retentions back unchanged", async () => {
    storedRetentions = [{ ...retention, amount: "100.00" }];
    const res = await updateReceiptAction(update([retention], 1000));
    expect(res.ok).toBe(true);
    expect(rpcCalls).toEqual(["update_receipt"]);
  });

  it("does not read the stored retentions when the user may change them", async () => {
    denied = [];
    storedRetentions = [{ ...retention, certificate_number: "Z" }];
    const res = await updateReceiptAction(update([retention], 1000));
    expect(res.ok).toBe(true);
  });
});
