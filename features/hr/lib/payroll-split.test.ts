import { describe, expect, it } from "vitest";

import {
  payrollOtros,
  suggestedPayment,
  suggestedSplit,
} from "./payroll-split";

const base = {
  recibo_neto: 600_000 as number | null,
  sueldo_neto: 800_000,
  embargo: 60_000,
  deudas: 10_000,
  telefono: 5_000,
  // 800k + 50k extras + 20k viáticos − 10k − 5k − 60k
  total_a_pagar: 795_000,
  saldo: 795_000,
  paid_transferencia: 0,
  paid_efectivo: 0,
  paid_in_kind: 0,
};

describe("payrollOtros", () => {
  it("is the agreed salary minus the receipt net", () => {
    expect(payrollOtros(base)).toBe(200_000);
  });

  it("is null without a receipt", () => {
    expect(payrollOtros({ ...base, recibo_neto: null })).toBeNull();
  });
});

describe("suggestedSplit", () => {
  it("transfers the receipt net less garnishment and discounts; cash is the rest", () => {
    expect(suggestedSplit(base)).toEqual({
      transferencia: 525_000,
      efectivo: 270_000,
    });
  });

  it("never transfers more than the total nor less than zero", () => {
    expect(
      suggestedSplit({ ...base, recibo_neto: 2_000_000 })?.transferencia,
    ).toBe(795_000);
    expect(suggestedSplit({ ...base, recibo_neto: 10_000 })).toEqual({
      transferencia: 0,
      efectivo: 795_000,
    });
  });

  it("is null without a receipt", () => {
    expect(suggestedSplit({ ...base, recibo_neto: null })).toBeNull();
  });
});

describe("suggestedPayment", () => {
  it("suggests what is left of the method's share", () => {
    const paid = {
      ...base,
      paid_transferencia: 300_000,
      saldo: 495_000,
    };
    expect(suggestedPayment(paid, "transferencia")).toBe(225_000);
    expect(suggestedPayment(paid, "efectivo")).toBe(270_000);
  });

  it("caps at the balance and floors at zero", () => {
    const overpaid = { ...base, paid_transferencia: 600_000, saldo: 100_000 };
    expect(suggestedPayment(overpaid, "transferencia")).toBe(0);
    expect(suggestedPayment(overpaid, "efectivo")).toBe(100_000);
  });

  it("suggests the whole balance without a receipt", () => {
    expect(
      suggestedPayment({ ...base, recibo_neto: null }, "transferencia"),
    ).toBe(795_000);
  });
});

describe("a savings plan cuota imputed to the employee", () => {
  it("is already paid: the split covers only the rest of the total", () => {
    // 100k of the total is a plan cuota: cash is 795k − 100k.
    expect(
      suggestedSplit({
        ...base,
        total_a_pagar: 895_000,
        paid_in_kind: 100_000,
      }),
    ).toEqual(suggestedSplit(base));
  });
});
