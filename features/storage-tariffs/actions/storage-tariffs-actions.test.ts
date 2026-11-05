import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const TARIFF_ID = "00000000-0000-4000-8000-0000000000f1";
const MIGRATED_MESSAGE =
  "Esta tarifa pasó al tarifario del cliente: cambiala en el detalle del cliente › Tarifario.";

let updateAnswer: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};
let current: unknown[] = [];
let fake = recordingSupabase(respond);

function respond(call: RecordedCall) {
  if (call.table !== "storage_tariffs") return { data: null, error: null };
  if (call.op === "update") return updateAnswer;
  if (call.op === "select") return { data: current, error: null };
  if (call.op === "insert") {
    return { data: [{ id: "new1" }], error: null };
  }
  return { data: null, error: null };
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["owner"], []),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { increaseStorageTariffsAction, updateStorageTariffAction } =
  await import("./storage-tariffs-actions");

beforeEach(() => {
  updateAnswer = { data: null, error: null };
  current = [];
  fake = recordingSupabase(respond);
});

describe("updateStorageTariffAction", () => {
  it("shows the guard's message for a tariff moved to the tarifario", async () => {
    updateAnswer = {
      data: null,
      error: { message: MIGRATED_MESSAGE, hint: "jouve_guard", code: "55006" },
    };
    const res = await updateStorageTariffAction({
      id: TARIFF_ID,
      rate_per_pallet: 5000,
    });
    expect(res).toEqual({ ok: false, error: MIGRATED_MESSAGE });
  });

  it("keeps the generic message for any other failure", async () => {
    updateAnswer = { data: null, error: { message: "boom", code: "XX000" } };
    const res = await updateStorageTariffAction({
      id: TARIFF_ID,
      rate_per_pallet: 5000,
    });
    expect(res).toEqual({
      ok: false,
      error: "No se pudo actualizar la tarifa.",
    });
  });
});

describe("increaseStorageTariffsAction", () => {
  it("raises only what started before the date and counts the rest as skipped", async () => {
    const row = {
      client_id: null,
      area_id: null,
      rate_per_pallet: 1000,
      handling_in: 0,
      handling_out: 0,
      period: "monthly",
      valid_to: null,
      is_active: true,
      migrated_to_client_tariffs_at: null,
    };
    current = [
      { ...row, id: "old", valid_from: "2026-01-01" },
      { ...row, id: "future", valid_from: "2026-12-01" },
    ];
    const res = await increaseStorageTariffsAction({
      percent: 10,
      valid_from: "2026-11-01",
    });
    expect(res).toEqual({ ok: true, data: { updated: 1, skipped: 1 } });
    const insert = fake.calls.find((c) => c.op === "insert");
    expect(insert?.payload).toEqual([
      expect.objectContaining({ rate_per_pallet: 1100 }),
    ]);
  });
});
