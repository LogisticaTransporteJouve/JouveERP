import { describe, expect, it } from "vitest";

import {
  ChannelSummaryInputSchema,
  defaultChannelSummaryRange,
  sumChannelSummary,
} from "./schema";

describe("ChannelSummaryInputSchema", () => {
  it("acepta un canal y un período válido", () => {
    expect(
      ChannelSummaryInputSchema.safeParse({
        channelId: "dz_fiscal",
        from: "2026-01-01",
        to: "2026-11-11",
      }).success,
    ).toBe(true);
  });

  it("rechaza un período invertido o sin canal", () => {
    expect(
      ChannelSummaryInputSchema.safeParse({
        channelId: "dz_fiscal",
        from: "2026-12-01",
        to: "2026-11-11",
      }).success,
    ).toBe(false);
    expect(
      ChannelSummaryInputSchema.safeParse({
        channelId: " ",
        from: "2026-01-01",
        to: "2026-11-11",
      }).success,
    ).toBe(false);
  });
});

describe("defaultChannelSummaryRange", () => {
  it("abre en los doce meses hasta hoy", () => {
    expect(defaultChannelSummaryRange("2026-11-11")).toEqual({
      from: "2025-12-01",
      to: "2026-11-11",
    });
    expect(defaultChannelSummaryRange("2026-01-31")).toEqual({
      from: "2025-02-01",
      to: "2026-01-31",
    });
  });
});

describe("sumChannelSummary", () => {
  it("suma cada columna sin mezclar los dólares pendientes", () => {
    expect(
      sumChannelSummary([
        {
          month: "2026-10",
          sales: 1000.1,
          costs: 400,
          margin: 600.1,
          payments: 300,
          pendingUsd: 0,
        },
        {
          month: "2026-11",
          sales: 0.2,
          costs: 0,
          margin: 0.2,
          payments: 0,
          pendingUsd: 50,
        },
      ]),
    ).toEqual({
      sales: 1000.3,
      costs: 400,
      margin: 600.3,
      payments: 300,
      pendingUsd: 50,
    });
  });
});
