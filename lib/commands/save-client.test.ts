import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  result: { data: null as unknown, error: null as unknown },
}));
const logAudit = vi.fn();

function builder() {
  const b = {
    insert: (v: unknown) => {
      h.insert(v);
      return b;
    },
    update: (v: unknown) => {
      h.update(v);
      return b;
    },
    eq: () => b,
    select: () => b,
    single: async () => h.result,
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(resolve(h.result)),
  };
  return b;
}

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from: () => builder() }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

const { createClientRecord, updateClientRecord, CLIENT_NOT_FOUND } =
  await import("./save-client");

const ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  h.result = { data: null, error: null };
});

describe("createClientRecord", () => {
  it("an Otras ventas client carries no CUIT, IVA condition or fiscal address", async () => {
    h.result = { data: { id: ID }, error: null };
    const res = await createClientRecord("u1", {
      is_fiscal: false,
      legal_name: "Juan Pérez",
      real_address: "Ruta 3 km 40",
    });
    expect(res).toEqual({ ok: true, data: { id: ID } });
    expect(h.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        is_fiscal: false,
        cuit: null,
        iva_condition: null,
        address: null,
        real_address: "Ruta 3 km 40",
        created_by: "u1",
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      "client.created",
      "u1",
      { cuit: null, legal_name: "Juan Pérez" },
      ID,
    );
  });

  it("a repeated CUIT is refused in the user's words and not audited", async () => {
    h.result = { data: null, error: { code: "23505", message: "dup" } };
    const res = await createClientRecord("u1", {
      is_fiscal: true,
      cuit: "30714637432",
      legal_name: "Acme SA",
      iva_condition: "responsable_inscripto",
    });
    expect(res).toEqual({
      ok: false,
      error: "Ya existe un cliente con ese CUIT.",
    });
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("updateClientRecord", () => {
  it("writes only the given fields and audits their names", async () => {
    h.result = { data: [{ id: ID }], error: null };
    const res = await updateClientRecord("u1", {
      id: ID,
      email: "pagos@acme.com",
      phone: null,
    });
    expect(res).toEqual({ ok: true, data: { id: ID } });
    expect(h.update).toHaveBeenCalledWith({
      email: "pagos@acme.com",
      phone: null,
    });
    expect(logAudit).toHaveBeenCalledWith(
      "client.updated",
      "u1",
      { fields: ["email", "phone"] },
      ID,
    );
  });

  it("no row matched is a refusal, not an audited update", async () => {
    h.result = { data: [], error: null };
    const res = await updateClientRecord("u1", { id: ID, notes: "x" });
    expect(res).toEqual({ ok: false, error: CLIENT_NOT_FOUND });
    expect(logAudit).not.toHaveBeenCalled();
  });
});
