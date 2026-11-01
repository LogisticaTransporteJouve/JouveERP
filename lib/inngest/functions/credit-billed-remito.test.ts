import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordingSupabase,
  type FakeResponse,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  factura: null as Row | null,
  facturaErr: null as unknown,
  remito: null as Row | null,
  moveErr: null as unknown,
  upsertErr: null as unknown,
  nc: null as Row | null,
  itemCount: 0,
}));

function eqValue(call: RecordedCall, column: string): unknown {
  return call.filters.find(([k, c]) => k === "eq" && c === column)?.[2];
}

function respond(call: RecordedCall): FakeResponse {
  if (call.op === "rpc") return { data: 0, error: h.moveErr };
  if (call.table === "invoices") {
    if (call.op === "upsert") return { data: null, error: h.upsertErr };
    if (eqValue(call, "idempotency_key") !== undefined) {
      return { data: h.nc, error: h.nc ? null : { message: "no rows" } };
    }
    const id = eqValue(call, "id");
    if (id === h.factura?.id) return { data: h.factura, error: h.facturaErr };
    if (id === h.remito?.id) return { data: h.remito, error: null };
    return { data: null, error: h.facturaErr };
  }
  if (call.table === "invoice_items") {
    if (call.op === "insert") return { data: null, error: null };
    return { data: null, error: null, count: h.itemCount };
  }
  return { data: null, error: null };
}

let fake = recordingSupabase(respond);

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));

const { creditBilledRemito } = await import("./credit-billed-remito");

const FACTURA = "11111111-1111-4111-8111-111111111111";
const REMITO = "22222222-2222-4222-8222-222222222222";
const NC = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  fake = recordingSupabase(respond);
  h.factura = {
    id: FACTURA,
    letter: "A",
    punto_venta: 3,
    numero: 12,
    source_remito_id: REMITO,
    created_by: "u1",
  };
  h.facturaErr = null;
  h.remito = {
    id: REMITO,
    channel_id: "jouve_internal",
    client_id: "c-int",
    punto_venta: 9001,
    concepto: 2,
    doc_tipo: 99,
    doc_nro: "0",
    moneda: "PES",
    cotizacion: 1,
    imp_total: "1000.00",
  };
  h.moveErr = null;
  h.upsertErr = null;
  h.nc = { id: NC, status: "draft" };
  h.itemCount = 0;
});

describe("creditBilledRemito", () => {
  it("does nothing for a factura without a source remito", async () => {
    h.factura = { ...h.factura, source_remito_id: null };
    expect(await creditBilledRemito(FACTURA)).toBeNull();
    expect(fake.calls.map((c) => c.op)).toEqual(["select"]);
  });

  it("moves the recibos internos before it drafts the NC", async () => {
    await creditBilledRemito(FACTURA);
    const rpcIdx = fake.calls.findIndex((c) => c.op === "rpc");
    const upsertIdx = fake.calls.findIndex((c) => c.op === "upsert");
    expect(rpcIdx).toBeGreaterThan(-1);
    expect(fake.calls[rpcIdx]).toMatchObject({
      table: "move_billed_remito_receipts",
      payload: { p_factura_id: FACTURA },
    });
    expect(upsertIdx).toBeGreaterThan(rpcIdx);
  });

  it("drafts an internal NC for the remito's whole total, keyed by the factura id", async () => {
    const event = await creditBilledRemito(FACTURA);
    const upsert = fake.calls.find((c) => c.op === "upsert");
    expect(upsert?.payload).toMatchObject({
      channel_id: "jouve_internal",
      client_id: "c-int",
      kind: "nc",
      letter: null,
      punto_venta: 9001,
      imp_neto: 1000,
      imp_iva: 0,
      imp_total: 1000,
      status: "draft",
      invoice_origin_id: REMITO,
      idempotency_key: FACTURA,
      motivo_nc_nd: "Facturado como A0003-00000012",
      created_by: "u1",
    });
    expect(upsert?.options).toEqual({
      onConflict: "idempotency_key",
      ignoreDuplicates: true,
    });
    const item = fake.calls.find(
      (c) => c.table === "invoice_items" && c.op === "insert",
    );
    expect(item?.payload).toMatchObject({
      invoice_id: NC,
      line_total: 1000,
      line_iva: 0,
    });
    expect(event).toEqual({
      invoice_id: NC,
      idempotency_key: FACTURA,
      channel_id: "jouve_internal",
      punto_venta: 9001,
    });
  });

  it("on a retry with the NC and its item already written, inserts nothing new and re-sends", async () => {
    h.itemCount = 1;
    const event = await creditBilledRemito(FACTURA);
    expect(
      fake.calls.filter(
        (c) => c.table === "invoice_items" && c.op === "insert",
      ),
    ).toEqual([]);
    expect(event?.invoice_id).toBe(NC);
  });

  it("returns no event once the NC left draft (already issued by an earlier attempt)", async () => {
    h.itemCount = 1;
    h.nc = { id: NC, status: "emitted" };
    expect(await creditBilledRemito(FACTURA)).toBeNull();
  });

  it("throws (so the step retries) when moving the recibos fails, before any NC", async () => {
    h.moveErr = { message: "boom" };
    await expect(creditBilledRemito(FACTURA)).rejects.toThrow(/move-receipts/);
    expect(fake.calls.some((c) => c.op === "upsert")).toBe(false);
  });

  it("throws when the factura cannot be read", async () => {
    h.facturaErr = { message: "boom" };
    await expect(creditBilledRemito(FACTURA)).rejects.toThrow(/load-factura/);
    expect(fake.calls.some((c) => c.op === "rpc")).toBe(false);
  });

  it("throws when the NC insert fails (e.g. the open-amount guard)", async () => {
    h.upsertErr = { message: "La nota de crédito supera el saldo abierto" };
    await expect(creditBilledRemito(FACTURA)).rejects.toThrow(/insert-nc/);
  });
});
