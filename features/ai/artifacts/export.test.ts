import { describe, expect, it } from "vitest";

import { artifactXlsx } from "./export";
import type { Artifact } from "./spec";

const meta = { sources: ["x"], asOf: "2026-06-05", partial: false };
const source = { action: "getX", input: {} };

describe("artifactXlsx", () => {
  it("types a table's columns from their formats", () => {
    const artifact: Artifact = {
      kind: "table",
      title: "Saldos por cliente: junio",
      source,
      columns: [
        { key: "cuit", label: "CUIT", numeric: false, format: "text" },
        { key: "fecha", label: "Fecha", numeric: false, format: "text" },
        { key: "saldo", label: "Saldo", numeric: true, format: "money" },
        { key: "usd", label: "USD", numeric: true, format: "usd" },
        { key: "n", label: "Facturas", numeric: true, format: "count" },
        { key: "pct", label: "Margen", numeric: true, format: "percent" },
      ],
      rows: [["0020123456789", "2026-06-01", 10.5, 2, 3, 12.5]],
      truncated: false,
      meta: { ...meta, currency: "ARS" },
    };
    const { fileName, sheet } = artifactXlsx(artifact);
    expect(fileName).toBe("saldos-por-cliente-junio.xlsx");
    expect(sheet.name).toBe("Saldos por cliente: junio");
    expect(sheet.columns).toEqual([
      { header: "CUIT", type: "text" },
      { header: "Fecha", type: "date" },
      { header: "Saldo", type: "money", currency: "ARS" },
      { header: "USD", type: "money", currency: "USD" },
      { header: "Facturas", type: "integer" },
      { header: "Margen", type: "percent" },
    ]);
    expect(sheet.rows).toBe(artifact.rows);
  });

  it("writes a chart's points with its x label and series", () => {
    const artifact: Artifact = {
      kind: "chart",
      title: "Ventas",
      source,
      chart: {
        type: "bar",
        title: "Ventas",
        x: "mes",
        xLabel: "Mes",
        series: [{ field: "total", label: "Total" }],
        sort: "none",
        valueFormat: "money",
      },
      points: [{ x: "2026-05", values: [100] }],
      truncated: false,
      meta,
    };
    const { sheet } = artifactXlsx(artifact);
    expect(sheet.columns).toEqual([
      { header: "Mes", type: "text" },
      { header: "Total", type: "money", currency: "ARS" },
    ]);
    expect(sheet.rows).toEqual([["2026-05", 100]]);
  });
});
