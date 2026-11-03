import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/clients/actions/sales-report-actions", () => ({
  getClientNetRevenueAction: vi.fn(),
  getClientSalesSummaryAction: vi.fn(),
}));
vi.mock("@/features/aging/actions/aging-actions", () => ({
  getAgingSummaryAction: vi.fn(),
}));
vi.mock("@/features/fleet-reports/actions/margin-actions", () => ({
  getFleetMarginAction: vi.fn(),
}));
vi.mock("@/features/fleet-reports/actions/activity-actions", () => ({
  getVehicleActivityAction: vi.fn(),
  getDriverActivityAction: vi.fn(),
}));
vi.mock("@/features/management/actions/management-actions", () => ({
  getManagementPnlAction: vi.fn(),
  listManagementCostCentersAction: vi.fn(),
  getManagementDrillAction: vi.fn(),
}));

import { getAgingSummaryAction } from "@/features/aging/actions/aging-actions";
import {
  getClientNetRevenueAction,
  getClientSalesSummaryAction,
} from "@/features/clients/actions/sales-report-actions";
import {
  getDriverActivityAction,
  getVehicleActivityAction,
} from "@/features/fleet-reports/actions/activity-actions";
import { getFleetMarginAction } from "@/features/fleet-reports/actions/margin-actions";
import type {
  DriverActivityRow,
  FleetMarginRow,
  VehicleActivityRow,
} from "@/features/fleet-reports/schema";
import {
  getManagementPnlAction,
  listManagementCostCentersAction,
} from "@/features/management/actions/management-actions";
import type { ManagementRow } from "@/features/management/schema";
import { resolveAccess, type Role } from "@/lib/auth/permissions";
import type { AgingPartyRow, AgingReport } from "@/lib/aging";

import {
  getClientMargin,
  getClientPaymentBehavior,
  getDriverActivity,
  getTopCosts,
  getVehicleEconomics,
  groupCosts,
  kmBasis,
  pageOf,
} from "./cross";
import { getManagementPnL } from "./management";

const ctx = (roles: Role[], denied: string[] = []) => ({
  userId: "u1",
  access: resolveAccess(roles, denied),
});

const RANGE = { from: "2026-10-01", to: "2026-10-31" };

function margin(
  key: string,
  label: string,
  v: Partial<FleetMarginRow>,
  totalGroups = 1,
): FleetMarginRow {
  return {
    group_key: key,
    label,
    trips: 0,
    revenue: 0,
    invoiced_revenue: 0,
    manual_revenue: 0,
    trip_cost: 0,
    fuel_cost: 0,
    maintenance_cost: 0,
    net: 0,
    margin_pct: 0,
    total_groups: totalGroups,
    total_revenue: 0,
    total_net: 0,
    ...v,
  };
}

type Data = { rows: Record<string, unknown>[]; [k: string]: unknown };

function okData(res: Awaited<ReturnType<typeof getClientMargin.execute>>) {
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(res.error);
  return { data: res.data as Data, meta: res.meta, summary: res.summary };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pageOf", () => {
  it("slices and says whether more rows follow", () => {
    const rows = [1, 2, 3, 4, 5];
    expect(pageOf(rows, { limit: 2, offset: 0 })).toEqual({
      rows: [1, 2],
      page: { offset: 0, limit: 2, total: 5, hasMore: true },
    });
    expect(pageOf(rows, { limit: 2, offset: 4 }).page.hasMore).toBe(false);
  });
});

describe("kmBasis", () => {
  it("prefers the odometer, then the trips' km, flagging trips without km", () => {
    expect(
      kmBasis({ odometer_km: 900, trip_km: 800, trips_without_km_count: 0 }),
    ).toEqual({ km: 900, source: "odómetro" });
    expect(
      kmBasis({ odometer_km: null, trip_km: 800, trips_without_km_count: 2 }),
    ).toEqual({ km: 800, source: "viajes (incompleto)" });
    expect(
      kmBasis({ odometer_km: null, trip_km: 0, trips_without_km_count: 0 }),
    ).toEqual({ km: null, source: null });
  });
});

