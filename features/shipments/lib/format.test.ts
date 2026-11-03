import { describe, expect, it } from "vitest";

import {
  matchesShipmentSearch,
  remitoMatches,
  remitoNumberPattern,
  scannedRemitoLabel,
} from "./format";

const carga = {
  remito_number: "0001 - 00001234",
  origin: "Rosario",
  destination: "Córdoba",
  description: null,
  client: { legal_name: "Lácteos del Sur SA", display_name: null },
};

describe("matchesShipmentSearch", () => {
  it("finds a carga by its remito ignoring spaces", () => {
    expect(matchesShipmentSearch(carga, "0001-00001234")).toBe(true);
    expect(matchesShipmentSearch(carga, "1234")).toBe(true);
    expect(matchesShipmentSearch(carga, "9999")).toBe(false);
  });

  it("finds it by client or route, without accents or case", () => {
    expect(matchesShipmentSearch(carga, "lacteos")).toBe(true);
    expect(matchesShipmentSearch(carga, "CORDOBA")).toBe(true);
    expect(matchesShipmentSearch(carga, "  ")).toBe(true);
  });
});

describe("remitoMatches", () => {
  it("compares punto de venta and number as numbers", () => {
    const scanned = { sales_point: 1, number: 1234 };
    expect(remitoMatches("0001-00001234", scanned)).toBe(true);
    expect(remitoMatches("R 1 1234", scanned)).toBe(true);
    expect(remitoMatches("0002-00001234", scanned)).toBe(false);
    expect(remitoMatches("0001-00012345", scanned)).toBe(false);
  });

  it("matches on the number when either side has no punto de venta", () => {
    expect(remitoMatches("1234", { sales_point: 1, number: 1234 })).toBe(true);
    expect(
      remitoMatches("0003-00001234", { sales_point: null, number: 1234 }),
    ).toBe(true);
    expect(remitoMatches("sin número", { sales_point: 1, number: 1 })).toBe(
      false,
    );
  });

  it("filters in SQL exactly on the last digit group, as remitoMatches does", () => {
    const pattern = new RegExp(remitoNumberPattern(37));
    const scanned = { sales_point: null, number: 37 };
    for (const remito of [
      "37",
      "0001-00000037",
      "R 1 37",
      "0001-00000037 A",
      "0001-00000370",
      "0037-00001375",
      "0001-00010037",
      "0001-37-2",
      "sin número",
    ]) {
      expect(pattern.test(remito), remito).toBe(
        remitoMatches(remito, scanned),
      );
    }
    expect(() => remitoNumberPattern(1.5)).toThrow();
  });

  it("labels the scanned remito", () => {
    expect(scannedRemitoLabel({ sales_point: 1, number: 1234 })).toBe(
      "0001-00001234",
    );
    expect(scannedRemitoLabel({ sales_point: null, number: 7 })).toBe(
      "00000007",
    );
  });
});
