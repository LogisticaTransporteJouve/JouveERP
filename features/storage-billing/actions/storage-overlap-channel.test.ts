import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const CLIENT_ID = "00000000-0000-4000-8000-0000000000c1";

// One run already billed October on the internal channel; a run whose invoice
// is gone has no channel.
let runs: unknown[] = [];
let fake = recordingSupabase(respond);

function respond(call: RecordedCall) {
  if (call.table === "storage_billing_runs") return { data: runs, error: null };
  if (call.table === "clients") {
    return {
      data: {
        id: CLIENT_ID,
        legal_name: "Cliente",
        cuit: "30111111118",
        iva_condition: "responsable_inscripto",
      },
      error: null,
    };
  }
  return { data: [], error: null };
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["owner"], []),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  issueFiscalInvoiceAction: vi.fn(),
}));

const { invoiceStorageAction } = await import("./billing-actions");

const october = (channel_id: string) => ({
  client_id: CLIENT_ID,
  period_start: "2026-10-01",
  period_end: "2026-10-31",
  channel_id,
  punto_venta: 3,
});

const OVERLAP = /ya fue facturado/;

beforeEach(() => {
  fake = recordingSupabase(respond);
});

describe("invoiceStorageAction overlap", () => {
  it("refuses a period already billed on the same channel", async () => {
    runs = [
      {
        period_start: "2026-10-15",
        period_end: "2026-11-14",
        invoice: { channel_id: "jouve_internal" },
      },
    ];
    const res = await invoiceStorageAction(october("jouve_internal"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(OVERLAP);
  });

  it("does not count a period billed on another channel", async () => {
    runs = [
      {
        period_start: "2026-10-15",
        period_end: "2026-11-14",
        invoice: { channel_id: "jouve_internal" },
      },
    ];
    const res = await invoiceStorageAction(october("jouve_fiscal"));
    // Past the overlap guard: nothing to bill with no pallets.
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).not.toMatch(OVERLAP);
  });

  it("a run with no invoice counts against every channel", async () => {
    runs = [
      { period_start: "2026-10-15", period_end: "2026-11-14", invoice: null },
    ];
    const res = await invoiceStorageAction(october("jouve_fiscal"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(OVERLAP);
  });
});
