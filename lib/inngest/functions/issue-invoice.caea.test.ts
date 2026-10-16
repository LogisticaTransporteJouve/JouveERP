import { beforeEach, describe, expect, it, vi } from "vitest";

// Runs the issue-invoice and caea-inform handlers against an in-memory
// database and AFIP, with step.run executing its callback inline.

type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  const handlers = new Map<string, (ctx: unknown) => Promise<unknown>>();
  const onFailures = new Map<string, (ctx: unknown) => Promise<unknown>>();
  const db: Record<string, Array<Record<string, unknown>>> = {};
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const caeaDates: string[] = [];
  const informed: Array<Record<string, unknown>> = [];
  return { handlers, onFailures, db, rpcCalls, updates, caeaDates, informed };
});

function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  const rows = () =>
    (h.db[table] ?? []).filter((r) => filters.every((f) => f(r)));
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
    in: (col: string, vs: unknown[]) => {
      filters.push((r) => vs.includes(r[col]));
      return builder;
    },
    is: (col: string, v: unknown) => {
      filters.push((r) => (r[col] ?? null) === v);
      return builder;
    },
    not: (col: string, _op: string, v: unknown) => {
      filters.push((r) => (r[col] ?? null) !== v);
      return builder;
    },
    lt: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[] | null; error: null }) => unknown) => {
      const hit = rows();
      if (patch) {
        h.updates.push({ table, patch });
        for (const r of hit) Object.assign(r, patch);
      }
      return Promise.resolve(
        resolve({ data: patch ? null : hit, error: null }),
      );
    },
  };
  return builder;
}

