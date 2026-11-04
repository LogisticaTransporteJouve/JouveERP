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
const audit = vi.fn();
// What the relink audit reads after a claim that linked an orphan invoice.
let linkedRuns: unknown[] = [];
let runInvoices: unknown[] = [];
let auditedInvoices: unknown[] = [];
let claim: { data: unknown; error: unknown } = { data: RUN_ID, error: null };
let pallets: unknown[] = [];
let link: { data: unknown; error: unknown } = { data: null, error: null };
let invoiceStatus = "emitting";
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
  if (
    call.table === "storage_billing_runs" &&
    call.op === "update" &&
    typeof call.payload === "object" &&
    call.payload !== null &&
    "invoice_id" in call.payload
  ) {
    return link;
  }
  if (call.table === "storage_billing_runs" && call.op === "select") {
    return { data: linkedRuns, error: null };
  }
  if (call.table === "audit_events") {
    return { data: auditedInvoices, error: null };
  }
  if (call.table === "invoices" && call.filters.some(([k]) => k === "in")) {
    return { data: runInvoices, error: null };
  }
  if (call.table === "invoices") {
    return { data: { status: invoiceStatus }, error: null };
  }
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
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => audit(...args),
}));
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
  audit.mockReset();
  linkedRuns = [];
  runInvoices = [];
  auditedInvoices = [];
  issue.mockResolvedValue({ ok: true, data: { id: "inv1" } });
  claim = { data: RUN_ID, error: null };
  link = { data: null, error: null };
  invoiceStatus = "emitting";
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
    const linkCall = runCalls().at(-1);
    expect(linkCall?.op).toBe("update");
    expect(linkCall?.payload).toEqual({
      invoice_id: "inv1",
      pending_since: null,
    });
  });

  it("issues under the run's id, with the totals already on the run", async () => {
    await invoiceStorageAction(october);
    expect(issue).toHaveBeenCalledWith(
      expect.objectContaining({ idempotency_key: RUN_ID }),
    );
    const [totals] = runCalls();
    expect(totals?.op).toBe("update");
    expect(totals?.payload).toMatchObject({ storage_total: 310, total: 310 });
    expect(totals?.payload).not.toHaveProperty("invoice_id");
  });

  it("issues nothing when the claim linked the period's earlier invoice", async () => {
    claim = { data: null, error: null };
    const res = await invoiceStorageAction(october);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/ya está facturado/);
      expect(res.error).toMatch(/Ventas › Comprobantes/);
      expect(res.error).not.toMatch(/historial/);
    }
    expect(issue).not.toHaveBeenCalled();
    expect(runCalls().every((c) => c.op === "select")).toBe(true);
  });

  const relinked = {
    id: RUN_ID,
    invoice_id: "inv-orphan",
    channel_id: "jouve_internal",
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    total: "310.00",
  };

  it("audits the invoice the claim relinked, marked relinked", async () => {
    claim = { data: null, error: null };
    linkedRuns = [
      relinked,
      // Another channel's run, and a run whose invoice has another key
      // (linked normally by older code): not this claim's relink.
      {
        ...relinked,
        id: "run-fiscal",
        invoice_id: "inv-f",
        channel_id: "jouve_fiscal",
      },
      { ...relinked, id: "run-old", invoice_id: "inv-old" },
    ];
    runInvoices = [
      { id: "inv-orphan", idempotency_key: RUN_ID },
      { id: "inv-f", idempotency_key: "run-fiscal" },
      { id: "inv-old", idempotency_key: "random-key" },
    ];
    await invoiceStorageAction(october);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      "storage.invoiced",
      "u1",
      expect.objectContaining({
        invoice_id: "inv-orphan",
        client_id: CLIENT_ID,
        total: 310,
        relinked: true,
      }),
      "inv-orphan",
    );
  });

  it("does not audit a relinked invoice twice", async () => {
    claim = { data: null, error: null };
    linkedRuns = [relinked];
    runInvoices = [{ id: "inv-orphan", idempotency_key: RUN_ID }];
    auditedInvoices = [{ target_resource_id: "inv-orphan" }];
    await invoiceStorageAction(october);
    expect(audit).not.toHaveBeenCalled();
  });

  it("frees the period when the link finds the invoice void", async () => {
    link = {
      data: null,
      error: { message: "falló", hint: "jouve_guard", code: "55006" },
    };
    invoiceStatus = "failed";
    const res = await invoiceStorageAction(october);
    expect(res.ok).toBe(false);
    expect(runCalls().at(-1)?.op).toBe("delete");
  });

  it("keeps the run when a live invoice's link is lost, without inviting a reissue", async () => {
    link = { data: null, error: { message: "timeout", code: "57014" } };
    const res = await invoiceStorageAction(october);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/No la emitas de nuevo/);
    expect(runCalls().some((c) => c.op === "delete")).toBe(false);
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
