import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAccess, userCan } from "@/lib/auth/permissions";

const getUser = vi.fn();
let roleRows: { role_id: string }[] = [];
let denyRows: { user_id: string; permission: string }[] = [];

function query(table: string) {
  const result =
    table === "user_roles"
      ? { data: roleRows, error: null }
      : table === "user_permission_denies"
        ? { data: denyRows, error: null }
        : { data: null, error: null };
  const b = {
    select: () => b,
    eq: () => b,
    in: () => b,
    maybeSingle: async () => result,
    then: <T>(resolve: (v: typeof result) => T) =>
      Promise.resolve(resolve(result)),
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, from: query }),
}));

const { getCurrentUserContext } = await import("./context");
const { runAsUser } = await import("./acting-user");

beforeEach(() => {
  getUser.mockReset();
  roleRows = [];
  denyRows = [];
});

describe("getCurrentUserContext", () => {
  it("resolves the session user from cookies outside a background job", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.c" } } });
    roleRows = [{ role_id: "finance" }];
    const ctx = await getCurrentUserContext();
    expect(ctx?.userId).toBe("u1");
    expect(ctx?.access.roles).toEqual(["finance"]);
  });

  it("resolves the acting user, with the roles their own client reads, without a session", async () => {
    roleRows = [{ role_id: "operations" }];
    const ctx = await runAsUser(
      { userId: "u2", email: "x@y.z", accessToken: "token" },
      () => getCurrentUserContext(),
    );
    expect(getUser).not.toHaveBeenCalled();
    expect(ctx).toMatchObject({
      userId: "u2",
      email: "x@y.z",
      access: resolveAccess(["operations"]),
    });
  });

  it("applies the user's own permission denies", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.c" } } });
    roleRows = [{ role_id: "finance" }];
    denyRows = [{ user_id: "u1", permission: "invoices:read" }];
    const ctx = await getCurrentUserContext();
    expect(ctx?.access).toEqual(resolveAccess(["finance"], ["invoices:read"]));
    expect(ctx && userCan(ctx.access, "invoices:read")).toBe(false);
    expect(ctx && userCan(ctx.access, "receipts:read")).toBe(true);
  });

  it("returns null without a session or an acting user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getCurrentUserContext()).toBeNull();
  });
});
