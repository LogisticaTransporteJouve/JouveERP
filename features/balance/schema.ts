import {
  fiscalYearLabel,
  fiscalYearOf,
  fiscalYearStart,
  shortPeriodLabel,
} from "@/lib/fiscal-year";

export type AccountBalanceRow = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type:
    | "activo"
    | "pasivo"
    | "patrimonio"
    | "resultado_positivo"
    | "resultado_negativo"
    | "orden";
  eerr_category: string | null;
  total_debit: string | number;
  total_credit: string | number;
  balance: string | number;
};

export const ACCOUNT_TYPE_LABEL: Record<
  AccountBalanceRow["account_type"],
  string
> = {
  activo: "Activo",
  pasivo: "Pasivo",
  patrimonio: "Patrimonio neto",
  resultado_positivo: "Resultados positivos",
  resultado_negativo: "Resultados negativos",
  orden: "Cuentas de orden",
};

export type BalanceTotals = {
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
};

export function computeBalanceTotals(
  rows: readonly AccountBalanceRow[],
): BalanceTotals {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const r of rows) {
    totalDebit += Number(r.total_debit);
    totalCredit += Number(r.total_credit);
  }
  return {
    totalDebit,
    totalCredit,
    isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
  };
}

export type GroupedByType = Array<{
  type: AccountBalanceRow["account_type"];
  label: string;
  rows: AccountBalanceRow[];
  total: number;
}>;

const TYPE_ORDER: AccountBalanceRow["account_type"][] = [
  "activo",
  "pasivo",
  "patrimonio",
  "resultado_positivo",
  "resultado_negativo",
  "orden",
];

export function groupByType(rows: readonly AccountBalanceRow[]): GroupedByType {
  const map = new Map<AccountBalanceRow["account_type"], AccountBalanceRow[]>();
  for (const r of rows) {
    const arr = map.get(r.account_type) ?? [];
    arr.push(r);
    map.set(r.account_type, arr);
  }
  return TYPE_ORDER.filter((t) => map.has(t)).map((t) => {
    const rs = map.get(t)!;
    const total = rs.reduce((a, r) => a + Number(r.balance), 0);
    return {
      type: t,
      label: ACCOUNT_TYPE_LABEL[t],
      rows: rs,
      total,
    };
  });
}

/**
 * EERR as a cascade: sales, cost, gross result, operating expenses, operating
 * result, financial and other results, result before tax, income tax, result
 * of the period. Each line groups the result accounts of its eerr_category;
 * an amount is what the account adds to the result (−balance: income
 * positive, expenses negative). A category the cascade doesn't know, or none,
 * goes to "Otros ingresos y egresos", so the period's result always closes.
 */
export type EERRLine = {
  kind: "line";
  key: string;
  label: string;
  total: number;
  rows: Array<{ row: AccountBalanceRow; amount: number }>;
};
export type EERRSubtotal = { kind: "subtotal"; label: string; total: number };
export type EERRStep = EERRLine | EERRSubtotal;

const EERR_LINES: Array<{ key: string; label: string; categories: string[] }> =
  [
    { key: "ventas", label: "Ventas", categories: ["ingresos_operativos"] },
    { key: "costo", label: "Costo de los servicios", categories: ["costo"] },
    {
      key: "gastos_operativos",
      label: "Gastos operativos",
      categories: ["gastos_operativos"],
    },
    {
      key: "gastos_administrativos",
      label: "Gastos de administración",
      categories: ["gastos_administrativos"],
    },
    {
      key: "financieros",
      label: "Resultados financieros",
      categories: ["ingresos_financieros", "gastos_financieros"],
    },
    { key: "otros", label: "Otros ingresos y egresos", categories: [] },
    {
      key: "impuesto_ganancias",
      label: "Impuesto a las ganancias",
      categories: ["impuesto_ganancias"],
    },
  ];

const SUBTOTAL_AFTER: Record<string, string> = {
  costo: "Resultado bruto",
  gastos_administrativos: "Resultado operativo",
  otros: "Resultado antes de impuestos",
};

/** Lines that show even without accounts, so the cascade keeps its shape. */
const ALWAYS_SHOWN = new Set(["ventas", "costo"]);

