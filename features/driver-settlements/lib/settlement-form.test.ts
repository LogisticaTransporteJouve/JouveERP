import { describe, expect, it } from "vitest";

import {
  emptyLine,
  parseAmount,
  rowReceived,
  rowsProblem,
  rowsToItems,
  type RowDraft,
} from "./settlement-form";

const CASH = "cash";
const CHECKS = "checks";
const isCheck = (id: string) => id === CHECKS;

function row(patch: Partial<RowDraft> = {}): RowDraft {
  return {
    shipment_id: "s1",
    label: "Cliente",
    detail: "",
    expected: 1000,
    included: true,
    note: "",
    lines: [emptyLine(CASH, "1000")],
    ...patch,
  };
}

describe("rendición form", () => {
  it("adds every line of a carga", () => {
    const r = row({
      lines: [
        emptyLine(CASH, "600"),
        { ...emptyLine(CHECKS, "400.005"), check_number: "1" },
      ],
    });
    expect(rowReceived(r)).toBe(1000.01);
    expect(parseAmount("-5")).toBe(0);
    expect(parseAmount("abc")).toBe(0);
  });

  it("sends only the lines with an amount, check fields only on checks", () => {
    const r = row({
      lines: [
        { ...emptyLine(CASH, "600"), check_number: "ignored" },
        emptyLine(CASH, ""),
        {
          ...emptyLine(CHECKS, "400"),
          check_number: "123",
          bank_name: "Nación",
          check_due_date: "2026-12-01",
        },
      ],
    });
    const [item] = rowsToItems(
      [r, row({ shipment_id: "s2", included: false })],
      isCheck,
    );
    expect(item?.lines).toEqual([
      {
        account_id: CASH,
        amount: 600,
        reference: "",
        check_number: "",
        bank_name: "",
        check_due_date: "",
      },
      {
        account_id: CHECKS,
        amount: 400,
        reference: "",
        check_number: "123",
        bank_name: "Nación",
        check_due_date: "2026-12-01",
      },
    ]);
    expect(rowsToItems([r], isCheck)).toHaveLength(1);
  });

  it("keeps a carga with nothing handed in as an item without lines", () => {
    const [item] = rowsToItems([row({ lines: [emptyLine(CASH)] })], isCheck);
    expect(item?.lines).toEqual([]);
  });

  it("asks for the check data of every check line", () => {
    const r = row({
      lines: [emptyLine(CASH, "500"), emptyLine(CHECKS, "500")],
    });
    expect(rowsProblem([r], isCheck)).toBe(
      "El cheque de Cliente necesita número, banco y fecha de pago.",
    );
    expect(rowsProblem([row({ included: false })], isCheck)).toBe(
      "Elegí al menos una carga.",
    );
    expect(rowsProblem([row()], isCheck)).toBeNull();
  });
});
