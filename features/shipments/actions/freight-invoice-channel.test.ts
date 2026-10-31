import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  filterValue,
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const SHIPMENT_ID = "00000000-0000-4000-8000-000000000001";

const issue = vi.fn();
let shipmentChannel: string | null = "jouve_internal";
let claimed = true;
let fake = recordingSupabase(respond);

function respond(call: RecordedCall) {
  if (call.table === "shipments" && call.op === "update") {
    const isClaim =
      typeof call.payload === "object" &&
      call.payload !== null &&
      "invoicing_claimed_at" in call.payload &&
      call.payload.invoicing_claimed_at !== null;
    if (isClaim) {
      return { data: claimed ? [{ id: SHIPMENT_ID }] : [], error: null };
    }
    return { data: null, error: null };
  }
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

const updates = () =>
  fake.calls.filter((c) => c.table === "shipments" && c.op === "update");

beforeEach(() => {
  issue.mockReset();
  issue.mockResolvedValue({ ok: true, data: { id: "inv1" } });
  claimed = true;
  fake = recordingSupabase(respond);
});

describe("invoiceFreightAction", () => {
  it("refuses a channel other than the shipment's, without issuing, and releases the claim", async () => {
    shipmentChannel = "jouve_internal";
    const res = await invoiceFreightAction({
      shipmentId: SHIPMENT_ID,
      channel_id: "jouve_fiscal",
      punto_venta: 3,
    });
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
    const release = updates().at(-1);
    expect(release?.payload).toEqual({ invoicing_claimed_at: null });
    expect(release && filterValue(release, "is", "invoice_id")).toBeNull();
  });

  it("issues on the shipment's own channel and links the invoice", async () => {
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
    expect(updates().at(-1)?.payload).toEqual({
      invoice_id: "inv1",
      invoicing_claimed_at: null,
    });
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

  it("claims only an unbilled shipment and never issues when the claim is lost", async () => {
    claimed = false;
    const res = await invoiceFreightAction({
      shipmentId: SHIPMENT_ID,
      channel_id: "jouve_internal",
      punto_venta: 3,
    });
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
    const claim = updates()[0];
    expect(claim && filterValue(claim, "is", "invoice_id")).toBeNull();
  });
});
