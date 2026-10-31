import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const CLIENT_ID = "00000000-0000-4000-8000-0000000000c1";
const RUN_ID = "00000000-0000-4000-8000-0000000000a1";

const OVERLAP_MESSAGE =
  "Ese período ya fue facturado (total o parcialmente) para este cliente en este canal.";

const issue = vi.fn();
let claim: { data: unknown; error: unknown } = { data: RUN_ID, error: null };
let pallets: unknown[] = [];
let fake = recordingSupabase(respond);
// paginateRange reads until an empty page; the fake ignores `.range()`, so
// each paged table answers its rows once and then an empty page.
let served = new Set<string>();
const page = (table: string, rows: unknown[]) => {
  if (served.has(table)) return { data: [], error: null };
  served.add(table);
  return { data: rows, error: null };
};

function respond(call: RecordedCall) {
  if (call.table === "claim_storage_billing_period") return claim;
  if (call.table === "clients") {
    return {
      data: {
        id: CLIENT_ID,
        legal_name: "Cliente",
        cuit: "30111111118",
        iva_condition: "responsable_inscripto",
      },
      error: null,
    };
  }
  if (call.table === "pallets") return page("pallets", pallets);
  if (call.table === "storage_tariffs") {
    return page("storage_tariffs", [
      {
        client_id: null,
        rate_per_pallet: 300,
        period: "monthly",
        handling_in: 0,
        handling_out: 0,
        valid_from: "2026-01-01",
        valid_to: null,
        is_active: true,
      },
    ]);
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
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  issueFiscalInvoiceAction: (input: unknown) => issue(input),
}));

const { invoiceStorageAction } = await import("./billing-actions");

const october = {
  client_id: CLIENT_ID,
  period_start: "2026-10-01",
  period_end: "2026-10-31",
  channel_id: "jouve_internal",
  punto_venta: 3,
};

const runCalls = () =>
  fake.calls.filter((c) => c.table === "storage_billing_runs");

beforeEach(() => {
  issue.mockReset();
  issue.mockResolvedValue({ ok: true, data: { id: "inv1" } });
  claim = { data: RUN_ID, error: null };
  pallets = [
    {
      id: "p1",
      client_id: CLIENT_ID,
      code: "P-1",
      entry_date: "2026-09-01",
      exit_date: null,
    },
  ];
  served = new Set();
  fake = recordingSupabase(respond);
});

describe("invoiceStorageAction claim", () => {
  it("surfaces the claim's overlap refusal without issuing", async () => {
    claim = {
      data: null,
      error: { message: OVERLAP_MESSAGE, hint: "jouve_guard", code: "23P01" },
    };
    const res = await invoiceStorageAction(october);
    expect(res).toEqual({ ok: false, error: OVERLAP_MESSAGE });
    expect(issue).not.toHaveBeenCalled();
  });

  it("claims the period before issuing and fills the claimed run", async () => {
    const res = await invoiceStorageAction(october);
    expect(res.ok).toBe(true);
    const claimCall = fake.calls.find(
      (c) => c.table === "claim_storage_billing_period",
    );
    expect(claimCall?.payload).toMatchObject({
      p_client_id: CLIENT_ID,
      p_channel_id: "jouve_internal",
    });
    const link = runCalls().at(-1);
    expect(link?.op).toBe("update");
    expect(link?.payload).toMatchObject({
      invoice_id: "inv1",
      pending_since: null,
    });
  });

  it("drops the claimed run when the issue fails", async () => {
    issue.mockResolvedValue({ ok: false, error: "AFIP caído" });
    const res = await invoiceStorageAction(october);
    expect(res.ok).toBe(false);
    expect(runCalls().at(-1)?.op).toBe("delete");
  });

  it("claims nothing when there is nothing to bill", async () => {
    pallets = [];
    const res = await invoiceStorageAction(october);
    expect(res.ok).toBe(false);
    expect(
      fake.calls.some((c) => c.table === "claim_storage_billing_period"),
    ).toBe(false);
  });
});
