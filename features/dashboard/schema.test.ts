import { describe, expect, it } from "vitest";

import { ROLES } from "@/lib/auth/permissions";

import {
  DashboardLayoutSchema,
  defaultLayoutForRoles,
  WIDGET_IDS,
  WIDGET_LABEL,
} from "./schema";

describe("DashboardLayoutSchema", () => {
  it("accepts a valid layout", () => {
    const res = DashboardLayoutSchema.safeParse([
      { id: "finance_kpis", size: "full" },
      { id: "due_dates", size: "half" },
    ]);
    expect(res.success).toBe(true);
  });

  it("accepts an empty layout", () => {
    expect(DashboardLayoutSchema.safeParse([]).success).toBe(true);
  });

  it("rejects unknown widget ids", () => {
    const res = DashboardLayoutSchema.safeParse([
      { id: "nope", size: "full" },
    ]);
    expect(res.success).toBe(false);
  });

  it("rejects invalid sizes", () => {
    const res = DashboardLayoutSchema.safeParse([
      { id: "cash_flow", size: "third" },
    ]);
    expect(res.success).toBe(false);
  });

  it("rejects duplicated widgets", () => {
    const res = DashboardLayoutSchema.safeParse([
      { id: "cash_flow", size: "full" },
      { id: "cash_flow", size: "half" },
    ]);
    expect(res.success).toBe(false);
  });

  it("rejects non-array payloads", () => {
    expect(DashboardLayoutSchema.safeParse({ id: "cash_flow" }).success).toBe(
      false,
    );
  });
});

describe("defaultLayoutForRoles", () => {
  it("returns a valid template for every role", () => {
    for (const role of ROLES) {
      const layout = defaultLayoutForRoles([role]);
      expect(layout.length).toBeGreaterThan(0);
      expect(DashboardLayoutSchema.safeParse(layout).success).toBe(true);
    }
  });

  it("returns empty for no roles", () => {
    expect(defaultLayoutForRoles([])).toEqual([]);
  });

  it("prefers the finance template for owner over driver", () => {
    const layout = defaultLayoutForRoles(["driver", "owner"]);
    expect(layout.map((i) => i.id)).toContain("finance_kpis");
  });
});

describe("widget catalog", () => {
  it("has a label for every widget id", () => {
    for (const id of WIDGET_IDS) {
      expect(WIDGET_LABEL[id]).toBeTruthy();
    }
  });
});
