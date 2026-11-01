import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Access, type Role } from "@/lib/auth/permissions";
import { INVOICE_REMITO_BILLED } from "@/lib/inngest/events";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

// retryRemitoCreditAction re-sends the settlement of a billed remito and
// getRemitoLinksAction reports whether it is still pending. Both read through
// the service client, so the action gate is the only boundary.

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  access: null as Access | null,
  byId: {} as Record<string, Row>,
  ncByKey: {} as Record<string, Row>,
  failTable: false,
  send: vi.fn(async () => undefined),
}));

function eqValue(call: RecordedCall, column: string): unknown {
  return call.filters.find(([k, c]) => k === "eq" && c === column)?.[2];
}

function respond(call: RecordedCall) {
  if (h.failTable) return { data: null, error: { message: "boom" } };
  if (call.table !== "invoices") return { data: null, error: null };
  if (eqValue(call, "source_remito_id") !== undefined) {
    return { data: null, error: null };
  }
  const key = eqValue(call, "idempotency_key");
  if (typeof key === "string") {
    const nc = h.ncByKey[key];
    const wantStatus = eqValue(call, "status");
    const match = nc && (wantStatus === undefined || nc.status === wantStatus);
    return { data: match ? nc : null, error: null };
  }
  const id = eqValue(call, "id");
  return {
    data: typeof id === "string" ? (h.byId[id] ?? null) : null,
    error: null,
  };
}

let fake = recordingSupabase(respond);

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", access: h.access }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: h.send } }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./invoices-actions", () => ({ issueFiscalInvoiceAction: vi.fn() }));

const { retryRemitoCreditAction, getRemitoLinksAction } =
  await import("./bill-remito-actions");

const FACTURA = "11111111-1111-4111-8111-111111111111";
const REMITO = "22222222-2222-4222-8222-222222222222";
const NC = "33333333-3333-4333-8333-333333333333";

function as(roles: Role[], denied: string[] = []) {
  h.access = resolveAccess(roles, denied);
}

function factura(status: string, source: string | null = REMITO): Row {
  return {
    id: FACTURA,
    kind: "factura",
    letter: "A",
    punto_venta: 3,
    numero: 12,
    status,
    source_remito_id: source,
  };
}

beforeEach(() => {
  fake = recordingSupabase(respond);
  h.send.mockClear();
  h.failTable = false;
  as(["finance"]);
  h.byId = {
    [FACTURA]: factura("emitted"),
    [REMITO]: {
      id: REMITO,
      kind: "factura",
      letter: null,
      punto_venta: 9001,
      numero: 4,
      status: "emitted",
      source_remito_id: null,
    },
  };
  h.ncByKey = {};
});

