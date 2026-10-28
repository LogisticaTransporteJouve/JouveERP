import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAccess } from "@/lib/auth/permissions";

type RpcResult = { data: unknown; error: { message: string } | null };

const rpc = vi.fn<
  (fn: string, args: Record<string, unknown>) => Promise<RpcResult>
>(async () => ({ data: true, error: null }));

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ rpc }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u-driver",
    access: resolveAccess(["driver"]),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { bootstrapOwnerIfNeeded } = await import("./bootstrap-owner");

beforeEach(() => {
  rpc.mockClear();
});

describe("bootstrapOwnerIfNeeded", () => {
  it("is not reachable as a server action endpoint", async () => {
    // Every export of a "use server" module is a POST endpoint any signed-in
    // user can call; the bootstrap must not be one of them.
    const actions = await import("../actions/users-actions");
    expect(Object.keys(actions)).not.toContain("bootstrapOwnerIfNeeded");
  });

  it("delegates the check-and-insert to the atomic RPC for the session user", async () => {
    const promoted = await bootstrapOwnerIfNeeded({
      userId: "u-first",
      access: resolveAccess([]),
    });
    expect(promoted).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("bootstrap_first_owner", {
      p_user_id: "u-first",
    });
  });

  it("reports no promotion when the RPC declines (owner exists / not first user)", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(
      await bootstrapOwnerIfNeeded({
        userId: "u-late",
        access: resolveAccess(["driver"]),
      }),
    ).toBe(false);
  });

  it("skips the RPC for an existing owner", async () => {
    expect(
      await bootstrapOwnerIfNeeded({
        userId: "u-owner",
        access: resolveAccess(["owner"]),
      }),
    ).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the RPC errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(
      await bootstrapOwnerIfNeeded({
        userId: "u-first",
        access: resolveAccess([]),
      }),
    ).toBe(false);
  });
});
