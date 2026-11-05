import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import { sourceInvoiceKey } from "@/lib/source-invoice-key";
import {
  filterValue,
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const SHIPMENT_ID = "00000000-0000-4000-8000-000000000001";

const issue = vi.fn();
let shipmentChannel: string | null = "jouve_internal";
let claimed = true;
// The void invoice claim_shipment_for_invoicing unlinked, if any.
let freedInvoice: string | null = null;
// Invoices already issued under the carga's keys.
let priorInvoices: { id: string; status: string; idempotency_key: string }[] =
  [];
// What the live one bills.
let priorBills = { client_id: "c1", imp_neto: 1000 };
// Invoices billing_invoice_is_void answers true for.
let voidInvoices = new Set<string>();
let link: { data: unknown; error: unknown } = { data: null, error: null };
let fake = recordingSupabase(respond);
const key = (attempt: number) =>
  sourceInvoiceKey("shipment_freight", SHIPMENT_ID, attempt);

function respond(call: RecordedCall) {
  if (call.table === "claim_shipment_for_invoicing") {
    return {
      data: [{ claimed, freed_invoice_id: freedInvoice }],
      error: null,
    };
  }
  if (call.table === "billing_invoice_is_void") {
    const id =
      typeof call.payload === "object" &&
      call.payload !== null &&
      "p_invoice_id" in call.payload
        ? call.payload.p_invoice_id
        : null;
    return {
      data: typeof id === "string" && voidInvoices.has(id),
      error: null,
    };
  }
  if (call.table === "shipments" && call.op === "update") {
    if (
      typeof call.payload === "object" &&
      call.payload !== null &&
      "invoice_id" in call.payload
    ) {
      return link;
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
  if (call.table === "invoices") {
    return filterValue(call, "eq", "id") === undefined
      ? { data: priorInvoices, error: null }
      : { data: priorBills, error: null };
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
  readInvoicingChannels: async () => ({ ok: true, channels: [] }),
}));
const logAudit = vi.fn();
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  issueFiscalInvoiceAction: (input: unknown) => issue(input),
}));

const { invoiceFreightAction } = await import("./shipments-actions");

const updates = () =>
  fake.calls.filter((c) => c.table === "shipments" && c.op === "update");

beforeEach(() => {
  issue.mockReset();
  issue.mockResolvedValue({ ok: true, data: { id: "inv1" } });
  logAudit.mockReset();
  claimed = true;
  freedInvoice = null;
  priorInvoices = [];
  priorBills = { client_id: "c1", imp_neto: 1000 };
  voidInvoices = new Set();
  link = { data: null, error: null };
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

  it("issues under the carga's own key", async () => {
    shipmentChannel = null;
    await invoiceFreightAction({
      shipmentId: SHIPMENT_ID,
      channel_id: "jouve_fiscal",
      punto_venta: 3,
    });
    expect(issue).toHaveBeenCalledWith(
      expect.objectContaining({ idempotency_key: key(0) }),
    );
  });

  it("links the invoice an earlier click issued instead of issuing a second one", async () => {
    shipmentChannel = null;
    priorInvoices = [
      { id: "inv0", status: "failed", idempotency_key: key(0) },
      { id: "inv1", status: "emitted", idempotency_key: key(1) },
    ];
    const res = await invoiceFreightAction({
      shipmentId: SHIPMENT_ID,
      channel_id: "jouve_fiscal",
      punto_venta: 3,
    });
    expect(res).toEqual({ ok: true, data: { invoiceId: "inv1" } });
    expect(issue).not.toHaveBeenCalled();
    expect(updates().at(-1)?.payload).toEqual({
      invoice_id: "inv1",
      invoicing_claimed_at: null,
    });
  });

  it("does not link an earlier invoice that bills another client or flete", async () => {
    shipmentChannel = null;
    priorInvoices = [
      { id: "inv0", status: "emitted", idempotency_key: key(0) },
    ];
    for (const bills of [
      { client_id: "c2", imp_neto: 1000 },
      { client_id: "c1", imp_neto: 800 },
    ]) {
      priorBills = bills;
      fake = recordingSupabase(respond);
      const res = await invoiceFreightAction({
        shipmentId: SHIPMENT_ID,
        channel_id: "jouve_fiscal",
        punto_venta: 3,
      });
      expect(res.ok).toBe(false);
      expect(issue).not.toHaveBeenCalled();
      expect(updates().at(-1)?.payload).toEqual({ invoicing_claimed_at: null });
    }
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
    expect(
      fake.calls.find((c) => c.table === "claim_shipment_for_invoicing")
        ?.payload,
    ).toEqual({ p_shipment_id: SHIPMENT_ID });
    expect(updates()).toHaveLength(0);
  });

  it("audits the void invoice the claim unlinked, then bills the carga again", async () => {
    shipmentChannel = null;
    freedInvoice = "inv-credited";
    const res = await invoiceFreightAction({
      shipmentId: SHIPMENT_ID,
      channel_id: "jouve_fiscal",
      punto_venta: 3,
    });
    expect(res).toEqual({ ok: true, data: { invoiceId: "inv1" } });
    expect(logAudit).toHaveBeenCalledWith(
      "shipment.invoice_unlinked",
      "u1",
      { invoice_id: "inv-credited", reason: "invoice_void" },
      SHIPMENT_ID,
    );
  });

  it("issues under the next key when the earlier factura is credited in full", async () => {
    shipmentChannel = null;
    priorInvoices = [
      { id: "inv0", status: "emitted", idempotency_key: key(0) },
    ];
    voidInvoices = new Set(["inv0"]);
    const res = await invoiceFreightAction({
      shipmentId: SHIPMENT_ID,
      channel_id: "jouve_fiscal",
      punto_venta: 3,
    });
    expect(res.ok).toBe(true);
    expect(issue).toHaveBeenCalledWith(
      expect.objectContaining({ idempotency_key: key(1) }),
    );
  });

  it("frees the carga when the link finds its invoice void", async () => {
    shipmentChannel = null;
    link = {
      data: null,
      error: { message: "falló", hint: "jouve_guard", code: "55006" },
    };
    voidInvoices = new Set(["inv1"]);
    const res = await invoiceFreightAction({
      shipmentId: SHIPMENT_ID,
      channel_id: "jouve_fiscal",
      punto_venta: 3,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/quedó libre/);
    const release = updates().at(-1);
    expect(release?.payload).toEqual({ invoicing_claimed_at: null });
    expect(release && filterValue(release, "is", "invoice_id")).toBeNull();
  });

  it("keeps the claim when a live invoice's link is lost", async () => {
    shipmentChannel = null;
    link = { data: null, error: { message: "timeout", code: "57014" } };
    const res = await invoiceFreightAction({
      shipmentId: SHIPMENT_ID,
      channel_id: "jouve_fiscal",
      punto_venta: 3,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sin emitir otra/);
    expect(updates().at(-1)?.payload).toEqual({
      invoice_id: "inv1",
      invoicing_claimed_at: null,
    });
  });
});
