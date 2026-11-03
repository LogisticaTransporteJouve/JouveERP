import { NonRetriableError } from "inngest";
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
  const caea: { active: boolean } = { active: true };
  const failReads = new Set<string>();
  const sent: Array<{ id: string; events: unknown }> = [];
  const beforeUpdate = null as
    ((table: string, patch: Record<string, unknown>) => void) | null;
  return {
    handlers,
    onFailures,
    db,
    rpcCalls,
    updates,
    caeaDates,
    informed,
    caea,
    failReads,
    sent,
    beforeUpdate,
  };
});

function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let head = false;
  const rows = () =>
    (h.db[table] ?? []).filter((r) => filters.every((f) => f(r)));
  const builder = {
    select: (_cols?: string, opts?: { head?: boolean }) => {
      head = opts?.head ?? false;
      return builder;
    },
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
    neq: (col: string, v: unknown) => {
      filters.push((r) => r[col] !== v);
      return builder;
    },
    or: () => builder,
    lt: () => builder,
    gt: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (
      resolve: (v: {
        data: Row[] | null;
        count?: number;
        error: { message: string } | null;
      }) => unknown,
    ) => {
      if (h.failReads.has(table) && !patch) {
        return Promise.resolve(
          resolve({ data: null, error: { message: `${table} down` } }),
        );
      }
      if (patch) h.beforeUpdate?.(table, patch);
      const hit = rows();
      if (patch) {
        h.updates.push({ table, patch });
        for (const r of hit) Object.assign(r, patch);
      }
      if (head) {
        return Promise.resolve(
          resolve({ data: null, count: hit.length, error: null }),
        );
      }
      return Promise.resolve(resolve({ data: hit, error: null }));
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
    return h.caea.active
      ? { caea: "12345678901234", fch_vig_hasta: "2026-10-31" }
      : null;
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
vi.mock("@/lib/observability", () => ({ captureException: vi.fn() }));

await import("./issue-invoice");
const { getVoucherInfo, requestCAE, informCaeaNoMovement } =
  await import("@/lib/afip/wsfev1");
await import("./caea-inform");
await import("./issue-invoice-reconcile");

const step = {
  run: async (_id: string, fn: () => Promise<unknown>) => fn(),
  sendEvent: async (id: string, events: unknown) => {
    h.sent.push({ id, events });
  },
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
    source_remito_id: null,
    afip_attempted_numero: null,
    channel: { id: "jouve_fiscal", is_fiscal: true, name: "Jouve fiscal" },
    ...overrides,
  };
}

beforeEach(() => {
  for (const key of Object.keys(h.db)) delete h.db[key];
  h.rpcCalls.length = 0;
  h.updates.length = 0;
  h.caeaDates.length = 0;
  h.caea.active = true;
  h.informed.length = 0;
  h.failReads.clear();
  h.sent.length = 0;
  h.beforeUpdate = null;
  vi.mocked(requestCAE).mockReset();
  vi.mocked(getVoucherInfo).mockReset();
  vi.mocked(informCaeaNoMovement).mockReset();
});

const issue = (data: Row = {}) =>
  h.handlers.get("issue-invoice")?.({
    event: {
      data: {
        invoice_id: INVOICE_ID,
        idempotency_key: "k1",
        punto_venta: 9,
        ...data,
      },
    },
    step,
  });

function seedDraft(overrides: Row = {}, emissionType = "CAE") {
  h.db.invoices = [draft(overrides)];
  h.db.invoice_items = [
    { invoice_id: INVOICE_ID, iva_rate_id: 5, line_neto: 100, line_iva: 21 },
  ];
  h.db.sales_points = [{ numero: 9, last_known_emission_type: emissionType }];
}

const CAE_6 = {
  ptoVta: 9,
  cbteTipo: 1,
  cbteNro: 6,
  cae: "75000000000006",
  caeFchVto: "20261024",
  observaciones: [],
  fchProceso: null,
};

describe("issue-invoice load-draft", () => {
  it("does nothing for an invoice another run already emitted", async () => {
    seedDraft({ status: "emitted", numero: 6 });
    await expect(issue()).resolves.toEqual({ skipped: "already_emitted" });
    expect(h.updates).toEqual([]);
  });

  it("never moves an invoice emitted between its read and the flip back to emitting", async () => {
    seedDraft();
    h.beforeUpdate = (table, patch) => {
      // Another run emits it after this run read `draft`.
      if (table === "invoices" && patch.status === "emitting") {
        Object.assign(h.db.invoices![0]!, { status: "emitted", numero: 6 });
      }
    };
    await expect(issue()).resolves.toEqual({ skipped: "already_emitted" });
    expect(h.db.invoices?.[0]?.status).toBe("emitted");
    expect(requestCAE).not.toHaveBeenCalled();
  });

  it("waits for the items of a draft a resubmit sent while the first submit was still saving them", async () => {
    seedDraft();
    h.db.invoice_items = [];
    const run = issue();
    await expect(run).rejects.toThrow("no tiene ítems");
    await expect(run).rejects.not.toBeInstanceOf(NonRetriableError);
    expect(h.db.invoices?.[0]?.status).toBe("draft");
    expect(requestCAE).not.toHaveBeenCalled();
  });
});

describe("issue-invoice CAE branch", () => {
  it("requests no CAE once the invoice is no longer emitting", async () => {
    seedDraft();
    h.beforeUpdate = (table, patch) => {
      // issue-invoice-reconcile failed it while this run waited for a retry.
      if (table === "invoices" && "afip_attempted_numero" in patch) {
        h.db.invoices![0]!.status = "failed";
      }
    };
    await expect(issue()).rejects.toBeInstanceOf(NonRetriableError);
    expect(requestCAE).not.toHaveBeenCalled();
  });

  it("does not report success for a CAE no row can hold", async () => {
    seedDraft();
    vi.mocked(requestCAE).mockResolvedValueOnce(CAE_6);
    h.beforeUpdate = (table, patch) => {
      // The draft was deleted while FECAESolicitar was in flight.
      if (table === "invoices" && "cae" in patch) h.db.invoices = [];
    };
    await expect(issue()).rejects.toBeInstanceOf(NonRetriableError);
  });

  it("stores the CAE AFIP authorized", async () => {
    seedDraft();
    vi.mocked(requestCAE).mockResolvedValueOnce(CAE_6);
    await expect(issue()).resolves.toMatchObject({ cbteNro: 6 });
    expect(h.db.invoices?.[0]).toMatchObject({
      status: "emitted",
      numero: 6,
      cae: "75000000000006",
      afip_attempted_numero: 6,
    });
  });
});

describe("issue-invoice internal branch", () => {
  it("does not re-emit an internal voucher another run emitted", async () => {
    seedDraft({
      channel_id: "jouve_internal",
      cbte_tipo_afip: null,
      channel: { id: "jouve_internal", is_fiscal: false, name: "Interno" },
    });
    h.beforeUpdate = (table, patch) => {
      if (table === "invoices" && patch.status === "emitted") {
        Object.assign(h.db.invoices![0]!, {
          status: "emitted",
          emitted_at: "earlier",
        });
      }
    };
    await issue();
    expect(h.db.invoices?.[0]?.emitted_at).toBe("earlier");
  });
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

describe("issue-invoice CAEA branch without a CAEA", () => {
  it("fails without retries: the same voucher date finds no CAEA again", async () => {
    h.caea.active = false;
    h.db.invoices = [draft()];
    h.db.invoice_items = [
      { invoice_id: INVOICE_ID, iva_rate_id: 5, line_neto: 100, line_iva: 21 },
    ];
    h.db.sales_points = [{ numero: 9, last_known_emission_type: "CAEA" }];

    const handler = h.handlers.get("issue-invoice");
    await expect(
      handler?.({
        event: {
          data: {
            invoice_id: INVOICE_ID,
            idempotency_key: "k1",
            punto_venta: 9,
          },
        },
        step,
      }),
    ).rejects.toBeInstanceOf(NonRetriableError);
    expect(h.rpcCalls).toEqual([]);
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
  const onFailure = (error: Error) =>
    h.onFailures.get("issue-invoice")?.({
      event: {
        data: {
          event: {
            data: { invoice_id: INVOICE_ID, idempotency_key: "k1" },
          },
        },
      },
      error,
      step,
    });

  const failure = (status: string, overrides: Row = {}) => {
    h.db.invoices = [draft({ status, ...overrides })];
    return onFailure(new Error("persist-cae: db down"));
  };

  it("never turns an emitted voucher into a failed one", async () => {
    await failure("emitted");
    expect(h.db.invoices?.[0]?.status).toBe("emitted");
    expect(h.sent).toEqual([]);
  });

  it("settles the remito of a factura emitted before its run failed", async () => {
    await failure("emitted", { source_remito_id: "r1" });
    expect(h.sent).toEqual([
      {
        id: "remito-billed",
        events: {
          name: "invoice/remito.billed",
          data: { factura_id: INVOICE_ID },
        },
      },
    ]);
  });

  it("fails a pending emission", async () => {
    await failure("emitting");
    expect(h.db.invoices?.[0]?.status).toBe("failed");
  });

  const minutesAgo = (minutes: number) =>
    new Date(Date.now() - minutes * 60_000).toISOString();

  const failureWithAttempt = (
    error: Error = new Error("persist-cae: db down"),
    overrides: Row = {},
  ) => {
    h.db.invoices = [
      draft({
        status: "emitting",
        afip_attempted_numero: 6,
        updated_at: minutesAgo(1),
        ...overrides,
      }),
    ];
    return onFailure(error);
  };

  const voucher6 = {
    ptoVta: 9,
    cbteTipo: 1,
    cbteNro: 6,
    cae: "75000000000006",
    caeFchVto: "20261024",
    impTotal: 121,
    cbteFch: "20261014",
    docTipo: 80,
    docNro: "30712345678",
  };

  it("keeps the CAE AFIP authorized for this invoice", async () => {
    vi.mocked(getVoucherInfo).mockResolvedValueOnce(voucher6 as never);
    await failureWithAttempt();
    expect(h.db.invoices?.[0]).toMatchObject({
      status: "emitted",
      numero: 6,
      cae: "75000000000006",
    });
  });

  it("settles the remito of a recovered factura in its own step", async () => {
    vi.mocked(getVoucherInfo).mockResolvedValueOnce(voucher6 as never);
    await failureWithAttempt(undefined, { source_remito_id: "r1" });
    expect(h.sent.map((s) => s.id)).toEqual(["remito-billed"]);
  });

  it("leaves a recent attempt to the reconcile: AFIP may still be processing a timed-out request", async () => {
    vi.mocked(getVoucherInfo).mockResolvedValueOnce(null);
    await failureWithAttempt(new Error("AFIP no respondió en 20 s"));
    expect(h.db.invoices?.[0]?.status).toBe("emitting");
  });

  it("fails a recent attempt AFIP rejected", async () => {
    vi.mocked(getVoucherInfo).mockResolvedValueOnce(null);
    await failureWithAttempt(new NonRetriableError("10015: receptor inválido"));
    expect(h.db.invoices?.[0]?.status).toBe("failed");
  });

  it("fails it when AFIP has no voucher at a number sent long ago", async () => {
    vi.mocked(getVoucherInfo).mockResolvedValueOnce(null);
    await failureWithAttempt(undefined, { updated_at: minutesAgo(31) });
    expect(h.db.invoices?.[0]?.status).toBe("failed");
  });

  it("leaves it emitting when AFIP does not answer", async () => {
    vi.mocked(getVoucherInfo).mockRejectedValueOnce(new Error("timeout"));
    await failureWithAttempt(undefined, { updated_at: minutesAgo(31) });
    expect(h.db.invoices?.[0]?.status).toBe("emitting");
  });
});

describe("caea-inform sin movimiento", () => {
  const expiredCaea = {
    id: "code-1",
    caea: "12345678901234",
    no_movement_pvs: [],
  };

  it("declares only the CAEA points of sale that issued nothing under it", async () => {
    h.db.invoices = [
      draft({
        numero: 4,
        status: "emitted",
        cae: "12345678901234",
        emission_type: "caea",
        caea_informed_at: "2026-10-15T00:00:00Z",
      }),
    ];
    h.db.caea_codes = [expiredCaea];
    h.db.sales_points = [
      { numero: 9, last_known_emission_type: "CAEA", is_enabled: true },
      { numero: 10, last_known_emission_type: "CAEA", is_enabled: true },
    ];
    await h.handlers.get("caea-inform")?.({ step });
    expect(vi.mocked(informCaeaNoMovement).mock.calls).toEqual([
      [10, "12345678901234"],
    ]);
  });

  it("files nothing with AFIP when the usage read fails", async () => {
    h.db.invoices = [];
    h.db.caea_codes = [expiredCaea];
    h.db.sales_points = [
      { numero: 9, last_known_emission_type: "CAEA", is_enabled: true },
    ];
    // load-pending reads invoices first; fail the invoices reads after it.
    const failingStep = {
      ...step,
      run: async (id: string, fn: () => Promise<unknown>) => {
        if (id === "inform-no-movement") h.failReads.add("invoices");
        return fn();
      },
    };
    await expect(
      h.handlers.get("caea-inform")?.({ step: failingStep }),
    ).rejects.toThrow("load-caea-usage");
    expect(informCaeaNoMovement).not.toHaveBeenCalled();
  });
});

describe("issue-invoice-reconcile", () => {
  const reconcile = () => h.handlers.get("issue-invoice-reconcile")?.({ step });

  const voucher6 = {
    ptoVta: 9,
    cbteTipo: 1,
    cbteNro: 6,
    cae: "75000000000006",
    caeFchVto: "20261024",
    impTotal: 121,
    cbteFch: "20261014",
    docTipo: 80,
    docNro: "30712345678",
  };

  const stuck = (overrides: Row = {}) => {
    h.db.invoices = [
      draft({
        status: "emitting",
        afip_attempted_numero: 6,
        updated_at: "2026-11-03T10:00:00Z",
        ...overrides,
      }),
    ];
    h.db.invoice_items = [];
  };

  it("emits a stuck invoice with the CAE AFIP holds for it", async () => {
    stuck();
    vi.mocked(getVoucherInfo).mockResolvedValueOnce(voucher6 as never);
    await reconcile();
    expect(h.db.invoices?.[0]).toMatchObject({ status: "emitted", numero: 6 });
    expect(h.sent).toEqual([]);
  });

  it("settles the remito of a recovered factura in a step of its own", async () => {
    stuck({ source_remito_id: "r1" });
    vi.mocked(getVoucherInfo).mockResolvedValueOnce(voucher6 as never);
    await reconcile();
    expect(h.sent).toEqual([
      {
        id: `remito-billed-${INVOICE_ID}`,
        events: {
          name: "invoice/remito.billed",
          data: { factura_id: INVOICE_ID },
        },
      },
    ]);
  });

  it("fails a stuck invoice AFIP has no voucher of, which frees its claims", async () => {
    stuck();
    vi.mocked(getVoucherInfo).mockResolvedValueOnce(null);
    await reconcile();
    expect(h.db.invoices?.[0]?.status).toBe("failed");
  });

  it("adopts its CAE although another stuck invoice attempted the same number", async () => {
    stuck();
    h.db.invoices?.push(
      draft({
        id: "33333333-3333-4333-8333-333333333333",
        status: "emitting",
        afip_attempted_numero: 6,
        imp_total: 999,
        updated_at: "2026-11-03T10:00:00Z",
      }),
    );
    vi.mocked(getVoucherInfo).mockResolvedValue(voucher6 as never);
    await reconcile();
    expect(h.db.invoices?.[0]).toMatchObject({ status: "emitted", numero: 6 });
    // The voucher at 6 is not the other one's: it is resolved as failed.
    expect(h.db.invoices?.[1]?.status).toBe("failed");
  });

  it("leaves it emitting while AFIP does not answer", async () => {
    stuck();
    vi.mocked(getVoucherInfo).mockRejectedValueOnce(new Error("timeout"));
    await reconcile();
    expect(h.db.invoices?.[0]?.status).toBe("emitting");
  });

  it("keeps a row a run touched after the read", async () => {
    stuck();
    vi.mocked(getVoucherInfo).mockResolvedValueOnce(null);
    h.beforeUpdate = (table, patch) => {
      const row = h.db.invoices?.[0];
      if (table === "invoices" && patch.status === "failed" && row) {
        row.updated_at = "2026-11-03T10:40:00Z";
      }
    };
    await reconcile();
    expect(h.db.invoices?.[0]?.status).toBe("emitting");
  });

  it("sends a draft with items that never reached Inngest again, with its own key", async () => {
    h.db.invoices = [
      draft({ idempotency_key: "k-draft" }),
      draft({ id: "no-items", idempotency_key: "k-empty" }),
    ];
    h.db.invoice_items = [
      { invoice_id: INVOICE_ID, iva_rate_id: 5, line_neto: 100, line_iva: 21 },
    ];
    await reconcile();
    expect(h.sent).toEqual([
      {
        id: "resend-unsent",
        events: [
          {
            name: "invoice/issue.requested",
            data: {
              invoice_id: INVOICE_ID,
              idempotency_key: "k-draft",
              channel_id: "jouve_fiscal",
              punto_venta: 9,
            },
          },
        ],
      },
    ]);
  });
});
