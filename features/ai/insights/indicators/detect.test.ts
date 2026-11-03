import { describe, expect, it } from "vitest";

import { insightFingerprint } from "../lib/fingerprint";
import {
  detectCashVsFinancing,
  detectClientMarginDrop,
  detectFuelOutliers,
  detectLateInterestUncharged,
  detectLoanInstallmentsDue,
  detectPendingSettlements,
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
  it("counts only lines older than 15 days and proposes a task", () => {
    const [f] = detectUnreconciledLines(
      [
        {
          id: "l1",
          account_name: "Banco",
          line_date: "2026-10-01",
          amount: -100,
        },
        {
          id: "l2",
          account_name: "Banco",
          line_date: "2026-10-30",
          amount: 50,
        },
      ],
      TODAY,
    );
    expect(f?.source_refs).toEqual(["l1"]);
    expect(f?.metrics.total_amount).toBe(100);
    expect(f?.proposal?.action).toBe("proposeTask");
    expect(f?.proposal?.input.title).toBe("Conciliar el extracto de Banco");
  });
});

describe("detectPendingSettlements", () => {
  it("flags old cash-on-delivery cargas and stale drafts", () => {
    const [f] = detectPendingSettlements(
      [
        {
          shipment_id: "s1",
          driver_name: "Juan",
          delivery_date: "2026-10-20",
          cod_amount: 5000,
        },
        {
          shipment_id: "s2",
          driver_name: "Juan",
          delivery_date: TODAY,
          cod_amount: 9000,
        },
      ],
      [{ id: "d1", driver_name: "Ana", settlement_date: "2026-10-01" }],
      TODAY,
    );
    expect(f?.metrics).toMatchObject({
      shipment_count: 1,
      total_amount: 5000,
      draft_count: 1,
    });
    expect(f?.source_refs).toEqual(["d1", "s1"]);
    expect(f?.proposal?.input.title).toBe("Rendir las cobranzas de Juan");
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
