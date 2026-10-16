import { describe, expect, it } from "vitest";

import { upgradeLegacyFields } from "./legacy-fields";
import type { PinRequest } from "./spec";

const PRESENT = new Set([
  "legal_name",
  "cuit",
  "total_ars",
  "total_usd",
  "total_ars_equivalent",
  "bucket_0_30_ars",
  "bucket_0_30_usd",
  "bucket_90_plus_ars",
  "bucket_90_plus_usd",
  "document_count",
]);

describe("upgradeLegacyFields", () => {
  it("maps an old aging table to the per-currency fields", () => {
    const { request, upgraded } = upgradeLegacyFields(
      {
        kind: "table",
        source: { action: "getSupplierAging", input: {} },
        config: {
          title: "Deuda",
          columns: [
            { field: "supplier_legal_name", label: "Proveedor" },
            { field: "total_open", label: "Total" },
            { field: "bucket_90_plus" },
            { field: "document_count" },
          ],
        },
      },
      PRESENT,
    );
    expect(upgraded).toBe(true);
    expect(request.kind === "table" && request.config.columns).toEqual([
      { field: "legal_name", label: "Proveedor" },
      { field: "total_ars", label: "Total $" },
      { field: "total_usd", label: "Total US$" },
      { field: "bucket_90_plus_ars" },
      { field: "bucket_90_plus_usd" },
      { field: "document_count" },
    ]);
  });

  it("maps an old aging chart's x and series, within the series cap", () => {
    const { request, upgraded } = upgradeLegacyFields(
      {
        kind: "chart",
        source: { action: "getClientAging", input: {} },
        config: {
          type: "hbar",
          title: "Deudores",
          x: "client_legal_name",
          series: [{ field: "total_open" }, { field: "bucket_0_30" }],
        },
      },
      PRESENT,
    );
    expect(upgraded).toBe(true);
    if (request.kind !== "chart") throw new Error("chart expected");
    expect(request.config.x).toBe("legal_name");
    expect(request.config.series).toEqual([
      { field: "total_ars" },
      { field: "total_usd" },
      { field: "bucket_0_30_ars" },
    ]);
  });

  it("leaves current fields and other actions untouched", () => {
    const current: PinRequest = {
      kind: "table",
      source: { action: "getClientAging", input: {} },
      config: { title: "T", columns: [{ field: "total_ars" }] },
    };
    expect(upgradeLegacyFields(current, PRESENT)).toEqual({
      request: current,
      upgraded: false,
    });
    const other: PinRequest = {
      kind: "table",
      source: { action: "getInvoices", input: {} },
      config: { title: "T", columns: [{ field: "total_open" }] },
    };
    expect(upgradeLegacyFields(other, PRESENT).upgraded).toBe(false);
  });
});
