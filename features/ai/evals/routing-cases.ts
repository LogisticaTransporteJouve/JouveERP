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
  /** The gated server action the tool must reach, with these arguments.
   *  Absent for a proposal (it parks a draft instead). */
  dispatch?: { fn: string; args: Record<string, unknown> };
};

/** A question whose tool the asking role must not even be offered. */
export type DeniedCase = {
  id: string;
  question: string;
  roles: Role[];
  forbiddenTools: string[];
};

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
];

export const DENIED_CASES: DeniedCase[] = [
  {
    id: "payroll-operations",
    question: "¿Cuánto pagamos de sueldo en octubre 2025?",
    roles: ["operations"],
    forbiddenTools: ["getPayrollSummary", "getPayrollConcepts"],
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
