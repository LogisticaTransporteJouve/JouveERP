import { describe, expect, it } from "vitest";

import {
  BULK_MAX_ERRORS,
  BulkProgressSchema,
  bulkAcceptOrder,
  bulkPendingTotal,
  chunk,
  emptyBulkProgress,
  formatFiscalAddress,
  ivaConditionFromLetters,
  mergeBulkProgress,
  missingSuppliers,
  pickBulkChannel,
  pickBulkCotizacion,
  pickOriginByTotal,
  supplierFromPadron,
} from "./arca-bulk-accept";

describe("bulkAcceptOrder", () => {
  it("loads facturas first, then ND, then NC, each by date and number", () => {
    const v = (
      id: string,
      kind: "factura" | "nc" | "nd",
      fecha: string,
      numero = 1,
    ) => ({ id, kind, fecha, punto_venta: 1, numero });
    const ordered = bulkAcceptOrder([
      v("nc1", "nc", "2024-01-01"),
      v("f2", "factura", "2025-01-01"),
      v("nd1", "nd", "2023-01-01"),
      v("f1b", "factura", "2024-06-01", 2),
      v("f1a", "factura", "2024-06-01", 1),
    ]);
    expect(ordered.map((x) => x.id)).toEqual([
      "f1a",
      "f1b",
      "f2",
      "nd1",
      "nc1",
    ]);
  });
});

