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
let increaseAnswer: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};
let fake = recordingSupabase(respond);

function respond(call: RecordedCall) {
  if (call.op === "rpc" && call.table === "increase_storage_tariffs") {
    return increaseAnswer;
  }
  if (call.table !== "storage_tariffs") return { data: null, error: null };
  if (call.op === "update") return updateAnswer;
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
const logAudit = vi.fn();
vi.mock("@/lib/actions/audit", () => ({ logAudit }));

const { increaseStorageTariffsAction, updateStorageTariffAction } =
  await import("./storage-tariffs-actions");

beforeEach(() => {
  vi.clearAllMocks();
  updateAnswer = { data: [{ id: TARIFF_ID }], error: null };
  increaseAnswer = { data: null, error: null };
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

  it("refuses an edit of a tariff that is not there, without auditing", async () => {
    updateAnswer = { data: [], error: null };
    const res = await updateStorageTariffAction({
      id: TARIFF_ID,
      rate_per_pallet: 5000,
    });
    expect(res).toEqual({ ok: false, error: "No se encontró la tarifa." });
    expect(logAudit).not.toHaveBeenCalled();
  });
});

// Which tariffs are raised, the new rows and the close of the old ones run in
// increase_storage_tariffs (supabase/tests/increase_storage_tariffs_test.sql).
describe("increaseStorageTariffsAction", () => {
  it("raises and closes in one call and reports its counts", async () => {
    increaseAnswer = { data: [{ updated: 1, skipped: 1 }], error: null };
    const res = await increaseStorageTariffsAction({
      percent: 10,
      valid_from: "2026-11-01",
    });
    expect(res).toEqual({ ok: true, data: { updated: 1, skipped: 1 } });
    expect(fake.calls).toEqual([
      expect.objectContaining({
        op: "rpc",
        table: "increase_storage_tariffs",
        payload: { p_percent: 10, p_valid_from: "2026-11-01" },
      }),
    ]);
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it("shows the guard's message when nothing is in force before the date", async () => {
    const message =
      "No hay tarifas vigentes anteriores a esa fecha para aumentar.";
    increaseAnswer = {
      data: null,
      error: { message, hint: "jouve_guard", code: "P0002" },
    };
    const res = await increaseStorageTariffsAction({
      percent: 10,
      valid_from: "2026-11-01",
    });
    expect(res).toEqual({ ok: false, error: message });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("reports a failed increase instead of ok, and audits nothing", async () => {
    increaseAnswer = { data: null, error: { message: "boom", code: "XX000" } };
    const res = await increaseStorageTariffsAction({
      percent: 10,
      valid_from: "2026-11-01",
    });
    expect(res).toEqual({ ok: false, error: "No se pudo aplicar el aumento." });
    expect(logAudit).not.toHaveBeenCalled();
  });
});