export function computeEERR(rows: readonly AccountBalanceRow[]): {
  steps: EERRStep[];
  resultado: number;
} {
  const lineOf = new Map<string, string>();
  for (const l of EERR_LINES)
    for (const c of l.categories) lineOf.set(c, l.key);

  const byLine = new Map<string, EERRLine["rows"]>();
  for (const r of rows) {
    if (
      r.account_type !== "resultado_positivo" &&
      r.account_type !== "resultado_negativo"
    )
      continue;
    const key = lineOf.get(r.eerr_category ?? "") ?? "otros";
    const arr = byLine.get(key) ?? [];
    arr.push({ row: r, amount: -Number(r.balance) });
    byLine.set(key, arr);
  }

  const steps: EERRStep[] = [];
  let running = 0;
  for (const l of EERR_LINES) {
    const lineRows = (byLine.get(l.key) ?? []).sort((a, b) =>
      a.row.account_code.localeCompare(b.row.account_code, "es", {
        numeric: true,
      }),
    );
    const total = lineRows.reduce((a, r) => a + r.amount, 0);
    running += total;
    if (lineRows.length > 0 || ALWAYS_SHOWN.has(l.key)) {
      steps.push({
        kind: "line",
        key: l.key,
        label: l.label,
        total,
        rows: lineRows,
      });
    }
    const subtotal = SUBTOTAL_AFTER[l.key];
    if (subtotal)
      steps.push({ kind: "subtotal", label: subtotal, total: running });
  }

  return { steps, resultado: running };
}

/** Net result (income − expenses) of the result accounts in `rows`. */
export function netResult(rows: readonly AccountBalanceRow[]): number {
  let result = 0;
  for (const r of rows) {
    if (
      r.account_type === "resultado_positivo" ||
      r.account_type === "resultado_negativo"
    ) {
      result -= Number(r.balance);
    }
  }
  return result;
}

/**
 * Equity of the balance sheet. Assets and liabilities are balances up to the
 * cut-off (`cumulative`); no closing entry moves results to equity, so the
 * results also come from `cumulative` and split into the period's
 * (`periodRows`, from the period's start to the cut-off) and the earlier ones.
 * Before, the whole cumulative result showed as "Resultado del período".
 */
export function computeBalanceSheetEquity(
  cumulative: readonly AccountBalanceRow[],
  periodRows: readonly AccountBalanceRow[],
): {
  resultadoPeriodo: number;
  resultadosAnteriores: number;
  totalPatrimonio: number;
} {
  const patrimonio = cumulative
    .filter((r) => r.account_type === "patrimonio")
    .reduce((a, r) => a - Number(r.balance), 0);
  const total = netResult(cumulative);
  const resultadoPeriodo = netResult(periodRows);
  return {
    resultadoPeriodo,
    resultadosAnteriores: total - resultadoPeriodo,
    totalPatrimonio: patrimonio + total,
  };
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Where the Estado de Resultados and the balance sheet's «Resultado del
 * período» start: «Desde» when set, else the first month of the fiscal year
 * the cut-off is in. Balance sheet accounts stay cumulative either way.
 */
export function resultsStart(
  periodEnd: string,
  periodStart: string | null,
  fiscalYearStartMonth: number,
): string {
  return periodStart ?? fiscalYearStart(periodEnd, fiscalYearStartMonth);
}

/** The hint under the Balance filters: what each tab adds up. */
export function balanceRangeHint(
  periodEnd: string,
  periodStart: string | null,
  fiscalYearStartMonth: number,
): string {
  if (periodStart) {
    return `Mostrando movimientos del rango ${shortPeriodLabel(periodStart)} a ${shortPeriodLabel(periodEnd)}.`;
  }
  const fy = fiscalYearOf(periodEnd, fiscalYearStartMonth);
  const from = fiscalYearStart(periodEnd, fiscalYearStartMonth);
  return (
    `Sin 'desde': saldos acumulados hasta el corte; resultados del ejercicio ` +
    `${fiscalYearLabel(fy, fiscalYearStartMonth)} (${shortPeriodLabel(from)} – ${shortPeriodLabel(periodEnd)}).`
  );
}
