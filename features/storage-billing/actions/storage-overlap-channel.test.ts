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
// The runs storage_billing_void_run_ids answers.
let voidRunIds: string[] = [];
// What claim_storage_billing_period_with_relinks answers.
const claimed = (runId: string | null, relinked: string[] = []) => ({
  data: [{ run_id: runId, relinked_run_ids: relinked }],
  error: null,
});
let claim: { data: unknown; error: unknown } = claimed(RUN_ID);
let pallets: unknown[] = [];
let link: { data: unknown; error: unknown } = { data: null, error: null };
// What billing_invoice_is_void answers when the link is refused.
let invoiceVoid = false;
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
  if (call.table === "claim_storage_billing_period_with_relinks") return claim;
  if (call.table === "billing_invoice_is_void") {
    return { data: invoiceVoid, error: null };
  }
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
    return page("storage_billing_runs", linkedRuns);
  }
  if (call.table === "storage_billing_void_run_ids") {
    return { data: voidRunIds, error: null };
  }
  if (call.table === "audit_events") {
    return { data: auditedInvoices, error: null };
  }
  if (call.table === "invoices" && call.filters.some(([k]) => k === "in")) {
    return { data: runInvoices, error: null };
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
vi.mock("@/lib/commands/issue-comprobante", () => ({
  issueComprobante: (_actorId: string, input: unknown) => issue(input),
}));

const { invoiceStorageAction, listStorageBillingRunsAction } =
  await import("./billing-actions");
const { invoiceStorage } = await import("@/lib/commands/invoice-storage");
const { createClient } = await import("@/lib/supabase/server");

const october = {
  client_id: CLIENT_ID,
  period_start: "2026-10-01",
  period_end: "2026-10-31",
  channel_id: "jouve_internal",
  punto_venta: 3,
};

const runCalls = () =>
  fake.calls.filter((c) => c.table === "storage_billing_runs");
// The writes to the claimed run (the relink audit only reads runs).
const runWrites = () => runCalls().filter((c) => c.op !== "select");

beforeEach(() => {
  issue.mockReset();
  audit.mockReset();
  linkedRuns = [];
  runInvoices = [];
  auditedInvoices = [];
  voidRunIds = [];
  issue.mockResolvedValue({ ok: true, data: { id: "inv1" } });
  claim = claimed(RUN_ID);
  link = { data: null, error: null };
  invoiceVoid = false;
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
      (c) => c.table === "claim_storage_billing_period_with_relinks",
    );
    expect(claimCall?.payload).toMatchObject({
      p_client_id: CLIENT_ID,
      p_channel_id: "jouve_internal",
    });
    const linkCall = runWrites().at(-1);
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
    const [totals] = runWrites();
    expect(totals?.op).toBe("update");
    expect(totals?.payload).toMatchObject({ storage_total: 310, total: 310 });
    expect(totals?.payload).not.toHaveProperty("invoice_id");
  });

  it("issues nothing when the claim linked the period's earlier invoice", async () => {
    claim = claimed(null);
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
    claim = claimed(null, [RUN_ID, "run-old"]);
    linkedRuns = [
      relinked,
      // A run whose invoice has another key (linked normally by older code):
      // not a relink.
      { ...relinked, id: "run-old", invoice_id: "inv-old" },
    ];
    runInvoices = [
      { id: "inv-orphan", idempotency_key: RUN_ID },
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

  it("audits a relink of another period or channel made by a claim that bills a new one", async () => {
    // The claim relinked January on the fiscal channel and returned a run
    // for October.
    claim = claimed(RUN_ID, ["run-january"]);
    linkedRuns = [
      {
        ...relinked,
        id: "run-january",
        invoice_id: "inv-january",
        channel_id: "jouve_fiscal",
        period_start: "2026-01-01",
        period_end: "2026-01-31",
      },
    ];
    runInvoices = [{ id: "inv-january", idempotency_key: "run-january" }];
    const res = await invoiceStorageAction(october);
    expect(res.ok).toBe(true);
    expect(audit).toHaveBeenCalledWith(
      "storage.invoiced",
      "u1",
      expect.objectContaining({
        invoice_id: "inv-january",
        period_start: "2026-01-01",
        relinked: true,
      }),
      "inv-january",
    );
    expect(audit).toHaveBeenCalledWith(
      "storage.invoiced",
      "u1",
      expect.not.objectContaining({ relinked: true }),
      "inv1",
    );
  });

  it("does not audit a relinked invoice twice", async () => {
    claim = claimed(null, [RUN_ID]);
    linkedRuns = [relinked];
    runInvoices = [{ id: "inv-orphan", idempotency_key: RUN_ID }];
    auditedInvoices = [{ target_resource_id: "inv-orphan" }];
    await invoiceStorageAction(october);
    expect(audit).not.toHaveBeenCalled();
  });

  it("does not audit as relinked a run the claim did not relink", async () => {
    // Another tab linked January on the normal path and has not written its
    // event yet: this claim relinked nothing.
    claim = claimed(RUN_ID, []);
    linkedRuns = [{ ...relinked, id: "run-january", invoice_id: "inv-jan" }];
    runInvoices = [{ id: "inv-jan", idempotency_key: "run-january" }];
    const res = await invoiceStorageAction(october);
    expect(res.ok).toBe(true);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      "storage.invoiced",
      "u1",
      expect.not.objectContaining({ relinked: true }),
      "inv1",
    );
    expect(
      runCalls().some(
        (c) =>
          c.op === "select" &&
          c.filters.some(([kind, column]) => kind === "in" && column === "id"),
      ),
    ).toBe(false);
  });

  it("frees the period when the link finds the invoice void", async () => {
    link = {
      data: null,
      error: { message: "falló", hint: "jouve_guard", code: "55006" },
    };
    invoiceVoid = true;
    const res = await invoiceStorageAction(october);
    expect(res.ok).toBe(false);
    expect(runWrites().at(-1)?.op).toBe("delete");
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
    expect(runWrites().at(-1)?.op).toBe("delete");
  });

  it("claims nothing when there is nothing to bill", async () => {
    pallets = [];
    const res = await invoiceStorageAction(october);
    expect(res.ok).toBe(false);
    expect(
      fake.calls.some(
        (c) => c.table === "claim_storage_billing_period_with_relinks",
      ),
    ).toBe(false);
  });
});

