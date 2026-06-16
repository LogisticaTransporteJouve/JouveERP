import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/aging/actions/aging-actions", () => ({
  getAgingSummaryAction: vi.fn(),
}));
vi.mock("@/features/balance/actions/balance-actions", () => ({
  getAccountBalancesAction: vi.fn(),
}));
vi.mock("@/features/libro-mayor/actions/libro-mayor-actions", () => ({
  getLedgerAction: vi.fn(),
}));
vi.mock("@/features/libro-iva/actions/libro-iva-actions", () => ({
  listLibroIvaVentasAction: vi.fn(),
  listLibroIvaComprasAction: vi.fn(),
}));
vi.mock("@/features/treasury/actions/treasury-actions", () => ({
  getTreasurySummaryAction: vi.fn(),
}));
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  listInvoicesAction: vi.fn(),
}));
vi.mock("@/features/receipts/actions/receipts-actions", () => ({
  listReceiptsAction: vi.fn(),
}));
vi.mock("@/features/clients/actions/clients-actions", () => ({
  searchClientsAction: vi.fn(),
}));
vi.mock("@/features/purchase-invoices/actions/purchase-invoices-actions", () => ({
  searchPurchaseInvoicesAction: vi.fn(),
}));
vi.mock("@/features/suppliers/actions/account-actions", () => ({
  getSupplierAgingAction: vi.fn(),
}));
vi.mock("@/features/payment-orders/actions/payment-orders-actions", () => ({
  listPaymentOrdersAction: vi.fn(),
}));
vi.mock("@/features/suppliers/actions/suppliers-actions", () => ({
  searchSuppliersAction: vi.fn(),
}));

import { getAgingSummaryAction } from "@/features/aging/actions/aging-actions";
import { getAccountBalancesAction } from "@/features/balance/actions/balance-actions";
import { getLedgerAction } from "@/features/libro-mayor/actions/libro-mayor-actions";
import { listLibroIvaVentasAction } from "@/features/libro-iva/actions/libro-iva-actions";
import { listInvoicesAction } from "@/features/invoices/actions/invoices-actions";
import { searchPurchaseInvoicesAction } from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import { getSupplierAgingAction } from "@/features/suppliers/actions/account-actions";

import { runLedger, runLibroIvaVentas, runTrialBalance } from "./accounting";
import { getPurchaseInvoices, runPurchaseInvoices, runSupplierAging } from "./purchases";
import { runClientAging } from "./receivables";
import { getInvoices, runInvoices } from "./sales";
import { AI_TOOL_NAMES, aiTools } from "./registry";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ai tools registry", () => {
  it("exposes 13 uniquely-named tools, each with a non-trivial description", () => {
    expect(AI_TOOL_NAMES).toHaveLength(13);
    expect(new Set(AI_TOOL_NAMES).size).toBe(13);
    for (const name of AI_TOOL_NAMES) {
      const desc = aiTools[name].description;
      expect(typeof desc).toBe("string");
      expect((desc ?? "").length).toBeGreaterThan(10);
    }
  });

  it("includes the sales + payables tools added in AI.4", () => {
    for (const name of [
      "getInvoices",
      "getReceipts",
      "searchClients",
      "getSupplierAging",
      "getPurchaseInvoices",
      "getPaymentOrders",
      "searchSuppliers",
    ]) {
      expect(AI_TOOL_NAMES).toContain(name);
    }
    // tool() handles bound correctly (defensive: catches a bad re-export)
    expect(typeof getInvoices.execute).toBe("function");
    expect(typeof getPurchaseInvoices.execute).toBe("function");
  });
});

