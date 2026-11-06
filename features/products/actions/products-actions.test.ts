import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import { recordingSupabase } from "@/tests/helpers/recording-supabase";

// The rows a write matches (none: the product is gone).
let written: Array<{ id: string }> = [];
const fake = recordingSupabase(() => ({ data: written, error: null }));
const logAudit = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["admin"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

const { deleteProductAction, setProductActiveAction, updateProductAction } =
  await import("./products-actions");

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  fake.calls.length = 0;
  written = [{ id: ID }];
  logAudit.mockClear();
});

describe("product writes on a product that is gone", () => {
  it.each([
    ["update", () => updateProductAction({ id: ID, notes: "x" })],
    ["deactivate", () => setProductActiveAction({ id: ID, is_active: false })],
    ["delete", () => deleteProductAction({ id: ID })],
  ] as const)("%s says so and audits nothing", async (_name, call) => {
    written = [];
    const res = await call();
    expect(res).toEqual({ ok: false, error: "El producto ya no existe." });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("audits a delete that removed the row", async () => {
    const res = await deleteProductAction({ id: ID });
    expect(res.ok).toBe(true);
    expect(logAudit).toHaveBeenCalledWith("product.deleted", "u1", {}, ID);
  });

  it("refuses a delete whose id is not a uuid", async () => {
    const res = await deleteProductAction({ id: "x" });
    expect(res).toEqual({ ok: false, error: "Datos inválidos." });
    expect(fake.calls).toHaveLength(0);
  });
});