describe("getClientMargin", () => {
  beforeEach(() => {
    vi.mocked(getClientNetRevenueAction).mockResolvedValue({
      ok: true,
      data: [
        {
          client_id: "c1",
          legal_name: "Acme",
          net_revenue_ars: 1000,
          invoices: 2,
          credit_notes: 0,
          debit_notes: 0,
          pending_foreign: 0,
          total_clients: 1,
          total_net_revenue_ars: 1000,
          total_pending_foreign: 0,
        },
      ],
    });
  });

  it("subtracts each client's direct trip costs and keeps the unassigned ones apart", async () => {
    vi.mocked(getFleetMarginAction).mockImplementation(async (input) => {
      const groupBy = (input as { groupBy: string }).groupBy;
      return {
        ok: true,
        data:
          groupBy === "client"
            ? [
                margin(
                  "c1",
                  "Acme",
                  { trips: 3, trip_cost: 200, fuel_cost: 100 },
                  3,
                ),
                margin(
                  "c2",
                  "Beta",
                  { trips: 1, trip_cost: 50, fuel_cost: 0 },
                  3,
                ),
                margin(
                  "none",
                  "Sin cliente asignado",
                  { trip_cost: 30, fuel_cost: 20 },
                  3,
                ),
              ]
            : [
                margin("v1", "AA123BB", {
                  fuel_cost: 180,
                  maintenance_cost: 70,
                }),
              ],
      };
    });
    const { data, meta } = okData(
      await getClientMargin.execute(ctx(["owner"]), RANGE),
    );
    expect(data.rows).toEqual([
      expect.objectContaining({
        client: "Acme",
        net_revenue_ars: 1000,
        direct_cost_ars: 300,
        contribution_ars: 700,
        contribution_pct: 70,
      }),
      // Costs but nothing invoiced in the range: shown, never hidden.
      expect.objectContaining({
        client: "Beta",
        net_revenue_ars: 0,
        direct_cost_ars: 50,
        contribution_ars: -50,
        contribution_pct: null,
      }),
    ]);
    expect(data.totals).toEqual(
      expect.objectContaining({
        direct_cost_ars: 400,
        direct_cost_without_client_ars: 50,
        // 180 of fuel by vehicle − 120 tied to trips + 70 maintenance.
        fleet_cost_not_assigned_ars: 130,
      }),
    );
    expect(meta.partial).toBe(false);
  });

  it("leaves the costs out (null, not 0) and says so without trips and shipments", async () => {
    const { data, meta } = okData(
      await getClientMargin.execute(ctx(["finance"]), RANGE),
    );
    expect(getFleetMarginAction).not.toHaveBeenCalled();
    expect(data.rows[0]).toEqual(
      expect.objectContaining({
        direct_cost_ars: null,
        contribution_ars: null,
      }),
    );
    expect(meta.note).toContain("Costos directos omitidos");
  });

  it("is partial when the revenue read did not cover every client", async () => {
    vi.mocked(getClientNetRevenueAction).mockResolvedValue({
      ok: true,
      data: [
        {
          client_id: "c1",
          legal_name: "Acme",
          net_revenue_ars: 1000,
          invoices: 1,
          credit_notes: 0,
          debit_notes: 0,
          pending_foreign: 0,
          total_clients: 900,
          total_net_revenue_ars: 5000,
          total_pending_foreign: 0,
        },
      ],
    });
    const { meta } = okData(
      await getClientMargin.execute(ctx(["finance"]), RANGE),
    );
    expect(meta.partial).toBe(true);
  });

  it("is not offered to a role without invoices", async () => {
    const res = await getClientMargin.execute(ctx(["operations"]), RANGE);
    expect(res.ok).toBe(false);
    expect(getClientNetRevenueAction).not.toHaveBeenCalled();
  });
});

describe("getClientPaymentBehavior", () => {
  it("joins days to pay with the current debt, the most overdue first", async () => {
    vi.mocked(getClientSalesSummaryAction).mockResolvedValue({
      ok: true,
      data: [
        {
          client_id: "c1",
          legal_name: "Acme",
          invoiced_ars: 0,
          invoices: 0,
          credit_notes: 0,
          collected_ars: 500,
          collected_usd: 0,
          receipts: 2,
          avg_days_to_pay: 45.5,
          open_ars: 100,
          open_foreign: 0,
          overdue_ars: 10,
          total_clients: 2,
          total_invoiced_ars: 0,
          total_collected_ars: 500,
          total_open_ars: 100,
        },
      ],
    });
    const party = (id: string, name: string, ars: number): AgingPartyRow => ({
      id,
      legal_name: name,
      display_name: null,
      cuit: null,
      document_count: 1,
      oldest_days: 120,
      buckets: {
        "0_30": { ars: 0, usd: 0 },
        "30_60": { ars: 0, usd: 0 },
        "60_90": { ars: 0, usd: 0 },
        "90_plus": { ars, usd: 0 },
      },
      total: { ars, usd: 0 },
      total_ars_equivalent: ars,
      rejected_checks: { ars: 0, usd: 0 },
      on_account: { ars: 0, usd: 0 },
    });
    const report: AgingReport = {
      rows: [party("c1", "Acme", 100), party("c2", "Beta", 900)],
      totals: {
        buckets: {
          "0_30": { ars: 0, usd: 0 },
          "30_60": { ars: 0, usd: 0 },
          "60_90": { ars: 0, usd: 0 },
          "90_plus": { ars: 1000, usd: 0 },
        },
        total: { ars: 1000, usd: 0 },
        total_ars_equivalent: 1000,
        party_count: 2,
        document_count: 2,
        rejected_checks: { ars: 0, usd: 0 },
        on_account: { ars: 0, usd: 0 },
      },
      usd_rate: null,
    };
    vi.mocked(getAgingSummaryAction).mockResolvedValue({
      ok: true,
      data: report,
    });
    const { data } = okData(
      await getClientPaymentBehavior.execute(ctx(["finance"]), RANGE),
    );
    expect(data.rows.map((r) => r.client)).toEqual(["Acme", "Beta"]);
    expect(data.rows[0]).toEqual(
      expect.objectContaining({ avg_days_to_pay: 45.5, receipts_count: 2 }),
    );
    // No receipts in the range: no average, not zero days.
    expect(data.rows[1]).toEqual(
      expect.objectContaining({ avg_days_to_pay: null, open_ars: 900 }),
    );
  });
});