describe("retryRemitoCreditAction — gate", () => {
  it.each<Role>(["operations", "warehouse", "driver", "fiscal_reader"])(
    "refuses %s (no invoices:issue) before reading or sending",
    async (role) => {
      as([role]);
      const res = await retryRemitoCreditAction(FACTURA);
      expect(res.ok).toBe(false);
      expect(fake.calls).toEqual([]);
      expect(h.send).not.toHaveBeenCalled();
    },
  );

  it("refuses a finance user whose invoices:issue is denied", async () => {
    as(["finance"], ["invoices:issue"]);
    const res = await retryRemitoCreditAction(FACTURA);
    expect(res.ok).toBe(false);
    expect(fake.calls).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("refuses a finance user whose invoices:read is denied", async () => {
    as(["finance"], ["invoices:read"]);
    const res = await retryRemitoCreditAction(FACTURA);
    expect(res.ok).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("rejects a malformed id before reading", async () => {
    const res = await retryRemitoCreditAction("not-a-uuid");
    expect(res.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});

describe("retryRemitoCreditAction — the factura", () => {
  it.each(["draft", "emitting", "failed", "cancelled"])(
    "refuses a %s factura without sending",
    async (status) => {
      h.byId[FACTURA] = factura(status);
      const res = await retryRemitoCreditAction(FACTURA);
      expect(res.ok).toBe(false);
      expect(h.send).not.toHaveBeenCalled();
    },
  );

  it("refuses an emitted factura that did not bill a remito", async () => {
    h.byId[FACTURA] = factura("emitted", null);
    const res = await retryRemitoCreditAction(FACTURA);
    expect(res.ok).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("refuses a missing factura", async () => {
    h.byId = {};
    const res = await retryRemitoCreditAction(FACTURA);
    expect(res.ok).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("fails closed when the read errors", async () => {
    h.failTable = true;
    const res = await retryRemitoCreditAction(FACTURA);
    expect(res.ok).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("sends the settlement event for the factura's own id, read from the DB", async () => {
    const res = await retryRemitoCreditAction(FACTURA);
    expect(res.ok).toBe(true);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith({
      name: INVOICE_REMITO_BILLED,
      data: { factura_id: FACTURA },
    });
    const read = fake.calls.find((c) => c.table === "invoices");
    expect(eqValue(read!, "id")).toBe(FACTURA);
  });
});

describe("getRemitoLinksAction — creditState", () => {
  it("is pending on a factura emitted long ago whose remito has no NC", async () => {
    const res = await getRemitoLinksAction(FACTURA);
    expect(res.ok && res.data.creditState).toBe("pending");
  });

  it("is running right after the CAE, before the job drafts the NC", async () => {
    h.byId[FACTURA] = {
      ...factura("emitted"),
      emitted_at: new Date().toISOString(),
    };
    const res = await getRemitoLinksAction(FACTURA);
    expect(res.ok && res.data.creditState).toBe("running");
  });

  it("is pending again when the settlement NC failed", async () => {
    h.ncByKey[FACTURA] = { id: NC, status: "failed" };
    const res = await getRemitoLinksAction(FACTURA);
    expect(res.ok && res.data.creditState).toBe("pending");
  });

  it("looks for the NC by the factura id as idempotency key, any status", async () => {
    await getRemitoLinksAction(FACTURA);
    const ncQuery = fake.calls.find(
      (c) => eqValue(c, "idempotency_key") !== undefined,
    );
    expect(eqValue(ncQuery!, "idempotency_key")).toBe(FACTURA);
    expect(eqValue(ncQuery!, "status")).toBeUndefined();
  });

  it("is settled once the settlement NC is emitted", async () => {
    h.ncByKey[FACTURA] = { id: NC, status: "emitted" };
    const res = await getRemitoLinksAction(FACTURA);
    expect(res.ok && res.data.creditState).toBe("settled");
  });

  it("is running while the settlement NC is drafted or emitting", async () => {
    h.ncByKey[FACTURA] = { id: NC, status: "draft" };
    const res = await getRemitoLinksAction(FACTURA);
    expect(res.ok && res.data.creditState).toBe("running");
  });

  it.each(["draft", "emitting", "failed"])(
    "is not pending on a %s factura",
    async (status) => {
      h.byId[FACTURA] = factura(status);
      const res = await getRemitoLinksAction(FACTURA);
      expect(res.ok && res.data.creditState).toBe("settled");
    },
  );

  it("is not pending on a factura that billed no remito", async () => {
    h.byId[FACTURA] = factura("emitted", null);
    const res = await getRemitoLinksAction(FACTURA);
    expect(res.ok && res.data.creditState).toBe("settled");
  });

  it("is not pending on the remito itself", async () => {
    const res = await getRemitoLinksAction(REMITO);
    expect(res.ok && res.data.creditState).toBe("settled");
  });

  it("is never reported to a fiscal-only user", async () => {
    as(["fiscal_reader"]);
    const res = await getRemitoLinksAction(FACTURA);
    expect(res.ok && res.data.creditState).toBe("settled");
    expect(fake.calls).toEqual([]);
  });

  it("fails loud when a read errors instead of reporting nothing pending", async () => {
    h.failTable = true;
    const res = await getRemitoLinksAction(FACTURA);
    expect(res.ok).toBe(false);
  });
});
