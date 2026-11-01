import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CONSUMIDOR_FINAL_CUIT,
  hourlyWindow,
  reconcilePair,
  renamePlaceholderClients,
  clientIvaConditionFor,
  receiverCuit,
  syncIssuedPair,
  voucherToInvoiceInsert,
  type ArcaVoucherPort,
} from "./sync-issued";
import type { VoucherInfo } from "./wsfev1";

function voucher(over: Partial<VoucherInfo> = {}): VoucherInfo {
  return {
    ptoVta: 3,
    cbteTipo: 1,
    cbteNro: 1,
    cbteFch: "20261030",
    concepto: 2,
    impTotal: 1210,
    impNeto: 1000,
    impIva: 210,
    impTrib: 0,
    impOpEx: 0,
    impTotConc: 0,
    monId: "PES",
    monCotiz: 1,
    fchServDesde: "20261001",
    fchServHasta: "20261031",
    fchVtoPago: "20261110",
    condicionIvaReceptorId: 1,
    docTipo: 80,
    docNro: "30718543866",
    cae: "76000000000001",
    caeFchVto: "20261109",
    emisionTipo: "CAE",
    cbtesAsoc: [],
    ...over,
  };
}

type Row = Record<string, unknown>;

// Minimal PostgREST-like fake covering the chains sync-issued uses.
function fakeSupabase(tables: Record<string, Row[]>) {
  let seq = 0;
  function query(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let order: { col: string; asc: boolean } | null = null;
    let limit = Infinity;
    let offset = 0;
    let patch: Row | null = null;
    const rows = () => {
      let out = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (order) {
        const { col, asc } = order;
        out = [...out].sort(
          (a, b) => (Number(a[col]) - Number(b[col])) * (asc ? 1 : -1),
        );
      }
      return out.slice(offset, offset + limit);
    };
    const builder = {
      select: () => builder,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
      is: (c: string, v: unknown) => (
        filters.push((r) => (r[c] ?? null) === v),
        builder
      ),
      not: (c: string, _op: string, v: unknown) => (
        filters.push((r) => (r[c] ?? null) !== v),
        builder
      ),
      in: (c: string, vs: unknown[]) => (
        filters.push((r) => vs.includes(r[c])),
        builder
      ),
      order: (col: string, o?: { ascending?: boolean }) => (
        (order = { col, asc: o?.ascending ?? true }),
        builder
      ),
      limit: (n: number) => ((limit = n), builder),
      like: (c: string, pattern: string) => {
        const prefix = pattern.replace(/%$/, "");
        filters.push((r) => String(r[c] ?? "").startsWith(prefix));
        return builder;
      },
      update: (p: Row) => {
        patch = p;
        return builder;
      },
      lte: (c: string, v: number | string) => (
        filters.push((r) =>
          typeof v === "string" ? String(r[c]) <= v : Number(r[c]) <= v,
        ),
        builder
      ),
      range: (from: number, to: number) => {
        offset = from;
        limit = to - from + 1;
        return builder;
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0], error: null }),
      upsert: async (row: Row, opts: { onConflict: string }) => {
        const list = (tables[table] ??= []);
        if (list.some((r) => r[opts.onConflict] === row[opts.onConflict])) {
          return { error: null };
        }
        list.push({ id: `${table}-${++seq}`, ...row });
        return { error: null };
      },
      then: (resolve: (v: { data: Row[]; error: null }) => void) => {
        const matched = rows();
        if (patch) for (const r of matched) Object.assign(r, patch);
        resolve({ data: matched, error: null });
      },
    };
    return builder;
  }
  return { from: query } as never;
}

function fakeAfip(vouchers: VoucherInfo[]): ArcaVoucherPort {
  return {
    lookupContributor: async (cuit) => ({
      cuit,
      person_type: "JURIDICA",
      id_type: "CUIT",
      status: "ACTIVO",
      legal_name: "PALLET SIRANS S.R.L.",
      first_name: null,
      last_name: null,
      tax_condition: "responsable_inscripto",
      fiscal_address: null,
      main_activity: null,
      closing_month: null,
      registration_date: null,
      taxes: [],
    }),
    getLastAuthorizedNumber: async (pv, tipo) =>
      Math.max(
        0,
        ...vouchers
          .filter((v) => v.ptoVta === pv && v.cbteTipo === tipo)
          .map((v) => v.cbteNro),
      ),
    getVoucherInfo: async (pv, tipo, nro) =>
      vouchers.find(
        (v) => v.ptoVta === pv && v.cbteTipo === tipo && v.cbteNro === nro,
      ) ?? null,
  };
}

