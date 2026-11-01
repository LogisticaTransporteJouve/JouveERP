import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Access } from "@/lib/auth/permissions";
import { INVOICE_REMITO_BILLED } from "@/lib/inngest/events";
import {
  recordingSupabase,
  type FakeResponse,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

// retryRemitoCreditAction: once the settlement drafted its NC the retry only
// re-issues it; before that, what billed_remito_blocker says reaches the user.
// An enqueue failure is an { ok: false }, and only a sent retry is audited.

const h = vi.hoisted(() => ({
  access: null as Access | null,
  blocker: { data: null, error: null } as FakeResponse,
  ownNc: { data: null, error: null } as FakeResponse,
  send: vi.fn(async (): Promise<unknown> => undefined),
  audit: vi.fn(async () => undefined),
}));

const FACTURA = "11111111-1111-4111-8111-111111111111";
const REMITO = "22222222-2222-4222-8222-222222222222";

function respond(call: RecordedCall): FakeResponse {
  if (call.op === "rpc") return h.blocker;
  if (call.table === "invoices") {
    if (call.filters.some(([k, c]) => k === "eq" && c === "idempotency_key")) {
      return h.ownNc;
    }
    return {
      data: { id: FACTURA, status: "emitted", source_remito_id: REMITO },
      error: null,
    };
  }
  return { data: null, error: null };
}

let fake = recordingSupabase(respond);

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", access: h.access }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: h.send } }));
vi.mock("@/lib/actions/audit", () => ({ logAudit: h.audit }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./invoices-actions", () => ({ issueFiscalInvoiceAction: vi.fn() }));

const { retryRemitoCreditAction } = await import("./bill-remito-actions");

beforeEach(() => {
  fake = recordingSupabase(respond);
  h.access = resolveAccess(["finance"], []);
  h.blocker = { data: null, error: null };
  h.ownNc = { data: null, error: null };
  h.send.mockReset();
  h.send.mockResolvedValue(undefined);
  h.audit.mockClear();
});

describe("retryRemitoCreditAction — the blocker", () => {
  it("asks billed_remito_blocker about the factura's remito, read from the DB", async () => {
    await retryRemitoCreditAction(FACTURA);
    const rpc = fake.calls.find((c) => c.op === "rpc");
    expect(rpc?.table).toBe("billed_remito_blocker");
    expect(rpc?.payload).toEqual({ p_remito_id: REMITO });
  });

  it.each([
    "El remito tiene un cobro en otra moneda: anulá ese recibo interno, facturá el remito y cargá el cobro en Ventas.",
    "Un recibo interno de este remito tiene saldo a cuenta: anulalo, facturá el remito y cargá el cobro en Ventas.",
    "El remito se cobró en un período contable cerrado: no se puede pasar el cobro a Ventas.",
  ])("returns the blocker's text without sending: %s", async (text) => {
    h.blocker = { data: text, error: null };
    const res = await retryRemitoCreditAction(FACTURA);
    expect(res).toEqual({ ok: false, error: text });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("skips the blocker once the settlement drafted its NC: the retry issues it again", async () => {
    h.ownNc = {
      data: { id: "33333333-3333-4333-8333-333333333333" },
      error: null,
    };
    h.blocker = {
      data: "El remito ya tiene una nota de crédito: no se puede facturar.",
      error: null,
    };
    const res = await retryRemitoCreditAction(FACTURA);
    expect(res.ok).toBe(true);
    expect(fake.calls.some((c) => c.op === "rpc")).toBe(false);
    expect(h.send).toHaveBeenCalledWith({
      name: INVOICE_REMITO_BILLED,
      data: { factura_id: FACTURA },
    });
  });

  it("fails closed when the settlement NC cannot be looked up", async () => {
    h.ownNc = { data: null, error: { message: "boom" } };
    const res = await retryRemitoCreditAction(FACTURA);
    expect(res.ok).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("fails closed when the blocker cannot be read", async () => {
    h.blocker = { data: null, error: { message: "boom" } };
    const res = await retryRemitoCreditAction(FACTURA);
    expect(res.ok).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });
});

describe("retryRemitoCreditAction — enqueue and audit", () => {
  it("returns ok:false (does not throw) when the event cannot be sent", async () => {
    h.send.mockRejectedValue(new Error("inngest down"));
    const res = await retryRemitoCreditAction(FACTURA);
    expect(res).toEqual({
      ok: false,
      error: "No se pudo encolar la acreditación. Probá de nuevo.",
    });
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("audits a sent retry with the caller and the factura, after sending", async () => {
    const res = await retryRemitoCreditAction(FACTURA);
    expect(res.ok).toBe(true);
    expect(h.audit).toHaveBeenCalledTimes(1);
    expect(h.audit).toHaveBeenCalledWith(
      "invoice.remito_credit_retried",
      "u1",
      {},
      FACTURA,
    );
    expect(h.send.mock.invocationCallOrder[0]).toBeLessThan(
      h.audit.mock.invocationCallOrder[0]!,
    );
  });

  it("neither reads, sends nor audits for a role without invoices:issue", async () => {
    h.access = resolveAccess(["operations"], []);
    const res = await retryRemitoCreditAction(FACTURA);
    expect(res.ok).toBe(false);
    expect(fake.calls).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });
});
