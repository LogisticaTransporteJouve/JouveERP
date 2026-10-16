import { describe, expect, it } from "vitest";

import {
  aggregateClientAging,
  aggregateSupplierAging,
  formatCurrencyAmounts,
  isAgingOverdue,
  type AgingViewAmounts,
  type ClientAgingViewRow,
} from "./aging";

const RATE = { rate: 1000, rate_date: "2026-10-15" };

const ZERO: AgingViewAmounts = {
  ars_bucket_0_30: 0,
  ars_bucket_30_60: 0,
  ars_bucket_60_90: 0,
  ars_bucket_90_plus: 0,
  ars_total_open: 0,
  usd_bucket_0_30: 0,
  usd_bucket_30_60: 0,
  usd_bucket_60_90: 0,
  usd_bucket_90_plus: 0,
  usd_total_open: 0,
  document_count: 0,
  oldest_days: 0,
};

function row(over: Partial<ClientAgingViewRow> = {}): ClientAgingViewRow {
  return {
    ...ZERO,
    client_id: "c1",
    clients: { legal_name: "Acme SA", display_name: null, cuit: "20-1-2" },
    ...over,
  };
}

describe("aggregateClientAging", () => {
  it("returns zero totals for an empty list", () => {
    const r = aggregateClientAging([], RATE);
    expect(r.rows).toEqual([]);
    expect(r.totals.party_count).toBe(0);
    expect(r.totals.total).toEqual({ ars: 0, usd: 0 });
    expect(r.totals.total_ars_equivalent).toBe(0);
    expect(r.usd_rate).toEqual(RATE);
  });

  it("keeps pesos and dollars apart in every bucket and total", () => {
    const r = aggregateClientAging(
      [
        row({
          ars_bucket_0_30: 100,
          ars_total_open: 100,
          usd_bucket_90_plus: 50,
          usd_total_open: 50,
          document_count: 2,
        }),
        row({
          client_id: "c2",
          clients: { legal_name: "Beta", display_name: "B", cuit: "30-9-1" },
          ars_bucket_90_plus: 70,
          ars_total_open: 70,
          document_count: 1,
        }),
      ],
      RATE,
    );
    expect(r.totals.buckets["0_30"]).toEqual({ ars: 100, usd: 0 });
    expect(r.totals.buckets["90_plus"]).toEqual({ ars: 70, usd: 50 });
    expect(r.totals.total).toEqual({ ars: 170, usd: 50 });
    expect(r.totals.total_ars_equivalent).toBe(50_170);
    expect(r.totals.document_count).toBe(3);
    expect(r.totals.party_count).toBe(2);
  });

  it("sorts by ARS-equivalent exposure, dollars at the rate", () => {
    const r = aggregateClientAging(
      [
        row({ client_id: "pesos", ars_total_open: 5000 }),
        row({ client_id: "dollars", usd_total_open: 10 }),
      ],
      RATE,
    );
    expect(r.rows.map((x) => x.id)).toEqual(["dollars", "pesos"]);
    expect(r.rows[0]!.total_ars_equivalent).toBe(10_000);
  });

  it("without a rate: no single total when there are dollars, pesos sort first", () => {
    const r = aggregateClientAging(
      [
        row({ client_id: "dollars", usd_total_open: 10 }),
        row({ client_id: "pesos", ars_total_open: 5000 }),
      ],
      null,
    );
    expect(r.totals.total).toEqual({ ars: 5000, usd: 10 });
    expect(r.totals.total_ars_equivalent).toBeNull();
    expect(r.rows.map((x) => x.id)).toEqual(["pesos", "dollars"]);
    expect(r.rows[0]!.total_ars_equivalent).toBe(5000);
    expect(r.rows[1]!.total_ars_equivalent).toBeNull();
  });

  it("discards rows without client_id or clients", () => {
    const r = aggregateClientAging(
      [
        row({ client_id: null, ars_total_open: 999 }),
        row({ clients: null, ars_total_open: 999 }),
        row({ ars_total_open: 10 }),
      ],
      RATE,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.totals.total.ars).toBe(10);
  });

  it("rounds float drift to 2 decimals", () => {
    const r = aggregateClientAging(
      [
        row({ ars_bucket_0_30: 0.1, ars_total_open: 0.1, usd_total_open: 0.1 }),
        row({ ars_bucket_0_30: 0.2, ars_total_open: 0.2, usd_total_open: 0.2 }),
      ],
      RATE,
    );
    expect(r.totals.buckets["0_30"].ars).toBe(0.3);
    expect(r.totals.total).toEqual({ ars: 0.3, usd: 0.3 });
  });
});

describe("aggregateSupplierAging", () => {
  it("maps the supplier join and discards rows without one", () => {
    const r = aggregateSupplierAging(
      [
        {
          ...ZERO,
          supplier_id: "s1",
          suppliers: { legal_name: "Prov SA", cuit: "30-1-2" },
          usd_total_open: 3,
        },
        { ...ZERO, supplier_id: null, suppliers: null, ars_total_open: 9 },
      ],
      RATE,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      id: "s1",
      legal_name: "Prov SA",
      display_name: null,
      total: { ars: 0, usd: 3 },
      total_ars_equivalent: 3000,
    });
  });
});

describe("isAgingOverdue", () => {
  it("is true when either currency has a 60+ day balance", () => {
    const [onlyUsdLate] = aggregateClientAging(
      [row({ usd_bucket_90_plus: 1, usd_total_open: 1 })],
      RATE,
    ).rows;
    const [current] = aggregateClientAging(
      [row({ ars_bucket_0_30: 1, ars_total_open: 1 })],
      RATE,
    ).rows;
    expect(isAgingOverdue(onlyUsdLate!)).toBe(true);
    expect(isAgingOverdue(current!)).toBe(false);
  });
});

describe("formatCurrencyAmounts", () => {
  it("formats es-AR pesos and adds dollars only when present", () => {
    expect(formatCurrencyAmounts({ ars: 1234.56, usd: 0 })).toBe("$ 1.234,56");
    expect(formatCurrencyAmounts({ ars: 0, usd: 1234.5 })).toBe(
      "$ 0,00 · US$ 1.234,50",
    );
  });
});
