import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Permission, resolveAccess } from "@/lib/auth/permissions";
import { recordingSupabase } from "@/tests/helpers/recording-supabase";

import { CHECK_CASH_DENIED_REASON } from "../lib/check-cash";

// Every cheques write that moves or deletes treasury money also needs
// transactions:write (docs/decisions/2026-11-04-cheques-que-mueven-plata-piden-movimientos.md).
// A finance user denied it is refused before any database call.

let denied: Permission[] = [];
let fake = recordingSupabase();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"], denied),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const {
  createCheckAction,
  creditCheckAction,
  depositCheckAction,
  rejectCheckAction,
  sellChecksAction,
} = await import("./checks-actions");
const { cancelCheckSaleAction, rejectSoldCheckAsDebtAction } =
  await import("./check-sale-followups-actions");

const CHECK = "00000000-0000-4000-8000-0000000000a1";
const ACCOUNT = "00000000-0000-4000-8000-0000000000b1";

const cases = [
  ["createCheckAction", () => createCheckAction({})],
  ["depositCheckAction", () => depositCheckAction({})],
  ["creditCheckAction", () => creditCheckAction({})],
  ["rejectCheckAction", () => rejectCheckAction({})],
  // @ts-expect-error -- the gate runs before the input is parsed.
  ["sellChecksAction", () => sellChecksAction({})],
  // @ts-expect-error -- the gate runs before the input is parsed.
  ["cancelCheckSaleAction", () => cancelCheckSaleAction({})],
] as const;

beforeEach(() => {
  denied = [];
  fake = recordingSupabase();
});

describe("cheques actions that move treasury", () => {
  it.each(cases)(
    "%s refuses a finance user denied transactions:write",
    async (_name, run) => {
      denied = ["transactions:write"];
      const res = await run();
      expect(res).toEqual({ ok: false, error: CHECK_CASH_DENIED_REASON });
      expect(fake.calls).toHaveLength(0);
    },
  );

  it.each(cases)("%s refuses a user denied cheques:write", async (_n, run) => {
    denied = ["cheques:write"];
    const res = await run();
    expect(res.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it("deposits for a user with cheques:write and transactions:write", async () => {
    fake = recordingSupabase((call) =>
      call.table === "deposit_check"
        ? { data: "mv-1", error: null }
        : { data: null, error: null },
    );
    const res = await depositCheckAction({
      check_id: CHECK,
      account_id: ACCOUNT,
      event_date: "2026-11-04",
      channel_id: "jouve_fiscal",
    });
    expect(res).toEqual({ ok: true, data: { movement_id: "mv-1" } });
    expect(fake.calls.map((c) => c.table)).toContain("deposit_check");
  });

  it("rejecting a sold check as a debt moves no money: cheques:write is enough", async () => {
    denied = ["transactions:write"];
    fake = recordingSupabase(() => ({ data: "debt-1", error: null }));
    const res = await rejectSoldCheckAsDebtAction({
      check_id: CHECK,
      event_date: "2026-11-04",
    });
    expect(res).toEqual({ ok: true, data: { debt_id: "debt-1" } });
  });
});
