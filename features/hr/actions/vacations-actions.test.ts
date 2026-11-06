import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

let roles: Role[] = [];
let rows: unknown[] = [];
const calls: [string, ...unknown[]][] = [];

/** A PostgREST builder that records its filters and resolves to `rows`. */
function builder() {
  const b = {
    select: (...a: unknown[]) => (calls.push(["select", ...a]), b),
    lte: (...a: unknown[]) => (calls.push(["lte", ...a]), b),
    gte: (...a: unknown[]) => (calls.push(["gte", ...a]), b),
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), b),
    order: (...a: unknown[]) => (calls.push(["order", ...a]), b),
    limit: (...a: unknown[]) => {
      calls.push(["limit", ...a]);
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return b;
}
const from = vi.fn((table: string) => {
  calls.push(["from", table]);
  return builder();
});

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { listLeavesByRangeAction } = await import("./vacations-actions");

const EMP = "00000000-0000-4000-8000-0000000000a1";

beforeEach(() => {
  roles = [];
  rows = [];
  calls.length = 0;
  from.mockClear();
});

describe("listLeavesByRangeAction", () => {
  it("never reaches the database for a role without hr:read", async () => {
    roles = ["operations"];
    const res = await listLeavesByRangeAction({
      from: "2026-12-01",
      to: "2026-12-31",
    });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("reads the leaves that overlap the range, with the days inside it", async () => {
    roles = ["admin"];
    rows = [
      {
        id: "l1",
        employee_id: EMP,
        start_date: "2026-11-25",
        end_date: "2026-12-06",
        kind: "vacaciones",
        employees: { legal_name: "Gómez Ana" },
      },
    ];
    const res = await listLeavesByRangeAction({
      from: "2026-12-01",
      to: "2026-12-31",
      kind: "vacaciones",
    });
    expect(calls).toContainEqual(["lte", "start_date", "2026-12-31"]);
    expect(calls).toContainEqual(["gte", "end_date", "2026-12-01"]);
    expect(calls).toContainEqual(["eq", "kind", "vacaciones"]);
    expect(res).toEqual({
      ok: true,
      data: {
        partial: false,
        rows: [
          {
            id: "l1",
            employee_id: EMP,
            employee: "Gómez Ana",
            kind: "vacaciones",
            kind_label: "Vacaciones",
            start_date: "2026-11-25",
            end_date: "2026-12-06",
            days: 12,
            days_in_range: 6,
          },
        ],
      },
    });
  });

  it("caps the rows and reports the read as partial", async () => {
    roles = ["admin"];
    rows = Array.from({ length: 501 }, (_, i) => ({
      id: `l${i}`,
      employee_id: EMP,
      start_date: "2026-12-01",
      end_date: "2026-12-01",
      kind: "franco",
      employees: { legal_name: "Gómez Ana" },
    }));
    const res = await listLeavesByRangeAction({
      from: "2026-12-01",
      to: "2026-12-31",
    });
    expect(calls).toContainEqual(["limit", 501]);
    expect(res.ok && res.data.rows).toHaveLength(500);
    expect(res.ok && res.data.partial).toBe(true);
  });

  it("rejects an inverted range", async () => {
    roles = ["admin"];
    const res = await listLeavesByRangeAction({
      from: "2026-12-31",
      to: "2026-12-01",
    });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});
