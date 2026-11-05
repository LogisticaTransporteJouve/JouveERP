import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONCEPTO, CONDICION_IVA_RECEPTOR, IVA_RATE } from "@/lib/afip/codes";
import { todayInAR } from "@/lib/format";

import type { CreateComprobanteInput } from "../schema";
import { resolveAccess, type Role } from "@/lib/auth/permissions";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  const db: Record<string, Array<Record<string, unknown>>> = {};
  const inserts: Array<{ table: string; values: unknown }> = [];
  const deletes: string[] = [];
  // invoice_open_amount of each comprobante; a missing id reads as NULL.
  const openAmount: Record<string, number> = {};
  return { db, inserts, deletes, openAmount };
});

function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let insertValues: unknown = null;
  const rows = () =>
    (h.db[table] ?? []).filter((r) => filters.every((f) => f(r)));
  const builder = {
    select: () => builder,
    insert: (values: unknown) => {
      insertValues = values;
      h.inserts.push({ table, values });
      return builder;
    },
    delete: () => {
      h.deletes.push(table);
      return builder;
    },
    eq: (col: string, v: unknown) => {
      filters.push((r) => r[col] === v);
      return builder;
    },
    not: (col: string, _op: string, v: unknown) => {
      filters.push((r) => (r[col] ?? null) !== v);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () =>
      insertValues
        ? { data: { id: "new-invoice" }, error: null }
        : { data: rows()[0] ?? null, error: null },
    then: (resolve: (v: { data: null; error: null }) => unknown) =>
      Promise.resolve(resolve({ data: null, error: null })),
  };
  return builder;
}

const roles = vi.hoisted(() => ({
  current: ["finance"] as Role[],
  denied: [] as string[],
}));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles.current, roles.denied),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    from,
    rpc: async (fn: string, args: { p_invoice_id: string }) =>
      fn === "invoice_open_amount"
        ? { data: h.openAmount[args.p_invoice_id] ?? null, error: null }
        : { data: null, error: { message: `unexpected rpc ${fn}` } },
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn(async () => undefined) },
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { issueFiscalInvoiceAction } = await import("./invoices-actions");
const { inngest } = await import("@/lib/inngest/client");

const CLIENT = "33333333-3333-4333-8333-333333333333";
const ORIGIN = "44444444-4444-4444-8444-444444444444";

function noteInput(): CreateComprobanteInput {
  const today = todayInAR();
  return {
    channel_id: "jouve_fiscal",
    client_id: CLIENT,
    kind: "nc",
    letter: "A",
    punto_venta: 3,
    fecha: today,
    fch_serv_desde: today,
    fch_serv_hasta: today,
    fch_vto_pago: today,
    concepto: CONCEPTO.SERVICIOS,
    doc_tipo: 80,
    doc_nro: "30712345678",
    // The client is RI today; the origin was issued while it was CF.
    iva_condition_receptor: CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO,
    moneda: "PES",
    cotizacion: 1,
    motivo_nc_nd: "Devolución",
    invoice_origin_id: ORIGIN,
    items: [
      {
        description: "Flete",
        quantity: 1,
        unit_price: 100,
        iva_rate_id: IVA_RATE.TWENTY_ONE,
      },
    ],
  };
}

beforeEach(() => {
  h.inserts.length = 0;
  h.deletes.length = 0;
  h.db.invoicing_channels = [
    { id: "jouve_fiscal", is_fiscal: true, is_active: true },
  ];
  h.db.clients = [
    {
      id: CLIENT,
      is_active: true,
      iva_condition: "responsable_inscripto",
      is_fiscal: true,
    },
  ];
  h.db.sales_points = [
    { numero: 3, channel_id: "jouve_fiscal", is_enabled: true },
  ];
  h.db.invoices = [
    {
      id: ORIGIN,
      client_id: CLIENT,
      channel_id: "jouve_fiscal",
      status: "emitted",
      numero: 10,
      kind: "factura",
      letter: "B",
      moneda: "PES",
      iva_condition_receptor: CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL,
    },
  ];
  for (const id of Object.keys(h.openAmount)) delete h.openAmount[id];
  h.openAmount[ORIGIN] = 1_000_000;
  roles.current = ["finance"];
  roles.denied = [];
});

