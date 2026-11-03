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
// A legacy liquidación (R-00000012) unless a test says otherwise.
let numero: number | null = 12;
let channel: string | null = null;
let remito: { pos: number; number: number } | null = null;
let isFiscal = true;
let confirmResult: unknown = null;
let fake = recordingSupabase(respond);

function respond(call: RecordedCall) {
  if (call.table === "confirm_freight_settlement_document") {
    if (status === "draft") {
      status = "confirmed";
      channel = isFiscal ? "fiscal" : "internal";
    }
    return {
      data: confirmResult ?? {
        channel,
        numero,
        remito_pos: remito?.pos ?? null,
        remito_number: remito?.number ?? null,
      },
      error: null,
    };
  }
  if (call.table === "freight_settlements" && call.op === "select") {
    return {
      data: {
        id: ID,
        numero,
        channel,
        remito_pos: remito?.pos ?? null,
        remito_number: remito?.number ?? null,
        client_id: "c1",
        period_start: "2026-10-01",
        period_end: "2026-10-31",
        status,
        total: 3000,
        invoice_id: null,
        invoicing_claimed_at: null,
        notes: null,
        created_at: "2026-11-01T12:00:00Z",
        client: { legal_name: "Cliente", is_fiscal: isFiscal },
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
      data: isFiscal
        ? {
            cuit: "30111111118",
            iva_condition: "responsable_inscripto",
            is_fiscal: true,
          }
        : { cuit: null, iva_condition: null, is_fiscal: false },
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

const { confirmFreightSettlementAction, invoiceFreightSettlementAction } =
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
  numero = 12;
  channel = null;
  remito = null;
  isFiscal = true;
  confirmResult = null;
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

  it("asks a fiscal draft for its Remito R first, without confirming", async () => {
    status = "draft";
    numero = null;
    const res = await invoiceFreightSettlementAction(input);
    expect(res).toEqual({
      ok: false,
      error: "Confirmá la liquidación (Remito R) antes de facturarla.",
    });
    expect(
      fake.calls.some((c) => c.table === "confirm_freight_settlement_document"),
    ).toBe(false);
    expect(issue).not.toHaveBeenCalled();
  });

  it("confirms an internal draft and issues its remito interno in one step", async () => {
    status = "draft";
    numero = null;
    isFiscal = false;
    const internalInput = {
      id: ID,
      channel_id: "jouve_internal",
      punto_venta: 9001,
    };
    const res = await invoiceFreightSettlementAction(internalInput);
    expect(res).toEqual({ ok: true, data: { invoiceId: "inv1" } });
    const tables = fake.calls.map((c) => c.table);
    const confirmAt = tables.indexOf("confirm_freight_settlement_document");
    expect(confirmAt).toBeGreaterThan(-1);
    // Confirming reprices: the liquidación is read again before issuing.
    expect(tables.lastIndexOf("freight_settlement_items")).toBeGreaterThan(
      confirmAt,
    );
    const sent = issue.mock.calls[0]![0] as {
      channel_id: string;
      doc_tipo: number;
    };
    expect(sent.channel_id).toBe("jouve_internal");
    expect(sent.doc_tipo).toBe(99);
  });
});

describe("confirmFreightSettlementAction", () => {
  it("returns the Remito R number of a fiscal liquidación", async () => {
    status = "draft";
    numero = null;
    confirmResult = {
      channel: "fiscal",
      numero: null,
      remito_pos: 9002,
      remito_number: 7,
    };
    const res = await confirmFreightSettlementAction({ id: ID });
    expect(res).toEqual({
      ok: true,
      data: { channel: "fiscal", number: "R9002-00000007" },
    });
    expect(
      fake.calls.find((c) => c.table === "confirm_freight_settlement_document")
        ?.payload,
    ).toEqual({ p_settlement_id: ID, p_user_id: "u1" });
  });

  it("gives an internal liquidación no number", async () => {
    confirmResult = {
      channel: "internal",
      numero: null,
      remito_pos: null,
      remito_number: null,
    };
    const res = await confirmFreightSettlementAction({ id: ID });
    expect(res).toEqual({
      ok: true,
      data: { channel: "internal", number: null },
    });
  });

  it("keeps the legacy R- number of one confirmed before the remito R", async () => {
    confirmResult = {
      channel: null,
      numero: 12,
      remito_pos: null,
      remito_number: null,
    };
    const res = await confirmFreightSettlementAction({ id: ID });
    expect(res).toEqual({
      ok: true,
      data: { channel: null, number: "R-00000012" },
    });
  });
});
