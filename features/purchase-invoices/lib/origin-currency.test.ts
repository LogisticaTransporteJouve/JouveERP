import { describe, expect, it } from "vitest";

import { originCurrencyFields } from "./origin-currency";

describe("originCurrencyFields", () => {
  it("an ARS origin sets pesos at 1", () => {
    expect(
      originCurrencyFields(
        { moneda: "PES", cotizacion: 1 },
        { moneda: "DOL", cotizacion: "1.180,5" },
      ),
    ).toEqual({ moneda: "PES", cotizacion: "1" });
  });

  it("a USD origin over a form in pesos sets dollars at the origin's rate", () => {
    expect(
      originCurrencyFields(
        { moneda: "DOL", cotizacion: 1180.5 },
        { moneda: "PES", cotizacion: "1" },
      ),
    ).toEqual({ moneda: "DOL", cotizacion: "1.180,50" });
  });

  it("keeps a rate already typed for the same currency", () => {
    expect(
      originCurrencyFields(
        { moneda: "DOL", cotizacion: 1000 },
        { moneda: "DOL", cotizacion: "1.250" },
      ),
    ).toEqual({ moneda: "DOL", cotizacion: "1.250" });
  });

  it("takes the origin's rate when the typed one is not a dollar rate", () => {
    expect(
      originCurrencyFields(
        { moneda: "DOL", cotizacion: 1000 },
        { moneda: "DOL", cotizacion: "1" },
      ),
    ).toEqual({ moneda: "DOL", cotizacion: "1.000,00" });
  });
});
