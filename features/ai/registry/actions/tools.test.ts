import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LedgerRow } from "@/features/libro-mayor/schema";

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
import {
  listLibroIvaComprasAction,
  listLibroIvaVentasAction,
} from "@/features/libro-iva/actions/libro-iva-actions";
import type {
  LibroIvaComprasRow,
  LibroIvaVentasRow,
} from "@/features/libro-iva/schema";
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
import { listIssuedChecksAction } from "@/features/issued-checks/actions/issued-checks-actions";
import { getTreasurySummaryAction } from "@/features/treasury/actions/treasury-actions";
import type { IssuedCheck } from "@/features/issued-checks/schema";

import { listJournalEntriesAction } from "@/features/journal-entries/actions/journal-entries-actions";

import {
  runJournalEntries,
  runLedger,
  runLibroIvaCompras,
  runLibroIvaVentas,
  runTrialBalance,
} from "./accounting";
import { buildChartArtifact } from "../../artifacts/build";
import { isPlainCaption } from "../../artifacts/format";

import { runChecks, runIssuedChecks } from "./cash";
import { runTreasurySummary } from "./treasury";
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

const ledgerRow = (running: number): LedgerRow => ({
  entry_id: "e",
  line_id: `l-${running}`,
  entry_date: "2026-05-01",
  accrual_period: "2026-05",
  description: "",
  source_table: null,
  source_id: null,
  channel_id: null,
  is_reversal: false,
  debit: 0,
  credit: 0,
  line_desc: null,
  running,
  account_code: "1.1.1.2",
  account_name: "Bancos",
});

