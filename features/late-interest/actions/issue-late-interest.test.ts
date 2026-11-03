import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const INVOICE = "00000000-0000-4000-8000-000000000001";
const CHARGE = "00000000-0000-4000-8000-0000000000c1";

const issue = vi.fn();
let roles: Role[] = ["owner"];
let candidate: Record<string, unknown> | null = null;
let claimError: unknown = null;
let fake = recordingSupabase(respond);

function respond(call: RecordedCall) {
  if (call.table === "late_interest_candidates") {
    return { data: candidate ? [candidate] : [], error: null };
  }
  if (call.table === "clients") {
    return {
      data: {
        cuit: "30111111118",
        iva_condition: "responsable_inscripto",
        is_fiscal: true,
      },
      error: null,
    };
  }
  if (call.table === "late_interest_charges" && call.op === "insert") {
    return claimError
      ? { data: null, error: claimError }
      : { data: { id: CHARGE }, error: null };
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
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  issueFiscalInvoiceAction: (input: unknown) => issue(input),
}));

const { issueLateInterestNdAction } = await import("./late-interest-actions");

const input = {
  invoice_id: INVOICE,
  as_of: "2026-10-31",
  monthly_rate: 3,
  punto_venta: 2,
};

const chargeUpdates = () =>
  fake.calls.filter(
    (c) => c.table === "late_interest_charges" && c.op === "update",
  );

beforeEach(() => {
  issue.mockReset();
  issue.mockResolvedValue({ ok: true, data: { id: "nd1" } });
  roles = ["owner"];
  claimError = null;
  candidate = {
    invoice_id: INVOICE,
    client_id: "c1",
    client_name: "Cliente",
    channel_id: "jouve_fiscal",
    channel_is_fiscal: true,
    kind: "factura",
    letter: "A",
    punto_venta: 2,
    numero: 123,
    fecha: "2026-09-01",
    due_date: "2026-10-01",
    moneda: "PES",
    open_amount: 10000,
    // 30 days on 10.000, no payment in the period.
    balance_days: 300000,
    charged_to: null,
    charge_from: "2026-10-02",
    client_rate: null,
    monthly_rate: 3,
  };
  fake = recordingSupabase(respond);
});

describe("issueLateInterestNdAction", () => {
  it("claims the period, issues an ND on the overdue comprobante and links it", async () => {
    const res = await issueLateInterestNdAction(input);
    expect(res).toEqual({ ok: true, data: { invoiceId: "nd1" } });

    const claim = fake.calls.find(
      (c) => c.table === "late_interest_charges" && c.op === "insert",
    );
    // 2/10 → 31/10 = 30 days × 3% monthly on 10.000.
    expect(claim?.payload).toMatchObject({
      invoice_id: INVOICE,
      period_from: "2026-10-02",
      period_to: "2026-10-31",
      monthly_rate: 3,
      base_amount: 10000,
      interest_amount: 300,
    });

    expect(issue).toHaveBeenCalledOnce();
    expect(issue.mock.calls[0]![0]).toMatchObject({
      kind: "nd",
      invoice_origin_id: INVOICE,
      channel_id: "jouve_fiscal",
      punto_venta: 2,
      fch_serv_desde: "2026-10-02",
      fch_serv_hasta: "2026-10-31",
      idempotency_key: CHARGE,
      items: [{ quantity: 1, unit_price: 300 }],
    });

    expect(chargeUpdates()).toHaveLength(1);
    expect(chargeUpdates()[0]?.payload).toEqual({ nd_invoice_id: "nd1" });
  });

  it("needs credit_debit_notes:issue", async () => {
    roles = ["operations"];
    const res = await issueLateInterestNdAction(input);
    expect(res.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
    expect(issue).not.toHaveBeenCalled();
  });

  it("surfaces the guard's refusal of a charged period without issuing", async () => {
    claimError = {
      message:
        "Ya se cobraron intereses de ese comprobante del 02/10/2026 al 31/10/2026.",
      code: "23P01",
      hint: "jouve_guard",
    };
    const res = await issueLateInterestNdAction(input);
    expect(res).toEqual({
      ok: false,
      error:
        "Ya se cobraron intereses de ese comprobante del 02/10/2026 al 31/10/2026.",
    });
    expect(issue).not.toHaveBeenCalled();
  });

  it("releases the claim when the ND is not created", async () => {
    issue.mockResolvedValue({ ok: false, error: "AFIP caído." });
    const res = await issueLateInterestNdAction(input);
    expect(res).toEqual({ ok: false, error: "AFIP caído." });
    expect(chargeUpdates()).toHaveLength(1);
    expect(chargeUpdates()[0]?.payload).toEqual({ released: true });
    expect(chargeUpdates()[0]?.filters).toContainEqual([
      "is",
      "nd_invoice_id",
      null,
    ]);
  });

  it("refuses a date already charged", async () => {
    candidate = {
      ...candidate,
      charged_to: "2026-10-31",
      charge_from: "2026-11-01",
    };
    const res = await issueLateInterestNdAction(input);
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
  });

  it("refuses a comprobante that is not overdue", async () => {
    candidate = null;
    const res = await issueLateInterestNdAction(input);
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
  });

  it("refuses future days", async () => {
    const res = await issueLateInterestNdAction({
      ...input,
      as_of: "2999-01-01",
    });
    expect(res.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});
