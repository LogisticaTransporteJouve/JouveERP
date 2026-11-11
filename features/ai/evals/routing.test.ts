import { generateText, isStepCount } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DENIED_CASES,
  EVAL_FIXTURES,
  ROUTING_CASES,
  inputMatches,
} from "./routing-cases";
import { scriptedModel, textTurn, toolCallTurn } from "./scripted-model";
import { resolveAccess } from "@/lib/auth/permissions";

// Offline routing eval: no network, no model. For each case the scripted model
// makes the expected call; the suite checks that the asking role is offered
// that tool, that the call passes the tool's own input schema and permission
// gate, and that it reaches the gated server action with the right arguments.
// What the real model would pick is the live suite's job.

const denied = { ok: false, error: "eval" };
const dispatched: Record<string, ReturnType<typeof vi.fn>> = {};
function stub(name: string) {
  const fn = vi.fn(async () => denied);
  dispatched[name] = fn;
  return fn;
}

vi.mock("@/features/hr/actions/hr-reports-actions", async (orig) => ({
  ...(await orig<typeof import("@/features/hr/actions/hr-reports-actions")>()),
  getPayrollSummaryAction: stub("getPayrollSummaryAction"),
  getDriverExtrasAction: stub("getDriverExtrasAction"),
  getVacationOverviewAction: stub("getVacationOverviewAction"),
}));
vi.mock("@/features/hr/actions/vacations-actions", async (orig) => ({
  ...(await orig<typeof import("@/features/hr/actions/vacations-actions")>()),
  listLeavesByRangeAction: stub("listLeavesByRangeAction"),
}));
vi.mock(
  "@/features/suppliers/actions/purchases-report-actions",
  async (orig) => ({
    ...(await orig<
      typeof import("@/features/suppliers/actions/purchases-report-actions")
    >()),
    getSupplierPurchasesSummaryAction: stub(
      "getSupplierPurchasesSummaryAction",
    ),
  }),
);
vi.mock("@/features/fleet-reports/actions/margin-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/fleet-reports/actions/margin-actions")
  >()),
  getFleetMarginAction: stub("getFleetMarginAction"),
}));
vi.mock("@/features/fleet-reports/actions/activity-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/fleet-reports/actions/activity-actions")
  >()),
  getVehicleActivityAction: stub("getVehicleActivityAction"),
  getDriverActivityAction: stub("getDriverActivityAction"),
}));
vi.mock("@/features/clients/actions/sales-report-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/clients/actions/sales-report-actions")
  >()),
  getClientSalesSummaryAction: stub("getClientSalesSummaryAction"),
}));
vi.mock("@/features/aging/actions/aging-actions", async (orig) => ({
  ...(await orig<typeof import("@/features/aging/actions/aging-actions")>()),
  getAgingSummaryAction: stub("getAgingSummaryAction"),
}));
vi.mock("@/features/treasury/actions/treasury-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/treasury/actions/treasury-actions")
  >()),
  getTreasurySummaryAction: stub("getTreasurySummaryAction"),
}));

vi.mock("@/features/management/actions/management-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/management/actions/management-actions")
  >()),
  getManagementPnlAction: stub("getManagementPnlAction"),
}));
vi.mock("@/features/balance/actions/statements-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/balance/actions/statements-actions")
  >()),
  getAccountTypeTotalsAction: stub("getAccountTypeTotalsAction"),
}));

vi.mock(
  "@/features/late-interest/actions/late-interest-actions",
  async (orig) => ({
    ...(await orig<
      typeof import("@/features/late-interest/actions/late-interest-actions")
    >()),
    listLateInterestCandidatesAction: stub("listLateInterestCandidatesAction"),
  }),
);

