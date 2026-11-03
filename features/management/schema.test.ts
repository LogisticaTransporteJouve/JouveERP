import { describe, expect, it } from "vitest";

import {
  BUCKET_CHOICES,
  SetBucketSchema,
  TABLE_LINES,
  buildMonthTable,
  computeKpis,
  computeWaterfall,
  costCenterBreakdown,
  drillDocuments,
  filterByCostCenter,
  monthTableExport,
  narrowManagementDocuments,
  narrowManagementRows,
  toPayrollControlRow,
  unclassifiedAccounts,
  type ManagementDocument,
  type ManagementRow,
  type RawManagementDocument,
} from "./schema";

const row = (over: Partial<ManagementRow>): ManagementRow => ({
  month: "2026-09",
  bucket: "service_revenue",
  subbucket: null,
  side: "fiscal",
  accountId: "a",
  amount: 0,
  pendingUsd: 0,
  costCenterId: null,
  ...over,
});

describe("computeWaterfall", () => {
  const rows = [
    row({ amount: 1000 }),
    row({ amount: 400, side: "internal" }),
    row({ bucket: "operating_cost", subbucket: "sueldos", amount: -100 }),
    row({
      bucket: "operating_cost",
      subbucket: "sueldos_internos",
      side: "internal",
      amount: -50,
    }),
    row({ bucket: "unclassified", amount: -10 }),
    row({ bucket: "financing_cost", subbucket: "intereses", amount: -40 }),
    row({ bucket: "loan_principal", amount: -700 }),
    row({ bucket: "fleet_investment", amount: -2000 }),
    row({ bucket: "asset_sale", amount: 5000 }),
    row({ bucket: "excluded_noncash", amount: -300 }),
    row({ bucket: "pending_usd", amount: 0, pendingUsd: 25 }),
  ];

  it("cascades fiscal + internal down to cash generation", () => {
    const w = computeWaterfall(rows);
    expect(w.serviceRevenue).toBe(1400);
    expect(w.operatingCost).toBe(-150);
    expect(w.operatingMargin).toBe(1240);
    expect(w.afterFinancing).toBe(1200);
    expect(w.cashGeneration).toBe(1200 - 700 - 2000 + 5000);
  });

  it("keeps the truck sale and the loan principal out of the operating margin", () => {
    const w = computeWaterfall([
      row({ amount: 1000 }),
      row({ bucket: "asset_sale", amount: 5000 }),
      row({ bucket: "loan_principal", amount: -700 }),
    ]);
    expect(w.operatingMargin).toBe(1000);
    expect(w.cashGeneration).toBe(5300);
  });

  it("never adds non-cash items or unconverted dollars to a total", () => {
    const w = computeWaterfall(rows);
    expect(w.excludedNoncash).toBe(-300);
    expect(w.pendingUsd).toBe(25);
    expect(w.cashGeneration).toBe(3500);
  });
});

describe("buildMonthTable", () => {
  it("shows Sueldos and Sueldos internos apart, with Total personal", () => {
    const { totals, byMonth } = buildMonthTable(
      [
        row({ bucket: "operating_cost", subbucket: "sueldos", amount: -100 }),
        row({
          bucket: "operating_cost",
          subbucket: "sueldos_internos",
          side: "internal",
          amount: -50,
        }),
        row({ bucket: "operating_cost", subbucket: null, amount: -5 }),
      ],
      ["2026-08", "2026-09"],
    );
    expect(totals["op:sueldos"]).toEqual({
      fiscal: -100,
      internal: 0,
      total: -100,
    });
    expect(totals["op:sueldos_internos"]).toEqual({
      fiscal: 0,
      internal: -50,
      total: -50,
    });
    expect(totals["op:personal"]?.total).toBe(-150);
    expect(totals["op:otros"]?.total).toBe(-5);
    expect(totals["operating_cost"]?.total).toBe(-155);
    expect(byMonth["op:personal"]?.["2026-08"]?.total).toBe(0);
  });

  it("ignores months outside the table", () => {
    const { totals } = buildMonthTable(
      [row({ amount: 10, month: "2025-01" })],
      ["2026-09"],
    );
    expect(totals["service_revenue"]?.total).toBe(0);
  });
});

