import { describe, expect, it } from "vitest";

import { insightFingerprint } from "../lib/fingerprint";
import {
  detectCashVsFinancing,
  detectClientMarginDrop,
  detectFuelOutliers,
  detectLateInterestUncharged,
  detectLoanInstallmentsDue,
  detectOverdueGrowth,
  detectUnreconciledLines,
  detectVehicleCostPerKm,
} from "./detect";

const TODAY = "2026-11-03";

describe("detectClientMarginDrop", () => {
  const base = {
    client_id: "c1",
    name: "Cliente Uno",
    revenuePrev: 1_000_000,
    costPrev: 600_000, // 40 %
    revenueNow: 1_000_000,
    costNow: 750_000, // 25 %
  };

  it("flags a client that lost 10 points or more", () => {
    const [f] = detectClientMarginDrop([base]);
    expect(f?.kind).toBe("client_margin_drop");
    expect(f?.finding).toContain("Cliente Uno (de 40 % a 25 %)");
    expect(f?.metrics.worst_drop_pts).toBe(15);
    expect(f?.source_refs).toEqual(["c1"]);
  });

  it("ignores small drops and clients without enough revenue on both sides", () => {
    expect(detectClientMarginDrop([{ ...base, costNow: 680_000 }])).toEqual([]);
    expect(detectClientMarginDrop([{ ...base, revenuePrev: 50_000 }])).toEqual(
      [],
    );
  });

  it("is critical when a client now loses money", () => {
    const [f] = detectClientMarginDrop([{ ...base, costNow: 1_100_000 }]);
    expect(f?.severity).toBe("critical");
  });
});

describe("detectVehicleCostPerKm", () => {
  const v = {
    vehicle_id: "v1",
    patente: "AB123CD",
    kmPrev: 10_000,
    costPrev: 1_000_000, // $100/km
    kmNow: 10_000,
    costNow: 1_300_000, // $130/km
  };

  it("flags a 20 % rise or more", () => {
    const [f] = detectVehicleCostPerKm([v]);
    expect(f?.finding).toContain("AB123CD (de $100 a $130 por km)");
    expect(f?.metrics.worst_rise_pct).toBe(30);
  });

  it("skips small rises and vehicles with few km", () => {
    expect(detectVehicleCostPerKm([{ ...v, costNow: 1_100_000 }])).toEqual([]);
    expect(detectVehicleCostPerKm([{ ...v, kmPrev: 500 }])).toEqual([]);
  });
});

describe("detectFuelOutliers", () => {
  const fleet = ["A", "B", "C", "D", "E"].map((p, i) => ({
    vehicle_id: p,
    patente: p,
    km: 10_000,
    liters: 3_000 + i * 50, // ~30-32 L/100 km
  }));

  it("flags a vehicle far above the fleet's upper fence", () => {
    const [f] = detectFuelOutliers([
      ...fleet,
      { vehicle_id: "X", patente: "X", km: 10_000, liters: 6_000 },
    ]);
    expect(f?.source_refs).toEqual(["X"]);
    expect(f?.finding).toContain("X con 60 L/100 km");
  });

  it("needs enough vehicles and km", () => {
    expect(detectFuelOutliers(fleet.slice(0, 3))).toEqual([]);
    expect(
      detectFuelOutliers([
        ...fleet,
        { vehicle_id: "X", patente: "X", km: 100, liters: 600 },
      ]),
    ).toEqual([]);
  });
});

