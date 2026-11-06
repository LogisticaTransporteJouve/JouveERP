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
  getClientNetRevenueAction: stub("getClientNetRevenueAction"),
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
}));
vi.mock(
  "@/features/purchase-invoices/actions/purchase-invoices-actions",
  async (orig) => ({
    ...(await orig<
      typeof import("@/features/purchase-invoices/actions/purchase-invoices-actions")
    >()),
    getPurchaseInvoiceByIdAction: stub("getPurchaseInvoiceByIdAction"),
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
