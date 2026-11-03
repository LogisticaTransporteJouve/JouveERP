import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type FakeResponse,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

// The guard against manual movements on a check account fails closed: when
// the account cannot be read, nothing is inserted.

let accountAnswer: FakeResponse = { data: { type: "bank" }, error: null };

function respond(call: RecordedCall): FakeResponse {
  if (call.table === "accounts") return accountAnswer;
  if (call.table === "transactions" && call.op === "insert") {
    return { data: { id: "t1" }, error: null };
  }
  return { data: null, error: null };
}

let fake = recordingSupabase(respond);

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { createTransactionAction } = await import("./transactions-actions");

const input = {
  account_id: "00000000-0000-4000-8000-000000000001",
  channel_id: "jouve_fiscal",
  kind: "expense",
  amount: 100,
  currency: "ARS",
  transaction_date: "2026-11-03",
  accrual_month: "2026-11-01",
  description: "Gasto",
};

const inserted = () =>
  fake.calls.filter((c) => c.table === "transactions" && c.op === "insert");

beforeEach(() => {
  fake = recordingSupabase(respond);
  accountAnswer = { data: { type: "bank" }, error: null };
});

describe("createTransactionAction", () => {
  it("refuses when the account cannot be read", async () => {
    accountAnswer = { data: null, error: { message: "timeout" } };
    const res = await createTransactionAction(input);
    expect(res).toEqual({ ok: false, error: "No se pudo leer la cuenta." });
    expect(inserted()).toHaveLength(0);
  });

  it("refuses a check account", async () => {
    accountAnswer = { data: { type: "checks" }, error: null };
    const res = await createTransactionAction(input);
    expect(res.ok).toBe(false);
    expect(inserted()).toHaveLength(0);
  });

  it("inserts on a bank account", async () => {
    await createTransactionAction(input);
    expect(inserted()).toHaveLength(1);
  });
});
