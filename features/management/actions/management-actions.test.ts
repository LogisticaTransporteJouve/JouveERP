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
  logManagementExportAction,
  setManagementBucketAction,
} = await import("./management-actions");

const ACCOUNT = "3f2b8c1e-6a4d-4e1b-9c2a-1b2c3d4e5f60";

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
    rpc.mockResolvedValue({
      data: [
        {
          month: "2026-09",
          bucket: "service_revenue",
          subbucket: null,
          channel_side: "internal",
          chart_account_id: ACCOUNT,
          amount_ars: "1500.50",
          pending_usd: "0",
        },
      ],
      error: null,
    });
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
      data: [expect.objectContaining({ amount: 1500.5, side: "internal" })],
    });
  });

  it("reports a failed read as an error, not as zero", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
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
