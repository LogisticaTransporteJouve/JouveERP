import { describe, expect, it } from "vitest";

import { PurchaseInvoiceCreateSchema, type ReceivedVoucher } from "../schema";
import { arcaVoucherToDraft } from "./arca-received-draft";
import {
  ARCA_NOTE_MOTIVO,
  arcaDraftAmounts,
  arcaReceivedInvoice,
  fullTributeSplit,
  supplierDueDate,
  tributeSplitTotal,
} from "./arca-received-invoice";

function voucher(over: Partial<ReceivedVoucher> = {}): ReceivedVoucher {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    issuer_cuit: "30711111111",
    issuer_name: "ACME SA",
    cbte_tipo: 1,
    kind: "factura",
    letter: "A",
    punto_venta: 3,
    numero: 120,
    fecha: "2025-04-10",
    cae: "75123456789012",
    moneda: "PES",
    cotizacion: null,
    imp_neto_gravado: 1000,
    imp_no_gravado: 0,
    imp_op_exentas: 0,
    imp_iva: 210,
    imp_trib: 0,
    imp_total: 1210,
    trib_breakdown: {},
    iva_breakdown: [],
    status: "pending_review",
    discard_reason: null,
    unreadable_reason: null,
    raw_amounts: null,
    purchase: null,
    supplier: null,
    ...over,
  };
}

const SUPPLIER = "00000000-0000-4000-8000-0000000000aa";

describe("supplierDueDate", () => {
  it("adds the payment term, or none without one", () => {
    expect(
      supplierDueDate({ default_payment_term_days: 30 }, "2025-01-15"),
    ).toBe("2025-02-14");
    expect(
      supplierDueDate({ default_payment_term_days: null }, "2025-01-15"),
    ).toBeNull();
  });
});

describe("arcaDraftAmounts", () => {
  it("puts ARCA's gap in no gravado on an A and in the net on a C", () => {
    const a = voucher({ imp_total: 1300 });
    const onA = arcaDraftAmounts(arcaVoucherToDraft(a), "A", "no_gravado");
    expect(onA).toMatchObject({ imp_neto: 1000, imp_no_gravado: 90 });

    const c = voucher({
      letter: "C",
      imp_neto_gravado: 1000,
      imp_iva: 0,
      imp_total: 1100,
    });
    const onC = arcaDraftAmounts(arcaVoucherToDraft(c), "C", "no_gravado");
    expect(onC).toMatchObject({ imp_neto: 1100, imp_no_gravado: 0 });
  });

  it("leaves ARCA's amounts as they are without a gap", () => {
    const v = voucher();
    expect(arcaDraftAmounts(arcaVoucherToDraft(v), "A", null)).toEqual({
      imp_neto: 1000,
      imp_no_gravado: 0,
      imp_op_exentas: 0,
      imp_iva: 210,
      imp_trib: 0,
      imp_total: 1210,
    });
  });
});

describe("arcaReceivedInvoice", () => {
  it("builds a purchase the create schema accepts, with ARCA's identity", () => {
    const v = voucher({
      imp_trib: 30,
      imp_total: 1240,
      trib_breakdown: { perc_iibb: 30 },
    });
    const base = arcaVoucherToDraft(v);
    const split = fullTributeSplit(base.tributes ?? {});
    expect(tributeSplitTotal(split)).toBe(30);
    const invoice = arcaReceivedInvoice(
      { ...v, kind: "factura" },
      {
        channelId: "jouve_fiscal",
        supplierId: SUPPLIER,
        accountId: null,
        costCenterId: null,
        amounts: arcaDraftAmounts(base, v.letter, null),
        split,
        cotizacion: 1,
        fchVtoPago: v.fecha,
        originId: null,
        notes: null,
      },
    );
    const parsed = PurchaseInvoiceCreateSchema.safeParse(invoice);
    expect(parsed.success).toBe(true);
    expect(invoice).toMatchObject({
      kind: "factura",
      letter: "A",
      punto_venta: 3,
      numero: 120,
      cae_proveedor: "75123456789012",
      imp_perc_iibb: 30,
      motivo_nc_nd: null,
      items: [],
    });
  });

  it("gives an NC/ND the ARCA motive and its origin", () => {
    const v = voucher({ kind: "nc", cbte_tipo: 3 });
    const base = arcaVoucherToDraft(v);
    const invoice = arcaReceivedInvoice(
      { ...v, kind: "nc" },
      {
        channelId: "jouve_fiscal",
        supplierId: SUPPLIER,
        accountId: null,
        costCenterId: null,
        amounts: arcaDraftAmounts(base, v.letter, null),
        split: fullTributeSplit({}),
        cotizacion: 1,
        fchVtoPago: v.fecha,
        originId: "00000000-0000-4000-8000-0000000000bb",
        notes: null,
      },
    );
    expect(invoice.motivo_nc_nd).toBe(ARCA_NOTE_MOTIVO);
    expect(PurchaseInvoiceCreateSchema.safeParse(invoice).success).toBe(true);
  });
});