describe("detectLateInterestUncharged", () => {
  const row = {
    invoice_id: "i1",
    client_name: "Cliente",
    comprobante: "FC A 0002-00000010",
    currency: "ARS" as const,
    monthly_rate: 3,
    interest: 12_000,
  };

  it("totals pesos and dollars apart and proposes the largest peso ND", () => {
    const [f] = detectLateInterestUncharged(
      [
        row,
        { ...row, invoice_id: "i2", interest: 30_000 },
        { ...row, invoice_id: "i3", currency: "USD", interest: 900 },
        { ...row, invoice_id: "i4", monthly_rate: null, interest: 0 },
      ],
      TODAY,
    );
    expect(f?.metrics).toMatchObject({
      invoice_count: 3,
      total_interest: 42_000,
      total_interest_usd: 900,
      no_rate_count: 1,
    });
    expect(f?.proposal).toEqual({
      action: "proposeLateInterestNd",
      label: "Generar ND por mora",
      input: { invoice_id: "i2", as_of: TODAY },
    });
  });

  it("says when there is overdue debt but no rate, without a proposal", () => {
    const [f] = detectLateInterestUncharged(
      [{ ...row, monthly_rate: null, interest: 0 }],
      TODAY,
    );
    expect(f?.severity).toBe("info");
    expect(f?.proposal).toBeUndefined();
    expect(f?.source_refs).toEqual([]);
  });

  it("is empty with nothing overdue", () => {
    expect(detectLateInterestUncharged([], TODAY)).toEqual([]);
  });
});

describe("detectUnreconciledLines", () => {
  const lines = [
    {
      id: "l1",
      account_id: "a1",
      account_name: "Banco",
      line_date: "2026-10-01",
      amount: -100,
    },
    {
      id: "l2",
      account_id: "a1",
      account_name: "Banco",
      line_date: "2026-10-30",
      amount: 50,
    },
    {
      id: "l3",
      account_id: "a2",
      account_name: "Caja de ahorro",
      line_date: "2026-10-05",
      amount: 30,
    },
    {
      id: "l4",
      account_id: "a1",
      account_name: "Banco",
      line_date: "2026-10-10",
      amount: 20,
    },
  ];

  it("counts only lines older than 15 days and proposes a task", () => {
    const [f] = detectUnreconciledLines(lines, TODAY);
    expect(f?.source_refs).toEqual(["l1", "l3", "l4"]);
    expect(f?.metrics.total_amount).toBe(150);
    expect(f?.metrics.account_count).toBe(2);
    expect(f?.proposal?.action).toBe("proposeTask");
    expect(f?.proposal?.input.title).toBe("Conciliar el extracto de Banco");
    expect(f?.proposal?.input.description).toContain("2 línea(s)");
  });

  it("proposes the suggested matches of the main account when there are some", () => {
    const [f] = detectUnreconciledLines(lines, TODAY, {
      account_id: "a1",
      from: "2026-10-01",
      to: "2026-10-10",
      suggestions: 2,
    });
    expect(f?.proposal).toEqual({
      action: "proposeBankMatches",
      label: "Conciliar con las sugerencias",
      input: { account: "Banco", from: "2026-10-01", to: "2026-10-10" },
    });
    expect(f?.metrics.suggested_matches).toBe(2);
    expect(f?.finding).toContain("2 sugerencia(s)");
  });

  it("keeps the task when the hint has no suggestions or is another account's", () => {
    for (const hint of [
      {
        account_id: "a1",
        from: "2026-10-01",
        to: "2026-10-10",
        suggestions: 0,
      },
      {
        account_id: "a2",
        from: "2026-10-05",
        to: "2026-10-05",
        suggestions: 3,
      },
    ]) {
      const [f] = detectUnreconciledLines(lines, TODAY, hint);
      expect(f?.proposal?.action).toBe("proposeTask");
    }
  });
});

describe("detectLoanInstallmentsDue", () => {
  it("is critical with an overdue installment and proposes paying the first", () => {
    const [f] = detectLoanInstallmentsDue(
      [
        {
          id: "q2",
          loan_description: "Leasing camión",
          number: 2,
          due_date: "2026-11-10",
          amount: 100,
          currency: "ARS",
        },
        {
          id: "q1",
          loan_description: "Leasing camión",
          number: 1,
          due_date: "2026-10-30",
          amount: 100,
          currency: "ARS",
        },
        {
          id: "q9",
          loan_description: "Otro",
          number: 9,
          due_date: "2026-12-30",
          amount: 100,
          currency: "ARS",
        },
      ],
      TODAY,
    );
    expect(f?.severity).toBe("critical");
    expect(f?.metrics.installment_count).toBe(2);
    expect(f?.proposal?.input).toMatchObject({
      title: "Pagar la cuota 1 de Leasing camión",
      due_date: TODAY,
    });
  });
});

