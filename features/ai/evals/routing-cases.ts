import type { Role } from "@/lib/auth/permissions";

/**
 * Tool-routing cases for the AI CFO: an es-AR question, who asks it, the tool
 * the assistant should call and the arguments that matter. The offline suite
 * (routing.test.ts) plays the expected call back through the real tools; the
 * live suite (routing.live.test.ts) asks the real model.
 */
export type RoutingCase = {
  id: string;
  question: string;
  roles: Role[];
  /** The tool and the input fields that must match (others are free). */
  expect: { tool: string; input: Record<string, unknown> };
  /** The full call the offline script makes, when the matched fields alone
   *  would not pass the tool's schema. */
  scriptedInput?: Record<string, unknown>;
  /** The gated server action the tool must reach, with these arguments
   *  (`calls` times, once by default). Absent for a proposal (it parks a
   *  draft instead). */
  dispatch?: { fn: string; args: Record<string, unknown>; calls?: number };
};

/** A question whose tool the asking role must not even be offered. */
export type DeniedCase = {
  id: string;
  question: string;
  roles: Role[];
  forbiddenTools: string[];
};

/** Records the offline suite's lookups return, so a tool that resolves a
 *  name (a plate, a driver, a bank account) reaches its read with the id. */
export const EVAL_FIXTURES = {
  truck: { id: "00000000-0000-4000-8000-0000000000f1", patente: "AB123CD" },
  driver: { id: "00000000-0000-4000-8000-0000000000f2", name: "Juan Pérez" },
  bank: { id: "00000000-0000-4000-8000-0000000000f3", name: "Banco Galicia" },
  record: "00000000-0000-4000-8000-0000000000f4",
} as const;

const { truck, driver, bank, record } = EVAL_FIXTURES;