describe("narrowManagementRows", () => {
  it("keeps known rows and returns unknown ones apart", () => {
    const { rows, unknown } = narrowManagementRows([
      {
        month: "2026-09",
        bucket: "operating_cost",
        subbucket: "sueldos_internos",
        channel_side: "internal",
        chart_account_id: "a",
        amount_ars: "-50.00",
        pending_usd: "0",
      },
      {
        month: "2026-09",
        bucket: "mystery",
        subbucket: null,
        channel_side: "fiscal",
        chart_account_id: null,
        amount_ars: 1,
        pending_usd: 0,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(-50);
    expect(unknown).toHaveLength(1);
  });
});

describe("cost centers", () => {
  const rows = [
    row({ amount: 1000, costCenterId: "truck" }),
    row({
      bucket: "operating_cost",
      subbucket: "combustible",
      amount: -300,
      costCenterId: "truck",
    }),
    row({
      bucket: "operating_cost",
      subbucket: "administracion",
      amount: -500,
      costCenterId: "admin",
    }),
    row({ bucket: "operating_cost", amount: -50 }),
  ];

  it("filters one center, the rows without one, or all", () => {
    expect(filterByCostCenter(rows, "truck")).toHaveLength(2);
    expect(filterByCostCenter(rows, "none")).toHaveLength(1);
    expect(filterByCostCenter(rows, "all")).toHaveLength(4);
  });

  it("breaks the cascade down by center and adds up to the whole", () => {
    const breakdown = costCenterBreakdown(rows);
    expect(breakdown.map((c) => c.costCenterId)).toEqual([
      "admin",
      "truck",
      null,
    ]);
    expect(breakdown[1]?.waterfall.operatingMargin).toBe(700);
    const margin = breakdown.reduce(
      (a, c) => a + c.waterfall.operatingMargin,
      0,
    );
    expect(margin).toBe(computeWaterfall(rows).operatingMargin);
  });

  it("reads the center from the RPC row, none when absent", () => {
    const base = {
      month: "2026-09",
      bucket: "operating_cost",
      subbucket: null,
      channel_side: "fiscal",
      chart_account_id: "a",
      amount_ars: "-1",
      pending_usd: "0",
    };
    const { rows: narrowed } = narrowManagementRows([
      { ...base, cost_center_id: "truck" },
      base,
    ]);
    expect(narrowed.map((r) => r.costCenterId)).toEqual(["truck", null]);
  });
});

describe("unclassifiedAccounts", () => {
  it("adds up each unmapped account", () => {
    expect(
      unclassifiedAccounts([
        row({ bucket: "unclassified", accountId: "x", amount: -10 }),
        row({ bucket: "unclassified", accountId: "x", amount: -5 }),
        row({ bucket: "unclassified", accountId: "y", amount: 3 }),
      ]),
    ).toEqual([
      { accountId: "x", amount: -15 },
      { accountId: "y", amount: 3 },
    ]);
  });
});

describe("payroll control", () => {
  it("shows what is liquidated and not paid", () => {
    expect(
      toPayrollControlRow({
        month: "2026-09",
        liquidated: "1500",
        paid_for_period: "1000",
        paid_in_month: "1200",
      }),
    ).toEqual({
      month: "2026-09",
      liquidated: 1500,
      paidForPeriod: 1000,
      paidInMonth: 1200,
      unpaid: 500,
    });
  });
});

describe("SetBucketSchema", () => {
  const id = "3f2b8c1e-6a4d-4e1b-9c2a-1b2c3d4e5f60";
  it("takes a subbucket only for its cost bucket", () => {
    expect(
      SetBucketSchema.safeParse({
        accountId: id,
        bucket: "operating_cost",
        subbucket: "combustible",
      }).success,
    ).toBe(true);
    expect(
      SetBucketSchema.safeParse({
        accountId: id,
        bucket: "financing_cost",
        subbucket: "combustible",
      }).success,
    ).toBe(false);
    expect(
      SetBucketSchema.safeParse({
        accountId: id,
        bucket: "asset_sale",
        subbucket: "intereses",
      }).success,
    ).toBe(false);
  });

  it("never maps an account to Sueldos internos (it comes from the channel)", () => {
    expect(
      SetBucketSchema.safeParse({
        accountId: id,
        bucket: "operating_cost",
        subbucket: "sueldos_internos",
      }).success,
    ).toBe(false);
    expect(BUCKET_CHOICES.map((c) => c.value)).not.toContain(
      "operating_cost:sueldos_internos",
    );
  });

  it("every choice parses", () => {
    for (const c of BUCKET_CHOICES) {
      expect(
        SetBucketSchema.safeParse({
          accountId: id,
          bucket: c.bucket,
          subbucket: c.subbucket,
        }).success,
        c.value,
      ).toBe(true);
    }
  });
});

describe("advances to staff (cash)", () => {
  it("stay out of the operating margin and inside cash generation", () => {
    const w = computeWaterfall([
      row({ amount: 1000 }),
      row({
        bucket: "operating_cost",
        subbucket: "sueldos_internos",
        side: "internal",
        amount: -100,
      }),
      row({ bucket: "employee_advances", side: "internal", amount: -300 }),
    ]);
    expect(w.operatingMargin).toBe(900);
    expect(w.employeeAdvances).toBe(-300);
    expect(w.cashGeneration).toBe(600);
    const { totals } = buildMonthTable(
      [row({ bucket: "employee_advances", amount: -300 })],
      ["2026-09"],
    );
    expect(totals.employee_advances!.total).toBe(-300);
    expect(totals.operating_margin!.total).toBe(0);
    expect(totals.cash_generation!.total).toBe(-300);
  });
});

describe("computeKpis", () => {
  const months = ["2025-10", "2025-11", "2025-12"];
  const rows = [
    row({ month: "2025-10", amount: 1000 }),
    row({ month: "2025-10", bucket: "operating_cost", amount: -600 }),
    row({ month: "2025-11", amount: 1000 }),
    row({ month: "2025-11", bucket: "operating_cost", amount: -800 }),
    row({ month: "2025-12", amount: 9999 }),
  ];
  const previous = [
    row({ month: "2024-10", amount: 1000 }),
    row({ month: "2024-10", bucket: "operating_cost", amount: -900 }),
    row({ month: "2024-12", amount: 5000 }),
  ];

  it("compares the months gone by with the same ones a year before", () => {
    const { months: used, kpis } = computeKpis(
      rows,
      previous,
      months,
      "2025-11",
    );
    expect(used).toEqual(["2025-10", "2025-11"]);
    const margin = kpis.find((k) => k.key === "operating_margin_pct")!;
    expect(margin.current).toBe(30);
    expect(margin.previous).toBe(10);
    expect(margin.variance).toBe(20);
    const result = kpis.find((k) => k.key === "operating_result")!;
    expect(result).toMatchObject({
      current: 600,
      previous: 100,
      variance: 500,
    });
  });

  it("says when there is no previous year to compare with", () => {
    const { kpis } = computeKpis(rows, [], months, "2026-09");
    expect(kpis.every((k) => k.previous === null && k.variance === null)).toBe(
      true,
    );
  });

  it("has no margin % without services", () => {
    const { kpis } = computeKpis(
      [row({ bucket: "operating_cost", amount: -5 })],
      [],
      months,
      "2026-09",
    );
    expect(kpis[0]!.current).toBeNull();
  });
});

const rawDoc = (
  over: Partial<RawManagementDocument>,
): RawManagementDocument => ({
  month: "2026-09",
  bucket: "operating_cost",
  subbucket: "proveedores",
  channel_side: "fiscal",
  chart_account_id: null,
  cost_center_id: null,
  amount_ars: "-100",
  pending_usd: "0",
  doc_type: "payment_order",
  doc_id: "11111111-1111-4111-8111-111111111111",
  doc_parent_id: null,
  doc_subtype: null,
  doc_date: "2026-09-10",
  doc_label: "Orden de pago 0001-00000001",
  counterparty: "Proveedor",
  ...over,
});

describe("narrowManagementDocuments", () => {
  it("links each document to its page, only for who can open it", () => {
    const { docs, unknown } = narrowManagementDocuments(
      [
        rawDoc({}),
        rawDoc({
          doc_type: "payroll",
          doc_subtype: "sac",
          doc_date: "2026-06-01",
        }),
        rawDoc({
          doc_type: "transaction",
          doc_parent_id: "22222222-2222-4222-8222-222222222222",
        }),
        rawDoc({ doc_type: "employee" }),
        rawDoc({ doc_type: "otro" }),
      ],
      (type) => type !== "employee",
    );
    expect(unknown).toHaveLength(1);
    expect(docs.map((d) => d.href)).toEqual([
      "/payment-orders/11111111-1111-4111-8111-111111111111",
      "/hr/payroll/sac/2026/1",
      "/transactions?account=22222222-2222-4222-8222-222222222222&period=custom&from=2026-09-10&to=2026-09-10",
      null,
    ]);
    expect(docs[0]).toMatchObject({ amount: -100, side: "fiscal" });
  });
});

describe("drillDocuments", () => {
  const doc = (over: Partial<ManagementDocument>): ManagementDocument => ({
    ...row({ bucket: "operating_cost", subbucket: "proveedores" }),
    docType: "payment_order",
    docId: "a",
    docDate: null,
    label: "OP",
    counterparty: null,
    href: null,
    ...over,
  });

  it("adds up to the figure of the line, side and center", () => {
    const docs = [
      doc({ docId: "a", amount: -100 }),
      doc({ docId: "a", amount: -50, accountId: "other" }),
      doc({ docId: "b", amount: -500 }),
      doc({ docId: "c", amount: -70, side: "internal" }),
      doc({ docId: "d", amount: -1, costCenterId: "cc" }),
      doc({ docId: "e", bucket: "service_revenue", amount: 900 }),
    ];
    const all = drillDocuments(docs, {
      lineKey: "op:proveedores",
      side: "total",
      costCenter: "all",
    });
    expect(all.count).toBe(4);
    expect(all.total).toBe(-721);
    expect(all.documents.map((d) => d.docId)).toEqual(["b", "a", "c", "d"]);
    expect(all.documents[1]!.amount).toBe(-150);

    const fiscalNoCenter = drillDocuments(docs, {
      lineKey: "op:proveedores",
      side: "fiscal",
      costCenter: "none",
    });
    expect(fiscalNoCenter.total).toBe(-650);

    const capped = drillDocuments(
      docs,
      { lineKey: "op:proveedores", side: "total", costCenter: "all" },
      1,
    );
    expect(capped.documents).toHaveLength(1);
    expect(capped.count).toBe(4);
    expect(capped.total).toBe(-721);
  });

  it("matches the month table for every line", () => {
    const rows = [
      row({ amount: 1000 }),
      row({ bucket: "operating_cost", subbucket: "sueldos", amount: -100 }),
      row({ bucket: "operating_cost", subbucket: null, amount: -7 }),
      row({ bucket: "employee_advances", amount: -30 }),
      row({ bucket: "loan_principal", amount: -40 }),
    ];
    const docs = rows.map((r, i) => doc({ ...r, docId: String(i) }));
    const { totals } = buildMonthTable(rows, ["2026-09"]);
    for (const line of TABLE_LINES) {
      expect(
        drillDocuments(docs, {
          lineKey: line.key,
          side: "total",
          costCenter: "all",
        }).total,
        line.key,
      ).toBe(totals[line.key]!.total);
    }
  });
});

describe("monthTableExport", () => {
  it("writes the screen's figures, one line per row", () => {
    const rows = [row({ amount: 1000 }), row({ month: "2026-08", amount: 5 })];
    const months = ["2026-08", "2026-09"];
    const table = buildMonthTable(rows, months);
    const out = monthTableExport(table, months, "total");
    expect(out.header).toEqual([
      "Concepto",
      "2026-08",
      "2026-09",
      "Fiscal",
      "Interno",
      "Total",
    ]);
    expect(out.rows).toHaveLength(TABLE_LINES.length);
    expect(out.rows[0]).toEqual(["Servicios", 5, 1000, 1005, 0, 1005]);
  });
});