describe("chunk", () => {
  it("splits in pieces of the size, the last shorter", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("missingSuppliers", () => {
  it("keeps one entry per unknown CUIT with every letter it issued", () => {
    const out = missingSuppliers(
      [
        { issuer_cuit: "30711111111", issuer_name: "ACME SA", letter: "A" },
        { issuer_cuit: "30711111111", issuer_name: "ACME SA", letter: "B" },
        { issuer_cuit: "30711111111", issuer_name: "ACME SA", letter: "A" },
        { issuer_cuit: "20222222223", issuer_name: "Juan", letter: "C" },
        { issuer_cuit: "30999999999", issuer_name: "Ya está", letter: "A" },
      ],
      new Set(["30999999999"]),
    );
    expect(out).toEqual([
      { cuit: "20222222223", issuerName: "Juan", letters: ["C"] },
      { cuit: "30711111111", issuerName: "ACME SA", letters: ["A", "B"] },
    ]);
  });
});

describe("ivaConditionFromLetters", () => {
  it("A or B issuer is responsable inscripto, only C is monotributo", () => {
    expect(ivaConditionFromLetters(["A"])).toBe("responsable_inscripto");
    expect(ivaConditionFromLetters(["B"])).toBe("responsable_inscripto");
    expect(ivaConditionFromLetters(["C", "A"])).toBe("responsable_inscripto");
    expect(ivaConditionFromLetters(["C"])).toBe("monotributo");
    expect(ivaConditionFromLetters([])).toBe("no_categorizado");
  });
});

describe("supplierFromPadron", () => {
  const missing = {
    cuit: "30711111111",
    issuerName: "ACME S.A. (ARCA)",
    letters: ["C" as const],
  };

  it("takes padrón's name, condition and fiscal address", () => {
    const { input, fromPadron } = supplierFromPadron(missing, {
      kind: "found",
      info: {
        legal_name: "ACME SOCIEDAD ANONIMA",
        tax_condition: "responsable_inscripto",
        fiscal_address: {
          street: "AV SIEMPRE VIVA 742",
          city: "CABA",
          province: "CIUDAD AUTONOMA BUENOS AIRES",
          postal_code: "1000",
        },
      },
    });
    expect(fromPadron).toBe(true);
    expect(input).toEqual({
      is_fiscal: true,
      cuit: "30711111111",
      legal_name: "ACME SOCIEDAD ANONIMA",
      iva_condition: "responsable_inscripto",
      address:
        "AV SIEMPRE VIVA 742, CABA, CIUDAD AUTONOMA BUENOS AIRES (CP 1000)",
    });
  });

  it("without a constancia uses the name AFIP still gave and the letter's condition", () => {
    const { input, fromPadron } = supplierFromPadron(missing, {
      kind: "failed",
      legalName: "ACME SA",
    });
    expect(fromPadron).toBe(false);
    expect(input).toMatchObject({
      legal_name: "ACME SA",
      iva_condition: "monotributo",
      address: null,
    });
  });

  it("falls back to ARCA's issuer name, then to the CUIT", () => {
    expect(
      supplierFromPadron(missing, { kind: "failed", legalName: null }).input
        .legal_name,
    ).toBe("ACME S.A. (ARCA)");
    expect(
      supplierFromPadron(
        { ...missing, issuerName: " " },
        { kind: "failed", legalName: null },
      ).input.legal_name,
    ).toBe("Proveedor 30711111111");
  });

  it("cuts a name longer than the supplier's limit", () => {
    const long = "X".repeat(200);
    expect(
      supplierFromPadron(missing, { kind: "failed", legalName: long }).input
        .legal_name,
    ).toHaveLength(120);
  });
});

describe("formatFiscalAddress", () => {
  it("joins what is there and drops what is empty", () => {
    expect(formatFiscalAddress(null)).toBeNull();
    expect(
      formatFiscalAddress({
        street: "",
        city: "",
        province: "",
        postal_code: "",
      }),
    ).toBeNull();
    expect(
      formatFiscalAddress({
        street: "CALLE 1",
        city: "",
        province: "BUENOS AIRES",
        postal_code: "",
      }),
    ).toBe("CALLE 1, BUENOS AIRES");
  });
});

describe("pickBulkChannel", () => {
  const fiscal = { id: "jouve_fiscal", is_fiscal: true, is_active: true };
  const internal = { id: "jouve_internal", is_fiscal: false, is_active: true };
  const dz = {
    id: "dz_fiscal",
    is_fiscal: true,
    is_active: true,
    is_segregated: true,
  };

  it("routes a DZ supplier's voucher to DZ, and anyone else's to the main fiscal channel", () => {
    expect(pickBulkChannel([dz, fiscal, internal], "dz_fiscal")).toBe(
      "dz_fiscal",
    );
    expect(pickBulkChannel([dz, fiscal, internal], null)).toBe("jouve_fiscal");
  });

  it("takes the supplier's default when it is an active fiscal one", () => {
    const other = { id: "other_fiscal", is_fiscal: true, is_active: true };
    expect(pickBulkChannel([fiscal, other, internal], "other_fiscal")).toBe(
      "other_fiscal",
    );
  });

  it("else the only active fiscal channel", () => {
    expect(pickBulkChannel([fiscal, internal], "jouve_internal")).toBe(
      "jouve_fiscal",
    );
    expect(pickBulkChannel([fiscal, internal], null)).toBe("jouve_fiscal");
  });

  it("none when there is not exactly one", () => {
    const other = { id: "other_fiscal", is_fiscal: true, is_active: true };
    expect(pickBulkChannel([fiscal, other], null)).toBeNull();
    expect(pickBulkChannel([internal], null)).toBeNull();
  });
});

describe("pickBulkCotizacion", () => {
  const dol = { moneda: "DOL" as const, cotizacion: null, fecha: "2025-03-10" };

  it("is 1 in pesos and ARCA's own when above 1", () => {
    expect(pickBulkCotizacion({ ...dol, moneda: "PES" }, null)).toBe(1);
    expect(pickBulkCotizacion({ ...dol, cotizacion: 1050.5 }, null)).toBe(
      1050.5,
    );
  });

  it("else the rate loaded for the date or a few days before", () => {
    expect(
      pickBulkCotizacion(dol, { rate: 1060, rate_date: "2025-03-08" }),
    ).toBe(1060);
    expect(
      pickBulkCotizacion(
        { ...dol, cotizacion: 1 },
        { rate: 1060, rate_date: "2025-03-10" },
      ),
    ).toBe(1060);
  });

  it("none without a rate or with a stale one", () => {
    expect(pickBulkCotizacion(dol, null)).toBeNull();
    expect(
      pickBulkCotizacion(dol, { rate: 900, rate_date: "2025-01-02" }),
    ).toBeNull();
  });
});

describe("pickOriginByTotal", () => {
  const f = (
    id: string,
    fecha: string,
    imp_total: number,
    open_amount = imp_total,
  ) => ({
    id,
    fecha,
    imp_total,
    open_amount,
  });

  it("prefers the factura with the same total", () => {
    expect(
      pickOriginByTotal(
        [f("late", "2025-05-01", 5000), f("same", "2025-02-01", 1210)],
        { kind: "nc", fecha: "2025-06-01", imp_total: 1210 },
      ),
    ).toBe("same");
  });

  it("else the latest with room for the whole NC", () => {
    expect(
      pickOriginByTotal(
        [
          f("full", "2025-05-01", 5000, 100),
          f("room", "2025-04-01", 5000, 3000),
          f("older", "2025-01-01", 5000, 5000),
        ],
        { kind: "nc", fecha: "2025-06-01", imp_total: 2000 },
      ),
    ).toBe("room");
  });

  it("never an NC on a factura with no room, even of the same total", () => {
    expect(
      pickOriginByTotal([f("paid", "2025-01-01", 1210, 0)], {
        kind: "nc",
        fecha: "2025-06-01",
        imp_total: 1210,
      }),
    ).toBeNull();
  });

  it("an ND takes any factura on or before it", () => {
    expect(
      pickOriginByTotal([f("paid", "2025-01-01", 1000, 0)], {
        kind: "nd",
        fecha: "2025-06-01",
        imp_total: 50,
      }),
    ).toBe("paid");
  });

  it("never a factura dated after the note", () => {
    expect(
      pickOriginByTotal([f("after", "2025-07-01", 1210)], {
        kind: "nc",
        fecha: "2025-06-01",
        imp_total: 1210,
      }),
    ).toBeNull();
  });
});

describe("mergeBulkProgress", () => {
  it("adds every count and keeps the first errors", () => {
    const start = {
      ...emptyBulkProgress(),
      totals: { vouchers: 10, newSuppliers: 2 },
    };
    const a = mergeBulkProgress(start, {
      suppliers: { created: 2, fromPadron: 1, fallback: 1 },
      errors: [{ scope: "supplier", ref: "CUIT 1", message: "x" }],
    });
    const b = mergeBulkProgress(a, {
      vouchers: {
        accepted: 6,
        linked: 1,
        pending: { nc_nd_sin_origen: 2, error: 1 },
      },
      dolOpen: 1,
    });
    expect(b.totals).toEqual({ vouchers: 10, newSuppliers: 2 });
    expect(b.suppliers).toMatchObject({
      created: 2,
      fromPadron: 1,
      fallback: 1,
    });
    expect(b.vouchers).toMatchObject({ accepted: 6, linked: 1 });
    expect(bulkPendingTotal(b)).toBe(3);
    expect(b.dolOpen).toBe(1);
    expect(b.errors).toHaveLength(1);

    const many = mergeBulkProgress(b, {
      errors: Array.from({ length: BULK_MAX_ERRORS + 10 }, (_, i) => ({
        scope: "voucher" as const,
        ref: String(i),
        message: "e",
      })),
    });
    expect(many.errors).toHaveLength(BULK_MAX_ERRORS);
    expect(many.errors[0]?.ref).toBe("CUIT 1");
  });

  it("reads a stored progress back, an empty one as zeros", () => {
    expect(BulkProgressSchema.parse({})).toEqual(emptyBulkProgress());
    const p = mergeBulkProgress(emptyBulkProgress(), {
      vouchers: { accepted: 3 },
    });
    expect(BulkProgressSchema.parse(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});
