import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const SHIPMENT_ID = "00000000-0000-4000-8000-000000000001";

const issue = vi.fn();
let shipmentChannel: string | null = "jouve_internal";
let fake = recordingSupabase(respond);

function respond(call: RecordedCall) {
  if (call.table === "shipments" && call.op === "select") {
    return {
      data: {
        id: SHIPMENT_ID,
        client_id: "c1",
        channel_id: shipmentChannel,
        origin: "A",
        destination: "B",
        freight_amount: 1000,
        invoice_id: null,
        scheduled_date: "2026-10-01",
        delivery_date: null,
        client: { cuit: "30111111118", iva_condition: "responsable_inscripto" },
      },
      error: null,
    };
  }
  return { data: null, error: null };
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
vi.mock("@/lib/channels", () => ({
  getActiveInvoicingChannels: async () => [],
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  issueFiscalInvoiceAction: (input: unknown) => issue(input),
}));

const { invoiceFreightAction } = await import("./shipments-actions");

beforeEach(() => {
  issue.mockReset();
  issue.mockResolvedValue({ ok: true, data: { id: "inv1" } });
  fake = recordingSupabase(respond);
});

describe("invoiceFreightAction", () => {
  it("refuses a channel other than the shipment's, without issuing", async () => {
    shipmentChannel = "jouve_internal";
    const res = await invoiceFreightAction({
      shipmentId: SHIPMENT_ID,
      channel_id: "jouve_fiscal",
      punto_venta: 3,
    });
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
  });

  it("issues on the shipment's own channel", async () => {
    shipmentChannel = "jouve_internal";
    const res = await invoiceFreightAction({
      shipmentId: SHIPMENT_ID,
      channel_id: "jouve_internal",
      punto_venta: 3,
    });
    expect(res.ok).toBe(true);
    expect(issue).toHaveBeenCalledWith(
      expect.objectContaining({ channel_id: "jouve_internal" }),
    );
  });

  it("a shipment with no channel takes the chosen one", async () => {
    shipmentChannel = null;
    const res = await invoiceFreightAction({
      shipmentId: SHIPMENT_ID,
      channel_id: "jouve_fiscal",
      punto_venta: 3,
    });
    expect(res.ok).toBe(true);
    expect(issue).toHaveBeenCalledOnce();
  });
});
