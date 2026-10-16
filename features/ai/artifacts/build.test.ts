import { describe, expect, it } from "vitest";

import { buildChartArtifact, buildTableArtifact } from "./build";

const source = { action: "getExpenseByCategory", input: { period: "2026-05" } };
const meta = {
  sources: ["ai_expense_by_category"],
  asOf: "2026-10-16T12:00:00Z",
  partial: false,
};

const rows = [
  { category_id: "c1", category: "Combustible", total: "1500.50", count: 3 },
  { category_id: "c2", category: "Peajes", total: "320", count: 7 },
  { category_id: "c3", category: "Seguros", total: 900, count: 1 },
];

describe("buildChartArtifact", () => {
  it("copies the values from the rows; defaults x and series to the first label and numeric fields", () => {
    const res = buildChartArtifact(
      { type: "bar", title: "Gasto por categoría" },
      { source, rows, meta },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.chart.x).toBe("category");
    expect(res.value.chart.series).toEqual([
      { field: "total", label: "Total" },
    ]);
    expect(res.value.chart.valueFormat).toBe("money");
    expect(res.value.points).toEqual([
      { x: "Combustible", values: [1500.5] },
      { x: "Peajes", values: [320] },
      { x: "Seguros", values: [900] },
    ]);
    expect(res.value.source).toEqual(source);
    expect(res.value.meta.partial).toBe(false);
  });

  it("sorts by the first series and caps with a limit, marking the cut as partial", () => {
    const res = buildChartArtifact(
      {
        type: "hbar",
        title: "Top",
        series: [{ field: "total" }],
        sort: "desc",
        limit: 2,
      },
      { source, rows, meta },
    );
    expect(res.ok && res.value.points.map((p) => p.x)).toEqual([
      "Combustible",
      "Seguros",
    ]);
    expect(res.ok && res.value.truncated).toBe(true);
    expect(res.ok && res.value.meta.partial).toBe(true);
  });

  it("puts points without a value last in either order", () => {
    const withGap = [...rows, { category: "Otros", total: null }];
    for (const sort of ["asc", "desc"] as const) {
      const res = buildChartArtifact(
        { type: "bar", title: "T", sort },
        { source, rows: withGap, meta },
      );
      expect(res.ok && res.value.points.at(-1)?.x).toBe("Otros");
    }
  });

  it("refuses an x that repeats instead of summing it", () => {
    const res = buildChartArtifact(
      { type: "bar", title: "T", x: "category" },
      { source, rows: [...rows, { category: "Peajes", total: 1 }], meta },
    );
    expect(res).toMatchObject({ ok: false });
    expect(!res.ok && res.error).toMatch(/repeats/);
  });

  it("names the usable fields when a field is missing or not numeric", () => {
    const missing = buildChartArtifact(
      { type: "line", title: "T", x: "month" },
      { source, rows, meta },
    );
    expect(!missing.ok && missing.error).toMatch(
      /Label fields: category.*Numeric fields: total, count/,
    );
    const notNumeric = buildChartArtifact(
      { type: "line", title: "T", series: [{ field: "category" }] },
      { source, rows, meta },
    );
    expect(notNumeric.ok).toBe(false);
  });

  it("keeps the source's partial flag and caps hbar at 30 points", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      name: `c${i}`,
      total: i,
    }));
    const res = buildChartArtifact(
      { type: "hbar", title: "T" },
      { source, rows: many, meta: { ...meta, partial: true } },
    );
    expect(res.ok && res.value.points).toHaveLength(30);
    expect(res.ok && res.value.meta.partial).toBe(true);
  });
});

describe("buildTableArtifact", () => {
  it("shows the chosen columns, numeric strings as numbers", () => {
    const res = buildTableArtifact(
      {
        title: "Gastos",
        columns: [
          { field: "category", label: "Categoría" },
          { field: "total" },
        ],
      },
      { source, rows, meta },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.columns).toEqual([
      { key: "category", label: "Categoría", numeric: false, money: false },
      { key: "total", label: "Total", numeric: true, money: true },
    ]);
    expect(res.value.rows).toEqual([
      ["Combustible", 1500.5],
      ["Peajes", 320],
      ["Seguros", 900],
    ]);
  });

  it("drops id columns by default and refuses unknown ones", () => {
    const res = buildTableArtifact({ title: "T" }, { source, rows, meta });
    expect(res.ok && res.value.columns.map((c) => c.key)).toEqual([
      "category",
      "total",
      "count",
    ]);
    expect(
      buildTableArtifact(
        { title: "T", columns: [{ field: "nope" }] },
        { source, rows, meta },
      ).ok,
    ).toBe(false);
  });

  it("caps rows and flags the cut", () => {
    const many = Array.from({ length: 320 }, (_, i) => ({ n: i }));
    const res = buildTableArtifact(
      { title: "T" },
      { source, rows: many, meta },
    );
    expect(res.ok && res.value.rows).toHaveLength(300);
    expect(res.ok && res.value.truncated).toBe(true);
  });
});
