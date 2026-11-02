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
      },
      {
        month: "2026-09",
        bucket: "operating_cost",
        subbucket: "sueldos",
        side: "fiscal",
        accountId: null,
        amount: -400,
        pendingUsd: 0,
      },
    ]);
    const bars = waterfallBars(waterfallSteps(w));
    expect(bars[0]).toMatchObject({ start: 0, end: 1000 });
    expect(bars[1]).toMatchObject({ start: 1000, end: 600 });
    expect(bars[2]).toMatchObject({
      label: "Margen operativo",
      start: 0,
      end: 600,
    });
    expect(bars.at(-1)).toMatchObject({
      label: "Generación de caja",
      end: 600,
    });
  });
});
