import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
const from = vi.fn();
const update = vi.fn();
const logAudit = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, []),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ update: (row: unknown) => update(row) }),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

const { listCostCenterVehiclesAction, updateCostCenterAction } =
  await import("./cost-centers-actions");

const CENTER = "3f2b8c1e-6a4d-4e1b-9c2a-1b2c3d4e5f60";
const VEHICLE = "5b1c9d2e-7a3f-4c2b-8d1e-2c3d4e5f6a70";

beforeEach(() => {
  roles = ["finance"];
  from.mockReset();
  update.mockReset();
  logAudit.mockReset();
});

describe("listCostCenterVehiclesAction", () => {
  it("is only for who edits the centers (not fiscal_reader)", async () => {
    roles = ["fiscal_reader"];
    const res = await listCostCenterVehiclesAction();
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("lists the trucks for finance, which cannot read vehicles itself", async () => {
    const page = [
      { id: VEHICLE, patente: "AB123CD", alias: null, is_active: true },
    ];
    const builder = {
      select: () => builder,
      order: () => builder,
      range: vi
        .fn()
        .mockResolvedValueOnce({ data: page, error: null })
        .mockResolvedValueOnce({ data: [], error: null }),
    };
    from.mockReturnValue(builder);
    const res = await listCostCenterVehiclesAction();
    expect(from).toHaveBeenCalledWith("vehicles");
    expect(res).toEqual({ ok: true, data: page });
  });
});

describe("updateCostCenterAction", () => {
  it("links a truck and audits it", async () => {
    update.mockReturnValue({
      eq: () => ({
        select: async () => ({ data: [{ id: CENTER }], error: null }),
      }),
    });
    const res = await updateCostCenterAction({
      id: CENTER,
      vehicle_id: VEHICLE,
    });
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ vehicle_id: VEHICLE });
    expect(logAudit).toHaveBeenCalledWith(
      "cost_center.updated",
      "u1",
      { vehicle_id: VEHICLE },
      CENTER,
    );
  });

  it("says a truck already has a center", async () => {
    update.mockReturnValue({
      eq: () => ({
        select: async () => ({
          data: null,
          error: {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "cost_centers_vehicle_unique"',
          },
        }),
      }),
    });
    const res = await updateCostCenterAction({
      id: CENTER,
      vehicle_id: VEHICLE,
    });
    expect(res).toEqual({
      ok: false,
      error: "Ese camión ya está vinculado a otro centro de costo.",
    });
  });

  it("says the center is gone and audits nothing when no row matched", async () => {
    update.mockReturnValue({
      eq: () => ({ select: async () => ({ data: [], error: null }) }),
    });
    expect(
      await updateCostCenterAction({ id: CENTER, vehicle_id: VEHICLE }),
    ).toEqual({
      ok: false,
      error: "No se encontró el centro de costo. Actualizá la página.",
    });
    expect(logAudit).not.toHaveBeenCalled();
  });
});
