import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";
import {
  filterValue,
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const ID = "00000000-0000-4000-8000-000000000001";

const issue = vi.fn();
let roles: Role[] = ["owner"];
let status = "confirmed";
let shipmentChannel: string | null = null;
let claimed = true;
let linkError: unknown = null;
let fake = recordingSupabase(respond);

function respond(call: RecordedCall) {
  if (call.table === "freight_settlements" && call.op === "select") {
    return {
      data: {
        id: ID,
        numero: 12,
        client_id: "c1",
        period_start: "2026-10-01",
        period_end: "2026-10-31",
        status,
        total: 3000,
        invoice_id: null,
        invoicing_claimed_at: null,
        notes: null,
        created_at: "2026-11-01T12:00:00Z",
        client: { legal_name: "Cliente", is_fiscal: true },
        invoice: null,
      },
      error: null,
    };
  }
  if (call.table === "freight_settlement_items") {
    return {
      data: [1, 2].map((n) => ({
        id: `i${n}`,
        shipment_id: `s${n}`,
        amount: 1500,
        price_source: n === 1 ? "freight" : "tariff",
        shipment: {
          remito_number: `0001-${n}`,
          delivery_date: "2026-10-1" + n,
          scheduled_date: null,
          origin: "Rosario",
          destination: "Córdoba",
          description: null,
          channel_id: shipmentChannel,
        },
      })),
      error: null,
    };
  }
  if (call.table === "clients") {
    return {
      data: {
        cuit: "30111111118",
        iva_condition: "responsable_inscripto",
        is_fiscal: true,
      },
      error: null,
    };
  }
  if (call.table === "freight_settlements" && call.op === "update") {
    const isClaim =
      typeof call.payload === "object" &&
      call.payload !== null &&
      "invoicing_claimed_at" in call.payload &&
      call.payload.invoicing_claimed_at !== null;
    if (isClaim) return { data: claimed ? [{ id: ID }] : [], error: null };
    return { data: null, error: null };
  }
  if (call.table === "link_freight_settlement_invoice") {
    return { data: null, error: linkError };
  }
  return { data: null, error: null };
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, []),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  issueFiscalInvoiceAction: (input: unknown) => issue(input),
}));

const { invoiceFreightSettlementAction } =
  await import("./freight-settlements-actions");

const input = { id: ID, channel_id: "jouve_fiscal", punto_venta: 3 };
const settlementUpdates = () =>
  fake.calls.filter(
    (c) => c.table === "freight_settlements" && c.op === "update",
  );

beforeEach(() => {
  issue.mockReset();
  issue.mockResolvedValue({ ok: true, data: { id: "inv1" } });
  roles = ["owner"];
  status = "confirmed";
  shipmentChannel = null;
  claimed = true;
  linkError = null;
  fake = recordingSupabase(respond);
});

describe("invoiceFreightSettlementAction", () => {
  it("issues ONE invoice with a line per carga and links it", async () => {
    const res = await invoiceFreightSettlementAction(input);
    expect(res).toEqual({ ok: true, data: { invoiceId: "inv1" } });
    expect(issue).toHaveBeenCalledOnce();
    const sent = issue.mock.calls[0]![0] as {
      items: { description: string; unit_price: number }[];
      fch_serv_desde: string;
      fch_serv_hasta: string;
    };
    expect(sent.items).toHaveLength(2);
    expect(sent.items[0]).toMatchObject({
      description: "Flete Rosario → Córdoba · Remito 0001-1 · 11/10/2026",
      unit_price: 1500,
    });
    expect(sent.fch_serv_desde).toBe("2026-10-01");
    expect(sent.fch_serv_hasta).toBe("2026-10-31");
    const link = fake.calls.find(
      (c) => c.table === "link_freight_settlement_invoice",
    );
    expect(link?.payload).toEqual({
      p_settlement_id: ID,
      p_invoice_id: "inv1",
    });
  });

  it("claims only a confirmed liquidación without invoice, and never issues when the claim is lost", async () => {
    claimed = false;
    const res = await invoiceFreightSettlementAction(input);
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
    const claim = settlementUpdates()[0];
    expect(claim && filterValue(claim, "eq", "status")).toBe("confirmed");
    expect(claim && filterValue(claim, "is", "invoice_id")).toBeNull();
  });

  it("releases the claim when the invoice is refused", async () => {
    issue.mockResolvedValue({ ok: false, error: "AFIP caído" });
    const res = await invoiceFreightSettlementAction(input);
    expect(res).toEqual({ ok: false, error: "AFIP caído" });
    expect(settlementUpdates().at(-1)?.payload).toEqual({
      invoicing_claimed_at: null,
    });
    expect(
      fake.calls.some((c) => c.table === "link_freight_settlement_invoice"),
    ).toBe(false);
  });

  it("refuses a draft and a carga booked on another channel without claiming", async () => {
    status = "draft";
    expect((await invoiceFreightSettlementAction(input)).ok).toBe(false);
    status = "confirmed";
    shipmentChannel = "jouve_internal";
    expect((await invoiceFreightSettlementAction(input)).ok).toBe(false);
    expect(settlementUpdates()).toHaveLength(0);
    expect(issue).not.toHaveBeenCalled();
  });

  it("keeps the claim and says so when the link fails after issuing", async () => {
    linkError = { message: "boom" };
    const res = await invoiceFreightSettlementAction(input);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/se emitió/);
    expect(settlementUpdates()).toHaveLength(1);
  });

  it("needs invoices:issue", async () => {
    roles = ["operations"];
    const res = await invoiceFreightSettlementAction(input);
    expect(res.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});
