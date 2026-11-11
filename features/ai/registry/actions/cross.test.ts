import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/clients/actions/sales-report-actions", () => ({
  getClientSalesSummaryAction: vi.fn(),
}));
vi.mock("@/features/aging/actions/aging-actions", () => ({
  getAgingSummaryAction: vi.fn(),
}));
vi.mock("@/features/fleet-reports/actions/margin-actions", () => ({
  getFleetMarginAction: vi.fn(),
}));
vi.mock("@/features/fleet-reports/actions/activity-actions", () => ({
  getDriverActivityAction: vi.fn(),
}));
vi.mock("@/features/management/actions/management-actions", () => ({
  getManagementPnlAction: vi.fn(),
  listManagementCostCentersAction: vi.fn(),
  getManagementDrillAction: vi.fn(),
}));

import { getAgingSummaryAction } from "@/features/aging/actions/aging-actions";
import { getClientSalesSummaryAction } from "@/features/clients/actions/sales-report-actions";
import { getDriverActivityAction } from "@/features/fleet-reports/actions/activity-actions";
import { getFleetMarginAction } from "@/features/fleet-reports/actions/margin-actions";
import type {
  DriverActivityRow,
  FleetMarginRow,
} from "@/features/fleet-reports/schema";
import {
  getManagementPnlAction,
  listManagementCostCentersAction,
} from "@/features/management/actions/management-actions";
import type { ManagementRow } from "@/features/management/schema";
import { resolveAccess, type Role } from "@/lib/auth/permissions";
import type { AgingPartyRow, AgingReport } from "@/lib/aging";

import {
  getClientPaymentBehavior,
  getDriverActivity,
  getTopCosts,
  groupCosts,
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
    uninvoiced_freight: 0,
    total_uninvoiced_freight: 0,
    uninvoiced_shipments: 0,
    total_uninvoiced_shipments: 0,
    maintenance_without_cost: 0,
    total_maintenance_without_cost: 0,
    ...v,
  };
}

type Data = { rows: Record<string, unknown>[]; [k: string]: unknown };

function okData(res: Awaited<ReturnType<typeof getDriverActivity.execute>>) {
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
      data: {
        rows: [
          row({ amount: -300 }),
          row({ month: "2026-09", amount: -100 }),
          row({ subbucket: "seguros", amount: -50 }),
          row({ subbucket: "peajes", amount: -50 }),
        ],
        partial: false,
      },
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
      data: {
        rows: [
          row({ month: "2026-10", amount: -300 }),
          row({
            month: "2026-10",
            bucket: "service_revenue",
            subbucket: null,
            amount: 1000,
          }),
        ],
        partial: false,
      },
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