// A proposal parks a draft only once its reads resolve the names.
vi.mock(
  "@/features/cost-centers/actions/recategorize-actions",
  async (orig) => ({
    ...(await orig<
      typeof import("@/features/cost-centers/actions/recategorize-actions")
    >()),
    getExpenseCostTagsAction: vi.fn(async () => ({
      ok: true,
      data: {
        source: "transactions",
        id: "00000000-0000-4000-8000-0000000000a1",
        label: "02/11/2026 · Gasoil · $ 50.000,00",
        expense_account_id: null,
        cost_center_id: null,
        blocked: null,
      },
    })),
  }),
);
vi.mock(
  "@/features/cost-centers/actions/cost-tag-options-actions",
  async (orig) => ({
    ...(await orig<
      typeof import("@/features/cost-centers/actions/cost-tag-options-actions")
    >()),
    listCostTagOptionsAction: vi.fn(async () => ({
      ok: true,
      data: {
        expenseAccounts: [],
        costCenters: [
          {
            id: "00000000-0000-4000-8000-0000000000c1",
            code: "FLOTA",
            name: "Flota",
          },
        ],
      },
    })),
  }),
);
vi.mock("@/features/taxes/actions/tax-documents-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/taxes/actions/tax-documents-actions")
  >()),
  listTaxDocumentsAction: stub("listTaxDocumentsAction"),
  listTaxAccountOptionsAction: vi.fn(async () => ({ ok: true, data: [] })),
  getIvaPositionEstimateAction: stub("getIvaPositionEstimateAction"),
}));

