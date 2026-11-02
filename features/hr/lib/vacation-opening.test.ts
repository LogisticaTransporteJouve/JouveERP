import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { applyVacationOpening } from "./vacation-opening";

type Row = Record<string, unknown>;

/** Minimal stand-in for the Supabase calls applyVacationOpening makes. */
function fakeClient(rows: Row[]) {
  const updates: Row[] = [];
  const inserts: Row[] = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: rows, error: null }),
        }),
      }),
      update: (patch: Row) => ({
        eq: (_col: string, id: unknown) => ({
          select: async () => {
            updates.push({ id, ...patch });
            return { data: [{ id }], error: null };
          },
        }),
      }),
      insert: async (row: Row) => {
        inserts.push(row);
        return { error: null };
      },
    }),
  };
  return { client, updates, inserts };
}

const base = {
  employeeId: "emp-1",
  today: "2026-11-02",
  userId: "user-1",
};

describe("applyVacationOpening", () => {
  it("creates both periods for an employee without balances", async () => {
    const { client, inserts } = fakeClient([]);
    const res = await applyVacationOpening(client as never, {
      ...base,
      currentDays: 14,
      previousDays: 5,
    });
    expect(res).toEqual({ ok: true, periodYear: 2026 });
    expect(inserts).toEqual([
      expect.objectContaining({
        period_year: 2026,
        entitled_days: 14,
        status: "active",
        granted_at: "2026-10-01",
        expires_at: "2027-04-30",
      }),
      expect.objectContaining({
        period_year: 2025,
        entitled_days: 5,
        status: "extended",
      }),
    ]);
  });

  it("leaves pending days equal to the figure entered, net of days used", async () => {
    const { client, updates } = fakeClient([
      {
        id: "b25",
        period_year: 2025,
        bonus_days: 0,
        carryover_days: 0,
        used_days: 3,
        status: "expired",
      },
    ]);
    await applyVacationOpening(client as never, {
      ...base,
      currentDays: null,
      previousDays: 7,
    });
    // entitled 10 − used 3 = 7 pending.
    expect(updates).toEqual([
      expect.objectContaining({
        id: "b25",
        entitled_days: 10,
        status: "extended",
      }),
    ]);
  });

  it("refuses a figure below what the period already used", async () => {
    const { client } = fakeClient([
      {
        id: "b26",
        period_year: 2026,
        bonus_days: 5,
        carryover_days: 0,
        used_days: 0,
        status: "active",
      },
    ]);
    const res = await applyVacationOpening(client as never, {
      ...base,
      currentDays: 3,
      previousDays: null,
    });
    expect(res.ok).toBe(false);
  });

  it("does not create an empty earlier period", async () => {
    const { client, inserts } = fakeClient([]);
    await applyVacationOpening(client as never, {
      ...base,
      currentDays: null,
      previousDays: 0,
    });
    expect(inserts).toEqual([]);
  });
});
