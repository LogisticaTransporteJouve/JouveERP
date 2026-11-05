import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Permission,
  type Role,
  resolveAccess,
} from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
let denies: Permission[] = [];
let result: { data: unknown; error: unknown } = { data: null, error: null };
const calls: { method: string; args: unknown[] }[] = [];
const from = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denies),
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      from(table);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "gte", "lte", "order", "limit"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.maybeSingle = async () => result;
      builder.then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject);
      return builder;
    },
  }),
}));

const { getSupplierCategoryAction, listSupplierCategoryPurchasesAction } =
  await import("./supplier-categories-actions");

const CATEGORY = "4f0c1d1e-0000-4000-8000-000000000001";
const input = {
  categoryId: CATEGORY,
  from: "2026-01-01",
  to: "2026-11-05",
  isFiscal: true,
  limit: 2,
};

const purchaseRow = (id: string, kind = "factura") => ({
  id,
  kind,
  letter: "A",
  punto_venta: 3,
  numero: 15,
  fecha: "2026-10-01",
  imp_total: 121,
  moneda: "PES",
  supplier_id: "s1",
  suppliers: { legal_name: "YPF S.A.", category_id: CATEGORY },
  invoicing_channels: { is_fiscal: true },
});

const eqArgs = () => calls.filter((c) => c.method === "eq").map((c) => c.args);

beforeEach(() => {
  roles = ["finance"];
  denies = [];
  result = { data: null, error: null };
  calls.length = 0;
  from.mockReset();
});

describe("getSupplierCategoryAction", () => {
  it("needs suppliers:read", async () => {
    roles = ["warehouse"];
    expect(await getSupplierCategoryAction(CATEGORY)).toEqual({
      ok: false,
      error: "No tenés permiso para ver categorías.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("reads a malformed id as not found without querying", async () => {
    expect(await getSupplierCategoryAction("nope")).toEqual({
      ok: true,
      data: null,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("returns the category without its slug", async () => {
    result = {
      data: { id: CATEGORY, name: "Combustible", is_active: true },
      error: null,
    };
    expect(await getSupplierCategoryAction(CATEGORY)).toEqual({
      ok: true,
      data: { id: CATEGORY, name: "Combustible", is_active: true },
    });
    expect(calls[0]).toEqual({
      method: "select",
      args: ["id, name, is_active"],
    });
  });

  it("returns a failed read as an error, not as not found", async () => {
    result = { data: null, error: { message: "boom" } };
    expect(await getSupplierCategoryAction(CATEGORY)).toEqual({
      ok: false,
      error: "No se pudo leer la categoría.",
    });
  });
});

describe("listSupplierCategoryPurchasesAction", () => {
  it.each<[string, Role[], Permission[]]>([
    ["operations (no purchase read)", ["operations"], []],
    [
      "finance with purchase_invoices:read denied",
      ["finance"],
      ["purchase_invoices:read"],
    ],
    ["finance with suppliers:read denied", ["finance"], ["suppliers:read"]],
  ])("refuses %s", async (_, r, d) => {
    roles = r;
    denies = d;
    expect(await listSupplierCategoryPurchasesAction(input)).toEqual({
      ok: false,
      error: "No tenés permiso para ver compras.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects an inverted range before querying", async () => {
    const res = await listSupplierCategoryPurchasesAction({
      ...input,
      from: "2026-12-01",
    });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("reads received purchases of the category on the asked side", async () => {
    result = { data: [purchaseRow("p1")], error: null };
    const res = await listSupplierCategoryPurchasesAction(input);
    expect(from).toHaveBeenCalledWith("purchase_invoices");
    expect(eqArgs()).toEqual([
      ["suppliers.category_id", CATEGORY],
      ["status", "received"],
      ["invoicing_channels.is_fiscal", true],
    ]);
    expect(calls).toContainEqual({
      method: "gte",
      args: ["fecha", input.from],
    });
    expect(calls).toContainEqual({ method: "lte", args: ["fecha", input.to] });
    expect(calls).toContainEqual({ method: "limit", args: [3] });
    expect(res).toEqual({
      ok: true,
      data: {
        purchases: [
          {
            id: "p1",
            kind: "factura",
            letter: "A",
            punto_venta: 3,
            numero: 15,
            fecha: "2026-10-01",
            imp_total: 121,
            moneda: "PES",
            supplier_id: "s1",
            supplier_legal_name: "YPF S.A.",
            is_fiscal: true,
          },
        ],
        hasMore: false,
      },
    });
  });

  it("reads both sides when isFiscal is null", async () => {
    result = { data: [], error: null };
    await listSupplierCategoryPurchasesAction({ ...input, isFiscal: null });
    expect(eqArgs().map(([column]) => column)).not.toContain(
      "invoicing_channels.is_fiscal",
    );
  });

  it("flags more rows than the limit", async () => {
    result = {
      data: [purchaseRow("p1"), purchaseRow("p2", "nc"), purchaseRow("p3")],
      error: null,
    };
    const res = await listSupplierCategoryPurchasesAction(input);
    expect(res.ok && res.data.purchases.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(res.ok && res.data.hasMore).toBe(true);
  });

  it("returns a failed read as an error, never as an empty list", async () => {
    result = { data: null, error: { message: "timeout" } };
    expect(await listSupplierCategoryPurchasesAction(input)).toEqual({
      ok: false,
      error: "No se pudieron leer las compras.",
    });
  });
});