describe("issueFiscalInvoiceAction for a credit note", () => {
  it("refuses a credit note over the origin's open amount", async () => {
    h.openAmount[ORIGIN] = 50;
    const res = await issueFiscalInvoiceAction(noteInput());
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/supera el saldo abierto/);
    expect(h.inserts).toEqual([]);
  });

  it("refuses a credit note when the origin owes nothing", async () => {
    delete h.openAmount[ORIGIN];
    const res = await issueFiscalInvoiceAction(noteInput());
    expect(res.ok).toBe(false);
    expect(h.inserts).toEqual([]);
  });

  it("requires credit_debit_notes:issue for a note", async () => {
    roles.denied = ["credit_debit_notes:issue"];
    const res = await issueFiscalInvoiceAction(noteInput());
    expect(res.ok).toBe(false);
    expect(h.inserts).toEqual([]);
  });

  it("takes the origin's letter and receptor condition", async () => {
    const res = await issueFiscalInvoiceAction(noteInput());

    expect(res.ok).toBe(true);
    const draft = h.inserts.find((i) => i.table === "invoices")?.values;
    expect(draft).toMatchObject({
      letter: "B",
      cbte_tipo_afip: 8,
      iva_condition_receptor: CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL,
    });
  });

  it.each([
    ["  Pedido por el cliente  ", "Pedido por el cliente"],
    ["   ", null],
    [undefined, null],
  ])("stores the observaciones %j as %j", async (notes, stored) => {
    const res = await issueFiscalInvoiceAction({ ...noteInput(), notes });
    expect(res.ok).toBe(true);
    const draft = h.inserts.find((i) => i.table === "invoices")?.values;
    expect(draft).toMatchObject({ notes: stored });
  });

  it("refuses observaciones over 1000 characters", async () => {
    const res = await issueFiscalInvoiceAction({
      ...noteInput(),
      notes: "x".repeat(1001),
    });
    expect(!res.ok && res.error).toBe(
      "Las observaciones admiten hasta 1000 caracteres.",
    );
    expect(h.inserts).toEqual([]);
  });

  it("rejects a credit note over another credit note", async () => {
    const origin = h.db.invoices?.[0];
    if (origin) origin.kind = "nc";
    const res = await issueFiscalInvoiceAction(noteInput());
    expect(res.ok).toBe(false);
    expect(h.inserts).toEqual([]);
  });
});

describe("issueFiscalInvoiceAction on an internal channel", () => {
  it("stores items without IVA so they add up to the header total", async () => {
    h.db.invoicing_channels = [
      { id: "jouve_interno", is_fiscal: false, is_active: true },
    ];
    h.db.sales_points = [
      { numero: 4, channel_id: "jouve_interno", is_enabled: true },
    ];
    // An Otras ventas client: no IVA condition, on the internal side.
    h.db.clients = [
      { id: CLIENT, is_active: true, iva_condition: null, is_fiscal: false },
    ];
    const res = await issueFiscalInvoiceAction({
      ...noteInput(),
      channel_id: "jouve_interno",
      punto_venta: 4,
      kind: "factura",
      invoice_origin_id: null,
    });

    expect(res.ok).toBe(true);
    expect(h.inserts.find((i) => i.table === "invoices")?.values).toMatchObject(
      {
        letter: null,
        iva_condition_receptor: null,
        imp_iva: 0,
        imp_total: 100,
      },
    );
    expect(h.inserts.find((i) => i.table === "invoice_items")?.values).toEqual([
      expect.objectContaining({ line_iva: 0, line_total: 100 }),
    ]);
  });
});

