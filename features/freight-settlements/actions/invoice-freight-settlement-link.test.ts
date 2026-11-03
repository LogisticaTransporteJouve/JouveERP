// The link step of "Facturar": a link refused because the invoice already
// failed frees the liquidación at once; any other link error keeps it
// claimed until the TTL.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";
import {
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
let invoiceStatus = "failed";
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
  if (call.table === "invoices") {
    return { data: { status: invoiceStatus }, error: null };
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
  numero = 12;
  channel = null;
  remito = null;
  isFiscal = true;
  confirmResult = null;
  claimed = true;
  linkError = null;
  invoiceStatus = "failed";
  fake = recordingSupabase(respond);
});

describe("invoiceFreightSettlementAction link failure", () => {
  const guard = {
    message: "La factura falló o se anuló: volvé a facturar la liquidación.",
    hint: "jouve_guard",
    code: "55006",
  };

  it("releases the claim when the invoice already failed", async () => {
    linkError = guard;
    const res = await invoiceFreightSettlementAction(input);
    expect(res).toEqual({ ok: false, error: guard.message });
    expect(settlementUpdates().at(-1)?.payload).toEqual({
      invoicing_claimed_at: null,
    });
    expect(settlementUpdates()).toHaveLength(2);
  });

  it("keeps the claim while the invoice is alive", async () => {
    linkError = guard;
    invoiceStatus = "emitting";
    const res = await invoiceFreightSettlementAction(input);
    expect(res.ok).toBe(false);
    expect(settlementUpdates()).toHaveLength(1);
  });
});
