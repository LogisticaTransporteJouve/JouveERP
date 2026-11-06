import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

// A double click or retry of the same fuel import used to pass the "already
// loaded?" read twice and insert the statement twice. The database now skips
// rows whose import_key exists (ON CONFLICT DO NOTHING).

const VEHICLE_ID = "00000000-0000-4000-8000-0000000000f1";
const IMPORT_KEY = "9b2f3c1e-0d4a-4f5b-8c6d-7e8f9a0b1c2d";

/** fuel_loads rows in the fake database, keyed by import_key. */
let stored: { import_key: string }[] = [];
const logAudit = vi.fn();

function respond(call: RecordedCall) {
  if (call.table === "vehicles") {
    return { data: [{ id: VEHICLE_ID }], error: null };
  }
  if (call.table === "fuel_loads" && call.op === "select") {
    // A stale read, as when two requests read before either inserts.
    return { data: [], error: null };
  }
  if (call.table === "fuel_loads" && call.op === "upsert") {
    const rows = Array.isArray(call.payload) ? call.payload : [];
    const added = rows.filter(
      (r: { import_key: string }) =>
        !stored.some((s) => s.import_key === r.import_key),
    );
    stored.push(...added);
    return {
      data: added.map((_r: unknown, i: number) => ({ id: `id-${i}` })),
      error: null,
    };
  }
  return { data: null, error: null };
}

let fake = recordingSupabase(respond);

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["owner"]),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));

const { confirmFuelImportAction } = await import("./fuel-import-actions");

const row = {
  vehicle_id: VEHICLE_ID,
  load_date: "2026-10-01",
  liters: 250.5,
  amount: 450900,
  odometer_km: null,
  station: "YPF",
  card: null,
  product: "Diesel",
  allow_duplicate: false,
};

beforeEach(() => {
  stored = [];
  fake = recordingSupabase(respond);
  logAudit.mockReset();
});

describe("confirmFuelImportAction", () => {
  it("adds the same import once when it is sent twice", async () => {
    const input = {
      provider: "ypf_en_ruta",
      import_key: IMPORT_KEY,
      rows: [row, { ...row, allow_duplicate: true }],
    };
    expect(await confirmFuelImportAction(input)).toEqual({
      ok: true,
      data: { inserted: 2, skipped: 0 },
    });
    expect(await confirmFuelImportAction(input)).toEqual({
      ok: true,
      data: { inserted: 0, skipped: 2 },
    });
    expect(stored).toHaveLength(2);
    // Only the import that added rows is audited.
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it("upserts on import_key, ignoring rows already there", async () => {
    await confirmFuelImportAction({
      provider: "axion_card",
      import_key: IMPORT_KEY,
      rows: [row],
    });
    const upsert = fake.calls.find((c) => c.op === "upsert");
    expect(upsert?.options).toEqual({
      onConflict: "import_key",
      ignoreDuplicates: true,
    });
    expect(upsert?.payload).toEqual([
      expect.objectContaining({
        import_key: `${IMPORT_KEY}:${VEHICLE_ID}|2026-10-01|450900.00|250.50#1`,
      }),
    ]);
  });

  it("a new import of the same statement keeps the rows the user kept on purpose", async () => {
    await confirmFuelImportAction({
      provider: "axion_card",
      import_key: IMPORT_KEY,
      rows: [row],
    });
    const again = await confirmFuelImportAction({
      provider: "axion_card",
      import_key: "1b2f3c1e-0d4a-4f5b-8c6d-7e8f9a0b1c2e",
      rows: [{ ...row, allow_duplicate: true }],
    });
    expect(again).toEqual({ ok: true, data: { inserted: 1, skipped: 0 } });
  });
});
