import { describe, expect, it } from "vitest";

import { applyFiscalFilter } from "./fiscal-filter";

function recorder() {
  const calls: unknown[][] = [];
  const query = {
    eq(column: string, value: boolean) {
      calls.push(["eq", column, value]);
      return query;
    },
    not(column: string, operator: string, value: null) {
      calls.push(["not", column, operator, value]);
      return query;
    },
  };
  return { query, calls };
}

describe("applyFiscalFilter", () => {
  it.each([null, undefined])("con %s no filtra", (isFiscal) => {
    const { query, calls } = recorder();
    expect(applyFiscalFilter(query, isFiscal, "channel")).toBe(query);
    expect(calls).toEqual([]);
  });

  it.each([true, false])(
    "con %s filtra el embed y descarta las filas sin canal",
    (isFiscal) => {
      const { query, calls } = recorder();
      applyFiscalFilter(query, isFiscal, "channel");
      expect(calls).toEqual([
        ["eq", "channel.is_fiscal", isFiscal],
        ["not", "channel", "is", null],
      ]);
    },
  );

  it("sin embed filtra la columna channel_is_fiscal de la vista", () => {
    const { query, calls } = recorder();
    applyFiscalFilter(query, false);
    expect(calls).toEqual([["eq", "channel_is_fiscal", false]]);
  });
});
