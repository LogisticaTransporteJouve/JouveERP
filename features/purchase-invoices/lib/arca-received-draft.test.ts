import { describe, expect, it } from "vitest";

import type { ReceivedVoucher } from "../schema";
import { TRIBUTE_SUGGESTION_NOTE } from "@/lib/purchases/tribute-split";

import {
  arcaVoucherToDraft,
  inferVoucherIvaRate,
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
  it("puts ARCA's rounding cent where it changes no tax", () => {
    // As two real vouchers came: 14049.58 + 2950.41 against 17000.
    expect(
      receivedVoucherAmounts(
        voucher({
          imp_neto_gravado: 14049.58,
          imp_no_gravado: 0,
          imp_op_exentas: 0,
          imp_iva: 2950.41,
          imp_trib: 0,
          imp_total: 17000,
        }),
      ),
    ).toMatchObject({
      imp_neto: 14049.58,
      imp_no_gravado: 0.01,
      imp_iva: 2950.41,
    });
    expect(
      receivedVoucherAmounts(
        voucher({
          letter: "B",
          imp_neto_gravado: 100,
          imp_no_gravado: 0,
          imp_op_exentas: 0,
          imp_iva: 0,
          imp_trib: 0,
          imp_total: 99.99,
        }),
      ),
    ).toMatchObject({ imp_neto: 99.99, imp_no_gravado: 0 });
    // More than a cent is not rounding: it stays, and the purchase's own
    // check refuses it.
    expect(
      receivedVoucherAmounts(voucher({ imp_total: 1310.05 })),
    ).toMatchObject({ imp_no_gravado: 20, imp_total: 1310.05 });
  });

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
  it("starts due on the voucher's date and carries ARCA's lines to show", () => {
    const draft = arcaVoucherToDraft(
      voucher({
        imp_no_gravado: 0,
        imp_op_exentas: 0,
        imp_trib: 0,
        imp_total: 1210,
        iva_breakdown: [{ iva_rate_id: 5, neto: 1000, iva: 210 }],
      }),
    );
    expect(draft.fch_vto_pago).toBe("2026-09-10");
    expect(draft.arca_lines).toEqual([
      { iva_rate_id: 5, neto: 1000, iva: 210 },
    ]);
    // The form's item editor stays empty: the lines are not edited there.
    expect(draft.items).toEqual([]);
  });

  it("suggests the issuer as a new supplier and a split of the tributes", () => {
    const d = arcaVoucherToDraft(voucher());
    expect(d.unmatchedSupplier).toEqual({
      legal_name: "Proveedor SA",
      cuit: "30711111118",
    });
    // 30 is 3 % of the neto gravado (1000).
    expect(d.tributes).toEqual({ imp_perc_iva: 30 });
    expect(d.warnings).toEqual([TRIBUTE_SUGGESTION_NOTE.iva_rate]);
  });

  it("suggests from the supplier's last split, IIBB on a B voucher", () => {
    const tribute_history = {
      imp_neto: 500,
      split: {
        imp_perc_iva: 0,
        imp_perc_nacionales: 5,
        imp_perc_iibb: 10,
        imp_perc_municipales: 0,
        imp_impuestos_internos: 0,
      },
    };
    expect(arcaVoucherToDraft(voucher({ tribute_history })).tributes).toEqual({
      imp_perc_nacionales: 10,
      imp_perc_iibb: 20,
    });
    const b = arcaVoucherToDraft(voucher({ letter: "B" }));
    expect(b.tributes).toEqual({ imp_perc_iibb: 30 });
    expect(b.warnings).toEqual([TRIBUTE_SUGGESTION_NOTE.iibb]);
  });

  it("flags a voucher whose IVA matches no single alícuota", () => {
    const d = arcaVoucherToDraft(voucher({ imp_iva: 150, imp_total: 1250 }));
    expect(d.warnings).toContain(
      "ARCA no detalla las alícuotas y el IVA no coincide con 21 %, 10,5 % ni 27 % del neto: se carga al 21 %. Revisá las alícuotas.",
    );
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
  const iva_breakdown = [
    { iva_rate_id: 5 as const, neto: 100, iva: 21 },
    { iva_rate_id: 4 as const, neto: 200, iva: 21 },
  ];
  const tied = { imp_neto_gravado: 300, imp_iva: 42, iva_breakdown };

  it("builds one line per alícuota on letter A when it ties with the header", () => {
    const items = receivedVoucherItems(voucher(tied));
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      iva_rate_id: 4,
      line_neto: 200,
      line_iva: 21,
      line_total: 221,
    });
  });

  it("saves header-only on B, and when the lines miss the header by a cent", () => {
    expect(receivedVoucherItems(voucher({ ...tied, letter: "B" }))).toEqual([]);
    expect(receivedVoucherItems(voucher({ ...tied, imp_iva: 42.01 }))).toEqual(
      [],
    );
  });
});

describe("inferVoucherIvaRate", () => {
  it.each([
    [44380.17, 9319.84, 5], // 21 %
    [226480.5, 23780.45, 4], // 10,5 %: bank interest
    [3937.01, 1062.99, 6], // 27 %: telephony
  ] as const)("reads %s with IVA %s as rate %s", (neto, iva, rate) => {
    expect(inferVoucherIvaRate(neto, iva)).toEqual({
      iva_rate_id: rate,
      mixed: false,
    });
  });

  it("falls back to 21 % and marks it mixed when no alícuota fits", () => {
    // 4720.20 at 10,5 % + 188035.86 at 21 % in one voucher.
    expect(inferVoucherIvaRate(192756.06, 39983.15)).toEqual({
      iva_rate_id: 5,
      mixed: true,
    });
  });

  it("reads nothing without IVA", () => {
    expect(inferVoucherIvaRate(1000, 0)).toBeNull();
  });
});

describe("receivedVoucherItems without per-alícuota columns", () => {
  it("builds one line at the inferred alícuota on letter A", () => {
    expect(
      receivedVoucherItems(
        voucher({ imp_neto_gravado: 3937.01, imp_iva: 1062.99 }),
      ),
    ).toEqual([
      {
        description: "Según ARCA → Mis Comprobantes",
        quantity: 1,
        unit_price: 3937.01,
        iva_rate_id: 6,
        line_neto: 3937.01,
        line_iva: 1062.99,
        line_total: 5000,
        sort_order: 0,
      },
    ]);
  });

  it("keeps a B voucher and an A without IVA header-only", () => {
    expect(receivedVoucherItems(voucher({ letter: "B" }))).toEqual([]);
    expect(receivedVoucherItems(voucher({ imp_iva: 0 }))).toEqual([]);
  });
});