describe("listStorageBillingRunsAction", () => {
  const run = (id: string, invoiceId: string | null) => ({
    id,
    client_id: CLIENT_ID,
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    storage_total: "310.00",
    handling_in_total: "0",
    handling_out_total: "0",
    total: "310.00",
    invoice_id: invoiceId,
    channel_id: "jouve_fiscal",
    pending_since: null,
    created_at: "2026-11-01T00:00:00Z",
    client: { legal_name: "Cliente" },
  });

  it("leaves out the runs whose invoice no longer bills them", async () => {
    linkedRuns = [run("run-live", "inv-live"), run("run-credited", "inv-nc")];
    voidRunIds = ["run-credited"];
    const res = await listStorageBillingRunsAction();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.map((r) => r.id)).toEqual(["run-live"]);
  });

  it("fails instead of showing a void run as billed when that read fails", async () => {
    linkedRuns = [run("run-credited", "inv-nc")];
    fake = recordingSupabase((call) =>
      call.table === "storage_billing_void_run_ids"
        ? { data: null, error: { message: "boom" } }
        : respond(call),
    );
    const res = await listStorageBillingRunsAction();
    expect(res.ok).toBe(false);
  });
});

// An accepted assistant proposal bills at the total its card showed.
describe("invoiceStorage at a proposal's total", () => {
  it("refuses, claiming nothing, when the period recomputes to another total", async () => {
    const res = await invoiceStorage(await createClient(), "u1", october, 300);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/cambió desde la propuesta/);
    expect(
      fake.calls.some(
        (c) => c.table === "claim_storage_billing_period_with_relinks",
      ),
    ).toBe(false);
    expect(issue).not.toHaveBeenCalled();
  });

  it("bills when the total is the one shown", async () => {
    const res = await invoiceStorage(await createClient(), "u1", october, 310);
    expect(res).toEqual({ ok: true, data: { invoiceId: "inv1" } });
  });
});
