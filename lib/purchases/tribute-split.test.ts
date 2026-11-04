import { describe, expect, it } from "vitest";

import { suggestTributeSplit, type TributeHistory } from "./tribute-split";

// Amounts from a real month of purchases (suppliers left out).
const suggest = (trib: number, netoGravado: number, history = null) =>
  suggestTributeSplit({
    trib,
    netoGravado,
    ivaComputable: true,
    history,
  });

function history(
  imp_neto: number,
  split: Partial<TributeHistory["split"]>,
): TributeHistory {
  return {
    imp_neto,
    split: {
      imp_perc_iva: 0,
      imp_perc_nacionales: 0,
      imp_perc_iibb: 0,
      imp_perc_municipales: 0,
      imp_impuestos_internos: 0,
      ...split,
    },
  };
}

describe("suggestTributeSplit", () => {
  it("suggests IVA when the whole amount is 1.5 % or 3 % of the neto gravado", () => {
    expect(suggest(2797.92, 186527.68)).toEqual({
      split: { imp_perc_iva: 2797.92 },
      basis: "iva_rate",
    });
    expect(suggest(2907.82, 96927.33)).toEqual({
      split: { imp_perc_iva: 2907.82 },
      basis: "iva_rate",
    });
  });

  it("splits off a 1.5 % IVA part and leaves the rest as IIBB", () => {
    // 3397.21 = 1.5 % of 226480.50 (I) + 3963.41 = 1.75 % (B).
    expect(suggest(7360.62, 226480.5)).toEqual({
      split: { imp_perc_iva: 3397.21, imp_perc_iibb: 3963.41 },
      basis: "iva_and_iibb",
    });
  });

  it("splits off a 3 % IVA part when that leaves the habitual IIBB rate", () => {
    // 2907.82 = 3 % of 96927.33 (I) + 2423.18 = 2.5 % (B).
    expect(suggest(5331, 96927.33)).toEqual({
      split: { imp_perc_iva: 2907.82, imp_perc_iibb: 2423.18 },
      basis: "iva_and_iibb",
    });
  });

  it("suggests IIBB for any other rate", () => {
    // 1.75 %: an IVA part would leave an implausible 0.25 % as IIBB.
    expect(suggest(5115.78, 292330.27)).toEqual({
      split: { imp_perc_iibb: 5115.78 },
      basis: "iibb",
    });
  });

  it("suggests IIBB on a B or C voucher, which carries no IVA perception", () => {
    expect(
      suggestTributeSplit({
        trib: 2797.92,
        netoGravado: 186527.68,
        ivaComputable: false,
        history: null,
      }),
    ).toEqual({ split: { imp_perc_iibb: 2797.92 }, basis: "iibb" });
  });

  it("reuses the supplier's last split applied to this neto, to the cent", () => {
    const h = history(226480.5, {
      imp_perc_iva: 3397.21,
      imp_perc_iibb: 3963.41,
    });
    const r = suggestTributeSplit({
      trib: 12215.06,
      netoGravado: 375847.75,
      ivaComputable: true,
      history: h,
    });
    expect(r?.basis).toBe("history");
    expect(r?.split).toEqual({ imp_perc_iva: 5637.72, imp_perc_iibb: 6577.34 });
  });

  it("ignores a history whose rates do not give this total", () => {
    const h = history(1000, { imp_perc_iibb: 50 });
    expect(
      suggestTributeSplit({
        trib: 2797.92,
        netoGravado: 186527.68,
        ivaComputable: true,
        history: h,
      })?.basis,
    ).toBe("iva_rate");
  });

  it("always adds up to the total, and suggests nothing without tributes", () => {
    for (const [trib, neto] of [
      [7360.62, 226480.5],
      [5331, 96927.33],
      [130.17, 7438.02],
    ] as const) {
      const r = suggest(trib, neto);
      const sum = Object.values(r?.split ?? {}).reduce((a, v) => a + v, 0);
      expect(Math.round(sum * 100) / 100).toBe(trib);
    }
    expect(suggest(0, 1000)).toBeNull();
  });
});
