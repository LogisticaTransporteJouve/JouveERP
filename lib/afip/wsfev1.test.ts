import { describe, expect, it } from "vitest";

import { normalizeSalesPoints } from "./wsfev1";

describe("normalizeSalesPoints", () => {
  it("returns empty array for undefined", () => {
    expect(normalizeSalesPoints(undefined)).toEqual([]);
  });

  it("wraps a single PtoVenta object into an array", () => {
    const result = normalizeSalesPoints({
      Nro: 1,
      EmisionTipo: "CAE",
      Bloqueado: "N",
      FchBaja: "NULL",
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      number: 1,
      emissionType: "CAE",
      blocked: false,
      expirationDate: null,
    });
  });

  it("flags blocked sales points", () => {
    const [pos] = normalizeSalesPoints({
      Nro: 99,
      EmisionTipo: "CAE",
      Bloqueado: "S",
      FchBaja: "NULL",
    });
    expect(pos?.blocked).toBe(true);
  });

  it("preserves expirationDate when not NULL", () => {
    const [pos] = normalizeSalesPoints({
      Nro: 5,
      EmisionTipo: "CAEA",
      Bloqueado: "N",
      FchBaja: "20251231",
    });
    expect(pos?.expirationDate).toBe("20251231");
  });

  it("normalizes a list of PtoVenta entries", () => {
    const result = normalizeSalesPoints([
      { Nro: 1, EmisionTipo: "CAE", Bloqueado: "N", FchBaja: "NULL" },
      { Nro: 2, EmisionTipo: "CAEA", Bloqueado: "S", FchBaja: "NULL" },
    ]);
    expect(result.map((p) => p.number)).toEqual([1, 2]);
    expect(result.map((p) => p.blocked)).toEqual([false, true]);
  });

  it("falls back to UNKNOWN when EmisionTipo missing", () => {
    const [pos] = normalizeSalesPoints({ Nro: 1 });
    expect(pos?.emissionType).toBe("UNKNOWN");
    expect(pos?.blocked).toBe(false);
  });
});
