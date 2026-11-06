import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordingSupabase,
  type FakeResponse,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const logAudit = vi.fn();
let accountAnswer: FakeResponse = { data: { type: "cash" }, error: null };

function respond(call: RecordedCall): FakeResponse {
  if (call.table === "accounts") return accountAnswer;
  if (call.table === "transactions" && call.op === "insert") {
    return { data: { id: "t1" }, error: null };
  }
  if (call.op === "rpc") {
    return {
      data: [{ transfer_out_id: "out1", transfer_in_id: "in1" }],
      error: null,
    };
  }
  return { data: null, error: null };
}

let fake = recordingSupabase(respond);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

const { createTransaction } = await import("./create-transaction");
const { createTransfer } = await import("./create-transfer");

const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

const movement = {
  account_id: ACCOUNT,
  channel_id: "jouve_fiscal",
  kind: "expense" as const,
  amount: 100,
  currency: "ARS" as const,
  transaction_date: "2026-11-03",
  accrual_month: "2026-11-01",
  description: "Insumos",
};

beforeEach(() => {
  vi.clearAllMocks();
  fake = recordingSupabase(respond);
  accountAnswer = { data: { type: "cash" }, error: null };
});

describe("createTransaction", () => {
  it("inserts the movement as the actor and audits it", async () => {
    const res = await createTransaction("u1", movement);
    expect(res).toEqual({ ok: true, data: { id: "t1" } });
    const insert = fake.calls.find(
      (c) => c.table === "transactions" && c.op === "insert",
    );
    expect(insert?.payload).toMatchObject({ created_by: "u1", amount: 100 });
    expect(logAudit).toHaveBeenCalledWith(
      "transaction.created",
      "u1",
      expect.objectContaining({ kind: "expense", amount: 100 }),
      "t1",
    );
  });

  it("refuses a check account without writing", async () => {
    accountAnswer = { data: { type: "echeq" }, error: null };
    const res = await createTransaction("u1", movement);
    expect(res.ok).toBe(false);
    expect(
      fake.calls.some((c) => c.table === "transactions" && c.op === "insert"),
    ).toBe(false);
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("createTransfer", () => {
  it("writes both legs in one RPC and audits the outgoing one", async () => {
    const res = await createTransfer("u1", {
      account_from_id: ACCOUNT,
      account_to_id: OTHER,
      channel_id: "jouve_fiscal",
      amount: 50,
      currency: "ARS",
      transaction_date: "2026-11-03",
      accrual_month: "2026-11-01",
      description: null,
    });
    expect(res).toEqual({
      ok: true,
      data: { transfer_out_id: "out1", transfer_in_id: "in1" },
    });
    expect(logAudit).toHaveBeenCalledWith(
      "transaction.transfer_created",
      "u1",
      expect.objectContaining({ from: ACCOUNT, to: OTHER, amount: 50 }),
      "out1",
    );
  });
});
