import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Permission, resolveAccess } from "@/lib/auth/permissions";
import { recordingSupabase } from "@/tests/helpers/recording-supabase";

import { CHECK_CASH_DENIED_REASON } from "@/features/checks/lib/check-cash";

// Cashing an own check (its bank outflow) and bouncing one (the inflow back)
// also need transactions:write; annulling books no movement
// (docs/decisions/2026-11-04-cheques-propios-e-importacion-de-cheques-piden-movimientos.md).

let denied: Permission[] = [];
let fake = recordingSupabase();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"], denied),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { transitionIssuedCheckAction } = await import("./issued-checks-actions");

const ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  denied = [];
  fake = recordingSupabase(() => ({ data: [{ id: ID }], error: null }));
});

describe("transitionIssuedCheckAction", () => {
  it.each(["cashed", "rejected"] as const)(
    "refuses %s to a finance user denied transactions:write",
    async (to_status) => {
      denied = ["transactions:write"];
      const res = await transitionIssuedCheckAction({ id: ID, to_status });
      expect(res).toEqual({ ok: false, error: CHECK_CASH_DENIED_REASON });
      expect(fake.calls).toHaveLength(0);
    },
  );

  it("still annuls for that user: annulling moves no money", async () => {
    denied = ["transactions:write"];
    const res = await transitionIssuedCheckAction({
      id: ID,
      to_status: "cancelled",
    });
    expect(res.ok).toBe(true);
    expect(fake.calls.map((c) => [c.table, c.op])).toEqual([
      ["issued_checks", "update"],
    ]);
  });

  it("cashes with issued_checks:write and transactions:write", async () => {
    const res = await transitionIssuedCheckAction({
      id: ID,
      to_status: "cashed",
    });
    expect(res.ok).toBe(true);
    expect(fake.calls[0]?.payload).toMatchObject({ status: "cashed" });
  });
});
