import { describe, expect, it } from "vitest";

import type { ReceivedVoucher } from "../schema";
import {
  arcaVoucherToDraft,
  receivedVoucherAmounts,
  receivedVoucherItems,
} from "./arca-received-draft";

function voucher(over: Partial<ReceivedVoucher> = {}): ReceivedVoucher {
  return {
    id: "v1",
    issuer_cuit: "30711111118",
    issuer_name: "Proveedor SA",
    cbte_tipo: 1,
    kind: "factura",
    letter: "A",
    punto_venta: 3,
    numero: 120,
    fecha: "2026-09-10",
    cae: "76123456789012",
    moneda: "PES",
    cotizacion: null,
    imp_neto_gravado: 1000,
    imp_no_gravado: 20,
    imp_op_exentas: 50,
    imp_iva: 210,
    imp_trib: 30,
    imp_total: 1310,
    trib_breakdown: {},
    iva_breakdown: [],
    status: "pending_review",
    discard_reason: null,
    purchase: null,
    supplier: null,
    ...over,
  };
}

describe("receivedVoucherAmounts", () => {
  it("keeps a letter A as ARCA lists it", () => {
    expect(receivedVoucherAmounts(voucher())).toEqual({
      imp_neto: 1000,
      imp_no_gravado: 20,
      imp_op_exentas: 50,
      imp_iva: 210,
      imp_trib: 30,
      imp_total: 1310,
    });
  });

  it.each(["B", "C"] as const)(
    "folds IVA, exento and no gravado into the net on %s",
    (letter) => {
      expect(receivedVoucherAmounts(voucher({ letter }))).toEqual({
        imp_neto: 1280,
        imp_no_gravado: 0,
        imp_op_exentas: 0,
        imp_iva: 0,
        imp_trib: 30,
        imp_total: 1310,
      });
    },
  );
});

describe("arcaVoucherToDraft", () => {
  it("suggests the issuer as a new supplier and asks to split the tributes", () => {
    const d = arcaVoucherToDraft(voucher());
    expect(d.unmatchedSupplier).toEqual({
      legal_name: "Proveedor SA",
      cuit: "30711111118",
    });
    expect(d.tributes).toEqual({});
    expect(d.warnings).toEqual([
      "Repartí los otros tributos ($ 30,00) entre percepción IVA, IIBB, municipales e impuestos internos.",
    ]);
  });

  it("prefills the split when ARCA lists it, and warns on NC and USD", () => {
    const d = arcaVoucherToDraft(
      voucher({
        kind: "nc",
        moneda: "DOL",
        cotizacion: 1050,
        trib_breakdown: { perc_iva: 20, perc_iibb: 10 },
      }),
    );
    expect(d.tributes).toEqual({ imp_perc_iva: 20, imp_perc_iibb: 10 });
    expect(d.motivo_nc_nd).toBe("Según ARCA → Mis Comprobantes");
    expect(d.cotizacion).toBe(1050);
    expect(d.warnings).toEqual([
      "NC/ND: elegí la factura de origen.",
      "USD: revisá la cotización.",
    ]);
  });
});

describe("receivedVoucherItems", () => {
  it("builds one line per alícuota on letter A only", () => {
    const iva_breakdown = [
      { iva_rate_id: 5 as const, neto: 100, iva: 21 },
      { iva_rate_id: 4 as const, neto: 200, iva: 21 },
    ];
    expect(receivedVoucherItems(voucher({ iva_breakdown }))).toHaveLength(2);
    expect(receivedVoucherItems(voucher({ iva_breakdown }))[1]).toMatchObject({
      iva_rate_id: 4,
      line_neto: 200,
      line_iva: 21,
      line_total: 221,
    });
    expect(
      receivedVoucherItems(voucher({ letter: "B", iva_breakdown })),
    ).toEqual([]);
  });
});