// Name lookups resolve to the fixtures, so the tool reaches its read.
vi.mock("@/features/vehicles/actions/vehicles-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/vehicles/actions/vehicles-actions")
  >()),
  listVehiclesAction: vi.fn(async () => ({
    ok: true,
    data: [
      {
        id: EVAL_FIXTURES.truck.id,
        patente: EVAL_FIXTURES.truck.patente,
        alias: null,
      },
    ],
  })),
}));
vi.mock("@/features/drivers/actions/drivers-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/drivers/actions/drivers-actions")
  >()),
  listDriversAction: vi.fn(async () => ({
    ok: true,
    data: [
      { id: EVAL_FIXTURES.driver.id, full_name: EVAL_FIXTURES.driver.name },
    ],
  })),
}));
vi.mock(
  "@/features/bank-reconciliation/actions/reconciliation-actions",
  async (orig) => ({
    ...(await orig<
      typeof import("@/features/bank-reconciliation/actions/reconciliation-actions")
    >()),
    listReconciliationAccountsAction: vi.fn(async () => ({
      ok: true,
      data: [
        {
          id: EVAL_FIXTURES.bank.id,
          name: EVAL_FIXTURES.bank.name,
          type: "bank",
          currency: "ARS",
        },
      ],
    })),
    getReconciliationAction: stub("getReconciliationAction"),
  }),
);
// The treasury proposals resolve an account, a party and a channel, then
// read the number and the open documents.
vi.mock("@/features/accounts/actions/accounts-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/accounts/actions/accounts-actions")
  >()),
  listAccountsAction: vi.fn(async () => ({
    ok: true,
    data: [
      { ...EVAL_FIXTURES.bank, type: "bank" },
      { ...EVAL_FIXTURES.cash, type: "cash" },
      { ...EVAL_FIXTURES.cartera, type: "checks" },
    ].map((a) => ({ ...a, currency: "ARS", is_active: true })),
  })),
}));
vi.mock("@/features/checks/actions/checks-actions", async (orig) => ({
  ...(await orig<typeof import("@/features/checks/actions/checks-actions")>()),
  listEnCarteraChecksAction: vi.fn(async () => ({
    ok: true,
    data: [
      {
        id: EVAL_FIXTURES.record,
        kind: "fisico",
        check_number: "12345",
        bank_name: "Banco Macro",
        drawer_name: EVAL_FIXTURES.client.name,
        due_date: "2026-11-20",
        amount: 300_000,
        currency: "ARS",
        cartera_account_id: EVAL_FIXTURES.cartera.id,
        cartera_account_name: EVAL_FIXTURES.cartera.name,
        channel_id: "jouve_fiscal",
      },
    ],
  })),
}));
vi.mock("@/lib/channels", async (orig) => ({
  ...(await orig<typeof import("@/lib/channels")>()),
  readInvoicingChannels: vi.fn(async () => ({
    ok: true,
    channels: [
      { id: "jouve_fiscal", name: "Fiscal", is_fiscal: true, is_active: true },
      {
        id: "jouve_internal",
        name: "Interno",
        is_fiscal: false,
        is_active: true,
      },
    ],
  })),
}));
const nextNumero = vi.fn(async () => ({
  ok: true,
  data: { next: 1, isFirst: true },
}));
const openInFiscal = vi.fn(async (_party: string, channel: string) => ({
  ok: true,
  data:
    channel === "jouve_fiscal"
      ? [
          {
            id: EVAL_FIXTURES.record,
            document_type: "invoice",
            numero: 1,
            punto_venta: 1,
            letter: "A",
            kind: "factura",
            fecha: "2026-10-01",
            imp_total: 500_000,
            already_allocated: 0,
            outstanding: 500_000,
            currency: "ARS",
            check_number: null,
          },
        ]
      : [],
}));
vi.mock("@/features/receipts/actions/receipts-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/receipts/actions/receipts-actions")
  >()),
  listPendingComprobantesForClientAction: openInFiscal,
  getNextReceiptNumeroAction: nextNumero,
  getReceiptByIdAction: vi.fn(async () => ({
    ok: true,
    data: { receipt: { id: EVAL_FIXTURES.record, status: "issued" } },
  })),
}));
vi.mock("@/features/receipts/actions/send-receipt-email", async (orig) => ({
  ...(await orig<
    typeof import("@/features/receipts/actions/send-receipt-email")
  >()),
  getReceiptEmailDefaultsAction: vi.fn(async () => ({
    ok: true,
    data: {
      recipient: "pagos@acme.com",
      subject: "Recibo X0001-00000001",
      numero_label: "X0001-00000001",
      client_legal_name: EVAL_FIXTURES.client.name,
      last_sent_at: null,
    },
  })),
}));
vi.mock(
  "@/features/payment-orders/actions/payment-orders-actions",
  async (orig) => ({
    ...(await orig<
      typeof import("@/features/payment-orders/actions/payment-orders-actions")
    >()),
    listPendingInvoicesForSupplierAction: openInFiscal,
    getNextPaymentOrderNumeroAction: nextNumero,
  }),
);
vi.mock("@/features/hr/actions/employees-actions", async (orig) => ({
  ...(await orig<typeof import("@/features/hr/actions/employees-actions")>()),
  searchEmployeesAction: vi.fn(async () => ({
    ok: true,
    data: {
      employees: [
        {
          id: EVAL_FIXTURES.employee.id,
          legal_name: EVAL_FIXTURES.employee.name,
          position: "Administrativo",
          cuil: null,
          cbu: null,
          pay_frequency: "mensual",
          base_salary: 900000,
          viatico_monthly: 0,
          is_monotributo: false,
          hire_date: "2024-03-01",
          notes: null,
          convenio: null,
          categoria: null,
          obra_social: null,
          art: null,
          retribucion_formal: null,
        },
      ],
      nextOffset: null,
    },
  })),
}));
const loanFixture = {
  id: EVAL_FIXTURES.record,
  kind: "leasing",
  description: "Leasing Scania",
  lender: "Banco Galicia",
  currency: "ARS",
  status: "active",
};
vi.mock("@/features/loans/actions/loans-actions", async (orig) => ({
  ...(await orig<typeof import("@/features/loans/actions/loans-actions")>()),
  listLoansAction: vi.fn(async () => ({ ok: true, data: [loanFixture] })),
  getLoanAction: vi.fn(async () => ({
    ok: true,
    data: {
      ...loanFixture,
      installments: [
        {
          id: EVAL_FIXTURES.record,
          number: 1,
          due_date: "2026-11-10",
          amount: 250000,
          status: "pendiente",
          split: null,
        },
      ],
    },
  })),
}));
vi.mock("@/features/hr/actions/attendance-actions", async (orig) => ({
  ...(await orig<typeof import("@/features/hr/actions/attendance-actions")>()),
  getAttendanceMonthAction: vi.fn(async () => ({
    ok: true,
    data: { year: 2026, month: 11, records: [], holidays: [] },
  })),
}));
vi.mock("@/features/hr/actions/payroll-actions", async (orig) => ({
  ...(await orig<typeof import("@/features/hr/actions/payroll-actions")>()),
  getPayrollPeriodAction: vi.fn(async () => ({
    ok: true,
    data: {
      period: { id: EVAL_FIXTURES.record, status: "draft" },
      entries: [
        {
          id: EVAL_FIXTURES.record,
          employee_id: EVAL_FIXTURES.employee.id,
          employee_legal_name: EVAL_FIXTURES.employee.name,
          recibo_neto: null,
          sueldo_neto: 900000,
          total_a_pagar: 900000,
          saldo: 900000,
          embargo: 0,
          deudas: 0,
          telefono: 0,
          paid_transferencia: 0,
          paid_efectivo: 0,
        },
      ],
    },
  })),
}));
vi.mock("@/features/trips/actions/trips-actions", async (orig) => ({
  ...(await orig<typeof import("@/features/trips/actions/trips-actions")>()),
  listTripsAction: stub("listTripsAction"),
  getTripAction: stub("getTripAction"),
}));
vi.mock("@/features/fuel/actions/fuel-actions", async (orig) => ({
  ...(await orig<typeof import("@/features/fuel/actions/fuel-actions")>()),
  listFuelLoadsAction: stub("listFuelLoadsAction"),
}));
vi.mock("@/features/shipments/actions/shipments-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/shipments/actions/shipments-actions")
  >()),
  listShipmentsAction: stub("listShipmentsAction"),
  listShipmentsByTripAction: stub("listShipmentsByTripAction"),
}));
vi.mock("@/features/pallets/actions/pallets-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/pallets/actions/pallets-actions")
  >()),
  listPalletsAction: stub("listPalletsAction"),
}));
vi.mock("@/features/treasury/actions/cash-flow-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/treasury/actions/cash-flow-actions")
  >()),
  getCashFlowAction: stub("getCashFlowAction"),
}));
vi.mock("@/features/dashboard/actions/dashboard-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/dashboard/actions/dashboard-actions")
  >()),
  getDashboardDueDatesAction: stub("getDashboardDueDatesAction"),
}));
vi.mock("@/features/clients/actions/account-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/clients/actions/account-actions")
  >()),
  getClientAccountAction: stub("getClientAccountAction"),
}));
vi.mock("@/features/suppliers/actions/account-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/suppliers/actions/account-actions")
  >()),
  getSupplierAccountAction: stub("getSupplierAccountAction"),
}));
vi.mock("@/features/invoices/actions/invoices-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/invoices/actions/invoices-actions")
  >()),
  getInvoiceDetailAction: stub("getInvoiceDetailAction"),
  listInvoicingChannelsAction: vi.fn(async () => ({
    ok: true,
    data: [{ id: "jouve_fiscal", name: "Jouve fiscal", is_fiscal: true }],
  })),
  listEnabledPosAction: vi.fn(async () => ({
    ok: true,
    data: [{ numero: 3, channel_id: "jouve_fiscal", nickname: null }],
  })),
}));
vi.mock("@/features/clients/actions/clients-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/clients/actions/clients-actions")
  >()),
  searchClientsAction: vi.fn(async () => ({
    ok: true,
    data: {
      clients: [
        {
          id: EVAL_FIXTURES.client.id,
          legal_name: EVAL_FIXTURES.client.name,
          display_name: null,
          cuit: EVAL_FIXTURES.client.cuit,
          iva_condition: "responsable_inscripto",
          is_fiscal: true,
          email: null,
          phone: null,
          address: null,
          real_address: null,
          notes: null,
          is_active: true,
        },
      ],
      nextOffset: null,
    },
  })),
}));
vi.mock(
  "@/features/purchase-invoices/actions/purchase-invoices-actions",
  async (orig) => ({
    ...(await orig<
      typeof import("@/features/purchase-invoices/actions/purchase-invoices-actions")
    >()),
    getPurchaseInvoiceByIdAction: stub("getPurchaseInvoiceByIdAction"),
    findPurchaseInvoiceDuplicateAction: vi.fn(async () => ({
      ok: true,
      data: null,
    })),
    getPurchaseInvoiceItemsAction: stub("getPurchaseInvoiceItemsAction"),
    getPurchaseInvoiceAllocationsAction: stub(
      "getPurchaseInvoiceAllocationsAction",
    ),
  }),
);
vi.mock(
  "@/features/purchase-invoices/actions/impute-remitos-actions",
  async (orig) => ({
    ...(await orig<
      typeof import("@/features/purchase-invoices/actions/impute-remitos-actions")
    >()),
    getPurchaseImputationsAction: stub("getPurchaseImputationsAction"),
  }),
);
vi.mock(
  "@/features/purchase-invoices/actions/arca-received-actions",
  async (orig) => ({
    ...(await orig<
      typeof import("@/features/purchase-invoices/actions/arca-received-actions")
    >()),
    listReceivedVouchersAction: stub("listReceivedVouchersAction"),
  }),
);
vi.mock("@/features/suppliers/actions/suppliers-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/suppliers/actions/suppliers-actions")
  >()),
  findSupplierByCuitAction: vi.fn(async () => ({ ok: true, data: null })),
  searchSuppliersAction: vi.fn(async () => ({
    ok: true,
    data: {
      suppliers: [
        {
          id: EVAL_FIXTURES.supplier.id,
          legal_name: EVAL_FIXTURES.supplier.name,
          display_name: null,
          cuit: "30711111111",
          is_fiscal: true,
          default_channel_id: null,
          default_payment_term_days: null,
          default_expense_account_id: null,
          default_cost_center_id: null,
        },
      ],
      nextOffset: null,
    },
  })),
}));
vi.mock("@/features/ai/document/actions", async (orig) => ({
  ...(await orig<typeof import("@/features/ai/document/actions")>()),
  listExtractionsAction: stub("listExtractionsAction"),
}));

