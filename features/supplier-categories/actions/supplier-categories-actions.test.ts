import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
let existing: { id: string; name: string } | null = null;
const ilike = vi.fn();
const insert = vi.fn();
const logAudit = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, []),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const lookup = {
        select: () => lookup,
        ilike: (...args: unknown[]) => {
          ilike(...args);
          return lookup;
        },
        neq: () => lookup,
        limit: () => lookup,
        maybeSingle: async () => ({ data: existing, error: null }),
        insert: (row: unknown) => {
          insert(row);
          return {
            select: () => ({
              single: async () => ({ data: { id: "cat-new" }, error: null }),
            }),
          };
        },
      };
      return lookup;
    },
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));

const { canCreateSupplierCategoryAction, createSupplierCategoryAction } =
  await import("./supplier-categories-actions");

beforeEach(() => {
  roles = ["finance"];
  existing = null;
  ilike.mockReset();
  insert.mockReset();
  logAudit.mockReset();
});

describe("createSupplierCategoryAction", () => {
  it("needs suppliers:write", async () => {
    roles = ["operations"];
    expect(await createSupplierCategoryAction({ name: "Peajes" })).toEqual({
      ok: false,
      error: "No tenés permiso para crear categorías.",
    });
    expect(insert).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses a name that exists with another case", async () => {
    existing = { id: "cat-1", name: "Combustible" };
    expect(
      await createSupplierCategoryAction({ name: "  combustible " }),
    ).toEqual({ ok: false, error: 'Ya existe la categoría "Combustible".' });
    expect(ilike).toHaveBeenCalledWith("name", "combustible");
    expect(insert).not.toHaveBeenCalled();
  });

  it("takes LIKE wildcards in the name literally", async () => {
    await createSupplierCategoryAction({ name: "100%_ok" });
    expect(ilike).toHaveBeenCalledWith("name", "100\\%\\_ok");
  });

  it("creates the trimmed name and audits it", async () => {
    expect(await createSupplierCategoryAction({ name: " Peajes " })).toEqual({
      ok: true,
      data: { id: "cat-new" },
    });
    expect(insert).toHaveBeenCalledWith({
      name: "Peajes",
      is_active: true,
    });
    expect(logAudit).toHaveBeenCalledWith(
      "supplier_category.created",
      "u1",
      { name: "Peajes" },
      "cat-new",
    );
  });

  it("refuses a blank name", async () => {
    expect((await createSupplierCategoryAction({ name: "   " })).ok).toBe(
      false,
    );
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("canCreateSupplierCategoryAction", () => {
  it("follows suppliers:write", async () => {
    expect(await canCreateSupplierCategoryAction()).toEqual({
      ok: true,
      data: true,
    });
    roles = ["operations"];
    expect(await canCreateSupplierCategoryAction()).toEqual({
      ok: true,
      data: false,
    });
  });
});
