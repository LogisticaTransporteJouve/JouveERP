import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONCEPTO, IVA_RATE } from "@/lib/afip/codes";
import { todayInAR } from "@/lib/format";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const CLIENT = "00000000-0000-4000-8000-0000000000c1";

let client: Record<string, unknown>;

function respond(call: RecordedCall) {
  if (call.op === "rpc" && call.table === "create_invoice_draft") {
    return { data: "new-invoice", error: null };
  }
  switch (call.table) {
    case "invoicing_channels":
      return {
        data: { id: "jouve_fiscal", is_fiscal: true, is_active: true },
        error: null,
      };
    case "clients":
      return { data: client, error: null };
    case "sales_points":
      return {
        data: { numero: 3, channel_id: "jouve_fiscal", is_enabled: true },
        error: null,
      };
    default:
      return { data: null, error: null };
  }
}

let fake = recordingSupabase(respond);
const send = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: (...args: unknown[]) => send(...args) },
}));

const { issueComprobante } = await import("./issue-comprobante");

const today = todayInAR();
const factura = {
  channel_id: "jouve_fiscal",
  client_id: CLIENT,
  kind: "factura" as const,
  letter: "A" as const,
  punto_venta: 3,
  fecha: today,
  fch_serv_desde: today,
  fch_serv_hasta: today,
  fch_vto_pago: today,
  concepto: CONCEPTO.SERVICIOS,
  doc_tipo: 80 as const,
  doc_nro: "30714637432",
  iva_condition_receptor: 1 as const,
  moneda: "PES" as const,
  cotizacion: 1,
  items: [
    {
      description: "Flete",
      quantity: 1,
      unit_price: 1000,
      iva_rate_id: IVA_RATE.TWENTY_ONE,
    },
  ],
};
const expected = {
  letter: factura.letter,
  doc_tipo: factura.doc_tipo,
  doc_nro: factura.doc_nro,
  iva_condition_receptor: factura.iva_condition_receptor,
};

beforeEach(() => {
  vi.clearAllMocks();
  fake = recordingSupabase(respond);
  client = {
    id: CLIENT,
    is_active: true,
    is_fiscal: true,
    iva_condition: "responsable_inscripto",
    cuit: "30714637432",
  };
});

describe("issueComprobante with the identity a proposal showed", () => {
  it("issues while the client's CUIT and IVA condition are the ones shown", async () => {
    const res = await issueComprobante("u1", factura, expected);
    expect(res).toEqual({
      ok: true,
      data: expect.objectContaining({ id: "new-invoice", status: "draft" }),
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("refuses, before writing, when the IVA condition changed (another letter)", async () => {
    client = { ...client, iva_condition: "monotributo" };
    const res = await issueComprobante("u1", factura, expected);
    expect(res).toEqual({
      ok: false,
      error:
        "El CUIT o la condición de IVA del cliente cambiaron desde la propuesta. Volvé a generarla.",
    });
    expect(fake.calls.some((c) => c.table === "create_invoice_draft")).toBe(
      false,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("without `expected` (the form) keeps issuing with the draft's receptor", async () => {
    client = { ...client, iva_condition: "monotributo" };
    const res = await issueComprobante("u1", factura);
    expect(res.ok).toBe(true);
  });
});