function vehicleActivity(
  // The generated type says string; the RPC's "without vehicle" row is NULL.
  v: Omit<Partial<VehicleActivityRow>, "vehicle_id"> & {
    vehicle_id: string | null;
  },
): VehicleActivityRow {
  return {
    patente: "",
    is_active: true,
    trips: 0,
    trip_km: 0,
    trips_without_km: 0,
    unassigned_revenue: 0,
    fuel_loads: 0,
    fuel_liters: 0,
    odometer_start: 0,
    odometer_end: 0,
    odometer_km: 0,
    ...v,
  } as VehicleActivityRow;
}

describe("getVehicleEconomics", () => {
  beforeEach(() => {
    vi.mocked(getVehicleActivityAction).mockResolvedValue({
      ok: true,
      data: [
        vehicleActivity({
          vehicle_id: null,
          trips: 2,
          trip_km: 300,
          unassigned_revenue: 400,
        }),
        vehicleActivity({
          vehicle_id: "v1",
          patente: "AA123BB",
          trips: 4,
          trip_km: 1000,
          fuel_liters: 350,
          odometer_km: 1200,
        }),
      ],
    });
    vi.mocked(getFleetMarginAction).mockResolvedValue({
      ok: true,
      data: [
        margin("v1", "AA123BB", {
          revenue: 6000,
          trip_cost: 1000,
          fuel_cost: 1200,
          maintenance_cost: 400,
          net: 3400,
        }),
      ],
    });
  });

  it("puts revenue, costs, liters and km per vehicle and the trips without one apart", async () => {
    const { data, meta } = okData(
      await getVehicleEconomics.execute(ctx(["operations"]), RANGE),
    );
    expect(data.rows).toEqual([
      expect.objectContaining({
        vehicle: "AA123BB",
        km_used: 1200,
        km_source: "odómetro",
        liters_per_100km: 29.17,
        revenue_per_km_ars: 5,
        cost_per_km_ars: 2.17,
        margin_pct: 56.7,
      }),
    ]);
    expect(data.withoutVehicle).toEqual({
      trips: 2,
      trip_km: 300,
      revenue_ars: 400,
    });
    expect(meta.note).toContain("no están vinculadas a un camión");
  });

  it("names the parts a per-user deny leaves out", async () => {
    const { meta } = okData(
      await getVehicleEconomics.execute(
        ctx(["operations"], ["fuel:read"]),
        RANGE,
      ),
    );
    expect(meta.note).toContain("litros (permiso de combustible)");
  });
});