export const ROUTING_CASES: RoutingCase[] = [
  {
    id: "payroll-month",
    question: "¿Cuánto pagamos de sueldo en octubre 2025?",
    roles: ["finance"],
    expect: {
      tool: "getPayrollSummary",
      input: { fromPeriod: "2025-10", toPeriod: "2025-10" },
    },
    dispatch: {
      fn: "getPayrollSummaryAction",
      args: { fromPeriod: "2025-10", toPeriod: "2025-10" },
    },
  },
  {
    id: "driver-extras",
    question: "¿Cuánto se pagó de extras a los choferes en septiembre 2025?",
    roles: ["finance"],
    expect: {
      tool: "getDriverExtras",
      input: { fromPeriod: "2025-09", toPeriod: "2025-09" },
    },
    dispatch: {
      fn: "getDriverExtrasAction",
      args: { fromPeriod: "2025-09", toPeriod: "2025-09" },
    },
  },
  {
    id: "vacations",
    question: "¿Qué empleados tienen días de vacaciones por vencer?",
    roles: ["admin"],
    expect: { tool: "getVacationOverview", input: {} },
    dispatch: { fn: "getVacationOverviewAction", args: {} },
  },
  {
    id: "suppliers-year",
    question: "¿Cuánto le compramos a cada proveedor en 2025?",
    roles: ["finance"],
    expect: {
      tool: "getSupplierPurchasesSummary",
      input: { from: "2025-01-01", to: "2025-12-31" },
    },
    dispatch: {
      fn: "getSupplierPurchasesSummaryAction",
      args: { from: "2025-01-01", to: "2025-12-31" },
    },
  },
  {
    id: "trips-margin",
    question: "¿Qué viajes de septiembre 2026 dejaron menos margen?",
    roles: ["operations"],
    expect: {
      tool: "getFleetMargin",
      input: { from: "2026-09-01", to: "2026-09-30", groupBy: "trip" },
    },
    dispatch: {
      fn: "getFleetMarginAction",
      args: { from: "2026-09-01", to: "2026-09-30", groupBy: "trip" },
    },
  },
  {
    id: "receivables",
    question: "¿Quién nos debe más plata?",
    roles: ["finance"],
    expect: { tool: "getClientAging", input: {} },
    dispatch: { fn: "getAgingSummaryAction", args: {} },
  },
  {
    id: "cash",
    question: "¿Cómo estamos de caja hoy?",
    roles: ["owner"],
    expect: { tool: "getTreasurySummary", input: {} },
    dispatch: { fn: "getTreasurySummaryAction", args: {} },
  },
  {
    id: "management-month",
    question: "¿Ganamos plata en septiembre 2026?",
    roles: ["owner"],
    expect: {
      tool: "getManagementPnL",
      input: { fromPeriod: "2026-09", toPeriod: "2026-09" },
    },
    dispatch: {
      fn: "getManagementPnlAction",
      args: {
        fromPeriod: "2026-09",
        toPeriod: "2026-09",
        basis: "accrual",
        inflation: false,
      },
      // The range, and the same months a year before for the KPIs.
      calls: 2,
    },
  },
  {
    id: "bank-balance",
    question: "Armame el balance para el banco a septiembre 2026.",
    roles: ["finance"],
    expect: { tool: "getBalanceSheet", input: { periodEnd: "2026-09" } },
    dispatch: {
      fn: "getAccountTypeTotalsAction",
      args: { periodEnd: "2026-09" },
    },
  },
  {
    id: "client-margin",
    question: "¿Qué clientes nos dejaron más margen en octubre 2026?",
    roles: ["finance"],
    expect: {
      tool: "getClientMargin",
      input: { from: "2026-10-01", to: "2026-10-31" },
    },
    dispatch: {
      fn: "getClientNetRevenueAction",
      args: { from: "2026-10-01", to: "2026-10-31" },
    },
  },
  {
    id: "client-payment-behavior",
    question:
      "¿Cuántos días tardan en pagarnos los clientes en 2026 y quién está más atrasado?",
    roles: ["finance"],
    expect: {
      tool: "getClientPaymentBehavior",
      input: { from: "2026-01-01", to: "2026-12-31" },
    },
    dispatch: {
      fn: "getClientSalesSummaryAction",
      args: { from: "2026-01-01", to: "2026-12-31" },
    },
  },
  {
    // "Días de pago" is payment behaviour, not the sales ranking, even
    // though both read ai_client_sales_summary.
    id: "client-days-to-pay",
    question: "¿Cuántos días de pago tiene cada cliente en octubre 2026?",
    roles: ["finance"],
    expect: {
      tool: "getClientPaymentBehavior",
      input: { from: "2026-10-01", to: "2026-10-31" },
    },
    dispatch: {
      fn: "getClientSalesSummaryAction",
      args: { from: "2026-10-01", to: "2026-10-31" },
    },
  },
  {
    id: "client-slowest-payer",
    question: "¿Qué cliente tarda más en pagarnos este año (2026)?",
    roles: ["owner"],
    expect: {
      tool: "getClientPaymentBehavior",
      input: { from: "2026-01-01", to: "2026-12-31" },
    },
    dispatch: {
      fn: "getClientSalesSummaryAction",
      args: { from: "2026-01-01", to: "2026-12-31" },
    },
  },
  {
    id: "client-sales-ranking",
    question: "¿Cuánto le facturamos a cada cliente en 2026?",
    roles: ["finance"],
    expect: {
      tool: "getClientSalesSummary",
      input: { from: "2026-01-01", to: "2026-12-31" },
    },
    dispatch: {
      fn: "getClientSalesSummaryAction",
      args: { from: "2026-01-01", to: "2026-12-31" },
    },
  },
  {
    id: "vehicle-economics",
    question:
      "¿Cuánto nos cuesta por km cada camión en septiembre 2026, con el combustible?",
    roles: ["operations"],
    expect: {
      tool: "getVehicleEconomics",
      input: { from: "2026-09-01", to: "2026-09-30" },
    },
    dispatch: {
      fn: "getVehicleActivityAction",
      args: { from: "2026-09-01", to: "2026-09-30" },
    },
  },
  {
    id: "driver-activity",
    question:
      "¿Cuántos viajes y km hizo cada chofer en octubre 2026 y cuánto se les adelantó?",
    roles: ["admin"],
    expect: {
      tool: "getDriverActivity",
      input: { from: "2026-10-01", to: "2026-10-31" },
    },
    dispatch: {
      fn: "getDriverActivityAction",
      args: { from: "2026-10-01", to: "2026-10-31" },
    },
  },
  {
    id: "top-costs",
    question:
      "¿En qué se nos fue la plata en 2026? Los costos más grandes por rubro.",
    roles: ["owner"],
    expect: {
      tool: "getTopCosts",
      input: { fromPeriod: "2026-01", toPeriod: "2026-12" },
    },
    dispatch: {
      fn: "getManagementPnlAction",
      args: {
        fromPeriod: "2026-01",
        toPeriod: "2026-12",
        basis: "accrual",
        inflation: false,
      },
    },
  },
  {
    id: "recurring-task",
    question: "Todos los lunes a las 8 resumime las cobranzas vencidas.",
    roles: ["finance"],
    expect: {
      tool: "proposeAiWorkflow",
      input: { cadence: "weekly", weekday: "1", runTime: "08:00" },
    },
    scriptedInput: {
      title: "Cobranzas vencidas",
      prompt: "Resumí las cobranzas vencidas por cliente.",
      cadence: "weekly",
      weekday: "1",
      runTime: "08:00",
    },
  },
  {
    id: "late-interest-uncharged",
    question:
      "¿Cuánto interés por mora no les cobramos a los clientes al 31/10/2026?",
    roles: ["finance"],
    expect: {
      tool: "getLateInterestCandidates",
      input: { as_of: "2026-10-31" },
    },
    dispatch: {
      fn: "listLateInterestCandidatesAction",
      args: { as_of: "2026-10-31" },
    },
  },
  {
    id: "propose-task",
    question:
      "Creame una tarea para renovar la VTV del AB123CD para el 15 de noviembre de 2026.",
    roles: ["operations"],
    expect: {
      tool: "proposeTask",
      input: { due_date: "2026-11-15" },
    },
    scriptedInput: {
      title: "Renovar la VTV del AB123CD",
      due_date: "2026-11-15",
    },
  },
  {
    id: "propose-recategorize-expense",
    question:
      "El gasto 00000000-0000-4000-8000-0000000000a1 de Caja pasalo al centro de costo FLOTA.",
    roles: ["finance"],
    expect: {
      tool: "proposeRecategorizeExpense",
      input: {
        source: "transactions",
        id: "00000000-0000-4000-8000-0000000000a1",
        cost_center: "FLOTA",
      },
    },
  },
  // The list read stops at the first refusal (the offline stub refuses),
  // so it reaches listTaxDocumentsAction once; its year is today's.
  {
    id: "taxes-due-this-week",
    question: "¿Qué impuestos vencen esta semana?",
    roles: ["finance"],
    expect: { tool: "getTaxDocuments", input: { dueWithinDays: 7 } },
    dispatch: { fn: "listTaxDocumentsAction", args: {} },
  },
  {
    id: "taxes-overdue-accountant",
    question: "¿Hay impuestos vencidos sin pagar?",
    roles: ["fiscal_reader"],
    expect: { tool: "getTaxDocuments", input: {} },
    dispatch: { fn: "listTaxDocumentsAction", args: {} },
  },
  {
    id: "taxes-paid-month",
    question: "¿Cuánto pagamos de impuestos en octubre 2026?",
    roles: ["finance"],
    expect: { tool: "getTaxDocuments", input: { period: "2026-10" } },
    dispatch: { fn: "listTaxDocumentsAction", args: {} },
  },
  {
    id: "taxes-iva-estimate",
    question: "¿Cuánto IVA vamos a pagar por octubre 2026?",
    roles: ["finance"],
    expect: { tool: "getTaxDocuments", input: { ivaPeriod: "2026-10" } },
    dispatch: { fn: "listTaxDocumentsAction", args: {} },
  },
  // Fleet by vehicle (the owner's two questions) and by driver.
  {
    id: "fleet-vehicle-km",
    question: "¿Cuántos km recorrió el camión AB123CD en octubre 2026?",
    roles: ["operations"],
    expect: {
      tool: "getVehicleUsage",
      input: { vehicle: "AB123CD", from: "2026-10-01", to: "2026-10-31" },
    },
    dispatch: {
      fn: "listTripsAction",
      args: { vehicleId: truck.id, from: "2026-10-01", to: "2026-10-31" },
    },
  },
  {
    id: "fleet-vehicle-drivers",
    question: "¿Quién manejó el camión AB123CD el último mes (octubre 2026)?",
    roles: ["operations"],
    expect: { tool: "getVehicleUsage", input: { vehicle: "AB123CD" } },
    scriptedInput: {
      vehicle: "AB123CD",
      from: "2026-10-01",
      to: "2026-10-31",
    },
    dispatch: { fn: "listTripsAction", args: { vehicleId: truck.id } },
  },
  {
    id: "fleet-driver-trips",
    question: "¿Qué viajes hizo Juan Pérez en octubre 2026?",
    roles: ["operations"],
    expect: {
      tool: "getTrips",
      input: { driver: "Juan Pérez", from: "2026-10-01", to: "2026-10-31" },
    },
    dispatch: {
      fn: "listTripsAction",
      args: { driverId: driver.id, from: "2026-10-01", to: "2026-10-31" },
    },
  },
  {
    id: "fleet-vehicle-fuel",
    question: "¿Qué cargas de combustible tuvo el AB123CD en octubre 2026?",
    roles: ["operations"],
    expect: {
      tool: "getFuelLoads",
      input: { vehicle: "AB123CD", from: "2026-10-01", to: "2026-10-31" },
    },
    dispatch: {
      fn: "listFuelLoadsAction",
      args: { vehicleId: truck.id, from: "2026-10-01", to: "2026-10-31" },
    },
  },
  {
    id: "shipment-by-remito",
    question: "Buscame la carga del remito 0001-00004567.",
    roles: ["operations"],
    expect: { tool: "getShipments", input: { remito: "0001-00004567" } },
    dispatch: { fn: "listShipmentsAction", args: { remito: "0001-00004567" } },
  },
  {
    id: "trip-detail",
    question: `¿Qué cargas llevó el viaje ${record}?`,
    roles: ["operations"],
    expect: { tool: "getTripDetail", input: { tripId: record } },
    dispatch: { fn: "getTripAction", args: {} },
  },
  {
    id: "pallet-where",
    question: "¿Dónde está el pallet P-0042?",
    roles: ["admin"],
    expect: { tool: "getPallets", input: { code: "P-0042" } },
    dispatch: { fn: "listPalletsAction", args: {} },
  },
  // Tesorería
  {
    id: "cash-flow",
    question: "¿Cómo viene la caja los próximos meses? ¿Algún mes en rojo?",
    roles: ["finance"],
    expect: { tool: "getCashFlow", input: {} },
    dispatch: { fn: "getCashFlowAction", args: {} },
  },
  {
    id: "due-dates",
    question: "¿Qué vence en las próximas dos semanas?",
    roles: ["finance"],
    expect: { tool: "getUpcomingDueDates", input: {} },
    dispatch: { fn: "getDashboardDueDatesAction", args: {} },
  },
  {
    id: "bank-unmatched",
    question:
      "¿Qué líneas del extracto del Galicia faltan conciliar en octubre 2026?",
    roles: ["finance"],
    expect: {
      tool: "getBankReconciliation",
      input: { account: "Galicia", from: "2026-10-01", to: "2026-10-31" },
    },
    dispatch: {
      fn: "getReconciliationAction",
      args: { account_id: bank.id, from: "2026-10-01", to: "2026-10-31" },
    },
  },
  // Cuentas corrientes y detalle de documentos (the id comes from a search
  // or a list; positional arguments, so only the call is checked).
  {
    id: "client-account",
    question: `Mostrame la cuenta corriente del cliente ${record}.`,
    roles: ["finance"],
    expect: { tool: "getClientAccount", input: { clientId: record } },
    dispatch: { fn: "getClientAccountAction", args: {} },
  },
  {
    id: "supplier-account",
    question: `¿Cuánto le debemos al proveedor ${record}? Su cuenta corriente.`,
    roles: ["finance"],
    expect: { tool: "getSupplierAccount", input: { supplierId: record } },
    dispatch: { fn: "getSupplierAccountAction", args: {} },
  },
  {
    id: "invoice-detail",
    question: `¿Qué ítems y qué CAE tiene la factura ${record}?`,
    roles: ["finance"],
    expect: { tool: "getInvoiceDetail", input: { id: record } },
    dispatch: { fn: "getInvoiceDetailAction", args: {} },
  },
  {
    id: "purchase-detail",
    question: `¿Con qué órdenes de pago se pagó la factura de compra ${record}?`,
    roles: ["finance"],
    expect: { tool: "getPurchaseInvoiceDetail", input: { id: record } },
    dispatch: { fn: "getPurchaseInvoiceByIdAction", args: {} },
  },
  // Compras y Documentos
  {
    id: "arca-pending",
    question: "¿Qué facturas de proveedores que están en ARCA faltan cargar?",
    roles: ["finance"],
    expect: { tool: "getArcaReceivedVouchers", input: {} },
    dispatch: {
      fn: "listReceivedVouchersAction",
      args: { status: "pending_review" },
    },
  },
  {
    id: "documents-pending",
    question: "¿Qué documentos escaneados faltan revisar?",
    roles: ["finance"],
    expect: { tool: "getDocumentExtractions", input: {} },
    dispatch: { fn: "listExtractionsAction", args: {} },
  },
];

