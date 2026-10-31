import { render } from "@react-email/render";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvoiceEmail } from "@/lib/email/templates/invoice-email";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

// D5: an internal receipt, payment order or comprobante carries no fiscal data
// of the issuer and an internal title; a fiscal one keeps the exact props.

const BU = {
  name: "DZ & Sons S.A.",
  cuit: "30-71234567-8",
  tax_condition: "IVA Responsable Inscripto",
  tax_address: "Av. Siempre Viva 123",
  iibb_number: "901-123456-7",
  inicio_actividades: "2020-01-01",
};

let isFiscal = true;

function channel() {
  return {
    id: isFiscal ? "jouve_fiscal" : "jouve_internal",
    name: isFiscal ? "Logística Jouve — Fiscal" : "Logística Jouve — Interno",
    division: "jouve",
    is_fiscal: isFiscal,
    business_unit_id: "dz_sons",
  };
}

function respond(call: RecordedCall) {
  switch (call.table) {
    case "business_units":
      return { data: BU, error: null };
    case "receipts":
      return {
        data: {
          id: "r1",
          channel_id: channel().id,
          client_id: "c1",
          punto_venta: 3,
          numero: 7,
          receipt_date: "2026-10-01",
          total_amount: 100,
          currency: "ARS",
          notes: null,
          status: "issued",
          channel: channel(),
          client: {
            legal_name: "Cliente SA",
            cuit: "30111111118",
            iva_condition: "responsable_inscripto",
          },
        },
        error: null,
      };
    case "payment_orders":
      return {
        data: {
          id: "p1",
          channel_id: channel().id,
          supplier_id: "s1",
          punto_venta: 3,
          numero: 9,
          payment_date: "2026-10-01",
          total_amount: 100,
          currency: "ARS",
          notes: null,
          status: "issued",
          channel: channel(),
          supplier: {
            legal_name: "Proveedor SA",
            cuit: "30222222229",
            iva_condition: "responsable_inscripto",
          },
        },
        error: null,
      };
    case "invoices":
      return {
        data: {
          id: "i1",
          kind: "factura",
          letter: isFiscal ? "A" : null,
          punto_venta: 3,
          numero: 11,
          fecha: "2026-10-01",
          fch_serv_desde: null,
          fch_serv_hasta: null,
          fch_vto_pago: null,
          concepto: 2,
          doc_tipo: 80,
          doc_nro: "30111111118",
          iva_condition_receptor: isFiscal ? 1 : null,
          imp_neto: 100,
          imp_iva: isFiscal ? 21 : 0,
          imp_trib: 0,
          imp_tot_conc: 0,
          imp_op_ex: 0,
          imp_total: isFiscal ? 121 : 100,
          moneda: "PES",
          cotizacion: 1,
          cae: null,
          cae_vencimiento: null,
          cbte_tipo_afip: null,
          emission_type: null,
          emitted_at: "2026-10-01T12:00:00-03:00",
          channel: channel(),
          client: {
            id: "c1",
            legal_name: "Cliente SA",
            iva_condition: "responsable_inscripto",
            address: null,
            real_address: null,
          },
          items: [],
        },
        error: null,
      };
    default:
      return { data: [], error: null };
  }
}

let fake = recordingSupabase(respond);

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));

const { buildReceiptTemplateData } = await import("./receipt-render");
const { buildPaymentOrderTemplateData } =
  await import("./payment-order-render");
const { buildTemplateData } = await import("./generate-and-store");

beforeEach(() => {
  fake = recordingSupabase(respond);
});

describe.each([
  ["receipt", () => buildReceiptTemplateData("r1"), "RECIBO INTERNO"],
  [
    "payment order",
    () => buildPaymentOrderTemplateData("p1"),
    "ORDEN DE PAGO INTERNA",
  ],
])("%s PDF", (_name, build, internalTitle) => {
  it("fiscal: issuer with CUIT and no title override", async () => {
    isFiscal = true;
    const data = await build();
    expect("title" in data).toBe(false);
    expect(data.emisor).toEqual({
      legal_name: "DZ & Sons S.A.",
      cuit: "30-71234567-8",
      address: "Av. Siempre Viva 123",
      division_label: "Logística Jouve",
    });
  });

  it("internal: the division as issuer, no CUIT, internal title", async () => {
    isFiscal = false;
    const data = await build();
    expect(data.title).toBe(internalTitle);
    expect(data.emisor).toEqual({
      legal_name: "Logística Jouve",
      cuit: "",
      address: null,
      division_label: "",
    });
  });
});

describe("invoice PDF", () => {
  it("fiscal: the full issuer, as before", async () => {
    isFiscal = true;
    const data = await buildTemplateData("i1");
    expect(data.emisor).toEqual({
      legal_name: "DZ & Sons S.A.",
      cuit: "30-71234567-8",
      iva_condition: "IVA Responsable Inscripto",
      address: "Av. Siempre Viva 123",
      division_label: "Logística Jouve",
      iibb_number: "901-123456-7",
      inicio_actividades: "2020-01-01",
    });
    expect(data.emittedAt).toBe("2026-10-01T12:00:00-03:00");
  });

  it("internal: no CUIT, IVA condition, IIBB or address", async () => {
    isFiscal = false;
    const data = await buildTemplateData("i1");
    expect(data.isFiscal).toBe(false);
    expect(data.emisor).toEqual({
      legal_name: "Logística Jouve",
      cuit: "",
      iva_condition: "",
      address: null,
      division_label: "",
      iibb_number: null,
      inicio_actividades: null,
    });
  });
});

describe("invoice email", () => {
  const props = {
    emisor_name: "Logística Jouve",
    client_legal_name: "Cliente SA",
    numero_label: "00003-00000011",
    fecha: "01/10/2026",
    total_label: "$100,00",
    custom_body: null,
  };

  it("internal: no billing wording", async () => {
    const html = await render(<InvoiceEmail {...props} internal />);
    expect(html.toLowerCase()).not.toContain("factura");
  });

  it("fiscal: keeps the billing-system footer", async () => {
    const html = await render(<InvoiceEmail {...props} />);
    expect(html).toContain("sistema de facturación");
  });
});
