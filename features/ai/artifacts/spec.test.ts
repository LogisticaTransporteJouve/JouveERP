import { describe, expect, it } from "vitest";

import { buildChartArtifact } from "./build";
import {
  artifactSchema,
  chartConfigSchema,
  pinRequestOf,
  pinRequestSchema,
  tableConfigSchema,
} from "./spec";

describe("chartConfigSchema", () => {
  it("accepts a form and fields", () => {
    expect(
      chartConfigSchema.safeParse({
        type: "line",
        title: "Evolución",
        x: "period",
        series: [{ field: "total", label: "Total" }],
      }).success,
    ).toBe(true);
  });

  it("rejects values, unknown chart types, extra keys and too many series", () => {
    const base = { type: "bar", title: "T" };
    expect(
      chartConfigSchema.safeParse({ ...base, data: [{ x: 1 }] }).success,
    ).toBe(false);
    expect(chartConfigSchema.safeParse({ ...base, type: "pie" }).success).toBe(
      false,
    );
    expect(
      chartConfigSchema.safeParse({
        ...base,
        series: [
          { field: "a" },
          { field: "b" },
          { field: "c" },
          { field: "d" },
        ],
      }).success,
    ).toBe(false);
    expect(
      chartConfigSchema.safeParse({
        ...base,
        series: [{ field: "a" }, { field: "a" }],
      }).success,
    ).toBe(false);
    expect(chartConfigSchema.safeParse({ ...base, x: "a.b" }).success).toBe(
      false,
    );
    expect(chartConfigSchema.safeParse({ ...base, title: "" }).success).toBe(
      false,
    );
  });

  it("rejects repeated table columns", () => {
    expect(
      tableConfigSchema.safeParse({
        title: "T",
        columns: [{ field: "a" }, { field: "a", label: "A" }],
      }).success,
    ).toBe(false);
  });
});

describe("pinRequestSchema", () => {
  it("carries a source and a config, never rows", () => {
    expect(
      pinRequestSchema.safeParse({
        kind: "table",
        source: { action: "getInvoices", input: {} },
        config: { title: "T" },
        rows: [[1]],
      }).success,
    ).toBe(false);
    expect(
      pinRequestSchema.safeParse({
        kind: "table",
        source: { action: "getInvoices", input: { q: "x".repeat(3000) } },
        config: { title: "T" },
      }).success,
    ).toBe(false);
  });

  it("round-trips a built chart into the request that rebuilds it", () => {
    const built = buildChartArtifact(
      { type: "bar", title: "T" },
      {
        source: { action: "getX", input: { period: "2026-05" } },
        rows: [{ name: "a", total: 1 }],
        meta: { sources: ["s"], asOf: "2026-10-16T00:00:00Z", partial: false },
      },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(artifactSchema.safeParse(built.value).success).toBe(true);
    const request = pinRequestOf(built.value);
    expect(pinRequestSchema.parse(request)).toEqual({
      kind: "chart",
      source: { action: "getX", input: { period: "2026-05" } },
      config: {
        type: "bar",
        title: "T",
        x: "name",
        xLabel: "Name",
        series: [{ field: "total", label: "Total" }],
        sort: "none",
        valueFormat: "money",
      },
    });
  });
});
