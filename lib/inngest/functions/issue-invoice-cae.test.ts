import { describe, expect, it, vi } from "vitest";

import { NonRetriableError } from "inngest";

import { AfipServiceError, AfipTransportError } from "@/lib/afip/errors";
import type {
  InvoiceCAEResult,
  InvoiceRequestInput,
  VoucherInfo,
} from "@/lib/afip/wsfev1";

import {
  reserveNumberAndRequestCae,
  voucherMatches,
  type AfipCaePort,
  type AttemptStore,
  type VoucherIdentity,
} from "./issue-invoice-cae";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const PV = 3;
const TIPO = 6;

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** In-memory AFIP for one (pv, tipo): only last + 1 is accepted. */
function fakeAfip(opts: { last?: number } = {}) {
  const vouchers = new Map<number, VoucherInfo>();
  const lastStart = opts.last ?? 0;
  let loseNextResponse = false;
  const last = () => Math.max(lastStart, ...vouchers.keys());

  const register = (input: InvoiceRequestInput): VoucherInfo => {
    const info: VoucherInfo = {
      ptoVta: input.ptoVta,
      cbteTipo: input.cbteTipo,
      cbteNro: input.cbteNro,
      cbteFch: input.fecha.replace(/-/g, ""),
      concepto: input.concepto,
      impTotal: input.impTotal,
      impNeto: input.impNeto,
      impIva: input.impIva,
      impTrib: input.impTrib,
      impOpEx: input.impOpEx,
      impTotConc: input.impTotConc,
      monId: input.monId,
      monCotiz: input.monCotiz,
      fchServDesde: null,
      fchServHasta: null,
      fchVtoPago: null,
      condicionIvaReceptorId: input.condicionIvaReceptorId,
      docTipo: input.docTipo,
      docNro: input.docNro,
      cae: `CAE${input.cbteNro}`,
      caeFchVto: "20260530",
      emisionTipo: "CAE",
      cbtesAsoc: [],
    };
    vouchers.set(input.cbteNro, info);
    return info;
  };

  const port: AfipCaePort = {
    getLastAuthorizedNumber: vi.fn(async () => {
      await tick();
      return last();
    }),
    requestCAE: vi.fn(async (input: InvoiceRequestInput) => {
      await tick();
      if (input.cbteNro !== last() + 1) {
        throw new AfipServiceError([
          { code: 10016, message: "El numero no es el proximo a autorizar" },
        ]);
      }
      const info = register(input);
      if (loseNextResponse) {
        loseNextResponse = false;
        throw new AfipTransportError("socket hang up");
      }
      const result: InvoiceCAEResult = {
        ptoVta: info.ptoVta,
        cbteTipo: info.cbteTipo,
        cbteNro: info.cbteNro,
        cae: info.cae ?? "",
        caeFchVto: info.caeFchVto ?? "",
        observaciones: [],
        fchProceso: null,
      };
      return result;
    }),
    getVoucherInfo: vi.fn(async (_pv: number, _tipo: number, nro: number) => {
      await tick();
      return vouchers.get(nro) ?? null;
    }),
  };

  return {
    port,
    vouchers,
    seed: (input: InvoiceRequestInput) => register(input),
    loseNextResponse: () => {
      loseNextResponse = true;
    },
  };
}

/** invoices.afip_attempted_numero for several invoices sharing a (pv, tipo). */
function fakeAttempts() {
  const attempted = new Map<string, number>();
  const failed = new Set<string>();
  const storeFor = (invoiceId: string): AttemptStore => ({
    read: async () => attempted.get(invoiceId) ?? null,
    record: async (n) => {
      attempted.set(invoiceId, n);
    },
    takenByOther: async (n) =>
      [...attempted].some(
        ([id, value]) => id !== invoiceId && value === n && !failed.has(id),
      ),
  });
  return { attempted, failed, storeFor };
}

/** Inngest concurrency limit 1 on a key: one STEP at a time across runs. */
function stepMutex() {
  let chain: Promise<unknown> = Promise.resolve();
  return function step<T>(body: () => Promise<T>): Promise<T> {
    const run = chain.then(body, body);
    chain = run.catch(() => undefined);
    return run;
  };
}