vi.mock("../client", () => ({
  inngest: {
    createFunction: (
      config: { id: string; onFailure?: (ctx: unknown) => Promise<unknown> },
      handler: (ctx: unknown) => Promise<unknown>,
    ) => {
      h.handlers.set(config.id, handler);
      if (config.onFailure) h.onFailures.set(config.id, config.onFailure);
      return config;
    },
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    from,
    rpc: async (fn: string, args: Row) => {
      h.rpcCalls.push({ fn, args });
      return { data: 8, error: null };
    },
  }),
}));
vi.mock("@/lib/afip/caea", () => ({
  getActiveCaeaForDate: async (date: string) => {
    h.caeaDates.push(date);
    return { caea: "12345678901234", fch_vig_hasta: "2026-10-31" };
  },
}));
vi.mock("@/lib/afip/wsfev1", () => ({
  getLastAuthorizedNumber: async () => 5,
  getVoucherInfo: vi.fn(),
  requestCAE: vi.fn(),
  informCaeaVoucher: async (input: Row) => {
    h.informed.push(input);
  },
  informCaeaNoMovement: vi.fn(),
  CAEA_NO_MOVEMENT_ALREADY_INFORMED: new Set<number>(),
}));
vi.mock("@/lib/pdf/generate-and-hash", () => ({
  generateAndPersistInvoicePdfHash: async () => ({ pdfHash: "x" }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

await import("./issue-invoice");
await import("./caea-inform");

const step = {
  run: async (_id: string, fn: () => Promise<unknown>) => fn(),
};

const INVOICE_ID = "11111111-1111-4111-8111-111111111111";
const ORIGIN_ID = "22222222-2222-4222-8222-222222222222";

function draft(overrides: Row = {}): Row {
  return {
    id: INVOICE_ID,
    channel_id: "jouve_fiscal",
    client_id: "c1",
    kind: "factura",
    letter: "A",
    punto_venta: 9,
    numero: null,
    cbte_tipo_afip: 1,
    fecha: "2026-10-14",
    fch_serv_desde: "2026-10-14",
    fch_serv_hasta: "2026-10-14",
    fch_vto_pago: "2026-10-14",
    concepto: 2,
    doc_tipo: 80,
    doc_nro: "30712345678",
    iva_condition_receptor: 1,
    imp_neto: 100,
    imp_iva: 21,
    imp_trib: 0,
    imp_tot_conc: 0,
    imp_op_ex: 0,
    imp_total: 121,
    moneda: "PES",
    cotizacion: 1,
    status: "draft",
    invoice_origin_id: null,
    channel: { id: "jouve_fiscal", is_fiscal: true, name: "Jouve fiscal" },
    ...overrides,
  };
}

beforeEach(() => {
  for (const key of Object.keys(h.db)) delete h.db[key];
  h.rpcCalls.length = 0;
  h.updates.length = 0;
  h.caeaDates.length = 0;
  h.informed.length = 0;
});

describe("issue-invoice CAEA branch", () => {
  it("checks the CAEA against the voucher date and emits through the locked RPC", async () => {
    h.db.invoices = [draft()];
    h.db.invoice_items = [
      { invoice_id: INVOICE_ID, iva_rate_id: 5, line_neto: 100, line_iva: 21 },
    ];
    h.db.sales_points = [{ numero: 9, last_known_emission_type: "CAEA" }];

    const handler = h.handlers.get("issue-invoice");
    const result = await handler?.({
      event: {
        data: { invoice_id: INVOICE_ID, idempotency_key: "k1", punto_venta: 9 },
      },
      step,
    });

    expect(h.caeaDates).toEqual(["2026-10-14"]);
    expect(h.rpcCalls).toEqual([
      {
        fn: "emit_caea_invoice",
        args: {
          p_invoice_id: INVOICE_ID,
          p_afip_last: 5,
          p_caea: "12345678901234",
          p_cae_vencimiento: "2026-10-31",
        },
      },
    ]);
    // Number and emission land together in the RPC; no separate write marks
    // the voucher emitted or numbered.
    expect(
      h.updates.filter(
        (u) => "numero" in u.patch || u.patch.status === "emitted",
      ),
    ).toEqual([]);
    expect(result).toEqual({ caea: "12345678901234", cbteNro: 8 });
  });
});

describe("caea-inform", () => {
  it("informs an NC with its associated voucher", async () => {
    h.db.invoices = [
      draft({
        id: ORIGIN_ID,
        numero: 4,
        status: "emitted",
        cae: "12345678901234",
        emission_type: "caea",
        caea_informed_at: "2026-10-15T00:00:00Z",
      }),
      draft({
        kind: "nc",
        cbte_tipo_afip: 3,
        numero: 5,
        status: "emitted",
        cae: "12345678901234",
        emission_type: "caea",
        caea_informed_at: null,
        cbte_fch_hs_gen: "2026-10-14T12:00:00Z",
        invoice_origin_id: ORIGIN_ID,
      }),
    ];
    h.db.invoice_items = [
      { invoice_id: INVOICE_ID, iva_rate_id: 5, line_neto: 100, line_iva: 21 },
    ];
    h.db.caea_codes = [];
    h.db.sales_points = [];

    const handler = h.handlers.get("caea-inform");
    await handler?.({ step });

    const nc = h.informed.find((i) => i.cbteTipo === 3);
    expect(nc?.cbtesAsoc).toEqual([{ tipo: 1, ptoVta: 9, nro: 4 }]);
  });
});

describe("issue-invoice onFailure", () => {
  const failure = (status: string) => {
    h.db.invoices = [draft({ status })];
    return h.onFailures.get("issue-invoice")?.({
      event: {
        data: {
          event: {
            data: { invoice_id: INVOICE_ID, idempotency_key: "k1" },
          },
        },
      },
      error: new Error("persist-cae: db down"),
    });
  };

  it("never turns an emitted voucher into a failed one", async () => {
    await failure("emitted");
    expect(h.db.invoices?.[0]?.status).toBe("emitted");
  });

  it("fails a pending emission", async () => {
    await failure("emitting");
    expect(h.db.invoices?.[0]?.status).toBe("failed");
  });
});
