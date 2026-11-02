import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
const rpc = vi.fn();
const upsert = vi.fn();
const logAudit = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles),
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

const { getManagementPnlAction, setManagementBucketAction } =
  await import("./management-actions");

const ACCOUNT = "3f2b8c1e-6a4d-4e1b-9c2a-1b2c3d4e5f60";

beforeEach(() => {
  roles = ["finance"];
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
