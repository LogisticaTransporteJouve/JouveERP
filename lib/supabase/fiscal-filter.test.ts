import { describe, expect, it } from "vitest";

import { applyChannelScope, applyFiscalFilter } from "./fiscal-filter";

function recorder() {
  const calls: unknown[][] = [];
  const query = {
    eq(column: string, value: string | boolean) {
      calls.push(["eq", column, value]);
      return query;
    },
    not(column: string, operator: string, value: boolean | null) {
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

describe("applyChannelScope", () => {
  it("con el canal de la sección filtra el lado y el canal", () => {
    const { query, calls } = recorder();
    applyChannelScope(
      query,
      { isFiscal: true, channelId: "jouve_internal" },
      "channel",
    );
    expect(calls).toEqual([
      ["eq", "channel.is_fiscal", true],
      ["not", "channel", "is", null],
      ["eq", "channel_id", "jouve_internal"],
    ]);
  });

  it("sin canal deja afuera los segregados del embed", () => {
    const { query, calls } = recorder();
    applyChannelScope(query, { isFiscal: null, channelId: null }, "channel");
    expect(calls).toEqual([
      ["eq", "channel.is_segregated", false],
      ["not", "channel", "is", null],
    ]);
  });

  it("en una vista conserva las filas sin canal", () => {
    const { query, calls } = recorder();
    applyChannelScope(query, { isFiscal: false, channelId: null });
    expect(calls).toEqual([
      ["eq", "channel_is_fiscal", false],
      ["not", "channel_is_segregated", "is", true],
    ]);
  });
});
