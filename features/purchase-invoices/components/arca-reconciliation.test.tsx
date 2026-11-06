// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ReconciliationDetail,
  ReconciliationMonth,
} from "../lib/arca-reconciliation";

const h = vi.hoisted(() => ({ periods: [] as string[] }));

const MONTHS: ReconciliationMonth[] = [
  {
    month: "2026-10-01",
    arca_count: 2,
    arca_uncomparable: 0,
    arca_neto: 200,
    arca_iva: 42,
    arca_trib: 0,
    arca_total: 242,
    erp_count: 2,
    erp_neto: 200,
    erp_iva: 42,
    erp_trib: 0,
    erp_total: 246,
    arca_only: 0,
    erp_only: 0,
    amount_mismatch: 1,
  },
];

const DETAIL: ReconciliationDetail = {
  arca_only: {
    count: 1,
    rows: [
      {
        issue: "arca_only",
        issue_count: 1,
        voucher_id: "v1",
        voucher_status: "pending_review",
        purchase_invoice_id: null,
        fecha: "2026-10-03",
        issuer_cuit: "20999999999",
        issuer_name: "NUEVO SA",
        cbte_tipo: 1,
        kind: "factura",
        letter: "A",
        punto_venta: 4,
        numero: 99,
        arca_moneda: "PES",
        arca_total: 242,
        erp_moneda: null,
        erp_total: null,
      },
    ],
  },
  erp_only: { count: 0, rows: [] },
  amount_mismatch: {
    count: 1,
    rows: [
      {
        issue: "amount_mismatch",
        issue_count: 1,
        voucher_id: "v2",
        voucher_status: "pending_review",
        purchase_invoice_id: "p2",
        fecha: "2026-10-06",
        issuer_cuit: "20111111111",
        issuer_name: "Uno",
        cbte_tipo: 1,
        kind: "factura",
        letter: "A",
        punto_venta: 1,
        numero: 11,
        arca_moneda: "PES",
        arca_total: 121,
        erp_moneda: "PES",
        erp_total: 125,
      },
    ],
  },
};

vi.mock("../hooks/use-arca-reconciliation", () => ({
  useArcaReconciliationMonths: () => ({ data: MONTHS }),
  useArcaReconciliationDetail: (period: string) => {
    h.periods.push(period);
    return { data: DETAIL };
  },
}));

const { ArcaReconciliation } = await import("./arca-reconciliation");

afterEach(() => {
  cleanup();
  h.periods.length = 0;
});

describe("ArcaReconciliation", () => {
  it("shows each side and only the differences that are not zero", () => {
    render(<ArcaReconciliation />);
    // The year opens with its month: in both, Cantidad, Neto, IVA and Otros
    // tributos match and only the total differs.
    expect(screen.getAllByText("—")).toHaveLength(8);
    expect(screen.getAllByText("-$ 4,00")).toHaveLength(2);
    expect(screen.getAllByText("Con diferencias")).toHaveLength(2);
  });

  it("opens the latest year and lists its vouchers with their links", () => {
    render(<ArcaReconciliation />);
    expect(h.periods.at(-1)).toBe("2026");
    expect(
      screen
        .getByRole("link", { name: "Ver en la bandeja" })
        .getAttribute("href"),
    ).toBe("/purchases/arca?estado=pending_review");
    expect(
      screen.getByRole("link", { name: "Ver compra" }).getAttribute("href"),
    ).toBe("/purchases/p2");
    expect(
      screen.getByText("Todas las compras fiscales aparecen en ARCA."),
    ).toBeTruthy();
  });

  it("selects a month", () => {
    render(<ArcaReconciliation />);
    fireEvent.click(screen.getByRole("button", { name: /oct 2026/i }));
    expect(h.periods.at(-1)).toBe("2026-10");
  });
});
