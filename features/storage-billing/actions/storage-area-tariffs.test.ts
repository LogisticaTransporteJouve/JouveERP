import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

// A general storage tariff limited to one area (storage_tariffs.area_id)
// prices only that area's pallets, in the preview and when invoicing alike.

const CLIENT_ID = "00000000-0000-4000-8000-0000000000c1";
const RUN_ID = "00000000-0000-4000-8000-0000000000a1";

const issue = vi.fn();
let fake = recordingSupabase(respond);
// paginateRange reads until an empty page; the fake ignores `.range()`.
let served = new Set<string>();
const page = (table: string, rows: unknown[]) => {
  if (served.has(table)) return { data: [], error: null };
  served.add(table);
  return { data: rows, error: null };
};

const pallet = (id: string, areaId: string) => ({
  id,
  client_id: CLIENT_ID,
  code: id.toUpperCase(),
  entry_date: "2026-09-01",
  exit_date: null,
  area_id: areaId,
});

const tariff = (areaId: string | null, rate: number, validFrom: string) => ({
  client_id: null,
  area_id: areaId,
  rate_per_pallet: rate,
  period: "monthly",
  handling_in: 0,
  handling_out: 0,
  valid_from: validFrom,
  valid_to: null,
  is_active: true,
});

function respond(call: RecordedCall) {
  if (call.table === "pallets") {
    return page("pallets", [pallet("p1", "a1"), pallet("p2", "a2")]);
  }
  if (call.table === "storage_tariffs") {
    // The area row starts later: without its area it would win everywhere.
    return page("storage_tariffs", [
      tariff(null, 3000, "2026-01-01"),
      tariff("a1", 6000, "2026-06-01"),
    ]);
  }
  if (call.table === "client_tariffs") return page("client_tariffs", []);
  if (call.table === "clients" && call.filters.some(([k]) => k === "eq")) {
    return {
      data: {
        id: CLIENT_ID,
        legal_name: "Cliente",
        cuit: "30111111118",
        iva_condition: "responsable_inscripto",
        is_fiscal: true,
      },
      error: null,
    };
  }
  if (call.table === "clients") {
    return page("clients", [
      { id: CLIENT_ID, legal_name: "Cliente", is_fiscal: true },
    ]);
  }
  if (call.table === "claim_storage_billing_period_with_relinks") {
    return { data: [{ run_id: RUN_ID, relinked_run_ids: [] }], error: null };
  }
  return { data: null, error: null };
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["owner"], []),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  issueFiscalInvoiceAction: (input: unknown) => issue(input),
}));

const { getStorageBillingAction, invoiceStorageAction } =
  await import("./billing-actions");

const october = { periodStart: "2026-10-01", periodEnd: "2026-10-31" };

beforeEach(() => {
  issue.mockReset();
  issue.mockResolvedValue({ ok: true, data: { id: "inv1" } });
  served = new Set();
  fake = recordingSupabase(respond);
});

describe("general area tariffs reach billing", () => {
  it("prices each pallet at its own area's tariff in the preview", async () => {
    const res = await getStorageBillingAction(october);
    if (!res.ok) throw new Error(res.error);
    const charge = (id: string) =>
      res.data.lines.find((l) => l.pallet_id === id)?.storage_charge;
    // 31 days: a1 at 6000/30, a2 at the every-area 3000/30.
    expect(charge("p1")).toBe(6200);
    expect(charge("p2")).toBe(3100);
    expect(res.data.total).toBe(9300);
  });

  it("invoices the same amounts as the preview", async () => {
    const res = await invoiceStorageAction({
      client_id: CLIENT_ID,
      period_start: october.periodStart,
      period_end: october.periodEnd,
      channel_id: "jouve_internal",
      punto_venta: 3,
    });
    expect(res.ok).toBe(true);
    const totals = fake.calls.find(
      (c) => c.table === "storage_billing_runs" && c.op === "update",
    );
    expect(totals?.payload).toMatchObject({ storage_total: 9300, total: 9300 });
    expect(totals?.payload).toMatchObject({
      applied_tariffs: expect.arrayContaining([
        expect.objectContaining({ area_id: "a1", rate_per_pallet: 6000 }),
      ]),
    });
  });
});
