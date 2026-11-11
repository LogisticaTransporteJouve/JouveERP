import { describe, expect, it } from "vitest";

import { computeWaterfall } from "../schema";
import { waterfallBars, waterfallSteps } from "./waterfall-chart";

describe("waterfall bars", () => {
  it("steps from the previous end and totals from zero", () => {
    const w = computeWaterfall([
      {
        month: "2026-09",
        bucket: "service_revenue",
        subbucket: null,
        side: "fiscal",
        accountId: null,
        amount: 1000,
        pendingUsd: 0,
        costCenterId: null,
      },
      {
        month: "2026-09",
        bucket: "operating_cost",
        subbucket: "sueldos",
        side: "fiscal",
        accountId: null,
        amount: -400,
        pendingUsd: 0,
        costCenterId: null,
      },
    ]);
    const bars = waterfallBars(waterfallSteps(w));
    expect(bars[0]).toMatchObject({ start: 0, end: 1000 });
    expect(bars.slice(1, 5)).toMatchObject([
      { label: "Costos directos", start: 1000, end: 600 },
      { label: "Margen bruto", start: 0, end: 600 },
      { label: "Gastos de estructura", start: 600, end: 600 },
      { label: "Margen operativo", start: 0, end: 600 },
    ]);
    expect(bars.at(-1)).toMatchObject({
      label: "Generación de caja",
      end: 600,
    });
  });

  it("adds financing received and the cash variation only when there is any", () => {
    const base = {
      month: "2026-09",
      subbucket: null,
      side: "fiscal" as const,
      accountId: null,
      pendingUsd: 0,
      costCenterId: null,
    };
    const without = waterfallSteps(
      computeWaterfall([{ ...base, bucket: "service_revenue", amount: 100 }]),
    );
    expect(without.at(-1)!.label).toBe("Generación de caja");
    const bars = waterfallBars(
      waterfallSteps(
        computeWaterfall([
          { ...base, bucket: "service_revenue", amount: 100 },
          { ...base, bucket: "loan_disbursements", amount: 900 },
        ]),
      ),
    );
    expect(bars.slice(-3)).toMatchObject([
      { label: "Generación de caja", start: 0, end: 100 },
      { label: "Financiamiento recibido", start: 100, end: 1000 },
      { label: "Variación de caja", start: 0, end: 1000 },
    ]);
  });
});
