import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterValue,
  recordingSupabase,
} from "@/tests/helpers/recording-supabase";
import { resolveAccess } from "@/lib/auth/permissions";

const getUserById = vi.fn();
let roleRows: { role_id: string }[] = [];
const fake = recordingSupabase(() => ({ data: roleRows, error: null }));

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    ...fake.client,
    auth: { admin: { getUserById } },
  }),
}));

let probe: { error: unknown; status: number } = { error: null, status: 200 };
const probeCalls: string[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      probeCalls.push(table);
      const b = {
        select: () => b,
        eq: () => b,
        then: <T>(resolve: (v: typeof probe) => T) =>
          Promise.resolve(resolve(probe)),
      };
      return b;
    },
  }),
}));

const {
  HeadlessTokenRejectedError,
  headlessEligibility,
  isTokenRejection,
  resolveHeadlessUser,
  runAsHeadlessUser,
} = await import("./headless-user");
const { getActingUser } = await import("./acting-user");

const NOW = new Date("2026-10-19T11:00:00Z");
const active = { email: "a@b.c", bannedUntil: null, deletedAt: null };

function decide(overrides: Partial<Parameters<typeof headlessEligibility>[0]>) {
  return headlessEligibility({
    userId: "u1",
    authUser: active,
    roles: ["finance"],
    denied: [],
    permission: "ai:chat",
    hasSecret: true,
    now: NOW,
    ...overrides,
  });
}

describe("headlessEligibility", () => {
  it("acts as an active user who holds the permission, with their roles", () => {
    expect(decide({ roles: ["finance", "not-a-role"] })).toEqual({
      ok: true,
      user: {
        userId: "u1",
        email: "a@b.c",
        access: resolveAccess(["finance"]),
      },
    });
  });

  it("skips a user who lost the permission", () => {
    expect(decide({ roles: ["warehouse"] })).toEqual({
      ok: false,
      reason: "permission_revoked",
    });
    expect(decide({ roles: [] })).toEqual({
      ok: false,
      reason: "permission_revoked",
    });
  });

  it("skips a user denied the permission, and carries other denies", () => {
    expect(decide({ denied: ["ai:chat"] })).toEqual({
      ok: false,
      reason: "permission_revoked",
    });
    expect(decide({ denied: ["invoices:read"] })).toEqual({
      ok: true,
      user: {
        userId: "u1",
        email: "a@b.c",
        access: resolveAccess(["finance"], ["invoices:read"]),
      },
    });
  });

  it("skips a missing, deleted, email-less or currently banned user", () => {
    for (const authUser of [
      null,
      { ...active, deletedAt: "2026-10-01T00:00:00Z" },
      { ...active, email: null },
      { ...active, bannedUntil: "2026-10-20T00:00:00Z" },
    ]) {
      expect(decide({ authUser })).toEqual({
        ok: false,
        reason: "user_disabled",
      });
    }
  });

  it("acts again once a ban has expired", () => {
    expect(
      decide({ authUser: { ...active, bannedUntil: "2026-10-18T00:00:00Z" } })
        .ok,
    ).toBe(true);
  });

  it("fails closed without the JWT secret", () => {
    expect(decide({ hasSecret: false })).toEqual({
      ok: false,
      reason: "headless_unavailable",
    });
  });
});

describe("resolveHeadlessUser", () => {
  beforeEach(() => {
    fake.calls.length = 0;
    getUserById.mockReset();
    vi.stubEnv("SUPABASE_JWT_SECRET", "s".repeat(40));
  });

  it("reads the account and that user's roles at run time", async () => {
    roleRows = [{ role_id: "admin" }];
    getUserById.mockResolvedValue({
      data: { user: { id: "u1", email: "a@b.c" } },
      error: null,
    });
    const res = await resolveHeadlessUser("u1", "ai:chat", NOW);
    expect(res).toEqual({
      ok: true,
      user: { userId: "u1", email: "a@b.c", access: resolveAccess(["admin"]) },
    });
    expect(getUserById).toHaveBeenCalledWith("u1");
    const roles = fake.calls.find((c) => c.table === "user_roles");
    expect(roles && filterValue(roles, "eq", "user_id")).toBe("u1");
  });

  it("treats a definitive not-found as a disabled user", async () => {
    roleRows = [{ role_id: "owner" }];
    getUserById.mockResolvedValue({
      data: { user: null },
      error: { status: 404, code: "user_not_found", message: "User not found" },
    });
    expect(await resolveHeadlessUser("u1", "ai:chat", NOW)).toEqual({
      ok: false,
      reason: "user_disabled",
    });
  });

  it("throws on a transient Auth error so the job retries", async () => {
    roleRows = [{ role_id: "owner" }];
    for (const error of [
      { status: 503, message: "upstream" },
      { status: 0, message: "fetch failed" },
    ]) {
      getUserById.mockResolvedValueOnce({ data: { user: null }, error });
      await expect(resolveHeadlessUser("u1", "ai:chat", NOW)).rejects.toBe(
        error,
      );
    }
  });
});

describe("isTokenRejection", () => {
  it("recognizes PostgREST refusing the token", () => {
    expect(isTokenRejection(401, null)).toBe(true);
    expect(isTokenRejection(400, { code: "PGRST301", message: "x" })).toBe(
      true,
    );
    expect(
      isTokenRejection(500, { message: "JWSError JWSInvalidSignature" }),
    ).toBe(true);
    expect(isTokenRejection(500, { code: "57014", message: "timeout" })).toBe(
      false,
    );
    expect(isTokenRejection(200, null)).toBe(false);
  });
});

describe("runAsHeadlessUser", () => {
  beforeEach(() => {
    probe = { error: null, status: 200 };
    probeCalls.length = 0;
  });

  it("refuses before running anything when the minted token is rejected", async () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "s".repeat(40));
    probe = {
      error: { code: "PGRST301", message: "JWT invalid" },
      status: 401,
    };
    const fn = vi.fn(async () => 1);
    await expect(
      runAsHeadlessUser(
        { userId: "u1", email: "a@b.c", access: resolveAccess([]) },
        fn,
      ),
    ).rejects.toBeInstanceOf(HeadlessTokenRejectedError);
    expect(fn).not.toHaveBeenCalled();
    expect(probeCalls).toEqual(["user_roles"]);
  });

  it("runs the callback as the user with a minted token", async () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "s".repeat(40));
    const acting = await runAsHeadlessUser(
      { userId: "u1", email: "a@b.c", access: resolveAccess(["finance"]) },
      async () => getActingUser(),
    );
    expect(acting?.userId).toBe("u1");
    expect(acting?.accessToken.split(".")).toHaveLength(3);
  });

  it("refuses without the secret", () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "");
    expect(() =>
      runAsHeadlessUser(
        { userId: "u1", email: "a@b.c", access: resolveAccess([]) },
        async () => 1,
      ),
    ).toThrow(/SUPABASE_JWT_SECRET/);
  });
});