describe("getDriverActivity", () => {
  const driver = (v: Partial<DriverActivityRow>): DriverActivityRow =>
    ({
      driver_id: "d1",
      full_name: "Juan",
      is_active: true,
      employee_id: null,
      trips: 3,
      trip_km: 900,
      trips_without_km: 0,
      extras_ars: null,
      advances_ars: null,
      advances_usd: null,
      account_balance_ars: null,
      ...v,
    }) as DriverActivityRow;

  it("says the HR part is left out without hr:read", async () => {
    vi.mocked(getDriverActivityAction).mockResolvedValue({
      ok: true,
      data: [driver({})],
    });
    vi.mocked(getFleetMarginAction).mockResolvedValue({
      ok: true,
      data: [margin("d1", "Juan", { revenue: 900, net: 500 })],
    });
    const { data, meta } = okData(
      await getDriverActivity.execute(ctx(["operations"]), RANGE),
    );
    expect(data.rows[0]).toEqual(
      expect.objectContaining({ revenue_ars: 900, extras_ars: null }),
    );
    expect(meta.note).toContain("permiso de RRHH");
  });

  it("brings the employee's extras and advances with hr:read", async () => {
    vi.mocked(getDriverActivityAction).mockResolvedValue({
      ok: true,
      data: [
        driver({
          employee_id: "e1",
          extras_ars: 50,
          advances_ars: 20,
          advances_usd: 0,
          account_balance_ars: 15,
        }),
      ],
    });
    vi.mocked(getFleetMarginAction).mockResolvedValue({ ok: true, data: [] });
    const { data, meta } = okData(
      await getDriverActivity.execute(ctx(["admin"]), RANGE),
    );
    expect(data.rows[0]).toEqual(
      expect.objectContaining({ extras_ars: 50, advances_ars: 20 }),
    );
    expect(meta.note).not.toContain("permiso de RRHH");
  });
});

describe("getTopCosts", () => {
  const row = (v: Partial<ManagementRow>): ManagementRow => ({
    month: "2026-10",
    bucket: "operating_cost",
    subbucket: "combustible",
    side: "fiscal",
    accountId: "a1",
    amount: -100,
    pendingUsd: 0,
    costCenterId: null,
    ...v,
  });

  it("groups costs as positive amounts by category, largest first", () => {
    const groups = groupCosts(
      [
        row({ amount: -300 }),
        row({ subbucket: "seguros", amount: -50 }),
        row({ subbucket: null, amount: -20 }),
        row({ bucket: "financing_cost", subbucket: "intereses", amount: -80 }),
        row({ bucket: "service_revenue", subbucket: null, amount: 5000 }),
      ],
      "category",
      true,
      () => "",
    );
    expect(groups.map((g) => [g.key, g.cost])).toEqual([
      ["combustible", 300],
      ["intereses", 80],
      ["seguros", 50],
      ["otros", 20],
    ]);
  });

  it("ranks the top ones, puts the rest in one row and builds the stacked month table", async () => {
    vi.mocked(getManagementPnlAction).mockResolvedValue({
      ok: true,
      data: [
        row({ amount: -300 }),
        row({ month: "2026-09", amount: -100 }),
        row({ subbucket: "seguros", amount: -50 }),
        row({ subbucket: "peajes", amount: -50 }),
      ],
    });
    const res = await getTopCosts.execute(ctx(["finance"]), {
      fromPeriod: "2026-09",
      toPeriod: "2026-10",
      limit: 1,
    });
    const { data } = okData(res);
    expect(data.rows).toEqual([
      expect.objectContaining({
        name: "Combustible",
        cost_ars: 400,
        share_pct: 80,
      }),
      expect.objectContaining({
        name: "Resto (2)",
        cost_ars: 100,
        share_pct: 20,
      }),
    ]);
    expect(data.byMonth).toEqual([
      {
        month: "2026-09",
        cost_combustible: 100,
        cost_peajes: 0,
        cost_seguros: 0,
      },
      {
        month: "2026-10",
        cost_combustible: 300,
        cost_peajes: 50,
        cost_seguros: 50,
      },
    ]);
  });

  it("getManagementPnL gives one chart-ready row per month", async () => {
    vi.mocked(getManagementPnlAction).mockResolvedValue({
      ok: true,
      data: [
        row({ month: "2026-10", amount: -300 }),
        row({
          month: "2026-10",
          bucket: "service_revenue",
          subbucket: null,
          amount: 1000,
        }),
      ],
    });
    vi.mocked(listManagementCostCentersAction).mockResolvedValue({
      ok: true,
      data: [],
    });
    const res = await getManagementPnL.execute(ctx(["owner"]), {
      fromPeriod: "2026-09",
      toPeriod: "2026-10",
    });
    const { data, meta } = okData(res);
    expect(data.byMonth).toEqual([
      expect.objectContaining({ month: "2026-09", operating_margin_ars: 0 }),
      expect.objectContaining({
        month: "2026-10",
        service_revenue_ars: 1000,
        operating_cost_ars: -300,
        operating_margin_ars: 700,
      }),
    ]);
    expect(meta.partial).toBe(false);
  });

  it("is not offered without management:read", async () => {
    const res = await getTopCosts.execute(ctx(["operations"]), {
      fromPeriod: "2026-09",
      toPeriod: "2026-10",
    });
    expect(res.ok).toBe(false);
  });
});
