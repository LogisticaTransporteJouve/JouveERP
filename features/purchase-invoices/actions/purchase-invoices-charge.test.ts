import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Permission,
  type Role,
  resolveAccess,
} from "@/lib/auth/permissions";

let roles: Role[] = [];
let denied: Permission[] = [];
const from = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denied),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { createPurchaseInvoiceAction, updatePurchaseInvoiceAction } =
  await import("./purchase-invoices-actions");

const EMP = "00000000-0000-4000-8000-000000000001";
const ID = "00000000-0000-4000-8000-000000000009";

beforeEach(() => {
  roles = ["finance"];
  denied = ["hr:write"];
  from.mockClear();
});

// "A cargo de empleado" writes the employee's current account: without
// hr:write a purchases user cannot set or clear it.
describe("a cargo de empleado", () => {
  it("refuses a new purchase charged to an employee without hr:write", async () => {
    const res = await createPurchaseInvoiceAction({
      channel_id: "jouve_internal",
      supplier_id: "11111111-1111-4111-8111-111111111111",
      charged_employee_id: EMP,
      kind: "factura",
      punto_venta: 1,
      numero: 10,
      fecha: "2026-11-03",
      imp_neto: 100,
      imp_total: 100,
    });
    expect(res).toEqual({
      ok: false,
      error: "No tenés permiso para cargar una compra a un empleado.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses clearing it without hr:write", async () => {
    const res = await updatePurchaseInvoiceAction({
      id: ID,
      charged_employee_id: "",
    });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});
