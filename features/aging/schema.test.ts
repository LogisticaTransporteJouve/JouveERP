import { describe, expect, it } from "vitest";

import { aggregateClientAging, type AgingViewRow } from "./schema";

function row(over: Partial<AgingViewRow> = {}): AgingViewRow {
  return {
    client_id: "c1",
    bucket_0_30: 0,
    bucket_30_60: 0,
    bucket_60_90: 0,
    bucket_90_plus: 0,
    total_open: 0,
    document_count: 0,
    oldest_days: 0,
    clients: { legal_name: "Acme SA", display_name: null, cuit: "20-1-2" },
    ...over,
  };
}

describe("aggregateClientAging", () => {
  it("devuelve totales en cero para lista vacía", () => {
    const r = aggregateClientAging([]);
    expect(r.clients).toEqual([]);
    expect(r.totals.client_count).toBe(0);
    expect(r.totals.total_open).toBe(0);
  });

  it("mapea y suma los buckets de cada cliente", () => {
    const r = aggregateClientAging([
      row({ bucket_0_30: 100, total_open: 100, document_count: 2 }),
      row({
        client_id: "c2",
        clients: { legal_name: "Beta", display_name: "B", cuit: "30-9-1" },
        bucket_90_plus: 50,
        total_open: 50,
        document_count: 1,
      }),
    ]);
    expect(r.clients).toHaveLength(2);
    expect(r.totals.client_count).toBe(2);
    expect(r.totals.bucket_0_30).toBe(100);
    expect(r.totals.bucket_90_plus).toBe(50);
    expect(r.totals.total_open).toBe(150);
    expect(r.totals.document_count).toBe(3);
  });

  it("descarta filas sin client_id o sin clients", () => {
    const r = aggregateClientAging([
      row({ client_id: null, total_open: 999 }),
      row({ clients: null, total_open: 999 }),
      row({ total_open: 10 }),
    ]);
    expect(r.clients).toHaveLength(1);
    expect(r.totals.total_open).toBe(10);
  });

  it("redondea a 2 decimales el drift de float", () => {
    const r = aggregateClientAging([
      row({ bucket_0_30: 0.1, total_open: 0.1 }),
      row({ bucket_0_30: 0.2, total_open: 0.2 }),
    ]);
    // 0.1 + 0.2 === 0.30000000000000004 sin redondeo.
    expect(r.totals.bucket_0_30).toBe(0.3);
    expect(r.totals.total_open).toBe(0.3);
  });

  it("coacciona valores null a 0", () => {
    const r = aggregateClientAging([
      row({ bucket_0_30: null, total_open: null, document_count: null }),
    ]);
    expect(r.clients[0]?.bucket_0_30).toBe(0);
    expect(r.totals.total_open).toBe(0);
  });
});
