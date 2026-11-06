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
  cash: { id: "00000000-0000-4000-8000-0000000000f5", name: "Caja" },
  client: {
    id: "00000000-0000-4000-8000-0000000000f6",
    name: "Acme SA",
    cuit: "30714637432",
  },
  supplier: { id: "00000000-0000-4000-8000-0000000000f7", name: "Gomería Sur" },
  cartera: {
    id: "00000000-0000-4000-8000-0000000000f8",
    name: "Cheques en cartera",
  },
  employee: { id: "00000000-0000-4000-8000-0000000000f9", name: "Gómez Ana" },
} as const;

const { truck, driver, bank, record, cash } = EVAL_FIXTURES;

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
    id: "vacations-one-employee",
    question: "¿Cuántas vacaciones le quedan a Gómez Ana?",
    roles: ["admin"],
    expect: { tool: "getVacationOverview", input: { employee: "Gómez Ana" } },
    dispatch: {
      fn: "getVacationOverviewAction",
      args: { employee: "Gómez Ana" },
    },
  },
  {
    id: "leaves-calendar-december",
    question:
      "haceme una tabla como si fuera un calendario para saber quién se toma vacaciones en diciembre",
    roles: ["admin"],
    expect: {
      tool: "getLeavesByRange",
      input: { from: "2026-12-01", to: "2026-12-31", kind: "vacaciones" },
    },
    dispatch: {
      fn: "listLeavesByRangeAction",
      args: { from: "2026-12-01", to: "2026-12-31", kind: "vacaciones" },
    },
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
  {
    id: "propose-trip",
    question:
      "Cargá un viaje para el 7 de noviembre de 2026 con el AB123CD y Juan Pérez, de Rosario a Córdoba.",
    roles: ["operations"],
    expect: {
      tool: "proposeTrip",
      input: {
        trip_date: "2026-11-07",
        vehicle: truck.patente,
        driver: driver.name,
      },
    },
    scriptedInput: {
      trip_date: "2026-11-07",
      vehicle: truck.patente,
      driver: driver.name,
      origin: "Rosario",
      destination: "Córdoba",
    },
  },
  {
    id: "propose-shipment",
    question:
      "Creá una carga con remito R-2041 para el 10/11/2026, de Rosario a Rafaela, flete $350.000.",
    roles: ["operations"],
    expect: {
      tool: "proposeShipment",
      input: { remito_number: "R-2041", scheduled_date: "2026-11-10" },
    },
    scriptedInput: {
      remito_number: "R-2041",
      scheduled_date: "2026-11-10",
      origin: "Rosario",
      destination: "Rafaela",
      freight_amount: 350_000,
    },
  },
  // The status change reads the carga first; the offline stub refuses it,
  // so the case checks it reaches that read with the id.
  {
    id: "propose-shipment-delivered",
    question: `Marcá como entregada la carga ${record}.`,
    roles: ["operations"],
    expect: {
      tool: "proposeShipmentStatus",
      input: { shipment_id: record, status: "delivered" },
    },
    dispatch: { fn: "listShipmentsAction", args: { id: record } },
  },
  {
    id: "propose-fuel-load",
    question:
      "Registrá una carga de combustible del AB123CD de hoy: 300 litros, $450.000.",
    roles: ["operations"],
    expect: {
      tool: "proposeFuelLoad",
      input: { vehicle: truck.patente, liters: 300, amount: 450_000 },
    },
  },
  {
    id: "propose-maintenance",
    question:
      "Al AB123CD le hicimos el service ayer en el taller Ruta 9, $180.000.",
    roles: ["operations"],
    expect: {
      tool: "proposeMaintenance",
      input: { vehicle: truck.patente, kind: "service" },
    },
    scriptedInput: {
      vehicle: truck.patente,
      kind: "service",
      description: "Service",
      provider: "Taller Ruta 9",
      cost: 180_000,
    },
  },
  {
    id: "propose-vehicle-km",
    question: "El AB123CD cerró octubre con 125.300 km.",
    roles: ["operations"],
    expect: {
      tool: "proposeVehicleKm",
      input: { vehicle: truck.patente, km: 125_300, period: "2026-10" },
    },
  },
  // The draft reads the client's cargas first; the offline stub refuses.
  {
    id: "propose-freight-settlement",
    question: `Armá la liquidación de fletes de octubre 2026 del cliente ${record}.`,
    roles: ["finance"],
    expect: {
      tool: "proposeFreightSettlement",
      input: {
        client: record,
        period_start: "2026-10-01",
        period_end: "2026-10-31",
      },
    },
    dispatch: {
      fn: "listFreightSettlementCandidatesAction",
      args: { client_id: record, period_start: "2026-10-01" },
    },
  },
  // The confirm reads the draft first; the offline stub refuses.
  {
    id: "propose-freight-settlement-confirm",
    question: `Confirmá la liquidación de fletes ${record} y emití el remito R.`,
    roles: ["finance"],
    expect: {
      tool: "proposeFreightSettlementConfirm",
      input: { settlement_id: record },
    },
    dispatch: { fn: "getFreightSettlementAction", args: {} },
  },
  // Storage billing reads the period's computation first; the stub refuses.
  {
    id: "propose-storage-invoice",
    question: "Facturá el almacenaje de octubre 2026 de Acme SA.",
    roles: ["finance"],
    expect: {
      tool: "proposeStorageInvoice",
      input: {
        client: EVAL_FIXTURES.client.name,
        period_start: "2026-10-01",
        period_end: "2026-10-31",
      },
    },
    dispatch: {
      fn: "getStorageBillingAction",
      args: { periodStart: "2026-10-01", periodEnd: "2026-10-31" },
    },
  },
  // Rendiciones read the pending cargas or the rendición first.
  {
    id: "propose-driver-settlement",
    question: "Juan Pérez rindió todo lo que cobró, en efectivo.",
    roles: ["finance"],
    expect: {
      tool: "proposeDriverSettlement",
      input: { driver: driver.name, all_collected: true },
    },
    dispatch: { fn: "listCodPendingAction", args: {} },
  },
  {
    id: "propose-driver-settlement-confirm",
    question: `Confirmá la rendición ${record}.`,
    roles: ["finance"],
    expect: {
      tool: "proposeDriverSettlementConfirm",
      input: { settlement_id: record },
    },
    dispatch: { fn: "getDriverSettlementAction", args: {} },
  },
  {
    id: "propose-driver-settlement-difference",
    question: `El faltante de la rendición ${record} va a cargo del chofer.`,
    roles: ["finance"],
    expect: {
      tool: "proposeDriverSettlementDifference",
      input: { settlement_id: record, charged_to: "driver" },
    },
    dispatch: { fn: "getDriverSettlementAction", args: {} },
  },
  {
    id: "propose-client-internal",
    question:
      "Dá de alta en Otras ventas al cliente Juan Pérez, teléfono 11 5555-5555.",
    roles: ["finance"],
    expect: {
      tool: "proposeClient",
      input: { legal_name: "Juan Pérez", side: "otras_ventas" },
    },
    scriptedInput: {
      legal_name: "Juan Pérez",
      side: "otras_ventas",
      phone: "11 5555-5555",
    },
  },
  {
    id: "propose-client-update",
    question: "Cambiale el mail a Acme SA: ahora es pagos@acme.com.",
    roles: ["finance"],
    expect: {
      tool: "proposeClientUpdate",
      input: { client: "Acme SA", email: "pagos@acme.com" },
    },
  },
  {
    id: "propose-invoice",
    question:
      "Facturale a Acme SA un flete Rosario–Buenos Aires de $ 850.000 más IVA.",
    roles: ["finance"],
    expect: { tool: "proposeInvoice", input: { client: "Acme SA" } },
    scriptedInput: {
      client: "Acme SA",
      items: [
        { description: "Flete Rosario–Buenos Aires", unit_price: 850_000 },
      ],
    },
  },
  {
    id: "propose-receipt",
    question:
      "Acme SA nos transfirió $100.000 al Banco Galicia, registrá el cobro.",
    roles: ["finance"],
    expect: {
      tool: "proposeReceipt",
      input: { client: "Acme SA", amount: 100_000, account: bank.name },
    },
  },
  {
    id: "propose-payment-order",
    question:
      "Haceme la orden de pago a Gomería Sur por $25.000 desde el Banco Galicia.",
    roles: ["finance"],
    expect: {
      tool: "proposePaymentOrder",
      input: { supplier: "Gomería Sur", amount: 25_000, account: bank.name },
    },
  },
  {
    id: "propose-receipt-retention",
    question:
      "Acme SA nos pagó $98.000 al Banco Galicia y nos retuvo $2.000 de Ganancias, certificado 0001-00001234.",
    roles: ["finance"],
    expect: {
      tool: "proposeReceipt",
      input: { client: "Acme SA", amount: 98_000, account: bank.name },
    },
    scriptedInput: {
      client: "Acme SA",
      amount: 98_000,
      account: bank.name,
      retentions: [
        {
          tax_type: "ganancias",
          certificate_number: "0001-00001234",
          amount: 2000,
        },
      ],
    },
  },
  {
    id: "propose-receipt-email",
    question: `Mandale por mail el recibo ${record} al cliente.`,
    roles: ["finance"],
    expect: { tool: "proposeReceiptEmail", input: { receipt_id: record } },
  },
  {
    id: "propose-payment-order-checks",
    question:
      "Pagale a Gomería Sur con el cheque 12345 de la cartera y un cheque propio del Galicia Nº 777 por $50.000 al 30/11/2026.",
    roles: ["finance"],
    expect: {
      tool: "proposePaymentOrder",
      input: { supplier: "Gomería Sur" },
    },
    scriptedInput: {
      supplier: "Gomería Sur",
      endorse_checks: [{ number: "12345" }],
      issue_checks: [
        {
          account: bank.name,
          number: "777",
          amount: 50_000,
          due_date: "2026-11-30",
        },
      ],
    },
  },
  {
    id: "propose-cash-movement",
    question:
      "Cargá un egreso de $15.000 del Banco Galicia por comisiones bancarias, en el canal fiscal.",
    roles: ["finance"],
    expect: {
      tool: "proposeCashMovement",
      input: {
        kind: "expense",
        amount: 15_000,
        account: bank.name,
        channel: "fiscal",
      },
    },
    scriptedInput: {
      kind: "expense",
      amount: 15_000,
      account: bank.name,
      channel: "fiscal",
      description: "Comisiones bancarias",
    },
  },
  {
    id: "propose-transfer",
    question: "Pasá $200.000 del Banco Galicia a la Caja, canal fiscal.",
    roles: ["finance"],
    expect: {
      tool: "proposeTransfer",
      input: {
        from: bank.name,
        to: cash.name,
        amount: 200_000,
        channel: "fiscal",
      },
    },
  },
  {
    id: "propose-manual-check",
    question:
      "Cargá un cheque del Banco Macro Nº 12345 de Acme SA por $300.000 que se cobra el 20/11/2026, canal fiscal.",
    roles: ["finance"],
    expect: {
      tool: "proposeManualCheck",
      input: { check_number: "12345", amount: 300_000, due_date: "2026-11-20" },
    },
    scriptedInput: {
      check_number: "12345",
      bank: "Banco Macro",
      drawer: "Acme SA",
      amount: 300_000,
      due_date: "2026-11-20",
      channel: "fiscal",
    },
  },
  {
    id: "propose-check-deposit",
    question: "Depositá el cheque 12345 en el Banco Galicia.",
    roles: ["finance"],
    expect: {
      tool: "proposeCheckDeposit",
      input: { check_number: "12345", account: bank.name },
    },
  },
  {
    id: "propose-issued-check",
    question:
      "Emití un cheque del Banco Galicia Nº 777 a Gomería Sur por $50.000 al 01/12/2026, fiscal.",
    roles: ["finance"],
    expect: {
      tool: "proposeIssuedCheck",
      input: { check_number: "777", account: bank.name, amount: 50_000 },
    },
    scriptedInput: {
      check_number: "777",
      account: bank.name,
      beneficiary: "Gomería Sur",
      amount: 50_000,
      due_date: "2026-12-01",
      channel: "fiscal",
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
    id: "propose-purchase-invoice",
    question:
      "Cargá la factura A 0003-00000055 de Gomería Sur del 2/11/2026: neto 1.000, IVA 210, total 1.210.",
    roles: ["finance"],
    expect: {
      tool: "proposePurchaseInvoice",
      input: { supplier: "Gomería Sur", letter: "A", numero: 55 },
    },
    scriptedInput: {
      supplier: "Gomería Sur",
      letter: "A",
      punto_venta: 3,
      numero: 55,
      fecha: "2026-11-02",
      imp_neto: 1000,
      imp_iva: 210,
      imp_total: 1210,
    },
  },
  {
    id: "propose-supplier",
    question:
      "Dá de alta al proveedor Transportes Sur SRL, CUIT 30-71111111-1, responsable inscripto.",
    roles: ["finance"],
    expect: {
      tool: "proposeSupplier",
      input: { legal_name: "Transportes Sur SRL", cuit: "30-71111111-1" },
    },
    scriptedInput: {
      legal_name: "Transportes Sur SRL",
      cuit: "30-71111111-1",
      iva_condition: "responsable_inscripto",
    },
  },
  {
    id: "propose-tax-document",
    question:
      "Cargá el anticipo de Ganancias de noviembre 2026, vence el 13/11/2026.",
    roles: ["finance"],
    expect: {
      tool: "proposeTaxDocument",
      input: { kind: "ganancias_anticipo", period: "2026-11" },
    },
    scriptedInput: {
      kind: "ganancias_anticipo",
      period: "2026-11",
      due_date: "2026-11-13",
    },
  },
  {
    id: "documents-pending",
    question: "¿Qué documentos escaneados faltan revisar?",
    roles: ["finance"],
    expect: { tool: "getDocumentExtractions", input: {} },
    dispatch: { fn: "listExtractionsAction", args: {} },
  },
  // RRHH proposals: finance has hr:write; the card waits for its Accept.
  {
    id: "propose-create-employee",
    question:
      "Dá de alta a Ramírez Pablo como chofer, entró el 2 de noviembre de 2026, sueldo base 750.000, mensual.",
    roles: ["finance"],
    expect: {
      tool: "proposeCreateEmployee",
      input: {
        legal_name: "Ramírez Pablo",
        position: "Chofer / Acompañante",
        hire_date: "2026-11-02",
        base_salary: 750000,
      },
    },
  },
  {
    id: "propose-update-employee",
    question: "Subile el sueldo base a Gómez Ana a 980.000.",
    roles: ["finance"],
    expect: {
      tool: "proposeUpdateEmployee",
      input: { employee: "Gómez Ana", base_salary: 980000 },
    },
  },
  {
    id: "propose-payroll-payment",
    question:
      "Pagale el sueldo de octubre 2026 a Gómez Ana por transferencia desde el Banco Galicia, canal interno.",
    roles: ["finance"],
    expect: {
      tool: "proposePayrollPayment",
      input: {
        period: "2026-10",
        method: "transferencia",
        account: "Banco Galicia",
        channel: "internal",
      },
    },
    scriptedInput: {
      period: "2026-10",
      employees: ["Gómez Ana"],
      method: "transferencia",
      account: "Banco Galicia",
      channel: "internal",
    },
  },
  {
    id: "propose-employee-advance",
    question:
      "Dale un adelanto de 150.000 a Gómez Ana desde el Banco Galicia, canal interno, que se descuente en 3 cuotas de 50.000.",
    roles: ["finance"],
    expect: {
      tool: "proposeEmployeeAccountCash",
      input: {
        employee: "Gómez Ana",
        kind: "advance",
        amount: 150000,
        installment_amount: 50000,
      },
    },
    scriptedInput: {
      employee: "Gómez Ana",
      kind: "advance",
      amount: 150000,
      installment_amount: 50000,
      account: "Banco Galicia",
      channel: "internal",
    },
  },
  {
    id: "propose-employee-charge",
    question:
      "Cargale a Gómez Ana una deuda de 80.000 por el celular que rompió.",
    roles: ["finance"],
    expect: {
      tool: "proposeEmployeeAccountMovement",
      input: { employee: "Gómez Ana", kind: "charge", amount: 80000 },
    },
    scriptedInput: {
      employee: "Gómez Ana",
      kind: "charge",
      amount: 80000,
      description: "Celular roto",
    },
  },
  {
    id: "propose-attendance",
    question: "Gómez Ana faltó sin aviso el 4 de noviembre de 2026, cargalo.",
    roles: ["finance"],
    expect: {
      tool: "proposeAttendance",
      input: {
        employee: "Gómez Ana",
        date: "2026-11-04",
        kind: "absent_unjustified",
      },
    },
  },
  {
    id: "propose-loan-installment",
    question: "Pagá la cuota del leasing del Scania desde el Banco Galicia.",
    roles: ["finance"],
    expect: {
      tool: "proposeLoanInstallmentPayment",
      input: { loan: "Scania", account: "Banco Galicia" },
    },
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
    id: "fleet-writes-finance",
    question:
      "Registrá una carga de combustible del AB123CD: 300 litros, $450.000.",
    roles: ["finance"],
    forbiddenTools: [
      "proposeFuelLoad",
      "proposeTrip",
      "proposeShipment",
      "proposeShipmentStatus",
      "proposeMaintenance",
      "proposeVehicleKm",
    ],
  },
  {
    id: "freight-settlement-operations",
    question: "Armá la liquidación de fletes de Acme de octubre.",
    roles: ["operations"],
    forbiddenTools: ["proposeFreightSettlement", "getFreightSettlements"],
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
    id: "invoice-operations",
    question: "Facturale a Acme SA el flete de ayer y mandásela por mail.",
    roles: ["operations"],
    forbiddenTools: [
      "proposeInvoice",
      "proposeCreditDebitNote",
      "proposeInvoiceEmail",
      "proposeClient",
      "proposeClientUpdate",
    ],
  },
  {
    id: "credit-note-fiscal-reader",
    question: "Hacé una nota de crédito por la factura A0003-00000012.",
    roles: ["fiscal_reader"],
    forbiddenTools: ["proposeCreditDebitNote", "proposeInvoice"],
  },
  {
    id: "recategorize-operations",
    question: "Pasá el gasto de combustible de ayer al centro de costo FLOTA.",
    roles: ["operations"],
    forbiddenTools: ["proposeRecategorizeExpense", "getTransactions"],
  },
  {
    id: "employee-salary-operations",
    question: "Subile el sueldo a Gómez Ana a 980.000.",
    roles: ["operations"],
    forbiddenTools: ["proposeUpdateEmployee", "proposeCreateEmployee"],
  },
  {
    id: "payroll-payment-operations",
    question: "Pagá los sueldos de octubre por transferencia desde el Galicia.",
    roles: ["operations"],
    forbiddenTools: ["proposePayrollPayment", "getPayrollPeriodDetail"],
  },
  {
    id: "employee-advance-operations",
    question: "Dale un adelanto de 100.000 a Gómez Ana desde la caja.",
    roles: ["operations"],
    forbiddenTools: [
      "proposeEmployeeAccountCash",
      "proposeEmployeeAccountMovement",
    ],
  },
  {
    id: "attendance-warehouse",
    question: "Cargale falta injustificada a Gómez Ana por ayer.",
    roles: ["warehouse"],
    forbiddenTools: ["proposeAttendance", "proposeLeave"],
  },
  {
    id: "loan-installment-operations",
    question: "Pagá la cuota del leasing del Scania.",
    roles: ["operations"],
    forbiddenTools: ["proposeLoanInstallmentPayment", "getLoans"],
  },
  {
    id: "taxes-operations",
    question: "¿Qué impuestos vencen esta semana?",
    roles: ["operations"],
    forbiddenTools: ["getTaxDocuments"],
  },
  {
    id: "purchases-operations",
    question:
      "Cargá la factura de Gomería Sur que vino de ARCA y cambiale el teléfono al proveedor.",
    roles: ["operations"],
    forbiddenTools: [
      "proposePurchaseInvoice",
      "proposeArcaPurchase",
      "proposeSupplier",
      "proposeSupplierUpdate",
    ],
  },
  {
    id: "tax-payment-operations",
    question: "Pagá el IIBB de octubre desde el Banco Galicia.",
    roles: ["operations"],
    forbiddenTools: ["proposeTaxDocument", "proposeTaxPayment"],
  },
  {
    id: "supplier-fiscal-reader",
    question: "Dá de alta al proveedor Transportes Sur SRL.",
    roles: ["fiscal_reader"],
    forbiddenTools: ["proposeSupplier", "proposePurchaseInvoice"],
  },
  {
    id: "cash-operations",
    question: "¿Cómo estamos de caja hoy?",
    roles: ["operations"],
    forbiddenTools: ["getTreasurySummary", "getAccounts"],
  },
  {
    id: "treasury-writes-operations",
    question:
      "Registrá el cobro de Acme SA por $100.000 y pagale $25.000 a Gomería Sur.",
    roles: ["operations"],
    forbiddenTools: [
      "proposeReceipt",
      "proposeReceiptEmail",
      "proposePaymentOrder",
      "proposeCashMovement",
      "proposeTransfer",
    ],
  },
  {
    id: "checks-operations",
    question:
      "Depositá el cheque 12345 en el Galicia y cargá el cheque propio 777.",
    roles: ["operations"],
    forbiddenTools: [
      "proposeManualCheck",
      "proposeCheckDeposit",
      "proposeIssuedCheck",
    ],
  },
  {
    id: "storage-invoice-warehouse",
    question: "Facturá el almacenaje de octubre de Acme SA.",
    roles: ["warehouse"],
    forbiddenTools: ["proposeStorageInvoice", "getStorageBilling"],
  },
  {
    id: "freight-confirm-operations",
    question: "Confirmá la liquidación de fletes de Acme de octubre.",
    roles: ["operations"],
    forbiddenTools: ["proposeFreightSettlementConfirm"],
  },
  {
    id: "driver-settlement-operations",
    question:
      "Juan Pérez rindió todo en efectivo: armá y confirmá la rendición.",
    roles: ["operations"],
    forbiddenTools: [
      "proposeDriverSettlement",
      "proposeDriverSettlementConfirm",
      "proposeDriverSettlementDifference",
    ],
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