describe("issueFiscalInvoiceAction dating", () => {
  it("refuses a date earlier than the last voucher of the same type", async () => {
    h.db.invoices = [
      {
        id: "prev",
        channel_id: "jouve_fiscal",
        punto_venta: 3,
        kind: "factura",
        letter: "A",
        numero: 20,
        fecha: "2999-01-01",
      },
    ];
    const res = await issueFiscalInvoiceAction({
      ...noteInput(),
      kind: "factura",
      invoice_origin_id: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/último comprobante/);
    expect(h.inserts).toEqual([]);
  });
});

describe("issueFiscalInvoiceAction for a note on a USD invoice", () => {
  function usdOrigin() {
    const origin = h.db.invoices?.[0];
    if (origin) {
      origin.moneda = "DOL";
      origin.cotizacion = "1000.0000";
    }
  }

  it("issues the note in dollars at the origin's cotización by default", async () => {
    usdOrigin();
    const res = await issueFiscalInvoiceAction(noteInput());
    expect(res.ok).toBe(true);
    expect(h.inserts.find((i) => i.table === "invoices")?.values).toMatchObject(
      {
        moneda: "DOL",
        cotizacion: 1000,
      },
    );
  });

  it("takes the cotización of the day when the caller gives one", async () => {
    usdOrigin();
    const res = await issueFiscalInvoiceAction({
      ...noteInput(),
      moneda: "DOL",
      cotizacion: 1050.5,
    });
    expect(res.ok).toBe(true);
    expect(h.inserts.find((i) => i.table === "invoices")?.values).toMatchObject(
      {
        moneda: "DOL",
        cotizacion: 1050.5,
      },
    );
  });
});

describe("issueFiscalInvoiceAction with an idempotency key", () => {
  const KEY = "55555555-5555-4555-8555-555555555555";

  it("returns the draft a previous submit with the same key created", async () => {
    h.db.invoices = [
      ...(h.db.invoices ?? []),
      {
        id: "first-draft",
        idempotency_key: KEY,
        created_by: "u1",
        status: "emitting",
      },
    ];
    const res = await issueFiscalInvoiceAction({
      ...noteInput(),
      idempotency_key: KEY,
    });
    expect(res).toEqual({
      ok: true,
      data: { id: "first-draft", idempotency_key: KEY, status: "emitting" },
    });
    expect(h.inserts).toEqual([]);
  });

  it("sends a draft the first submit never enqueued again, with the same key", async () => {
    h.db.invoices = [
      ...(h.db.invoices ?? []),
      {
        id: "unsent-draft",
        idempotency_key: KEY,
        created_by: "u1",
        status: "draft",
        channel_id: "jouve_fiscal",
        punto_venta: 3,
      },
    ];
    const send = vi.mocked(inngest.send);
    send.mockClear();
    const res = await issueFiscalInvoiceAction({
      ...noteInput(),
      idempotency_key: KEY,
    });
    expect(res).toEqual({
      ok: true,
      data: { id: "unsent-draft", idempotency_key: KEY, status: "draft" },
    });
    expect(send).toHaveBeenCalledWith({
      name: "invoice/issue.requested",
      data: {
        invoice_id: "unsent-draft",
        idempotency_key: KEY,
        channel_id: "jouve_fiscal",
        punto_venta: 3,
      },
    });
    expect(h.inserts).toEqual([]);
  });

  it("keeps the draft when the send fails: Inngest may have taken it", async () => {
    const send = vi.mocked(inngest.send);
    send.mockClear();
    send.mockRejectedValueOnce(new Error("timeout"));
    const res = await issueFiscalInvoiceAction({
      ...noteInput(),
      idempotency_key: KEY,
    });
    expect(res).toEqual({
      ok: true,
      data: { id: "new-invoice", idempotency_key: KEY, status: "draft" },
    });
    expect(h.deletes).toEqual([]);
  });

  it("stores the caller's key on a first submit", async () => {
    const res = await issueFiscalInvoiceAction({
      ...noteInput(),
      idempotency_key: KEY,
    });
    expect(res.ok).toBe(true);
    const draft = h.inserts.find((i) => i.table === "invoices")?.values;
    expect(draft).toMatchObject({ idempotency_key: KEY });
  });
});

// billRemitoAction refuses a remito with a prior NC or recibos it cannot move
// (cheques, retentions, other docs, USD). source_remito_id is also a field of
// the public CreateComprobanteSchema, so issueFiscalInvoiceAction — a server
// action of its own — must not let a caller link a remito past those checks:
// once the factura is emitted, credit-billed-remito moves the remito's
// recibos and credits it in full.
// Billing a remito: the refusals (prior NC, ajuste de saldo, recibos that
// cannot move) are the DB's — guard_invoice_source_remito runs
// billed_remito_blocker on the draft insert, whoever drafts it. Pinned in
// supabase/tests/otras_ventas_sides_test.sql.

describe("issueFiscalInvoiceAction across sides", () => {
  it("refuses an Otras ventas client on a Ventas channel before writing", async () => {
    h.db.clients = [
      { id: CLIENT, is_active: true, iva_condition: null, is_fiscal: false },
    ];
    const res = await issueFiscalInvoiceAction({
      ...noteInput(),
      kind: "factura",
      invoice_origin_id: null,
    });
    expect(res).toEqual({
      ok: false,
      error: "Un comprobante de Ventas necesita un cliente de Ventas.",
    });
    expect(h.inserts).toHaveLength(0);
  });
});
