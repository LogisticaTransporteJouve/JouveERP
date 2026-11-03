import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const CHECK = "00000000-0000-4000-8000-0000000000a1";
const ACCOUNT = "00000000-0000-4000-8000-0000000000b1";
const KEY = "00000000-0000-4000-8000-0000000000d1";

let roles: Role[] = ["finance"];
let rpcError: unknown = null;
let fake = recordingSupabase(respond);

function respond(call: RecordedCall) {
  if (call.table === "sell_checks") {
    return rpcError
      ? { data: null, error: rpcError }
      : { data: "sale1", error: null };
  }
  return { data: null, error: null };
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, []),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { sellChecksAction } = await import("./checks-actions");

const input = {
  check_ids: [CHECK],
  account_id: ACCOUNT,
  channel_id: "jouve_fiscal",
  sale_date: "2026-11-03",
  buyer_name: "Banco Y",
  buyer_cuit: "",
  interest: "1200",
  commission: "300",
  notes: "",
  idempotency_key: KEY,
};

beforeEach(() => {
  roles = ["finance"];
  rpcError = null;
  fake = recordingSupabase(respond);
});

describe("sellChecksAction", () => {
  it("sells through sell_checks with the dialog's key and the user", async () => {
    const res = await sellChecksAction(input);
    expect(res).toEqual({ ok: true, data: { sale_id: "sale1" } });
    const call = fake.calls.find((c) => c.table === "sell_checks");
    expect(call?.payload).toEqual({
      p_check_ids: [CHECK],
      p_account_id: ACCOUNT,
      p_sale_date: "2026-11-03",
      p_channel_id: "jouve_fiscal",
      p_buyer_name: "Banco Y",
      p_buyer_cuit: "",
      p_interest: 1200,
      p_commission: 300,
      p_notes: "",
      p_idempotency_key: KEY,
      p_user_id: "u1",
    });
  });

  it("needs cheques:write", async () => {
    roles = ["operations"];
    const res = await sellChecksAction(input);
    expect(res.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it("shows the guard's message", async () => {
    rpcError = {
      message: "El cheque 123 ya no está en cartera (depositado).",
      code: "55006",
      hint: "jouve_guard",
    };
    const res = await sellChecksAction(input);
    expect(res).toEqual({
      ok: false,
      error: "El cheque 123 ya no está en cartera (depositado).",
    });
  });
});
