import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
let denies: string[] = [];
const rpc = vi.fn();
const upsert = vi.fn();
const logAudit = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denies),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
      upsert,
    }),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

const {
  getManagementDrillAction,
  getManagementPnlAction,
  getVehicleMarginAction,
  logManagementExportAction,
  setManagementBucketAction,
} = await import("./management-actions");

const ACCOUNT = "3f2b8c1e-6a4d-4e1b-9c2a-1b2c3d4e5f60";
const VEHICLE = "5b1c9d2e-7a3f-4c2b-8d1e-2c3d4e5f6a70";

/** An RPC builder: `.order()` chains, `.range()` answers `pages` in turn. */
function pageable(...pages: { data: unknown; error: unknown }[]) {
  const order = vi.fn();
  const range = vi.fn();
  const builder = { order, range };
  order.mockReturnValue(builder);
  for (const page of pages) range.mockResolvedValueOnce(page);
  return builder;
}

const pnlRow = (over: Record<string, unknown> = {}) => ({
  month: "2026-09",
  bucket: "service_revenue",
  subbucket: null,
  channel_side: "internal",
  chart_account_id: ACCOUNT,
  amount_ars: "1500.50",
  pending_usd: "0",
  ...over,
});

beforeEach(() => {
  roles = ["finance"];
  denies = [];
  rpc.mockReset();
  upsert.mockReset();
  logAudit.mockReset();
});

