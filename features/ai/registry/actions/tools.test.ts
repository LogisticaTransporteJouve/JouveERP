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
import {
  listInvoicesAction,
  type InvoiceListItem,
} from "@/features/invoices/actions/invoices-actions";
import { searchPurchaseInvoicesAction } from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import { getSupplierAgingAction } from "@/features/suppliers/actions/account-actions";
import {
  listChecksAction,
  type CheckListItem,
} from "@/features/checks/actions/checks-actions";
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
import { resolveRows } from "../../artifacts/rows";
import {
  buildAgingReport,
  type AgingPartyInput,
  type AgingViewAmounts,
} from "@/lib/aging";

function agingParty(
  id: string,
  amounts: Partial<AgingViewAmounts>,
): AgingPartyInput {
  return {
    id,
    legal_name: id,
    display_name: null,
    cuit: "20-1-2",
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
    document_count: 1,
    oldest_days: 10,
    ...amounts,
  };
}
import { getInvoices, runInvoices } from "./sales";
import { AI_ACTIONS } from "../catalog";
import { reachedCap, totalsByCurrency } from "../result";
import { resolveAccess } from "@/lib/auth/permissions";

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
    const ctx = { userId: "u1", access: resolveAccess(["owner" as const]) };
    expect(typeof getInvoices.toTool(ctx).execute).toBe("function");
    expect(typeof getPurchaseInvoices.toTool(ctx).execute).toBe("function");
  });
});

describe("runClientAging", () => {
  it("summarizes the aging totals per currency on success", async () => {
    vi.mocked(getAgingSummaryAction).mockResolvedValue({
      ok: true,
      data: buildAgingReport(
        [
          agingParty("c1", { ars_bucket_90_plus: 200, ars_total_open: 1000 }),
          agingParty("c2", { usd_bucket_0_30: 5, usd_total_open: 5 }),
          agingParty("c3", { ars_bucket_0_30: 100, ars_total_open: 100 }),
        ],
        { rate: 1000, rate_date: "2026-10-15" },
      ),
    });
    const r = await runClientAging();
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("3 clients");
    expect(r.summary).toContain("total $1.100 + US$5");
    expect(r.summary).toContain("≈ $6.100");
    expect(r.summary).toContain("+90");
    if (r.ok) {
      expect(resolveRows(r.data)?.[0]).toMatchObject({
        legal_name: "c2",
        total_usd: 5,
        total_ars_equivalent: 5000,
        bucket_0_30_ars: 0,
        bucket_0_30_usd: 5,
        bucket_30_60_ars: 0,
        bucket_60_90_usd: 0,
        bucket_90_plus_ars: 0,
      });
      expect(r.exchangeRate).toEqual({
        currency: "USD",
        rate: 1000,
        date: "2026-10-15",
      });
    }
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
  it("summarizes total payable and +90 bucket without a rate", async () => {
    vi.mocked(getSupplierAgingAction).mockResolvedValue({
      ok: true,
      data: buildAgingReport(
        [
          agingParty("s1", { ars_total_open: 800, ars_bucket_90_plus: 300 }),
          agingParty("s2", { usd_total_open: 200, usd_bucket_0_30: 200 }),
        ],
        null,
      ),
    });
    const r = await runSupplierAging();
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("2 suppliers");
    expect(r.summary).toContain("not consolidated");
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

describe("per-currency totals in list summaries", () => {
  it("runInvoices sums emitted documents per currency, credit notes subtracting", async () => {
    const item = {
      id: "i",
      channel_id: "f",
      channel_name: "Fiscal",
      channel_is_fiscal: true,
      client_id: "c",
      client_legal_name: "Acme",
      kind: "factura",
      letter: "A",
      punto_venta: 1,
      numero: 1,
      fecha: "2026-05-01",
      imp_total: 1000,
      moneda: "PES",
      status: "emitted",
      cae: null,
      emitted_at: null,
    } satisfies InvoiceListItem;
    vi.mocked(listInvoicesAction).mockResolvedValue({
      ok: true,
      data: {
        items: [
          item,
          { ...item, id: "nc", kind: "nc", imp_total: 200 },
          { ...item, id: "usd", moneda: "DOL", imp_total: 50 },
          { ...item, id: "draft", status: "draft", imp_total: 9999 },
        ],
        nextOffset: null,
      },
    });
    const r = await runInvoices({});
    expect(r.summary).toContain("emitted total $800 + US$50");
  });

  it("totalsByCurrency keeps every currency apart and skips what does not count", () => {
    expect(
      totalsByCurrency([
        { amount: 1000, currency: "ARS", counts: true },
        { amount: 10, currency: "USD", counts: true },
        { amount: 5, currency: "DOL", counts: true },
        { amount: 7, currency: "060", counts: true },
        { amount: 99, currency: "ARS", counts: false },
      ]),
    ).toBe("$1.000 + US$15 + 060 7");
    expect(totalsByCurrency([])).toBe("$0");
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
    expect(r.ok && r.partial).toBe(false);
  });

  it("flags the 500-check list cap as partial in the result and summary", async () => {
    const check: CheckListItem = {
      id: "c1",
      amount: 100,
      bank_name: "Banco",
      cartera_account_id: "a1",
      channel_id: null,
      check_number: "1",
      created_at: "2026-01-01T00:00:00Z",
      created_by: null,
      currency: "ARS",
      drawer_cuit: null,
      drawer_name: "Acme",
      due_date: "2026-02-01",
      issue_date: "2026-01-01",
      kind: "fisico",
      notes: null,
      source_client_id: null,
      source_kind: "receipt",
      source_payment_line_id: null,
      source_receipt_id: null,
      status: "en_cartera",
      updated_at: "2026-01-01T00:00:00Z",
      cartera_account_name: "Cartera",
      source_client_legal_name: null,
    };
    vi.mocked(listChecksAction).mockResolvedValue({
      ok: true,
      data: { items: Array.from({ length: 500 }, () => check) },
    });
    const r = await runChecks();
    expect(r.ok && r.partial).toBe(true);
    expect(r.summary).toContain("capped at 500");
  });
});

describe("reachedCap", () => {
  it("is true only when a capped read came back full", () => {
    expect(reachedCap(999)).toBe(false);
    expect(reachedCap(1000)).toBe(true);
    expect(reachedCap(200, 200)).toBe(true);
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
