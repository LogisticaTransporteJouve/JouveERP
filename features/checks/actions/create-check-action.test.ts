import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import { recordingSupabase } from "@/tests/helpers/recording-supabase";

// «Nuevo cheque» loads a manual check en_cartera only: a receipt's check is
// written by its receipt, so the action never takes a receipt as the source
// (w6-s2 F1).

let fake = recordingSupabase();

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

const { createCheckAction } = await import("./checks-actions");

const UUID = "00000000-0000-4000-8000-0000000000a1";
const valid = {
  kind: "fisico",
  check_number: "123",
  bank_name: "Banco X",
  drawer_name: "Firmante",
  issue_date: "2026-11-04",
  due_date: "2026-12-04",
  amount: 100,
  currency: "ARS",
  cartera_account_id: UUID,
  channel_id: "jouve_internal",
};

function respondWithCartera(type: string) {
  return recordingSupabase((call) => {
    if (call.table === "checks" && call.op === "insert") {
      return { data: { id: "c1" }, error: null };
    }
    if (call.table === "accounts") return { data: { type }, error: null };
    return { data: null, error: null };
  });
}

beforeEach(() => {
  fake = respondWithCartera("checks");
});

describe("createCheckAction", () => {
  it("refuses a check whose source is a receipt", async () => {
    const res = await createCheckAction({ ...valid, source_kind: "receipt" });
    expect(res.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it("writes a manual check with no receipt even if one is sent", async () => {
    const res = await createCheckAction({
      ...valid,
      source_receipt_id: UUID,
      source_payment_line_id: UUID,
    });
    expect(res).toEqual({ ok: true, data: { id: "c1" } });
    const insert = fake.calls.find(
      (c) => c.table === "checks" && c.op === "insert",
    );
    expect(insert?.payload).toMatchObject({ source_kind: "manual" });
    expect(insert?.payload).not.toHaveProperty("source_receipt_id");
    expect(insert?.payload).not.toHaveProperty("source_payment_line_id");
    expect(insert?.payload).not.toHaveProperty("status");
  });

  it.each(["bank", "cash"])(
    "refuses a %s account as the cartera, inserting nothing",
    async (type) => {
      fake = respondWithCartera(type);
      const res = await createCheckAction(valid);
      expect(res).toEqual({
        ok: false,
        error: "La cuenta de cartera no es válida.",
      });
      expect(fake.calls.some((c) => c.op === "insert")).toBe(false);
    },
  );

  it("loads an echeq cartera", async () => {
    fake = respondWithCartera("echeq");
    const res = await createCheckAction(valid);
    expect(res).toEqual({ ok: true, data: { id: "c1" } });
  });
});
