import { beforeEach, describe, expect, it, vi } from "vitest";

// A PostgREST stand-in that honours .range() and caps every response at
// max_rows = 1000, as the hosted API does.
const MAX_ROWS = 1000;
let tables: Record<string, Record<string, unknown>[]> = {};

function from(table: string) {
  const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  let window: [number, number] | null = null;
  const builder = {
    select: () => builder,
    eq: (col: string, v: unknown) => {
      filters.push((r) => r[col] === v);
      return builder;
    },
    in: (col: string, vs: unknown[]) => {
      filters.push((r) => vs.includes(r[col]));
      return builder;
    },
    gte: () => builder,
    lte: () => builder,
    order: () => builder,
    limit: () => builder,
    range: (a: number, b: number) => {
      window = [a, b];
      return builder;
    },
    then<T>(resolve: (v: { data: unknown; error: null }) => T) {
      const rows = (tables[table] ?? []).filter((r) =>
        filters.every((f) => f(r)),
      );
      const [a, b] = window ?? [0, rows.length - 1];
      const page = rows.slice(a, Math.min(b + 1, a + MAX_ROWS));
      return Promise.resolve({ data: page, error: null }).then(resolve);
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from }),
}));

const { readEmployeeTrips, TRIPS_LIMIT } = await import("./trip-extras");

function trips(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    trip_date: "2026-10-15",
    km: 10,
    origin: null,
    destination: null,
    driver_id: "d1",
    status: "completed",
  }));
}

beforeEach(() => {
  tables = { drivers: [{ id: "d1", employee_id: "e1" }] };
});

describe("readEmployeeTrips", () => {
  it("reads every trip and unloading past the 1000-row cap", async () => {
    tables.trips = trips(1500);
    // Two delivered shipments per trip: 3000 rows.
    tables.shipments = tables.trips.flatMap((t, i) => [
      { id: `s${i}a`, trip_id: t.id, status: "delivered" },
      { id: `s${i}b`, trip_id: t.id, status: "delivered" },
    ]);

    const res = await readEmployeeTrips(["e1"], 2026, 10);

    const list = res.byEmployee.get("e1") ?? [];
    expect(list).toHaveLength(1500);
    expect(list.reduce((s, t) => s + t.unloads, 0)).toBe(3000);
    expect(res.partial).toBe(false);
  });

  it("flags partial only past its own trip cap", async () => {
    tables.trips = trips(TRIPS_LIMIT + 1);
    tables.shipments = [];

    const res = await readEmployeeTrips(["e1"], 2026, 10);

    expect(res.byEmployee.get("e1")).toHaveLength(TRIPS_LIMIT);
    expect(res.partial).toBe(true);
  });
});