const { buildAiTools, buildCapabilitiesSummary } = await import("../registry");

const proposals = {
  createRevision: vi.fn(async () => ({ id: "conf-1", revision: 1 })),
};

beforeEach(() => {
  for (const fn of Object.values(dispatched)) fn.mockClear();
  proposals.createRevision.mockClear();
});

describe("AI CFO tool routing (offline)", () => {
  it.each(ROUTING_CASES)("$id: $question", async (c) => {
    const tools = buildAiTools({
      // A real auth uid: a task proposal assigns the draft to it.
      userId: "00000000-0000-4000-8000-0000000000e1",
      access: resolveAccess(c.roles),
      proposals,
    });
    expect(Object.keys(tools), "offered to the role").toContain(c.expect.tool);
    expect(buildCapabilitiesSummary(resolveAccess(c.roles))).toContain(
      `- ${c.expect.tool}`,
    );

    const model = scriptedModel([
      toolCallTurn(c.expect.tool, c.scriptedInput ?? c.expect.input),
      textTurn("ok"),
    ]);
    const result = await generateText({
      model,
      prompt: c.question,
      tools,
      stopWhen: isStepCount(2),
    });
    const call = result.steps[0]?.toolCalls[0];
    expect(call?.toolName).toBe(c.expect.tool);
    expect(inputMatches(call?.input, c.expect.input)).toBe(true);
    const toolResult = result.steps[0]?.toolResults[0];
    expect(toolResult, "the tool ran (input passed its schema)").toBeDefined();

    if (c.dispatch) {
      const fn = dispatched[c.dispatch.fn];
      expect(fn).toHaveBeenCalledTimes(c.dispatch.calls ?? 1);
      if (Object.keys(c.dispatch.args).length > 0) {
        expect(fn).toHaveBeenCalledWith(
          expect.objectContaining(c.dispatch.args),
        );
      }
    } else {
      expect(proposals.createRevision).toHaveBeenCalledOnce();
    }
  });

  it.each(DENIED_CASES)("$id: never offers $forbiddenTools", (c) => {
    const tools = Object.keys(
      buildAiTools({ userId: "u1", access: resolveAccess(c.roles) }),
    );
    const summary = buildCapabilitiesSummary(resolveAccess(c.roles));
    for (const name of c.forbiddenTools) {
      expect(tools).not.toContain(name);
      expect(summary).not.toContain(`- ${name}:`);
    }
  });

  it("matches inputs field by field", () => {
    expect(inputMatches({ a: 1, b: 2 }, { a: 1 })).toBe(true);
    expect(inputMatches({ a: 1 }, { a: 2 })).toBe(false);
    expect(inputMatches(null, {})).toBe(false);
  });
});