describe("getManagementPnlAction", () => {
  it("never answers fiscal_reader, and never reaches the RPC for it", async () => {
    roles = ["fiscal_reader"];
    const res = await getManagementPnlAction({
      fromPeriod: "2026-09",
      toPeriod: "2026-09",
    });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reads the month range in pesos for finance", async () => {
    const builder = pageable({ data: [pnlRow()], error: null });
    rpc.mockReturnValue(builder);
    const res = await getManagementPnlAction({
      fromPeriod: "2026-09",
      toPeriod: "2026-09",
      basis: "cash",
    });
    expect(rpc).toHaveBeenCalledWith("get_management_pnl", {
      p_from: "2026-09-01",
      p_to: "2026-09-30",
      p_basis: "cash",
      p_inflation: false,
    });
    expect(res).toEqual({
      ok: true,
      data: {
        rows: [expect.objectContaining({ amount: 1500.5, side: "internal" })],
        partial: false,
      },
    });
  });

  it("pages past PostgREST's 1000-row cap over a total order", async () => {
    const builder = pageable(
      { data: Array.from({ length: 1000 }, () => pnlRow()), error: null },
      { data: [pnlRow(), pnlRow()], error: null },
    );
    rpc.mockReturnValue(builder);
    const res = await getManagementPnlAction({
      fromPeriod: "2026-09",
      toPeriod: "2026-09",
    });
    expect(res.ok && res.data.rows).toHaveLength(1002);
    expect(res.ok && res.data.partial).toBe(false);
    expect(builder.range.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    // Each page is a fresh, fully ordered request.
    expect(builder.order.mock.calls.slice(0, 6).map(([c]) => c)).toEqual([
      "month",
      "bucket",
      "subbucket",
      "channel_side",
      "chart_account_id",
      "cost_center_id",
    ]);
  });

  it("reports a failed read as an error, not as zero", async () => {
    rpc.mockReturnValue(pageable({ data: null, error: { message: "boom" } }));
    const res = await getManagementPnlAction({
      fromPeriod: "2026-09",
      toPeriod: "2026-09",
    });
    expect(res.ok).toBe(false);
  });
});

describe("setManagementBucketAction", () => {
  it("is for owner and admin only", async () => {
    const res = await setManagementBucketAction({
      accountId: ACCOUNT,
      bucket: "operating_cost",
      subbucket: "combustible",
    });
    expect(res.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("saves and audits the change", async () => {
    roles = ["admin"];
    upsert.mockResolvedValue({ error: null });
    const res = await setManagementBucketAction({
      accountId: ACCOUNT,
      bucket: "operating_cost",
      subbucket: "combustible",
    });
    expect(res.ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        chart_of_accounts_id: ACCOUNT,
        bucket: "operating_cost",
        subbucket: "combustible",
        updated_by: "u1",
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      "management_bucket.set",
      "u1",
      expect.objectContaining({ bucket: "operating_cost" }),
      ACCOUNT,
    );
  });
});

describe("getManagementDrillAction", () => {
  const input = {
    fromPeriod: "2026-09",
    toPeriod: "2026-09",
    basis: "cash",
    lineKey: "op:sueldos_internos",
    side: "internal",
  };
  const doc = (over: Record<string, unknown>) => ({
    month: "2026-09",
    bucket: "operating_cost",
    subbucket: "sueldos_internos",
    channel_side: "internal",
    chart_account_id: null,
    cost_center_id: null,
    amount_ars: "-100",
    pending_usd: "0",
    doc_type: "employee",
    doc_id: ACCOUNT,
    doc_parent_id: null,
    doc_subtype: null,
    doc_date: null,
    doc_label: "Cuenta del empleado",
    counterparty: "Juan",
    ...over,
  });

  it("never answers fiscal_reader", async () => {
    roles = ["fiscal_reader"];
    const res = await getManagementDrillAction(input);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks for the line's buckets and adds up its documents", async () => {
    rpc.mockReturnValue({
      range: async () => ({
        data: [doc({}), doc({ channel_side: "fiscal", amount_ars: "-5" })],
        error: null,
      }),
    });
    const res = await getManagementDrillAction(input);
    expect(rpc).toHaveBeenCalledWith("get_management_pnl_documents", {
      p_from: "2026-09-01",
      p_to: "2026-09-30",
      p_basis: "cash",
      p_buckets: ["operating_cost"],
    });
    expect(res).toEqual({
      ok: true,
      data: expect.objectContaining({ count: 1, total: -100, partial: false }),
    });
    expect(res.ok && res.data.documents[0]!.href).toBe(`/employees/${ACCOUNT}`);
  });

  it("does not link a document whose module the user cannot read", async () => {
    denies = ["hr:read"];
    rpc.mockReturnValue({
      range: async () => ({ data: [doc({})], error: null }),
    });
    const res = await getManagementDrillAction(input);
    expect(res.ok && res.data.documents[0]!.href).toBeNull();
  });

  it("reports a failed read as an error, not as no documents", async () => {
    rpc.mockReturnValue({
      range: async () => ({ data: null, error: { message: "boom" } }),
    });
    const res = await getManagementDrillAction(input);
    expect(res.ok).toBe(false);
  });
});

describe("getVehicleMarginAction", () => {
  const input = { fromPeriod: "2025-10", toPeriod: "2026-09" };
  const raw = (over: Record<string, unknown>) => ({
    row_kind: "vehicle",
    vehicle_id: VEHICLE,
    patente: "AB123CD",
    is_active: true,
    cost_center_id: ACCOUNT,
    trips: 3,
    revenue: "1000",
    trip_cost: "100",
    fuel_cost: "300",
    maintenance_cost: "0",
    center_cost: "400",
    net: "200",
    pending_usd: "0",
    ...over,
  });

  it("is for management:read (not operations)", async () => {
    roles = ["operations"];
    const res = await getVehicleMarginAction(input);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps what no truck owns apart from the trucks", async () => {
    rpc.mockReturnValue(
      pageable({
        data: [
          raw({}),
          raw({
            row_kind: "no_vehicle",
            vehicle_id: null,
            patente: null,
            is_active: null,
            cost_center_id: null,
            center_cost: "0",
            fuel_cost: "0",
            revenue: "50",
            net: "50",
          }),
          raw({
            row_kind: "no_center",
            vehicle_id: null,
            patente: null,
            is_active: null,
            cost_center_id: null,
            revenue: "0",
            trip_cost: "0",
            fuel_cost: "0",
            center_cost: "70",
            net: "-70",
          }),
          raw({ row_kind: "something_new" }),
        ],
        error: null,
      }),
    );
    const res = await getVehicleMarginAction(input);
    expect(rpc).toHaveBeenCalledWith("get_vehicle_margin", {
      p_from: "2025-10-01",
      p_to: "2026-09-30",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.vehicles).toEqual([
      expect.objectContaining({
        vehicleId: VEHICLE,
        centerCost: 400,
        net: 200,
        marginPct: 20,
      }),
    ]);
    expect(res.data.withoutVehicle).toEqual(
      expect.objectContaining({ revenue: 50, marginPct: 100 }),
    );
    expect(res.data.unattributed).toEqual([
      expect.objectContaining({ kind: "no_center", centerCost: 70 }),
    ]);
    expect(res.data.partial).toBe(false);
  });

  it("shows a database guard's message", async () => {
    rpc.mockReturnValue(
      pageable({
        data: null,
        error: {
          message: "Hay más de 500 vehículos con movimientos en el período",
          hint: "jouve_guard",
          code: "54000",
        },
      }),
    );
    const res = await getVehicleMarginAction(input);
    expect(res).toEqual({
      ok: false,
      error: "Hay más de 500 vehículos con movimientos en el período",
    });
  });

  it("reports a failed read as an error, not as zero", async () => {
    rpc.mockReturnValue(pageable({ data: null, error: { message: "boom" } }));
    const res = await getVehicleMarginAction(input);
    expect(res).toEqual({
      ok: false,
      error: "No se pudo calcular el margen por camión.",
    });
  });
});

describe("logManagementExportAction", () => {
  const input = {
    fiscalYear: 2026,
    basis: "accrual",
    inflation: false,
    format: "xlsx",
    side: "total",
    costCenter: "all",
  };

  it("audits who downloaded the internal table", async () => {
    const res = await logManagementExportAction(input);
    expect(res.ok).toBe(true);
    expect(logAudit).toHaveBeenCalledWith(
      "management.exported",
      "u1",
      expect.objectContaining({ format: "xlsx", fiscalYear: 2026 }),
    );
  });

  it("is refused to fiscal_reader", async () => {
    roles = ["fiscal_reader"];
    const res = await logManagementExportAction(input);
    expect(res.ok).toBe(false);
    expect(logAudit).not.toHaveBeenCalled();
  });
});
