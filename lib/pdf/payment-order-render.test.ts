import { describe, expect, it, vi } from "vitest";

import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

// Audit w3-s2 F3 / w3-s6 F1: what the order applied to a bounced check is an
// imputación on the voucher, not "a cuenta".

function respond(call: RecordedCall) {
  switch (call.table) {
    case "payment_orders":
      return {
        data: {
          id: "p1",
          channel_id: "jouve_internal",
          supplier_id: "s1",
          punto_venta: 1,
          numero: 9,
          payment_date: "2026-11-01",
          total_amount: 100,
          currency: "ARS",
          notes: null,
          status: "issued",
          channel: {
            name: "Interno",
            is_fiscal: false,
            business_unit_id: "dz_sons",
          },
          supplier: {
            legal_name: "Proveedor SA",
            cuit: null,
            iva_condition: null,
          },
        },
        error: null,
      };
    case "payment_order_rejected_check_allocations":
      return {
        data: [
          {
            id: "a1",
            amount_applied: "60.00",
            endorsed_check: null,
            issued_check: { check_number: "RB-1", bank_name: "Banco RB" },
          },
        ],
        error: null,
      };
    default:
      return { data: [], error: null };
  }
}

const fake = recordingSupabase(respond);

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));

const { buildPaymentOrderTemplateData } =
  await import("./payment-order-render");

describe("payment order PDF", () => {
  it("lists what the order applied to a bounced check and leaves it out of a cuenta", async () => {
    const data = await buildPaymentOrderTemplateData("p1");
    expect(data.allocations).toEqual([
      {
        invoice_label: "Cheque rechazado RB-1 Banco RB",
        invoice_date: "",
        amount_applied: 60,
      },
    ]);
    expect(data.allocated_sum).toBe(60);
    expect(data.a_cuenta).toBe(40);
  });
});
