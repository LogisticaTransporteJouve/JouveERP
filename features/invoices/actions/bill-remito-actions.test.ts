import { beforeEach, describe, expect, it, vi } from "vitest";

import { DOC_TIPO, IVA_RATE } from "@/lib/afip/codes";
import { resolveAccess, type Access, type Role } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

// billRemitoAction and getRemitoLinksAction read through the service client,
// so the action gate is the only boundary (RLS does not apply).

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  access: null as Access | null,
  remito: null as Row | null,
  client: null as Row | null,
  invoicesById: {} as Record<string, Row>,
  billed: null as Row | null,
  failTable: null as string | null,
  blocker: null as string | null,
  blockerErr: null as unknown,
}));

function eqValue(call: RecordedCall, column: string): unknown {
  return call.filters.find(([k, c]) => k === "eq" && c === column)?.[2];
}

function respond(call: RecordedCall) {
  if (call.op === "rpc" && call.table === "billed_remito_blocker") {
    return { data: h.blocker, error: h.blockerErr };
  }
  if (h.failTable === call.table) {
    return { data: null, error: { message: "boom" } };
  }
  switch (call.table) {
    case "invoices": {
      if (eqValue(call, "source_remito_id") !== undefined) {
        return { data: h.billed, error: null };
      }
      const id = eqValue(call, "id");
      if (typeof id === "string" && id in h.invoicesById) {
        return { data: h.invoicesById[id], error: null };
      }
      return { data: h.remito, error: null };
    }
    case "clients":
      return { data: h.client, error: null };
    default:
      return { data: null, error: null };
  }
}

let fake = recordingSupabase(respond);

const issue = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", access: h.access }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./invoices-actions", () => ({ issueFiscalInvoiceAction: issue }));

const { billRemitoAction, getRemitoLinksAction } =
  await import("./bill-remito-actions");

const REMITO = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const FACTURA = "33333333-3333-4333-8333-333333333333";
const KEY = "55555555-5555-4555-8555-555555555555";

function input() {
  return {
    remito_id: REMITO,
    client_id: CLIENT,
    channel_id: "jouve_fiscal",
    punto_venta: 3,
    iva_rate_id: IVA_RATE.TWENTY_ONE,
    idempotency_key: KEY,
  };
}

function as(roles: Role[], denied: string[] = []) {
  h.access = resolveAccess(roles, denied);
}

beforeEach(() => {
  fake = recordingSupabase(respond);
  issue.mockReset();
  issue.mockResolvedValue({ ok: true, data: { id: FACTURA } });
  as(["finance"]);
  h.remito = {
    id: REMITO,
    kind: "factura",
    status: "emitted",
    concepto: 2,
    imp_total: 1000,
    channel: { is_fiscal: false },
    items: [
      { description: "B", quantity: 2, unit_price: 100, sort_order: 1 },
      { description: "A", quantity: 1, unit_price: 800, sort_order: 0 },
    ],
  };
  h.client = {
    id: CLIENT,
    cuit: "30714637432",
    iva_condition: "responsable_inscripto",
    is_fiscal: true,
  };
  h.invoicesById = {};
  h.billed = null;
  h.failTable = null;
  h.blocker = null;
  h.blockerErr = null;
});

