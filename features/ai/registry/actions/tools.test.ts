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
vi.mock(
  "@/features/purchase-invoices/actions/purchase-invoices-actions",
  () => ({
    searchPurchaseInvoicesAction: vi.fn(),
  }),
);
vi.mock("@/features/suppliers/actions/account-actions", () => ({
  getSupplierAgingAction: vi.fn(),
}));
vi.mock("@/features/payment-orders/actions/payment-orders-actions", () => ({
  listPaymentOrdersAction: vi.fn(),
}));
vi.mock("@/features/suppliers/actions/suppliers-actions", () => ({
  searchSuppliersAction: vi.fn(),
}));
vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction: vi.fn(),
}));
vi.mock("@/features/transactions/actions/transactions-actions", () => ({
  listTransactionsAction: vi.fn(),
}));
vi.mock("@/features/checks/actions/checks-actions", () => ({
  listChecksAction: vi.fn(),
}));
vi.mock("@/features/issued-checks/actions/issued-checks-actions", () => ({
  listIssuedChecksAction: vi.fn(),
}));
vi.mock(
  "@/features/chart-of-accounts/actions/chart-of-accounts-actions",
  () => ({
    listChartOfAccountsAction: vi.fn(),
  }),
);
vi.mock("@/features/journal-entries/actions/journal-entries-actions", () => ({
  listJournalEntriesAction: vi.fn(),
}));
vi.mock("@/features/cost-centers/actions/cost-centers-actions", () => ({
  listCostCentersAction: vi.fn(),
}));
vi.mock("@/features/inflation/actions/inflation-actions", () => ({
  listInflationAdjustmentsAction: vi.fn(),
}));
vi.mock("@/features/hr/actions/employees-actions", () => ({
  listEmployeesAction: vi.fn(),
  searchEmployeesAction: vi.fn(),
}));
vi.mock("@/features/hr/actions/attendance-actions", () => ({
  getAttendanceMonthAction: vi.fn(),
}));
vi.mock(
  "@/features/employee-documents/actions/employee-documents-actions",
  () => ({
    listExpiringDocumentsAction: vi.fn(),
  }),
);

import { getAgingSummaryAction } from "@/features/aging/actions/aging-actions";
import { getAccountBalancesAction } from "@/features/balance/actions/balance-actions";
import { getLedgerAction } from "@/features/libro-mayor/actions/libro-mayor-actions";
import { listLibroIvaVentasAction } from "@/features/libro-iva/actions/libro-iva-actions";
import { listInvoicesAction } from "@/features/invoices/actions/invoices-actions";
import { searchPurchaseInvoicesAction } from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import { getSupplierAgingAction } from "@/features/suppliers/actions/account-actions";
import { listChecksAction } from "@/features/checks/actions/checks-actions";
import { getAttendanceMonthAction } from "@/features/hr/actions/attendance-actions";

import { runLedger, runLibroIvaVentas, runTrialBalance } from "./accounting";
import { runChecks } from "./cash";
import { runAttendance } from "./hr";
import {
  getPurchaseInvoices,
  runPurchaseInvoices,
  runSupplierAging,
} from "./purchases";
import { runClientAging } from "./receivables";
import { getInvoices, runInvoices } from "./sales";
import { AI_ACTIONS } from "../catalog";

beforeEach(() => {
  vi.clearAllMocks();
});

const MIGRATED_TOOLS = [
  "getClientAging",
  "getInvoices",
  "getReceipts",
  "searchClients",
  "getSupplierAging",
  "getPurchaseInvoices",
  "getPaymentOrders",
  "searchSuppliers",
  "getTreasurySummary",
  "getAccounts",
  "getTransactions",
  "getChecks",
  "getIssuedChecks",
  "getTrialBalance",
  "getLedger",
  "getLibroIvaVentas",
  "getLibroIvaCompras",
  "getChartOfAccounts",
  "getJournalEntries",
  "getCostCenters",
  "getInflationAdjustments",
  "getEmployees",
  "searchEmployees",
  "getAttendance",
  "getExpiringDocuments",
  "getVehicles",
  "getTrips",
  "getFuelLoads",
  "getMaintenance",
  "getFleetDocuments",
  "getFleetProfitability",
];

describe("ai action registry", () => {
  it("keeps every pre-registry tool, uniquely named, each with a non-trivial description", () => {
    const names = AI_ACTIONS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of MIGRATED_TOOLS) {
      const action = AI_ACTIONS.find((a) => a.name === name);
      expect(action, name).toBeDefined();
      expect(action?.description.length).toBeGreaterThan(10);
      expect(action?.sideEffect).toBe("read");
    }
  });

  it("binds the sales + payables actions to AI SDK tools", () => {
    const ctx = { userId: "u1", roles: ["owner" as const] };
    expect(typeof getInvoices.toTool(ctx).execute).toBe("function");
    expect(typeof getPurchaseInvoices.toTool(ctx).execute).toBe("function");
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
    expect(r.summary).toContain("3 clients");
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
    vi.mocked(getAccountBalancesAction).mockResolvedValue({
      ok: true,
      data: [],
    });
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
    expect(r.summary).toContain("truncated");
  });
});

describe("runLibroIvaVentas", () => {
  it("reports the row count for the period", async () => {
    vi.mocked(listLibroIvaVentasAction).mockResolvedValue({
      ok: true,
      data: [],
    });
    const r = await runLibroIvaVentas({ period: "2026-05" });
    expect(listLibroIvaVentasAction).toHaveBeenCalledWith({
      period: "2026-05",
      channelId: null,
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("VAT Sales");
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
    expect(r.summary).toContain("0 invoices");
    expect(r.summary).toContain("more available");
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
    expect(r.summary).toContain("2 suppliers");
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
    expect(r.summary).toContain("0 purchase invoices");
  });
});

describe("runChecks", () => {
  it("returns a summary over an empty portfolio without throwing", async () => {
    vi.mocked(listChecksAction).mockResolvedValue({
      ok: true,
      data: { items: [] },
    });
    const r = await runChecks();
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("0 checks received");
  });
});

describe("runAttendance", () => {
  it("calls the action with positional year/month", async () => {
    vi.mocked(getAttendanceMonthAction).mockResolvedValue({
      ok: true,
      data: { year: 2026, month: 5, records: [], holidays: [] },
    });
    const r = await runAttendance({ year: 2026, month: 5 });
    expect(getAttendanceMonthAction).toHaveBeenCalledWith(2026, 5);
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("05/2026");
  });
});