function draft(
  id: string,
  overrides: Partial<VoucherIdentity> = {},
): { id: string; expected: VoucherIdentity } {
  return {
    id,
    expected: {
      impTotal: 121,
      fecha: "2026-05-17",
      docTipo: 80,
      docNro: "30714637432",
      ...overrides,
    },
  };
}

function inputFor(
  expected: VoucherIdentity,
  cbteNro: number,
): InvoiceRequestInput {
  return {
    ptoVta: PV,
    cbteTipo: 6,
    cbteNro,
    fecha: expected.fecha,
    concepto: 2,
    docTipo: 80,
    docNro: expected.docNro,
    impTotal: expected.impTotal,
    impNeto: 100,
    impIva: 21,
    impTotConc: 0,
    impOpEx: 0,
    impTrib: 0,
    monId: "PES",
    monCotiz: 1,
    condicionIvaReceptorId: 1,
    iva: [{ id: 5, baseImp: 100, importe: 21 }],
  };
}

function emit(
  afip: AfipCaePort,
  attempts: AttemptStore,
  d: { id: string; expected: VoucherIdentity },
) {
  return reserveNumberAndRequestCae({
    invoiceId: d.id,
    ptoVta: PV,
    cbteTipo: TIPO,
    expected: d.expected,
    buildInput: (n) => inputFor(d.expected, n),
    afip,
    attempts,
  });
}