describe("billRemitoAction — gate", () => {
  it.each<Role>(["operations", "warehouse", "driver", "fiscal_reader"])(
    "refuses %s (no invoices:issue) before touching the service client",
    async (role) => {
      as([role]);
      const res = await billRemitoAction(input());
      expect(res.ok).toBe(false);
      expect(fake.calls).toEqual([]);
      expect(issue).not.toHaveBeenCalled();
    },
  );

  it("refuses a finance user whose invoices:issue is denied", async () => {
    as(["finance"], ["invoices:issue"]);
    const res = await billRemitoAction(input());
    expect(res.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it("refuses a finance user whose invoices:read is denied (read deny implies every invoices:*)", async () => {
    as(["finance"], ["invoices:read"]);
    const res = await billRemitoAction(input());
    expect(res.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it("rejects a malformed remito id before reading", async () => {
    const res = await billRemitoAction({ ...input(), remito_id: "x" });
    expect(res.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it("rejects an IVA rate id that AFIP does not define", async () => {
    const res = await billRemitoAction({ ...input(), iva_rate_id: 7 });
    expect(res.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});

describe("billRemitoAction — the remito", () => {
  it("refuses a fiscal factura as the source", async () => {
    h.remito = { ...h.remito, channel: { is_fiscal: true } };
    const res = await billRemitoAction(input());
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
  });

  it("refuses a nota de crédito interna as the source", async () => {
    h.remito = { ...h.remito, kind: "nc" };
    const res = await billRemitoAction(input());
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
  });

  it("refuses a remito whose channel embed is missing (fails closed)", async () => {
    h.remito = { ...h.remito, channel: null };
    const res = await billRemitoAction(input());
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
  });

  it("refuses a remito that is not emitted", async () => {
    h.remito = { ...h.remito, status: "draft" };
    const res = await billRemitoAction(input());
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
  });

  it("refuses a missing remito", async () => {
    h.remito = null;
    const res = await billRemitoAction(input());
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
  });

  it("refuses a remito without items", async () => {
    h.remito = { ...h.remito, items: [] };
    const res = await billRemitoAction(input());
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
  });
});

describe("billRemitoAction — billed_remito_blocker (the DB owns the rule)", () => {
  it("asks the DB whether the remito can be billed and returns its reason", async () => {
    h.blocker = "El remito se cobró con cheques: anulá ese recibo interno.";
    const res = await billRemitoAction(input());
    expect(res).toEqual({ ok: false, error: h.blocker });
    const rpc = fake.calls.find((c) => c.op === "rpc");
    expect(rpc?.table).toBe("billed_remito_blocker");
    expect(rpc?.payload).toEqual({ p_remito_id: REMITO });
    expect(issue).not.toHaveBeenCalled();
  });

  it("fails closed when the check errors", async () => {
    h.blockerErr = { message: "boom" };
    const res = await billRemitoAction(input());
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
  });

  it("lets a remito the DB does not block through", async () => {
    const res = await billRemitoAction(input());
    expect(res.ok).toBe(true);
    expect(issue).toHaveBeenCalledTimes(1);
  });
});

describe("billRemitoAction — the fiscal client", () => {
  it("refuses an Otras ventas client", async () => {
    h.client = {
      id: CLIENT,
      cuit: null,
      iva_condition: null,
      is_fiscal: false,
    };
    const res = await billRemitoAction(input());
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
  });

  it("refuses a missing client", async () => {
    h.client = null;
    const res = await billRemitoAction(input());
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
  });

  it("refuses a fiscal client with an unknown IVA condition", async () => {
    h.client = { ...h.client, iva_condition: "otra_cosa" };
    const res = await billRemitoAction(input());
    expect(res.ok).toBe(false);
    expect(issue).not.toHaveBeenCalled();
  });
});

describe("billRemitoAction — the factura it issues", () => {
  it("issues a fiscal factura with the remito's items as net + chosen IVA, linked to the remito", async () => {
    const res = await billRemitoAction(input());
    expect(res).toEqual({ ok: true, data: { id: FACTURA } });
    expect(issue).toHaveBeenCalledOnce();
    const arg = issue.mock.calls[0]![0];
    expect(arg).toMatchObject({
      channel_id: "jouve_fiscal",
      client_id: CLIENT,
      kind: "factura",
      letter: null,
      punto_venta: 3,
      concepto: 2,
      doc_tipo: DOC_TIPO.CUIT,
      doc_nro: "30714637432",
      moneda: "PES",
      cotizacion: 1,
      source_remito_id: REMITO,
      idempotency_key: KEY,
    });
    expect(arg.items).toEqual([
      {
        description: "A",
        quantity: 1,
        unit_price: 800,
        iva_rate_id: IVA_RATE.TWENTY_ONE,
      },
      {
        description: "B",
        quantity: 2,
        unit_price: 100,
        iva_rate_id: IVA_RATE.TWENTY_ONE,
      },
    ]);
  });

  it("keeps productos (1) and productos y servicios (3) from the remito", async () => {
    h.remito = { ...h.remito, concepto: 1 };
    await billRemitoAction(input());
    expect(issue.mock.calls[0]![0].concepto).toBe(1);
  });

  it("takes the client from the DB, not from the caller (the CUIT is re-read)", async () => {
    await billRemitoAction(input());
    const clientRead = fake.calls.find((c) => c.table === "clients");
    expect(eqValue(clientRead!, "id")).toBe(CLIENT);
    expect(issue.mock.calls[0]![0].doc_nro).toBe("30714637432");
  });
});

describe("getRemitoLinksAction", () => {
  it.each<Role>(["operations", "warehouse", "driver"])(
    "refuses %s (no invoices:read) before reading",
    async (role) => {
      as([role]);
      const res = await getRemitoLinksAction(FACTURA);
      expect(res.ok).toBe(false);
      expect(fake.calls).toEqual([]);
    },
  );

  it("refuses a malformed id", async () => {
    const res = await getRemitoLinksAction("not-a-uuid");
    expect(res.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it("links a factura to its remito and a remito to its live factura", async () => {
    h.invoicesById = {
      [FACTURA]: {
        id: FACTURA,
        kind: "factura",
        letter: "A",
        punto_venta: 3,
        numero: 12,
        source_remito_id: REMITO,
      },
      [REMITO]: {
        id: REMITO,
        kind: "factura",
        letter: null,
        punto_venta: 9001,
        numero: 4,
        source_remito_id: null,
      },
    };
    const res = await getRemitoLinksAction(FACTURA);
    expect(res.ok && res.data.sourceRemito).toEqual({
      id: REMITO,
      label: "X9001-00000004",
    });
    const billedQuery = fake.calls.find(
      (c) => c.table === "invoices" && eqValue(c, "source_remito_id"),
    );
    expect(
      billedQuery?.filters.find(([k, c]) => k === "not" && c === "status")?.[2],
    ).toEqual(["in", "(failed,cancelled)"]);
  });

  // A fiscal_reader reads only fiscal channels (isFiscalOnly pins every
  // service-client read in invoices-actions). The links action reads the
  // remito interno through the service client with no such pin.
  it("does not reveal a remito interno to a fiscal_reader", async () => {
    as(["fiscal_reader"]);
    h.invoicesById = {
      [FACTURA]: {
        id: FACTURA,
        kind: "factura",
        letter: "A",
        punto_venta: 3,
        numero: 12,
        source_remito_id: REMITO,
      },
      [REMITO]: {
        id: REMITO,
        kind: "factura",
        letter: null,
        punto_venta: 9001,
        numero: 4,
        source_remito_id: null,
      },
    };
    const res = await getRemitoLinksAction(FACTURA);
    expect(res.ok && res.data.sourceRemito).toBeNull();
  });
});
