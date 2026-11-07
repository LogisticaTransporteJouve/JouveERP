import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Permission, resolveAccess } from "@/lib/auth/permissions";
import { recordingSupabase } from "@/tests/helpers/recording-supabase";

// Card statements and the bank-line writes (transfer, cheque deposit, card
// payment) need the treasury write: a finance user denied
// transactions:write is refused before any database call.

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

const cards = await import("./card-statements-actions");
const bank =
  await import("@/features/bank-reconciliation/actions/reconciliation-actions");

const cases = [
  ["createCardStatementAction", () => cards.createCardStatementAction({})],
  ["setCardLinesAction", () => cards.setCardLinesAction({})],
  ["setCardHolderAction", () => cards.setCardHolderAction({})],
  ["deleteCardStatementAction", () => cards.deleteCardStatementAction({})],
  ["unsettleCardStatementAction", () => cards.unsettleCardStatementAction({})],
  ["transferFromLineAction", () => bank.transferFromLineAction({})],
  ["depositCheckFromLineAction", () => bank.depositCheckFromLineAction({})],
  [
    "payCardStatementFromLineAction",
    () => bank.payCardStatementFromLineAction({}),
  ],
] as const;

beforeEach(() => {
  denied = [];
  fake = recordingSupabase();
});

describe("treasury writes", () => {
  it.each(cases)(
    "%s refuses a finance user denied transactions:write",
    async (_name, run) => {
      denied = ["transactions:write"];
      const res = await run();
      expect(res.ok).toBe(false);
      expect(fake.calls).toHaveLength(0);
    },
  );

  it.each(cases)(
    "%s lets a finance user through to its input check",
    async (_name, run) => {
      const res = await run();
      expect(res).toMatchObject({ ok: false });
      expect(res.ok === false && res.error).not.toMatch(/permiso/i);
    },
  );

  it("refuses a cheque deposit from a line without cheques:write", async () => {
    denied = ["cheques:write"];
    const res = await bank.depositCheckFromLineAction({});
    expect(res.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});
