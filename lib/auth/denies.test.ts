import { beforeEach, describe, expect, it, vi } from "vitest";

const obs = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessageOnce: vi.fn(),
}));
vi.mock("@/lib/observability", () => obs);

const { loadDenies } = await import("./denies");

type Result = {
  data: { user_id: string; permission: string }[] | null;
  error: { code: string; message: string } | null;
};

function client(result: Result) {
  const calls: Array<[string, readonly string[]]> = [];
  const b = {
    select: () => b,
    in: (column: string, values: readonly string[]) => {
      calls.push([column, values]);
      return b;
    },
    then: <T>(resolve: (v: Result) => T) => Promise.resolve(resolve(result)),
  };
  // Only the builder surface loadDenies touches.
  const fake = { from: () => b };
  return { fake, calls };
}

beforeEach(() => {
  obs.captureException.mockReset();
  obs.captureMessageOnce.mockReset();
});

describe("loadDenies", () => {
  it("groups the denied permissions by user", async () => {
    const { fake } = client({
      data: [
        { user_id: "u1", permission: "invoices:read" },
        { user_id: "u1", permission: "receipts:write" },
        { user_id: "u2", permission: "hr:read" },
      ],
      error: null,
    });
    // @ts-expect-error -- partial Supabase client
    const denies = await loadDenies(fake, ["u1", "u2"]);
    expect(denies.get("u1")).toEqual(["invoices:read", "receipts:write"]);
    expect(denies.get("u2")).toEqual(["hr:read"]);
  });

  it("narrows the read to the given permissions", async () => {
    const { fake, calls } = client({ data: [], error: null });
    // @ts-expect-error -- partial Supabase client
    await loadDenies(fake, ["u1"], ["hr:read"]);
    expect(calls).toEqual([
      ["user_id", ["u1"]],
      ["permission", ["hr:read"]],
    ]);
  });

  it("reads nothing for no users", async () => {
    const { fake, calls } = client({ data: [], error: null });
    // @ts-expect-error -- partial Supabase client
    expect((await loadDenies(fake, [])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it.each(["42P01", "PGRST205"])(
    "reads a missing table (%s) as no denies",
    async (code) => {
      const { fake } = client({ data: null, error: { code, message: "x" } });
      // @ts-expect-error -- partial Supabase client
      expect((await loadDenies(fake, ["u1"])).size).toBe(0);
      expect(obs.captureMessageOnce).toHaveBeenCalledWith(
        "auth.denies.table_missing",
        "warn",
        { code },
      );
    },
  );

  it("fails closed on any other error", async () => {
    const error = { code: "57014", message: "timeout" };
    const { fake } = client({ data: null, error });
    // @ts-expect-error -- partial Supabase client
    await expect(loadDenies(fake, ["u1"])).rejects.toBe(error);
    expect(obs.captureException).toHaveBeenCalledWith(error, {
      op: "auth.denies.load_failed",
      count: 1,
    });
  });
});
