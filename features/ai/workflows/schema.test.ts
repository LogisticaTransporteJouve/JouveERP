import { describe, expect, it } from "vitest";

import {
  AiWorkflowDraftSchema,
  describeSchedule,
  draftSchedule,
} from "./schema";

const base = {
  title: "Cobranzas vencidas",
  prompt: "Resumime las cobranzas vencidas por cliente.",
  runTime: "08:00",
};

describe("AiWorkflowDraftSchema", () => {
  it("accepts a weekly task and drops a stray month day", () => {
    const parsed = AiWorkflowDraftSchema.parse({
      ...base,
      cadence: "weekly",
      weekday: "1",
      monthDay: 5,
    });
    expect(parsed).toMatchObject({ weekday: "1", monthDay: null });
    expect(describeSchedule(draftSchedule(parsed))).toBe(
      "Todos los lunes a las 08:00",
    );
  });

  it("requires the weekday for weekly and the day for monthly", () => {
    const weekly = AiWorkflowDraftSchema.safeParse({
      ...base,
      cadence: "weekly",
      weekday: "",
      monthDay: null,
    });
    expect(weekly.success).toBe(false);
    expect(weekly.error?.issues[0]?.path).toEqual(["weekday"]);
    const monthly = AiWorkflowDraftSchema.safeParse({
      ...base,
      cadence: "monthly",
      weekday: null,
      monthDay: Number.NaN,
    });
    expect(monthly.success).toBe(false);
    expect(monthly.error?.issues[0]?.path).toEqual(["monthDay"]);
  });

  it("keeps times on the 15-minute grid and month days at most 28", () => {
    for (const runTime of ["08:10", "24:00", "8:00"]) {
      expect(
        AiWorkflowDraftSchema.safeParse({
          ...base,
          runTime,
          cadence: "daily",
          weekday: null,
          monthDay: null,
        }).success,
      ).toBe(false);
    }
    expect(
      AiWorkflowDraftSchema.safeParse({
        ...base,
        cadence: "monthly",
        weekday: null,
        monthDay: 31,
      }).success,
    ).toBe(false);
  });

  it("re-parses its own output (stored drafts are revalidated on confirm)", () => {
    const once = AiWorkflowDraftSchema.parse({
      ...base,
      cadence: "monthly",
      weekday: null,
      monthDay: "10",
    });
    expect(AiWorkflowDraftSchema.parse(once)).toEqual(once);
    expect(describeSchedule(draftSchedule(once))).toBe(
      "Todos los meses, el día 10, a las 08:00",
    );
  });
});
