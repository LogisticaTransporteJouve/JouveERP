import { beforeEach, describe, expect, it, vi } from "vitest";

import { isRole, resolveAccess } from "@/lib/auth/permissions";

let roles: string[] = ["finance"];
const rpc = vi.fn(async (_fn: string, _args: unknown) => ({
  data: ["n1", "n2"] as unknown,
  error: null as unknown,
}));
const audit = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles.filter(isRole)),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ rpc }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: audit }));

const { applyFreightTariffIncreaseAction, listFreightTariffsAction } =
  await import("./freight-tariffs-actions");

const input = {
  list_ids: ["00000000-0000-4000-8000-000000000001"],
  pct: "7,5".replace(",", "."),
  label: "Enero/Febrero 27",
  valid_from: "2027-01-01",
  round_to: "10",
};

beforeEach(() => {
  roles = ["finance"];
  rpc.mockClear();
  audit.mockClear();
});

describe("applyFreightTariffIncreaseAction", () => {
  it("applies the increase in one call and audits it", async () => {
    const res = await applyFreightTariffIncreaseAction(input);
    expect(res).toEqual({ ok: true, data: { created: 2 } });
    expect(rpc).toHaveBeenCalledWith("apply_freight_tariff_increase", {
      p_list_ids: input.list_ids,
      p_pct: 7.5,
      p_label: "Enero/Febrero 27",
      p_valid_from: "2027-01-01",
      p_round_to: 10,
      p_user_id: "u1",
    });
    expect(audit).toHaveBeenCalledOnce();
  });

  it("returns the guard's message", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23514",
        hint: "jouve_guard",
        message: "El tarifario «General» ya tiene precios desde el 01/01/2027.",
      },
    });
    const res = await applyFreightTariffIncreaseAction(input);
    expect(res).toEqual({
      ok: false,
      error: "El tarifario «General» ya tiene precios desde el 01/01/2027.",
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it("operations reads the tariffs but cannot raise them", async () => {
    roles = ["operations"];
    const res = await applyFreightTariffIncreaseAction(input);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a warehouse user cannot read them", async () => {
    roles = ["warehouse"];
    const res = await listFreightTariffsAction();
    expect(res).toEqual({
      ok: false,
      error: "No tenés permiso para ver las tarifas de flete.",
    });
  });
});