export const DENIED_CASES: DeniedCase[] = [
  {
    id: "cash-flow-operations",
    question: "¿Cómo viene la caja los próximos meses?",
    roles: ["operations"],
    forbiddenTools: [
      "getCashFlow",
      "getBankReconciliation",
      "getArcaReceivedVouchers",
    ],
  },
  {
    id: "fleet-fiscal-reader",
    question: "¿Cuántos km recorrió el camión AB123CD en octubre?",
    roles: ["fiscal_reader"],
    forbiddenTools: ["getVehicleUsage", "getTrips", "getShipments"],
  },
  {
    id: "management-fiscal-reader",
    question: "¿Ganamos plata en septiembre 2026?",
    roles: ["fiscal_reader"],
    forbiddenTools: ["getManagementPnL"],
  },
  {
    id: "payroll-operations",
    question: "¿Cuánto pagamos de sueldo en octubre 2025?",
    roles: ["operations"],
    forbiddenTools: ["getPayrollSummary", "getPayrollConcepts"],
  },
  {
    id: "client-margin-operations",
    question: "¿Qué clientes nos dejaron más margen en octubre 2026?",
    roles: ["operations"],
    forbiddenTools: ["getClientMargin", "getClientPaymentBehavior"],
  },
  {
    id: "costs-fiscal-reader",
    question: "¿En qué se nos fue la plata en 2026?",
    roles: ["fiscal_reader"],
    forbiddenTools: ["getTopCosts", "getVehicleEconomics", "getDriverActivity"],
  },
  {
    id: "late-interest-operations",
    question: "Generá la nota de débito por mora de la factura más vieja.",
    roles: ["operations"],
    forbiddenTools: [
      "getLateInterestCandidates",
      "proposeLateInterestNd",
      "proposeBankMatches",
      "proposeClientTariff",
    ],
  },
  {
    id: "late-interest-fiscal-reader",
    question: "Emití la ND por intereses de mora de Cliente Uno.",
    roles: ["fiscal_reader"],
    forbiddenTools: ["proposeLateInterestNd", "proposeTask"],
  },
  {
    id: "recategorize-operations",
    question: "Pasá el gasto de combustible de ayer al centro de costo FLOTA.",
    roles: ["operations"],
    forbiddenTools: ["proposeRecategorizeExpense", "getTransactions"],
  },
  {
    id: "taxes-operations",
    question: "¿Qué impuestos vencen esta semana?",
    roles: ["operations"],
    forbiddenTools: ["getTaxDocuments"],
  },
  {
    id: "cash-operations",
    question: "¿Cómo estamos de caja hoy?",
    roles: ["operations"],
    forbiddenTools: ["getTreasurySummary", "getAccounts"],
  },
];

/** True when every expected field equals the actual one. */
export function inputMatches(
  actual: unknown,
  expected: Record<string, unknown>,
): boolean {
  if (typeof actual !== "object" || actual === null) return false;
  return Object.entries(expected).every(
    ([key, value]) => Reflect.get(actual, key) === value,
  );
}
