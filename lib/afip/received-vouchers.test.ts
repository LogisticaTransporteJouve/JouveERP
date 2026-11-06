import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

const { ingestReceivedVouchers, ingestUnreadableVouchers } =
  await import("./received-vouchers");
import type { ReceivedVoucher } from "./mis-comprobantes/parse";

function voucher(
  numero: number,
  kind: "factura" | null = "factura",
): ReceivedVoucher {
  return {
    issuer_cuit: "30711111118",
    issuer_name: "P",
    cbte_tipo: kind ? 1 : 201,
    kind,
    letter: kind ? "A" : null,
    punto_venta: 1,
    numero,
    fecha: "2026-09-10",
    cae: null,
    moneda: "PES",
    cotizacion: null,
    imp_neto_gravado: 100,
    imp_no_gravado: 0,
    imp_op_exentas: 0,
    imp_iva: 21,
    imp_trib: 0,
    imp_total: 121,
    trib_breakdown: {},
    iva_breakdown: [],
  };
}

/** A tray that already holds número 1 (and, with `unreadable`, número 5 as
 *  «No se pudieron leer»); linking matches número 2. */
function fakeClient(opts: { failUpsert?: boolean; unreadable?: boolean } = {}) {
  const linkedIds: string[][] = [];
  const upserts: unknown[][] = [];
  const updates: { id: string; values: Record<string, unknown> }[] = [];
  const held = opts.unreadable
    ? [
        {
          id: "id-5",
          issuer_cuit: "30711111118",
          cbte_tipo: 1,
          punto_venta: 1,
          numero: 5,
        },
      ]
    : [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({ in: async () => ({ data: held, error: null }) }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (_c: string, id: string) => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => {
                updates.push({ id, values });
                return { data: { id }, error: null };
              },
            }),
          }),
        }),
      }),
      upsert: (rows: { numero: number; status: string }[]) => {
        upserts.push(rows);
        return {
          select: async () =>
            opts.failUpsert
              ? { data: null, error: { code: "XX000" } }
              : {
                  data: rows
                    .filter(
                      (r) =>
                        r.numero !== 1 && !(opts.unreadable && r.numero === 5),
                    )
                    .map((r) => ({ id: `id-${r.numero}`, status: r.status })),
                  error: null,
                },
        };
      },
    }),
    rpc: async (_fn: string, args: { p_ids: string[] }) => {
      linkedIds.push(args.p_ids);
      return {
        data: args.p_ids.filter((id) => id === "id-2").length,
        error: null,
      };
    },
  };
  return { client, linkedIds, upserts, updates };
}

describe("ingestReceivedVouchers", () => {
  it("counts new, unsupported, already-in-tray and linked vouchers", async () => {
    const { client, linkedIds, upserts } = fakeClient();
    const counts = await ingestReceivedVouchers(
      // @ts-expect-error a minimal fake of the query builder
      client,
      [voucher(1), voucher(2), voucher(3), voucher(4, null)],
      { origin: "upload" },
    );
    expect(counts).toEqual({
      inserted: 3,
      unsupported: 1,
      alreadyInTray: 1,
      linked: 1,
    });
    expect(linkedIds).toEqual([["id-2", "id-3"]]);
    expect(upserts[0]).toContainEqual(
      expect.objectContaining({
        numero: 4,
        status: "unsupported",
        origin: "upload",
      }),
    );
  });

  it("returns null when the write fails", async () => {
    const { client } = fakeClient({ failUpsert: true });
    expect(
      // @ts-expect-error a minimal fake of the query builder
      await ingestReceivedVouchers(client, [voucher(2)], { origin: "upload" }),
    ).toBeNull();
  });

  it("moves a voucher that could not be read before to pending when it reads now", async () => {
    const { client, linkedIds, updates } = fakeClient({ unreadable: true });
    const counts = await ingestReceivedVouchers(
      // @ts-expect-error a minimal fake of the query builder
      client,
      [voucher(1), voucher(5)],
      { origin: "sync" },
    );
    expect(counts).toEqual({
      inserted: 1,
      unsupported: 0,
      alreadyInTray: 1,
      linked: 0,
    });
    expect(updates).toEqual([
      {
        id: "id-5",
        values: expect.objectContaining({
          status: "pending_review",
          imp_total: 121,
          unreadable_reason: null,
          raw_amounts: null,
        }),
      },
    ]);
    expect(linkedIds).toEqual([["id-5"]]);
  });

  it("keeps an unreadable row as «No se pudieron leer», with total 0", async () => {
    const { client, upserts } = fakeClient();
    const added = await ingestUnreadableVouchers(
      // @ts-expect-error a minimal fake of the query builder
      client,
      [
        {
          issuer_cuit: "30711111118",
          issuer_name: "P",
          cbte_tipo: 1,
          kind: "factura",
          letter: "A",
          punto_venta: 1,
          numero: 7,
          fecha: "2026-09-10",
          cae: null,
          moneda: "PES",
          unreadable_reason: "amount_over_total",
          raw_amounts: { neto: "100", total: "90" },
        },
      ],
      { origin: "sync" },
    );
    expect(added).toBe(1);
    expect(upserts[0]).toEqual([
      expect.objectContaining({
        numero: 7,
        status: "unreadable",
        imp_total: 0,
        unreadable_reason: "amount_over_total",
        raw_amounts: { neto: "100", total: "90" },
      }),
    ]);
  });
});
