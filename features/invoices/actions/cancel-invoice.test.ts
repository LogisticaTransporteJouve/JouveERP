import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  const state: {
    roles: string[];
    invoice: Record<string, unknown> | null;
    updateError: { code: string; message: string } | null;
    updates: Array<Record<string, unknown>>;
    audits: unknown[][];
  } = {
    roles: ["finance"],
    invoice: null,
    updateError: null,
    updates: [],
    audits: [],
  };
  return state;
});

function from() {
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  const builder = {
    select: () => builder,
    update: (values: Row) => {
      patch = values;
      return builder;
    },
    eq: (col: string, v: unknown) => {
      filters.push((r) => r[col] === v);
      return builder;
    },
    maybeSingle: async () => ({ data: h.invoice, error: null }),
    then: (resolve: (v: { data: Row[] | null; error: unknown }) => unknown) => {
      if (h.updateError)
        return Promise.resolve(resolve({ data: null, error: h.updateError }));
      const hit =
        h.invoice && filters.every((f) => f(h.invoice ?? {}))
          ? [h.invoice]
          : [];
      if (patch) {
        h.updates.push(patch);
        for (const r of hit) Object.assign(r, patch);
      }
      return Promise.resolve(resolve({ data: hit, error: null }));
    },
  };
  return builder;
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", roles: h.roles }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: async (...args: unknown[]) => {
    h.audits.push(args);
  },
}));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn() } }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { cancelInvoiceAction } = await import("./invoices-actions");

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.roles = ["finance"];
  h.updateError = null;
  h.updates = [];
  h.audits = [];
  h.invoice = { id: ID, status: "emitted", channel: { is_fiscal: false } };
});

describe("cancelInvoiceAction", () => {
  it("cancels an emitted internal invoice and audits it", async () => {
    const res = await cancelInvoiceAction({ id: ID });
    expect(res).toEqual({ ok: true, data: { id: ID } });
    expect(h.updates).toEqual([{ status: "cancelled" }]);
    expect(h.audits[0]?.[0]).toBe("invoice.cancelled");
  });

  it("refuses a fiscal invoice: an NC compensates it", async () => {
    h.invoice = { id: ID, status: "emitted", channel: { is_fiscal: true } };
    const res = await cancelInvoiceAction({ id: ID });
    expect(res.ok).toBe(false);
    expect(h.updates).toEqual([]);
  });

  it("refuses an invoice still being issued", async () => {
    h.invoice = { id: ID, status: "emitting", channel: { is_fiscal: false } };
    const res = await cancelInvoiceAction({ id: ID });
    expect(res.ok).toBe(false);
    expect(h.updates).toEqual([]);
  });

  it("explains the allocation guard instead of a raw database error", async () => {
    h.updateError = { code: "22023", message: "allocations" };
    const res = await cancelInvoiceAction({ id: ID });
    expect(res).toEqual({
      ok: false,
      error:
        "El comprobante tiene cobros imputados. Anulá esos recibos antes de anular el comprobante.",
    });
  });

  it("is denied to roles without invoices:cancel", async () => {
    h.roles = ["operations"];
    const res = await cancelInvoiceAction({ id: ID });
    expect(res.ok).toBe(false);
    expect(h.updates).toEqual([]);
  });
});

describe("getInvoiceDetailAction", () => {
  it("returns a draft that has no number yet", async () => {
    const { getInvoiceDetailAction } = await import("./invoices-actions");
    h.invoice = {
      id: ID,
      status: "draft",
      numero: null,
      kind: "factura",
      letter: "A",
      punto_venta: 3,
      imp_total: "121.00",
      channel: { id: "jouve_fiscal", name: "Jouve", is_fiscal: true },
      client: {
        id: "c1",
        legal_name: "Cliente",
        iva_condition: "responsable_inscripto",
      },
      items: [],
    };
    const res = await getInvoiceDetailAction(ID);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.numero).toBeNull();
  });
});