describe("runLedger", () => {
  it("flags truncation in the summary", async () => {
    vi.mocked(getLedgerAction).mockResolvedValue({
      ok: true,
      data: { rows: [], truncated: true, opening: 0 },
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

  it("takes the closing balance from the newest line (the first)", async () => {
    vi.mocked(getLedgerAction).mockResolvedValue({
      ok: true,
      data: {
        rows: [ledgerRow(900), ledgerRow(700)],
        truncated: false,
        opening: 0,
      },
    });
    const r = await runLedger({ accountId: "acc-1" });
    expect(r.summary).toContain("closing balance $900.");
  });

  it("reports the opening balance of a dated range", async () => {
    vi.mocked(getLedgerAction).mockResolvedValue({
      ok: true,
      data: { rows: [], truncated: false, opening: 1500 },
    });
    const r = await runLedger({ accountId: "acc-1", from: "2026-05-01" });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("opening balance");
    expect(r.summary).toContain("closing balance");
  });
});

describe("runLibroIvaVentas", () => {
  it("reads every fiscal channel of the period and says so", async () => {
    vi.mocked(listLibroIvaVentasAction).mockResolvedValue({
      ok: true,
      data: [],
    });
    const r = await runLibroIvaVentas({ period: "2026-05" });
    expect(listLibroIvaVentasAction).toHaveBeenCalledWith({
      period: "2026-05",
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/^Solo fiscal: .*VAT Sales/);
  });
});

// A libro IVA row: one document × rate, NC amounts positive, the document's
// totals repeated on each of its rate rows (as the RPC returns them).
function ventaRow(over: Partial<LibroIvaVentasRow>): LibroIvaVentasRow {
  return {
    invoice_id: "f1",
    fecha: "2026-05-10",
    kind: "factura",
    letter: "A",
    punto_venta: 1,
    numero: 1,
    cbte_tipo_afip: 1,
    client_legal_name: "Cliente",
    doc_tipo: 80,
    doc_nro: "30000000007",
    cae: null,
    cae_vencimiento: null,
    iva_rate_id: 5,
    iva_rate_pct: 21,
    neto: 0,
    iva: 0,
    imp_trib: 0,
    imp_op_ex: 0,
    imp_tot_conc: 0,
    imp_total: 0,
    channel_id: "jouve_fiscal",
    channel_name: "Fiscal",
    has_items: false,
    moneda: "PES",
    cotizacion: 1,
    neto_orig: 0,
    iva_orig: 0,
    imp_trib_orig: 0,
    imp_op_ex_orig: 0,
    imp_tot_conc_orig: 0,
    imp_total_orig: 0,
    ...over,
  };
}

function compraRow(over: Partial<LibroIvaComprasRow>): LibroIvaComprasRow {
  return {
    purchase_invoice_id: "c1",
    fecha: "2026-05-10",
    kind: "factura",
    letter: "A",
    punto_venta: 1,
    numero: 1,
    supplier_legal_name: "Proveedor",
    supplier_cuit: null,
    cae_proveedor: null,
    cae_vto_proveedor: null,
    iva_rate_id: 5,
    iva_rate_pct: 21,
    neto: 0,
    iva: 0,
    imp_trib: 0,
    imp_total: 0,
    channel_id: "jouve_fiscal",
    channel_name: "Fiscal",
    has_items: false,
    moneda: "PES",
    cotizacion: 1,
    neto_orig: 0,
    iva_orig: 0,
    imp_trib_orig: 0,
    imp_total_orig: 0,
    no_gravado: 0,
    exentas: 0,
    perc_iva: 0,
    perc_iibb: 0,
    perc_nacionales: 0,
    perc_municipales: 0,
    impuestos_internos: 0,
    no_gravado_orig: 0,
    exentas_orig: 0,
    perc_iva_orig: 0,
    perc_iibb_orig: 0,
    perc_nacionales_orig: 0,
    perc_municipales_orig: 0,
    impuestos_internos_orig: 0,
    ...over,
  };
}

describe("libro IVA totals", () => {
  it("ventas: signed IVA débito, each document's total once", async () => {
    vi.mocked(listLibroIvaVentasAction).mockResolvedValue({
      ok: true,
      data: [
        // A two-rate factura: 1000 at 21% + 1000 at 10.5%, total 2315.
        // Exento 50, repeated on both rate rows like imp_total.
        ventaRow({ neto: 1000, iva: 210, imp_op_ex: 50, imp_total: 2315 }),
        ventaRow({
          iva_rate_id: 4,
          iva_rate_pct: 10.5,
          neto: 1000,
          iva: 105,
          imp_op_ex: 50,
          imp_total: 2315,
        }),
        // An NC of 100 + 21 on it.
        ventaRow({
          invoice_id: "nc1",
          kind: "nc",
          numero: 2,
          neto: 100,
          iva: 21,
          imp_total: 121,
        }),
      ],
    });
    const r = await runLibroIvaVentas({ period: "2026-05" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      totals: {
        documents: 2,
        neto: 1900,
        iva: 294,
        imp_total: 2194,
        imp_op_ex: 50,
        imp_tot_conc: 0,
        per_rate: [
          { alicuota: "10.5%", neto: 1000, iva: 105 },
          { alicuota: "21%", neto: 900, iva: 189 },
        ],
      },
    });
    expect(r.summary).toContain("IVA débito");
  });

  it("ventas: a voucher without items counts under the rate the book prints", async () => {
    vi.mocked(listLibroIvaVentasAction).mockResolvedValue({
      ok: true,
      data: [
        // Imported from ARCA: header only.
        ventaRow({
          iva_rate_id: null,
          iva_rate_pct: null,
          neto: 1000,
          iva: 210,
          imp_total: 1210,
          neto_orig: 1000,
          iva_orig: 210,
        }),
        ventaRow({
          invoice_id: "x2",
          numero: 2,
          iva_rate_id: null,
          iva_rate_pct: null,
          neto: 1000,
          iva: 150,
          imp_total: 1150,
          neto_orig: 1000,
          iva_orig: 150,
        }),
      ],
    });
    const r = await runLibroIvaVentas({ period: "2026-05" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      totals: {
        iva: 360,
        per_rate: [
          { alicuota: "Sin alícuota", neto: 1000, iva: 150 },
          { alicuota: "21%", neto: 1000, iva: 210 },
        ],
      },
    });
  });

  it("compras: signed IVA crédito and otros tributos", async () => {
    vi.mocked(listLibroIvaComprasAction).mockResolvedValue({
      ok: true,
      data: [
        compraRow({ neto: 1000, iva: 210, imp_trib: 30, imp_total: 1240 }),
        compraRow({
          purchase_invoice_id: "nc1",
          kind: "nc",
          numero: 2,
          neto: 200,
          iva: 42,
          imp_total: 242,
        }),
      ],
    });
    const r = await runLibroIvaCompras({ period: "2026-05" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      totals: {
        documents: 2,
        neto: 800,
        iva: 168,
        imp_trib: 30,
        imp_total: 998,
      },
    });
  });

  it("compras: a B purchase's amount, IVA inside, stays out of neto", async () => {
    vi.mocked(listLibroIvaComprasAction).mockResolvedValue({
      ok: true,
      data: [
        compraRow({ neto: 1000, iva: 210, imp_total: 1210 }),
        compraRow({
          purchase_invoice_id: "b1",
          letter: "B",
          numero: 3,
          iva_rate_id: null,
          iva_rate_pct: null,
          neto: 1210,
          iva: 0,
          imp_total: 1210,
          neto_orig: 1210,
        }),
      ],
    });
    const r = await runLibroIvaCompras({ period: "2026-05" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      totals: {
        neto: 1000,
        iva: 210,
        sin_discriminar: 1210,
        imp_total: 2420,
        per_rate: expect.arrayContaining([
          { alicuota: "Sin discriminar (B/C)", neto: 1210, iva: 0 },
        ]),
      },
    });
    expect(r.summary).toContain("sin discriminar (B/C, IVA incluido)");
  });
});

describe("libro IVA captions and charts", () => {
  it("ventas: the user caption is plain Spanish; the row rules go to the model only", async () => {
    vi.mocked(listLibroIvaVentasAction).mockResolvedValue({
      ok: true,
      data: [ventaRow({ punto_venta: 3, numero: 22271 })],
    });
    const r = await runLibroIvaVentas({ period: "2026-11" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.note).toContain("Importes en pesos");
    expect(isPlainCaption(r.note ?? "")).toBe(true);
    expect(r.modelNote).toContain("`totals`");
    expect(r.data).toMatchObject({
      rows: [{ comprobante: "A0003-00022271" }],
    });
  });

  it("compras: the same split", async () => {
    vi.mocked(listLibroIvaComprasAction).mockResolvedValue({
      ok: true,
      data: [compraRow({ numero: 7 })],
    });
    const r = await runLibroIvaCompras({ period: "2026-11" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(isPlainCaption(r.note ?? "")).toBe(true);
    expect(r.modelNote).toBeTruthy();
    expect(r.data).toMatchObject({
      rows: [{ comprobante: "A00001-00000007" }],
    });
  });

  it("a chart by invoice number labels the axis by date and names the document on hover", async () => {
    vi.mocked(listLibroIvaVentasAction).mockResolvedValue({
      ok: true,
      data: [
        ventaRow({
          fecha: "2026-11-03",
          punto_venta: 3,
          numero: 22271,
          client_legal_name: "Acme SA",
          neto: 1000,
          iva: 210,
        }),
        ventaRow({
          invoice_id: "f2",
          fecha: "2026-11-04",
          punto_venta: 3,
          numero: 22276,
          client_legal_name: "Beta SRL",
          neto: 500,
          iva: 105,
        }),
      ],
    });
    const r = await runLibroIvaVentas({ period: "2026-11" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const built = buildChartArtifact(
      {
        type: "bar",
        title: "IVA ventas 2026-11 por comprobante",
        x: "numero",
        series: [{ field: "neto" }, { field: "iva" }],
      },
      {
        source: { action: "getLibroIvaVentas", input: { period: "2026-11" } },
        rows: resolveRows(r.data, "rows") ?? [],
        meta: { sources: [], asOf: "2026-11-06T12:00:00Z", partial: false },
      },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.chart.tick).toBe("fecha");
    expect(built.value.chart.detail).toEqual([
      { field: "comprobante", label: "Comprobante" },
      { field: "client_legal_name", label: "Cliente" },
      { field: "fecha", label: "Fecha" },
    ]);
    expect(built.value.points[0]).toEqual({
      x: "22271",
      values: [1000, 210],
      tick: "2026-11-03",
      detail: ["A0003-00022271", "Acme SA", "2026-11-03"],
    });
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
      isFiscal: null,
      fecha_desde: null,
      fecha_hasta: null,
      limit: 25,
    });
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("0 invoices");
    expect(r.summary).toContain("more available");
    expect(r.summary).toContain("Todos los canales");
  });

  it("reads only fiscal channels and labels the figure with scope 'fiscal'", async () => {
    vi.mocked(listInvoicesAction).mockResolvedValue({
      ok: true,
      data: { items: [], nextOffset: null },
    });
    const r = await runInvoices({ scope: "fiscal" });
    expect(listInvoicesAction).toHaveBeenCalledWith(
      expect.objectContaining({ isFiscal: true }),
    );
    expect(r.summary).toContain("Solo fiscal");
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
      is_operational: true,
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
      isFiscal: null,
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
      data: { items: [], truncated: false },
    });
    const r = await runChecks();
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("0 checks received");
    expect(r.ok && r.partial).toBe(false);
  });

  it("flags a truncated list as partial in the result and summary", async () => {
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
      data: { items: [check], truncated: true },
    });
    const r = await runChecks();
    expect(r.ok && r.partial).toBe(true);
    expect(r.summary).toContain("latest 500 settled");
  });

  it("totals only the checks in portfolio or deposited", async () => {
    const base: CheckListItem = {
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
      data: {
        items: [
          base,
          { ...base, id: "c2", amount: 50, status: "depositado" },
          { ...base, id: "c3", amount: 1000, status: "acreditado" },
          { ...base, id: "c4", amount: 2000, status: "endosado" },
          { ...base, id: "c5", amount: 4000, status: "rechazado" },
        ],
        truncated: false,
      },
    });
    const r = await runChecks();
    expect(r.summary).toContain(
      `5 checks received · 2 in portfolio or deposited, total ${totalsByCurrency(
        [{ amount: 150, currency: "ARS", counts: true }],
      )} (per currency).`,
    );
  });
});

describe("runTreasurySummary", () => {
  it("says the checks due soon are pesos only", async () => {
    vi.mocked(getTreasurySummaryAction).mockResolvedValue({
      ok: true,
      data: {
        as_of: "2026-11-04",
        prev_eom: "2026-10-31",
        accounts: [],
        liquid_now: { ARS: 0, USD: 0 },
        liquid_prev_eom: { ARS: 0, USD: 0 },
        checks_now: 0,
        checks_prev_eom: 0,
        checks_usd_now: 500,
        checks_usd_prev_eom: 0,
        checks_due_soon: { count: 0, amount: 0 },
        usd_rate: null,
      },
    });
    const r = await runTreasurySummary();
    expect(r.summary).toContain("0 ARS checks in portfolio due soon");
    expect(r.summary).toContain("pesos only");
  });
});

describe("runIssuedChecks", () => {
  const base: IssuedCheck = {
    id: "ic1",
    kind: "fisico",
    check_number: "1",
    bank_name: "Banco",
    beneficiary_name: null,
    beneficiary_cuit: null,
    issue_date: "2026-11-01",
    due_date: "2026-11-30",
    amount: 100,
    currency: "ARS",
    bank_account_id: "a1",
    payment_order_id: null,
    channel_id: null,
    supplier_id: null,
    status: "emitted",
    cashed_at: null,
    rejected_at: null,
    cancelled_at: null,
    cancelled_by: null,
    notes: null,
    created_by: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };

  it("totals only the checks not yet cashed, and says the list is capped", async () => {
    vi.mocked(listIssuedChecksAction).mockResolvedValue({
      ok: true,
      data: {
        items: [
          base,
          { ...base, id: "ic2" },
          { ...base, id: "ic3", amount: 500, status: "cancelled" },
          { ...base, id: "ic4", amount: 1000, status: "cashed" },
          { ...base, id: "ic5", amount: 3000, status: "rejected" },
        ],
        truncated: true,
      },
    });
    const r = await runIssuedChecks();
    expect(r.ok && r.partial).toBe(true);
    expect(r.summary).toContain(
      `5 own checks issued · 2 not yet cashed, total ${totalsByCurrency([
        { amount: 200, currency: "ARS", counts: true },
      ])} (per currency)`,
    );
    expect(r.summary).toContain("latest 500 settled");
  });
});

describe("reachedCap", () => {
  it("is true only when a capped read came back full", () => {
    expect(reachedCap(999)).toBe(false);
    expect(reachedCap(1000)).toBe(true);
    expect(reachedCap(200, 200)).toBe(true);
  });
});

describe("runJournalEntries", () => {
  it("bounds the page the model asks for and reports more as partial", async () => {
    vi.mocked(listJournalEntriesAction).mockResolvedValue({
      ok: true,
      data: { items: [], nextOffset: 200 },
    });
    const r = await runJournalEntries({ limit: 5000 });
    expect(
      vi.mocked(listJournalEntriesAction).mock.calls[0]?.[0],
    ).toMatchObject({ limit: 200 });
    expect(r.ok && r.partial).toBe(true);
    await runJournalEntries({ limit: 0 });
    expect(
      vi.mocked(listJournalEntriesAction).mock.calls[1]?.[0],
    ).toMatchObject({ limit: 1 });
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
