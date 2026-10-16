import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Role } from "@/lib/auth/permissions";

let roles: Role[] = [];
const createClient = vi.fn(async () => ({ marker: "rls-client" }));

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", roles }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

const { gatedRead } = await import("./gated-read");

const schema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

type Rows = {
  data: { n: number }[] | null;
  error: { message: string } | null;
};

function run(
  input: unknown,
  query = vi.fn(async (): Promise<Rows> => ({ data: [{ n: 1 }], error: null })),
) {
  return {
    query,
    result: gatedRead({
      permissions: ["hr:read", "accounting:read"],
      denied: "denied",
      failure: "failed",
      schema,
      input,
      event: "test.failed",
      query,
    }),
  };
}

beforeEach(() => {
  roles = [];
  createClient.mockClear();
});

describe("gatedRead", () => {
  it("requires every listed permission before touching the database", async () => {
    roles = ["operations"];
    const { query, result } = run({ from: "2026-01-01" });
    expect(await result).toEqual({ ok: false, error: "denied" });
    expect(createClient).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects invalid input without querying", async () => {
    roles = ["finance"];
    const { query, result } = run({ from: "01/01/2026" });
    expect((await result).ok).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it("queries with the RLS user client and the parsed input", async () => {
    roles = ["finance"];
    const { query, result } = run({ from: "2026-01-01" });
    expect(await result).toEqual({ ok: true, data: [{ n: 1 }] });
    expect(query).toHaveBeenCalledWith(
      { marker: "rls-client" },
      { from: "2026-01-01" },
    );
  });

  it("maps a database error to the failure message", async () => {
    roles = ["admin"];
    const { result } = run(
      { from: "2026-01-01" },
      vi.fn(async (): Promise<Rows> => ({
        data: null,
        error: { message: "boom" },
      })),
    );
    expect(await result).toEqual({ ok: false, error: "failed" });
  });
});