describe("runClientAging", () => {
  it("summarizes the aging totals on success", async () => {
    vi.mocked(getAgingSummaryAction).mockResolvedValue({
      ok: true,
      data: {
        clients: [],
        totals: {
          bucket_0_30: 100,
          bucket_30_60: 0,
          bucket_60_90: 0,
          bucket_90_plus: 200,
          total_open: 1000,
          client_count: 3,
          document_count: 5,
        },
      },
    });
    const r = await runClientAging();
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("3 clientes");
    expect(r.summary).toContain("+90");
  });

  it("returns an error result (never throws) when the action denies", async () => {
    vi.mocked(getAgingSummaryAction).mockResolvedValue({
      ok: false,
      error: "No tenés permiso para ver aging.",
    });
    const r = await runClientAging();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("No tenés permiso para ver aging.");
  });
});

describe("runTrialBalance", () => {
  it("forwards periodEnd (periodStart defaults to null) and reports the count", async () => {
    vi.mocked(getAccountBalancesAction).mockResolvedValue({ ok: true, data: [] });
    const r = await runTrialBalance({ periodEnd: "2026-05" });
    expect(getAccountBalancesAction).toHaveBeenCalledWith({
      periodEnd: "2026-05",
      periodStart: null,
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("2026-05");
  });
});

describe("runLedger", () => {
  it("flags truncation in the summary", async () => {
    vi.mocked(getLedgerAction).mockResolvedValue({
      ok: true,
      data: { rows: [], truncated: true },
    });
    const r = await runLedger({ accountId: "acc-1" });
    expect(getLedgerAction).toHaveBeenCalledWith({
      accountId: "acc-1",
      from: null,
      to: null,
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("truncado");
  });
});

describe("runLibroIvaVentas", () => {
  it("reports the row count for the period", async () => {
    vi.mocked(listLibroIvaVentasAction).mockResolvedValue({ ok: true, data: [] });
    const r = await runLibroIvaVentas({ period: "2026-05" });
    expect(listLibroIvaVentasAction).toHaveBeenCalledWith({
      period: "2026-05",
      channelId: null,
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("IVA Ventas");
  });
});

describe("runInvoices", () => {
  it("forwards mapped filters and flags more pages", async () => {
    vi.mocked(listInvoicesAction).mockResolvedValue({
      ok: true,
      data: { items: [], nextOffset: 25 },
    });
    const r = await runInvoices({ query: "Acme" });
    expect(listInvoicesAction).toHaveBeenCalledWith({
      query: "Acme",
      channel_id: null,
      fecha_desde: null,
      fecha_hasta: null,
      limit: 25,
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("0 comprobantes");
    expect(r.summary).toContain("hay más");
  });
});

describe("runSupplierAging", () => {
  it("summarizes total payable and +90 bucket", async () => {
    const row = {
      supplier_id: "s",
      supplier_legal_name: "Prov",
      supplier_cuit: "20-1-2",
      bucket_0_30: 0,
      bucket_30_60: 0,
      bucket_60_90: 0,
      bucket_90_plus: 0,
      total_open: 0,
      document_count: 1,
      oldest_days: 10,
    };
    vi.mocked(getSupplierAgingAction).mockResolvedValue({
      ok: true,
      data: [
        { ...row, total_open: 800, bucket_90_plus: 300 },
        { ...row, total_open: 200 },
      ],
    });
    const r = await runSupplierAging();
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("2 proveedores");
    expect(r.summary).toContain("+90");
  });

  it("returns an error result (never throws) when the action denies", async () => {
    vi.mocked(getSupplierAgingAction).mockResolvedValue({
      ok: false,
      error: "No tenés permiso.",
    });
    const r = await runSupplierAging();
    expect(r.ok).toBe(false);
  });
});

describe("runPurchaseInvoices", () => {
  it("defaults the query to empty and forwards filters", async () => {
    vi.mocked(searchPurchaseInvoicesAction).mockResolvedValue({
      ok: true,
      data: { invoices: [], nextOffset: null },
    });
    const r = await runPurchaseInvoices({ supplierId: "sup-1" });
    expect(searchPurchaseInvoicesAction).toHaveBeenCalledWith({
      query: "",
      supplierId: "sup-1",
      channelId: null,
      fechaFrom: null,
      fechaTo: null,
      limit: 25,
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("0 facturas de compra");
  });
});