describe("detectCashVsFinancing", () => {
  it("warns when cash grew only thanks to loans", () => {
    const [f] = detectCashVsFinancing({
      cashChange: 200_000,
      disbursements: 1_000_000,
      installmentsPaid: 100_000,
    });
    expect(f?.severity).toBe("warning");
    expect(f?.metrics.change_without_financing).toBe(-700_000);
    expect(f?.finding).toContain("habría bajado $700.000");
    expect(insightFingerprint(f?.kind ?? "", f?.source_refs)).toBeNull();
  });

  it("stays quiet without loan money in the window", () => {
    expect(
      detectCashVsFinancing({
        cashChange: -10,
        disbursements: 0,
        installmentsPaid: 50,
      }),
    ).toEqual([]);
  });
});

describe("detectOverdueGrowth", () => {
  const earlier = {
    snapshot_date: "2026-10-03",
    ars_overdue: 2_000_000,
    usd_overdue: 10_000,
  };
  const latest = {
    snapshot_date: "2026-11-02",
    ars_overdue: 2_600_000, // +30 %
    usd_overdue: 10_500, // +5 %
  };

  it("says how much the overdue debt grew vs 30 days before, per currency", () => {
    const [f] = detectOverdueGrowth(latest, earlier, TODAY);
    expect(f?.kind).toBe("receivables_overdue_growth");
    expect(f?.title).toBe("La mora creció 30 % vs hace 30 días");
    expect(f?.severity).toBe("warning");
    expect(f?.finding).toContain("en pesos pasó de $2.000.000 a $2.600.000");
    expect(f?.finding).not.toContain("en dólares");
    expect(f?.metrics).toMatchObject({
      ars_overdue_before: 2_000_000,
      ars_overdue_now: 2_600_000,
      ars_growth_pct: 30,
      snapshot_from: "2026-10-03",
    });
    expect(f?.metrics).not.toHaveProperty("usd_growth_pct");
    expect(f?.source_refs).toEqual([]);
    expect(f?.proposal?.action).toBe("proposeTask");
  });

  it("is critical from 50 % and counts dollars on their own", () => {
    const [f] = detectOverdueGrowth(
      { ...latest, ars_overdue: 2_100_000, usd_overdue: 20_000 },
      earlier,
      TODAY,
    );
    expect(f?.severity).toBe("critical");
    expect(f?.title).toBe("La mora creció 100 % vs hace 30 días");
    expect(f?.finding).toContain("en dólares");
  });

  it("stays quiet below the thresholds, without history, stale or too far apart", () => {
    // +10 %
    expect(
      detectOverdueGrowth(
        { ...latest, ars_overdue: 2_200_000 },
        earlier,
        TODAY,
      ),
    ).toEqual([]);
    // +50 % but only $100.000
    expect(
      detectOverdueGrowth(
        { ...latest, ars_overdue: 300_000 },
        { ...earlier, ars_overdue: 200_000 },
        TODAY,
      ),
    ).toEqual([]);
    // nothing overdue before: no percentage
    expect(
      detectOverdueGrowth(latest, { ...earlier, ars_overdue: 0 }, TODAY),
    ).toEqual([]);
    expect(detectOverdueGrowth(latest, null, TODAY)).toEqual([]);
    expect(detectOverdueGrowth(latest, earlier, "2026-11-20")).toEqual([]);
    expect(
      detectOverdueGrowth(
        latest,
        { ...earlier, snapshot_date: "2026-09-01" },
        TODAY,
      ),
    ).toEqual([]);
  });
});
