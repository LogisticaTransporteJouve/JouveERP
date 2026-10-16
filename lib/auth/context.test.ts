import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
let roleRows: { role_id: string }[] = [];

function query(table: string) {
  const result =
    table === "user_roles"
      ? { data: roleRows, error: null }
      : { data: null, error: null };
  const b = {
    select: () => b,
    eq: () => b,
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
});

describe("getCurrentUserContext", () => {
  it("resolves the session user from cookies outside a background job", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.c" } } });
    roleRows = [{ role_id: "finance" }];
    const ctx = await getCurrentUserContext();
    expect(ctx?.userId).toBe("u1");
    expect(ctx?.roles).toEqual(["finance"]);
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
      roles: ["operations"],
    });
  });

  it("returns null without a session or an acting user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getCurrentUserContext()).toBeNull();
  });
});
