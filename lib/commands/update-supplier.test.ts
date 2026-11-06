import { beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn();
const select = vi.fn();
const logAudit = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      update: (patch: unknown) => {
        update(patch);
        return { eq: () => ({ select }) };
      },
    }),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

const { updateSupplier } = await import("./update-supplier");

const ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateSupplier", () => {
  it("writes only the fields sent and audits their names", async () => {
    select.mockResolvedValue({ data: [{ id: ID }], error: null });
    const res = await updateSupplier("u1", {
      id: ID,
      email: "pagos@proveedor.com",
      default_payment_term_days: null,
    });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(update).toHaveBeenCalledWith({
      email: "pagos@proveedor.com",
      default_payment_term_days: null,
    });
    expect(logAudit).toHaveBeenCalledWith(
      "supplier.updated",
      "u1",
      { fields: ["email", "default_payment_term_days"] },
      ID,
    );
  });

  it("says when the supplier is not there", async () => {
    select.mockResolvedValue({ data: [], error: null });
    expect(await updateSupplier("u1", { id: ID, notes: "x" })).toEqual({
      ok: false,
      error: "No se encontró el proveedor.",
    });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("names a duplicate CUIT", async () => {
    select.mockResolvedValue({ data: null, error: { code: "23505" } });
    expect(await updateSupplier("u1", { id: ID, cuit: "30711111111" })).toEqual(
      { ok: false, error: "Ya existe un proveedor con ese CUIT." },
    );
  });
});