const target = { punto_venta: 3, channel_id: "jouve_fiscal" };

describe("voucherToInvoiceInsert", () => {
  it("maps an ARCA factura A to an emitted invoice", () => {
    const row = voucherToInvoiceInsert(voucher({ cbteNro: 6 }), {
      channelId: "jouve_fiscal",
      clientId: "c1",
      originId: null,
    });
    expect(row).toMatchObject({
      kind: "factura",
      letter: "A",
      punto_venta: 3,
      numero: 6,
      fecha: "2026-10-30",
      cbte_tipo_afip: 1,
      imp_neto: 1000,
      imp_iva: 210,
      imp_total: 1210,
      moneda: "PES",
      cae: "76000000000001",
      cae_vencimiento: "2026-11-09",
      fch_serv_desde: "2026-10-01",
      status: "emitted",
      emission_type: "cae",
      idempotency_key: "arca-sync-3-1-6",
    });
  });

  it("keeps the origin cbte tipo on NC/ND and skips unknown tipos", () => {
    const nc = voucherToInvoiceInsert(
      voucher({ cbteTipo: 3, cbtesAsoc: [{ tipo: 1, ptoVta: 3, nro: 6 }] }),
      { channelId: "jouve_fiscal", clientId: "c1", originId: "inv-6" },
    );
    expect(nc).toMatchObject({
      kind: "nc",
      cbte_tipo_origen_afip: 1,
      invoice_origin_id: "inv-6",
    });
    expect(
      voucherToInvoiceInsert(voucher({ cbteTipo: 51 }), {
        channelId: "x",
        clientId: "c1",
        originId: null,
      }),
    ).toBeNull();
  });
});

describe("receiver mapping", () => {
  it("uses the CUIT only for DocTipo 80 with 11 digits", () => {
    expect(receiverCuit(voucher())).toBe("30718543866");
    expect(receiverCuit(voucher({ docTipo: 96, docNro: "30111222" }))).toBe(
      CONSUMIDOR_FINAL_CUIT,
    );
  });

  it("derives the client IVA condition from CondicionIVAReceptorId", () => {
    expect(clientIvaConditionFor(voucher({ condicionIvaReceptorId: 6 }))).toBe(
      "monotributo",
    );
    expect(clientIvaConditionFor(voucher({ docTipo: 99, docNro: "0" }))).toBe(
      "consumidor_final",
    );
  });
});

