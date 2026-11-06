import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordingSupabase,
  type FakeResponse,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const logAudit = vi.fn();
let rpcAnswer: FakeResponse = { data: "m1", error: null };

function respond(call: RecordedCall): FakeResponse {
  if (call.op === "rpc") return rpcAnswer;
  if (call.table === "issued_checks" && call.op === "insert") {
    return { data: { id: "ic1" }, error: null };
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

const { depositCheck } = await import("./deposit-check");
const { createIssuedCheck } = await import("./create-issued-check");

const CHECK = "00000000-0000-4000-8000-000000000001";
const BANK = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
  fake = recordingSupabase(respond);
  rpcAnswer = { data: "m1", error: null };
});

describe("depositCheck", () => {
  const input = {
    check_id: CHECK,
    account_id: BANK,
    channel_id: "jouve_fiscal",
    event_date: "2026-11-06",
    description: null,
  };

  it("deposits in one RPC and audits it on the check", async () => {
    const res = await depositCheck("u1", input);
    expect(res).toEqual({ ok: true, data: { movement_id: "m1" } });
    expect(logAudit).toHaveBeenCalledWith(
      "check.deposited",
      "u1",
      { destination_account_id: BANK },
      CHECK,
    );
  });

  it("a refused deposit audits nothing", async () => {
    rpcAnswer = { data: null, error: { code: "XX000", message: "boom" } };
    const res = await depositCheck("u1", input);
    expect(res).toEqual({
      ok: false,
      error: "No se pudo depositar el cheque.",
    });
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("createIssuedCheck", () => {
  const input = {
    kind: "fisico" as const,
    check_number: "777",
    bank_name: "Banco Galicia",
    beneficiary_name: null,
    issue_date: "2026-11-06",
    due_date: "2026-12-01",
    amount: 100,
    currency: "ARS" as const,
    bank_account_id: BANK,
    channel_id: "jouve_fiscal",
    notes: null,
  };

  it("inserts the check as the actor", async () => {
    const res = await createIssuedCheck("u1", input);
    expect(res).toEqual({ ok: true, data: { id: "ic1" } });
    const insert = fake.calls.find((c) => c.table === "issued_checks");
    expect(insert?.payload).toMatchObject({ created_by: "u1", amount: 100 });
  });

  it("refuses a link to a payment order", async () => {
    const res = await createIssuedCheck("u1", {
      ...input,
      payment_order_id: CHECK,
    });
    expect(res.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});
