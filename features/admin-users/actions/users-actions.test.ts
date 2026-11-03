import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Access } from "@/lib/auth/permissions";

const h = await vi.hoisted(async () => {
  const { resolveAccess } = await import("@/lib/auth/permissions");
  const state: {
    access: Access;
    rpcCalls: Array<[string, Record<string, unknown>]>;
    rpcError: { code: string; message: string } | null;
    audits: unknown[][];
    resolveAccess: typeof resolveAccess;
  } = {
    access: resolveAccess(["owner"]),
    rpcCalls: [],
    rpcError: null,
    audits: [],
    resolveAccess,
  };
  return state;
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "actor", access: h.access }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: async (...args: unknown[]) => {
    h.audits.push(args);
  },
}));
vi.mock("@/lib/observability", () => ({
  captureException: vi.fn(),
  captureMessageOnce: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => {
    return {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        h.rpcCalls.push([fn, args]);
        return { error: h.rpcError };
      },
      auth: {
        admin: {
          inviteUserByEmail: async () => ({
            data: { user: { id: "invited" } },
            error: null,
          }),
        },
      },
    };
  },
}));

const { setUserAccessAction, inviteUserAction } =
  await import("./users-actions");

const TARGET = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.access = h.resolveAccess(["owner"]);
  h.rpcCalls = [];
  h.rpcError = null;
  h.audits = [];
});

describe("setUserAccessAction", () => {
  const input = {
    userId: TARGET,
    roles: ["finance"],
    denied: ["invoices:issue"],
    expectedRoles: ["operations"],
    expectedDenied: [],
  };

  it("saves roles and denies in one RPC, with the actor's role reach", async () => {
    expect(await setUserAccessAction(input)).toEqual({
      ok: true,
      data: undefined,
    });
    expect(h.rpcCalls).toHaveLength(1);
    const [fn, args] = h.rpcCalls[0] ?? [];
    expect(fn).toBe("set_user_access");
    expect(args).toMatchObject({
      p_actor: "actor",
      p_user_id: TARGET,
      p_roles: ["finance"],
      p_denied: ["invoices:issue"],
      p_expected_roles: ["operations"],
      p_expected_denied: [],
    });
    expect(args?.p_addable_roles).toContain("owner");
  });

  it("leaves an unchanged part out of the RPC", async () => {
    await setUserAccessAction({ ...input, roles: null });
    expect(h.rpcCalls[0]?.[1]).not.toHaveProperty("p_roles");
  });

  it("refuses editing one's own access", async () => {
    const res = await setUserAccessAction({ ...input, userId: "actor" });
    expect(res.ok).toBe(false);
    expect(h.rpcCalls).toEqual([]);
  });

  it("needs users:manage_access to change denies (admin lacks it)", async () => {
    h.access = h.resolveAccess(["admin"]);
    const res = await setUserAccessAction(input);
    expect(res).toEqual({
      ok: false,
      error: "No tenés permiso para modificar accesos.",
    });
    expect(h.rpcCalls).toEqual([]);
  });

  it("lets an admin change roles alone", async () => {
    h.access = h.resolveAccess(["admin"]);
    expect((await setUserAccessAction({ ...input, denied: null })).ok).toBe(
      true,
    );
  });

  it("honours a deny on users:assign_role", async () => {
    h.access = h.resolveAccess(["admin"], ["users:assign_role"]);
    const res = await setUserAccessAction({ ...input, denied: null });
    expect(res).toEqual({
      ok: false,
      error: "No tenés permiso para modificar roles.",
    });
  });

  it.each([
    ["UA002", "Otro cambio se guardó antes; recargá los accesos."],
    ["23514", "Tiene que quedar al menos un usuario con rol owner."],
    ["PGRST202", "Actualización pendiente; reintentá en unos minutos."],
  ])("maps the RPC's %s to its message", async (code, message) => {
    h.rpcError = { code, message: "x" };
    expect(await setUserAccessAction(input)).toEqual({
      ok: false,
      error: message,
    });
  });
});

describe("inviteUserAction", () => {
  it("assigns the requested roles through set_user_access and audits it", async () => {
    const res = await inviteUserAction({ email: "a@b.co", roles: ["finance"] });
    expect(res).toEqual({ ok: true, data: { userId: "invited" } });
    expect(h.rpcCalls).toHaveLength(1);
    const [fn, args] = h.rpcCalls[0] ?? [];
    expect(fn).toBe("set_user_access");
    expect(args).toMatchObject({
      p_actor: "actor",
      p_user_id: "invited",
      p_roles: ["finance"],
      p_removable_roles: [],
      p_expected_roles: [],
    });
    expect(args).not.toHaveProperty("p_denied");
    expect(args?.p_addable_roles).toContain("owner");
    expect(h.audits[0]?.[0]).toBe("user.invited");
  });

  it("refuses a role the actor cannot assign", async () => {
    h.access = h.resolveAccess(["admin"]);
    const res = await inviteUserAction({ email: "a@b.co", roles: ["owner"] });
    expect(res.ok).toBe(false);
    expect(h.rpcCalls).toEqual([]);
  });

  it.each([
    ["UA001", "No podés invitarte a vos mismo."],
    ["UA002", "Ya estaba invitado; editá sus accesos."],
    ["UA003", "No podés asignar alguno de esos roles."],
    ["XX000", "Usuario invitado pero no se asignaron roles."],
  ])(
    "maps the RPC's %s to its message, without auditing",
    async (code, error) => {
      h.rpcError = { code, message: "x" };
      const res = await inviteUserAction({
        email: "a@b.co",
        roles: ["finance"],
      });
      expect(res).toEqual({ ok: false, error });
      expect(h.audits).toEqual([]);
    },
  );
});