describe("syncIssuedPair", () => {
  it("imports from the last local number up to ARCA's last, within the limit", async () => {
    const db = {
      clients: [] as Row[],
      invoices: [
        {
          id: "i1",
          punto_venta: 3,
          cbte_tipo_afip: 1,
          numero: 1,
          status: "emitted",
        },
      ] as Row[],
    };
    const afip = fakeAfip([1, 2, 3, 4].map((n) => voucher({ cbteNro: n })));

    const res = await syncIssuedPair(fakeSupabase(db), afip, target, 1, 2);

    expect(res).toMatchObject({
      imported: 2,
      last_local: 1,
      last_authorized: 4,
    });
    expect(db.invoices.map((r) => r.numero)).toEqual([1, 2, 3]);
    expect(db.clients).toEqual([
      expect.objectContaining({
        cuit: "30718543866",
        legal_name: "PALLET SIRANS S.R.L.",
      }),
    ]);
  });

  it("does not touch a pair with an emission waiting for its CAE", async () => {
    const db = {
      clients: [] as Row[],
      invoices: [
        {
          id: "i9",
          punto_venta: 3,
          cbte_tipo_afip: 1,
          numero: null,
          status: "emitting",
        },
      ] as Row[],
    };
    const afip = fakeAfip([voucher({ cbteNro: 1 })]);

    const res = await syncIssuedPair(fakeSupabase(db), afip, target, 1, 10);

    expect(res.imported).toBe(0);
    expect(res.stopped).toMatch(/emisión en curso/);
    expect(db.invoices).toHaveLength(1);
  });

  it("links an NC to its imported origin and stores one without origin unlinked", async () => {
    const db = {
      clients: [
        { id: "c1", cuit: "30718543866", legal_name: "PALLET SIRANS S.R.L." },
      ] as Row[],
      invoices: [
        {
          id: "inv-6",
          punto_venta: 3,
          cbte_tipo_afip: 1,
          numero: 6,
          status: "emitted",
          client_id: "c1",
        },
      ] as Row[],
    };
    const afip = fakeAfip([
      voucher({
        cbteTipo: 3,
        cbteNro: 1,
        cbtesAsoc: [{ tipo: 1, ptoVta: 3, nro: 6 }],
      }),
      voucher({
        cbteTipo: 3,
        cbteNro: 2,
        cbtesAsoc: [{ tipo: 1, ptoVta: 5, nro: 99 }],
      }),
    ]);

    const res = await syncIssuedPair(fakeSupabase(db), afip, target, 3, 10);

    expect(res).toMatchObject({ imported: 2, unlinked: 1 });
    expect(db.invoices.find((r) => r.numero === 1)).toMatchObject({
      kind: "nc",
      invoice_origin_id: "inv-6",
      origin_unlinked: false,
    });
    // Origin on a point of sale the ERP does not import: stored unlinked.
    expect(db.invoices.find((r) => r.numero === 2)).toMatchObject({
      kind: "nc",
      invoice_origin_id: null,
      origin_unlinked: true,
    });
  });

  it("waits for an origin on the same point of sale that is not imported yet", async () => {
    const db = {
      clients: [
        { id: "c1", cuit: "30718543866", legal_name: "PALLET SIRANS S.R.L." },
      ] as Row[],
      invoices: [
        {
          id: "inv-6",
          punto_venta: 3,
          cbte_tipo_afip: 1,
          numero: 6,
          status: "emitted",
          client_id: "c1",
        },
      ] as Row[],
    };
    const afip = fakeAfip([
      voucher({
        cbteTipo: 3,
        cbteNro: 1,
        cbtesAsoc: [{ tipo: 1, ptoVta: 3, nro: 6 }],
      }),
      voucher({
        cbteTipo: 3,
        cbteNro: 2,
        cbtesAsoc: [{ tipo: 1, ptoVta: 3, nro: 50 }],
      }),
      voucher({
        cbteTipo: 3,
        cbteNro: 3,
        cbtesAsoc: [{ tipo: 1, ptoVta: 3, nro: 6 }],
      }),
    ]);

    const res = await syncIssuedPair(fakeSupabase(db), afip, target, 3, 10);

    expect(res).toMatchObject({ imported: 1, unlinked: 0 });
    expect(res.stopped).toMatch(/espera su comprobante de origen \(50\)/);
    expect(
      db.invoices.filter((r) => r.kind === "nc").map((r) => r.numero),
    ).toEqual([1]);
  });

  it("retries NC/ND left behind once their origin is imported", async () => {
    const db = {
      clients: [
        { id: "c1", cuit: "30718543866", legal_name: "PALLET SIRANS S.R.L." },
      ] as Row[],
      invoices: [
        {
          id: "inv-6",
          punto_venta: 3,
          cbte_tipo_afip: 1,
          numero: 6,
          status: "emitted",
          client_id: "c1",
        },
        {
          id: "nc-2",
          punto_venta: 3,
          cbte_tipo_afip: 3,
          numero: 2,
          status: "emitted",
        },
      ] as Row[],
    };
    const afip = fakeAfip([
      voucher({
        cbteTipo: 3,
        cbteNro: 1,
        cbtesAsoc: [{ tipo: 1, ptoVta: 3, nro: 6 }],
      }),
      voucher({
        cbteTipo: 3,
        cbteNro: 2,
        cbtesAsoc: [{ tipo: 1, ptoVta: 3, nro: 6 }],
      }),
    ]);

    const res = await syncIssuedPair(fakeSupabase(db), afip, target, 3, 10, {
      retryGaps: true,
    });

    expect(res).toMatchObject({ recovered: 1, imported: 0 });
    expect(
      db.invoices.filter((r) => r.cbte_tipo_afip === 3).map((r) => r.numero),
    ).toEqual([2, 1]);
  });
});

describe("hourlyWindow", () => {
  const hour = 3_600_000;
  it("returns everything when it fits and rotates otherwise", () => {
    expect(hourlyWindow([1, 2], 5, 0)).toEqual([1, 2]);
    const gaps = [1, 2, 3, 4, 5];
    expect(hourlyWindow(gaps, 2, 0)).toEqual([1, 2]);
    expect(hourlyWindow(gaps, 2, hour)).toEqual([3, 4]);
    expect(hourlyWindow(gaps, 2, 2 * hour)).toEqual([5]);
    expect(hourlyWindow(gaps, 2, 3 * hour)).toEqual([1, 2]);
  });
});

