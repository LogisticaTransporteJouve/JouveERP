import { describe, expect, it } from "vitest";

import { voucherParty, voucherPaymentLines } from "./voucher-data";

describe("voucherPaymentLines", () => {
  it("labels the account type and keeps a missing account readable", () => {
    const rows: { amount: number | string; reference: string | null }[] = [
      {
        amount: "100.50",
        reference: "T1",
        account: { name: "Banco Nación", type: "bank" },
      },
      { amount: 10, reference: null, account: null },
      { amount: 1, reference: null, account: { name: "X", type: "otro" } },
    ].map((r) => r);
    expect(voucherPaymentLines(rows)).toEqual([
      {
        account_name: "Banco Nación",
        account_type_label: "Cuenta bancaria",
        amount: 100.5,
        reference: "T1",
      },
      {
        account_name: "—",
        account_type_label: "",
        amount: 10,
        reference: null,
      },
      {
        account_name: "X",
        account_type_label: "otro",
        amount: 1,
        reference: null,
      },
    ]);
  });
});

describe("voucherParty", () => {
  it("prints the IVA condition label, or the stored value when unknown", () => {
    expect(
      voucherParty({
        legal_name: "A",
        cuit: "1",
        iva_condition: "monotributo",
      }),
    ).toEqual({
      legal_name: "A",
      cuit: "1",
      iva_condition_label: "Monotributo",
    });
    expect(
      voucherParty({ legal_name: "A", cuit: "1", iva_condition: "raro" })
        .iva_condition_label,
    ).toBe("raro");
  });
});
