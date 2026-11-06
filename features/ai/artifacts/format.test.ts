import { describe, expect, it } from "vitest";

import {
  formatTick,
  isPlainCaption,
  pointDetails,
  tickIndices,
} from "./format";
import type { ChartArtifact } from "./spec";

describe("isPlainCaption", () => {
  it("accepts prose for an accountant", () => {
    expect(
      isPlainCaption(
        "Importes en pesos, a la cotización de cada comprobante. Las notas de crédito figuran en positivo.",
      ),
    ).toBe(true);
  });

  it("rejects field names, wildcards, backticks and tool names", () => {
    expect(
      isPlainCaption("las columnas *_orig quedan en moneda original"),
    ).toBe(false);
    expect(isPlainCaption("las cifras son las de `totals`")).toBe(false);
    expect(isPlainCaption("van aparte (collected_usd, open_foreign)")).toBe(
      false,
    );
    expect(isPlainCaption("usar getIncomeStatement")).toBe(false);
  });
});

describe("formatTick", () => {
  it("reads a document date as dd/mm and anything else as a category", () => {
    expect(formatTick("2026-11-03")).toBe("03/11");
    expect(formatTick("2026-05")).toBe("may 2026");
    expect(formatTick("Combustible")).toBe("Combustible");
  });
});

describe("tickIndices", () => {
  it("labels every point when there are few", () => {
    expect(tickIndices(["a", "b", "c"])).toEqual([0, 1, 2]);
  });

  it("prints each date once, at the first document of the day", () => {
    expect(
      tickIndices(["2026-11-03", "2026-11-03", "2026-11-04", "2026-11-04"]),
    ).toEqual([0, 2]);
  });

  it("thins to at most max labels, by date", () => {
    const days = Array.from(
      { length: 40 },
      (_, i) => `2026-11-${String(Math.floor(i / 2) + 1).padStart(2, "0")}`,
    );
    const shown = tickIndices(days, 10);
    expect(shown).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36]);
  });
});

describe("pointDetails", () => {
  const artifact: ChartArtifact = {
    kind: "chart",
    title: "IVA ventas",
    source: { action: "getLibroIvaVentas", input: {} },
    chart: {
      type: "bar",
      title: "IVA ventas",
      x: "comprobante",
      xLabel: "Comprobante",
      series: [{ field: "neto", label: "Neto" }],
      sort: "none",
      valueFormat: "money",
      tick: "fecha",
      detail: [
        { field: "comprobante", label: "Comprobante" },
        { field: "client_legal_name", label: "Cliente" },
        { field: "fecha", label: "Fecha" },
      ],
    },
    points: [
      {
        x: "A0003-00022271",
        values: [1000],
        tick: "2026-11-03",
        detail: ["A0003-00022271", null, "2026-11-03"],
      },
    ],
    truncated: false,
    meta: { sources: [], asOf: "2026-11-06T12:00:00Z", partial: false },
  };

  it("lists the label fields formatted, skipping blanks and the point's own label", () => {
    expect(pointDetails(artifact, 0)).toEqual([
      { label: "Fecha", value: "3 nov 2026" },
    ]);
  });

  it("is empty for a point without details", () => {
    expect(pointDetails(artifact, 5)).toEqual([]);
  });
});
