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
 * EERR: groups positive results (income) and negative results (expenses) by
 * eerr_category. Returns net profit = income - expenses. Convention:
 * resultado_positivo accounts have a negative balance (Σdebit-Σcredit; with
 * more credit → negative balance). We flip the sign to display them
 * positively.
 */
export type EERRSection = {
  title: string;
  categories: Array<{ name: string; total: number; rows: AccountBalanceRow[] }>;
  total: number;
};

export function computeEERR(rows: readonly AccountBalanceRow[]): {
  ingresos: EERRSection;
  gastos: EERRSection;
  resultado: number;
} {
  const posByCat = new Map<string, AccountBalanceRow[]>();
  const negByCat = new Map<string, AccountBalanceRow[]>();

  for (const r of rows) {
    if (r.account_type === "resultado_positivo") {
      const cat = r.eerr_category ?? "sin_categoria";
      const arr = posByCat.get(cat) ?? [];
      arr.push(r);
      posByCat.set(cat, arr);
    } else if (r.account_type === "resultado_negativo") {
      const cat = r.eerr_category ?? "sin_categoria";
      const arr = negByCat.get(cat) ?? [];
      arr.push(r);
      negByCat.set(cat, arr);
    }
  }

  const buildSection = (
    title: string,
    map: Map<string, AccountBalanceRow[]>,
    sign: 1 | -1,
  ): EERRSection => {
    const categories = Array.from(map.entries())
      .map(([name, rs]) => {
        const total = rs.reduce((a, r) => a + Number(r.balance) * sign, 0);
        return { name, total, rows: rs };
      })
      .sort((a, b) => b.total - a.total);
    const total = categories.reduce((a, c) => a + c.total, 0);
    return { title, categories, total };
  };

  const ingresos = buildSection("Ingresos", posByCat, -1); // credit → positive
  const gastos = buildSection("Gastos", negByCat, 1);

  return {
    ingresos,
    gastos,
    resultado: ingresos.total - gastos.total,
  };
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