describe("reconcilePair", () => {
  it("splits what is missing into not imported yet and gaps", async () => {
    const db = {
      invoices: [1, 2, 4, 5, 7].map((numero) => ({
        id: `nc-${numero}`,
        punto_venta: 3,
        cbte_tipo_afip: 3,
        numero,
      })) as Row[],
    };
    const afip = { getLastAuthorizedNumber: async () => 10 };

    const res = await reconcilePair(fakeSupabase(db), afip, target, 3);

    expect(res).toMatchObject({
      label: "Nota de crédito A",
      last_authorized: 10,
      last_local: 7,
      not_imported_yet: 3,
      gaps: 2,
      gap_sample: [3, 6],
    });
  });
});

describe("renamePlaceholderClients", () => {
  it("names clients from the name AFIP returns without a constancia", async () => {
    const db = {
      clients: [
        { id: "c1", cuit: "30711099057", legal_name: "Cliente 30711099057" },
        { id: "c2", cuit: "30718543866", legal_name: "PALLET SIRANS S.R.L." },
      ] as Row[],
    };
    const { PadronNoConstanciaError } = await import("./padron");
    const afip = {
      lookupContributor: async () => {
        throw new PadronNoConstanciaError(
          "sin constancia",
          "TRANSPORTE SUR SA",
        );
      },
    };

    const res = await renamePlaceholderClients(fakeSupabase(db), afip, 50);

    expect(res).toEqual({ checked: 1, renamed: 1 });
    expect(db.clients.map((c) => c.legal_name)).toEqual([
      "TRANSPORTE SUR SA",
      "PALLET SIRANS S.R.L.",
    ]);
  });
});

describe("NC without CbtesAsoc", () => {
  it("links to the factura with the same receiver and total, on or before its date", async () => {
    const db = {
      clients: [
        { id: "c1", cuit: "30708974141", legal_name: "DEBENELUX SRL" },
      ] as Row[],
      invoices: [
        {
          id: "fa-15538",
          punto_venta: 3,
          cbte_tipo_afip: 1,
          numero: 15538,
          doc_nro: "30708974141",
          imp_total: 5220020000,
          fecha: "2022-10-28",
          status: "emitted",
          client_id: "c1",
        },
      ] as Row[],
    };
    const afip = fakeAfip([
      voucher({
        cbteTipo: 3,
        cbteNro: 610,
        cbteFch: "20221028",
        docNro: "30708974141",
        impTotal: 5220020000,
        cbtesAsoc: [],
      }),
    ]);
    // NC numbering starts above the local NCs at 609.
    db.invoices.push({
      id: "nc-609",
      punto_venta: 3,
      cbte_tipo_afip: 3,
      numero: 609,
      status: "emitted",
    });

    const res = await syncIssuedPair(fakeSupabase(db), afip, target, 3, 10);

    expect(res).toMatchObject({ imported: 1, unlinked: 0 });
    expect(db.invoices.find((r) => r.numero === 610)).toMatchObject({
      kind: "nc",
      invoice_origin_id: "fa-15538",
    });
  });
});

describe("NC whose origin belongs to another client", () => {
  it("stores it unlinked instead of stopping the pair", async () => {
    const db = {
      clients: [
        { id: "c-cf", cuit: "00000000000", legal_name: "CONSUMIDOR FINAL" },
      ] as Row[],
      invoices: [
        {
          id: "fa-9",
          punto_venta: 3,
          cbte_tipo_afip: 1,
          numero: 9,
          status: "emitted",
          client_id: "c-cf",
        },
      ] as Row[],
    };
    const afip = fakeAfip([
      voucher({
        cbteTipo: 3,
        cbteNro: 1,
        docNro: "30718543866",
        cbtesAsoc: [{ tipo: 1, ptoVta: 3, nro: 9 }],
      }),
      voucher({ cbteTipo: 3, cbteNro: 2, docNro: "30718543866" }),
    ]);

    const res = await syncIssuedPair(fakeSupabase(db), afip, target, 3, 10);

    expect(res).toMatchObject({ imported: 2, unlinked: 2, stopped: null });
    expect(db.invoices.find((r) => r.numero === 1)).toMatchObject({
      invoice_origin_id: null,
      origin_unlinked: true,
    });
  });
});

describe("NC citing a voucher tipo the import does not bring", () => {
  it("stores it unlinked instead of waiting forever", async () => {
    const db = { clients: [] as Row[], invoices: [] as Row[] };
    const afip = fakeAfip([
      voucher({
        cbteTipo: 8,
        cbteNro: 1,
        // 201: Factura de Crédito Electrónica MiPyME A.
        cbtesAsoc: [{ tipo: 201, ptoVta: 3, nro: 50 }],
      }),
    ]);

    const res = await syncIssuedPair(fakeSupabase(db), afip, target, 8, 10);

    expect(res).toMatchObject({ imported: 1, unlinked: 1, stopped: null });
  });
});