describe("reserveNumberAndRequestCae", () => {
  it("records the number before asking AFIP for last + 1", async () => {
    const afip = fakeAfip({ last: 41 });
    const { attempted, storeFor } = fakeAttempts();
    const res = await emit(afip.port, storeFor("a"), draft("a"));
    expect(res.cbteNro).toBe(42);
    expect(res.cae).toBe("CAE42");
    expect(attempted.get("a")).toBe(42);
  });

  it("gives two concurrent emissions on one punto de venta consecutive numbers", async () => {
    const afip = fakeAfip({ last: 41 });
    const { storeFor } = fakeAttempts();
    const step = stepMutex();
    const [a, b] = await Promise.all([
      step(() => emit(afip.port, storeFor("a"), draft("a"))),
      step(() => emit(afip.port, storeFor("b"), draft("b", { impTotal: 50 }))),
    ]);
    expect([a.cbteNro, b.cbteNro].sort()).toEqual([42, 43]);
    expect(a.cae).not.toBe(b.cae);
  });

  it("(why one step) reading the number and requesting the CAE in separate steps collides", async () => {
    const afip = fakeAfip({ last: 41 });
    const step = stepMutex();
    const splitRun = async (d: { expected: VoucherIdentity }) => {
      const n = await step(
        async () => (await afip.port.getLastAuthorizedNumber(PV, TIPO)) + 1,
      );
      return step(() => afip.port.requestCAE(inputFor(d.expected, n)));
    };
    const results = await Promise.allSettled([
      splitRun(draft("a")),
      splitRun(draft("b")),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
  });

  it("adopts the CAE when the response is lost but AFIP registered this voucher", async () => {
    const afip = fakeAfip({ last: 41 });
    afip.loseNextResponse();
    const { storeFor } = fakeAttempts();
    const res = await emit(afip.port, storeFor("a"), draft("a"));
    expect(res).toMatchObject({ cbteNro: 42, cae: "CAE42" });
  });

  it("does not adopt a voucher with a different total", async () => {
    const afip = fakeAfip({ last: 41 });
    const { storeFor } = fakeAttempts();
    const other = draft("x", { impTotal: 999 });
    // Another voucher lands on 42 while our request's response is lost.
    afip.port.requestCAE = vi.fn(async () => {
      afip.seed(inputFor(other.expected, 42));
      throw new AfipTransportError("timeout");
    });
    await expect(emit(afip.port, storeFor("a"), draft("a"))).rejects.toThrow(
      AfipTransportError,
    );
  });

  it("does not adopt a voucher with a different date", async () => {
    const afip = fakeAfip({ last: 41 });
    const { storeFor } = fakeAttempts();
    const other = draft("x", { fecha: "2026-05-16" });
    afip.port.requestCAE = vi.fn(async () => {
      afip.seed(inputFor(other.expected, 42));
      throw new AfipTransportError("timeout");
    });
    await expect(emit(afip.port, storeFor("a"), draft("a"))).rejects.toThrow(
      AfipTransportError,
    );
  });

  it("on retry, recovers the CAE of the number it already sent instead of emitting twice", async () => {
    const afip = fakeAfip({ last: 41 });
    const { storeFor } = fakeAttempts();
    const store = storeFor("a");
    // First attempt: AFIP registers 42 but the step dies before returning.
    await store.record(42);
    afip.seed(inputFor(draft("a").expected, 42));
    // Another invoice was authorized afterwards.
    afip.seed(inputFor(draft("b", { impTotal: 50 }).expected, 43));

    const res = await emit(afip.port, store, draft("a"));
    expect(res).toMatchObject({ cbteNro: 42, cae: "CAE42" });
    expect(afip.port.requestCAE).not.toHaveBeenCalled();
    expect(afip.vouchers.size).toBe(2);
  });

  it("on retry, ignores its old number when another live invoice took it", async () => {
    const afip = fakeAfip({ last: 41 });
    const { storeFor } = fakeAttempts();
    const mine = storeFor("a");
    const theirs = storeFor("b");
    // Our first attempt at 42 never reached AFIP; b then took 42 with
    // identical content.
    await mine.record(42);
    await theirs.record(42);
    afip.seed(inputFor(draft("b").expected, 42));

    const res = await emit(afip.port, mine, draft("a"));
    expect(res.cbteNro).toBe(43);
    expect(afip.port.getVoucherInfo).not.toHaveBeenCalled();
  });

  it("on retry, emits normally when its old number was never registered", async () => {
    const afip = fakeAfip({ last: 41 });
    const { storeFor } = fakeAttempts();
    const store = storeFor("a");
    await store.record(42);
    const res = await emit(afip.port, store, draft("a"));
    expect(res.cbteNro).toBe(42);
    expect(afip.port.requestCAE).toHaveBeenCalledTimes(1);
  });

  it("fails fast on deterministic AFIP rejections", async () => {
    const afip = fakeAfip({ last: 41 });
    afip.port.requestCAE = vi.fn(async () => {
      throw new AfipServiceError([{ code: 10015, message: "DocNro invalido" }]);
    });
    const { storeFor } = fakeAttempts();
    await expect(emit(afip.port, storeFor("a"), draft("a"))).rejects.toThrow(
      NonRetriableError,
    );
  });
});

describe("voucherMatches", () => {
  const info: VoucherInfo = {
    ptoVta: PV,
    cbteTipo: TIPO,
    cbteNro: 42,
    cbteFch: "20260517",
    concepto: 2,
    impTotal: 121.004,
    impNeto: 100,
    impIva: 21,
    impTrib: 0,
    impOpEx: 0,
    impTotConc: 0,
    monId: "PES",
    monCotiz: 1,
    fchServDesde: null,
    fchServHasta: null,
    fchVtoPago: null,
    condicionIvaReceptorId: 1,
    docTipo: 80,
    docNro: "030714637432",
    cae: "CAE42",
    caeFchVto: "20260530",
    emisionTipo: "CAE",
    cbtesAsoc: [],
  };
  const expected = draft("a").expected;

  it("matches on total (2 decimals), date and receptor", () => {
    expect(voucherMatches(info, expected)).toBe(true);
  });

  it("rejects a different receptor", () => {
    expect(voucherMatches(info, { ...expected, docNro: "20111111112" })).toBe(
      false,
    );
    expect(voucherMatches(info, { ...expected, docTipo: 96 })).toBe(false);
  });

  it("tolerates AFIP omitting the receptor fields", () => {
    expect(
      voucherMatches({ ...info, docTipo: null, docNro: null }, expected),
    ).toBe(true);
  });
});
