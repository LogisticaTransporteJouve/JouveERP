// Pure monthly cash-flow builder (no DB). Realized months come from actual cash
// movements; projected months roll a running balance forward from today's cash.
// Each amount is split by scope so the view can show the total plus a
// facturado (canal fiscal / blanco) vs interno (canal interno / negro) badge.

export type CashScope = "facturado" | "interno" | "otro";

export type CashFlowEvent = {
  /** YYYY-MM. */
  month: string;
  direction: "in" | "out";
  /** Positive amount. */
  amount: number;
  scope: CashScope;
};

export type MonthFlow = {
  month: string;
  realized: boolean;
  inTotal: number;
  outTotal: number;
  inFacturado: number;
  inInterno: number;
  inOtro: number;
  outFacturado: number;
  outInterno: number;
  outOtro: number;
  net: number;
  /** Projected running balance from today's cash; null for realized months. */
  closing: number | null;
};

export type CashFlow = {
  months: MonthFlow[];
  cashToday: number;
  lowestClosing: number | null;
  deficitMonth: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Month (YYYY-MM) to place an open document in the projection: the month of its
 * payment due date (or invoice date if there's no due date), clamped forward to
 * the first projected month when it's already overdue. Null inputs fall back to
 * the first projected month.
 */
export function placementMonth(
  dueDate: string | null,
  invoiceDate: string | null,
  firstProjectedMonth: string,
): string {
  const ref = dueDate ?? invoiceDate;
  if (!ref) return firstProjectedMonth;
  const m = ref.slice(0, 7);
  return m < firstProjectedMonth ? firstProjectedMonth : m;
}

export function buildCashFlow(params: {
  months: { month: string; realized: boolean }[];
  events: CashFlowEvent[];
  cashToday: number;
}): CashFlow {
  const map = new Map<string, MonthFlow>();
  for (const m of params.months) {
    map.set(m.month, {
      month: m.month,
      realized: m.realized,
      inTotal: 0,
      outTotal: 0,
      inFacturado: 0,
      inInterno: 0,
      inOtro: 0,
      outFacturado: 0,
      outInterno: 0,
      outOtro: 0,
      net: 0,
      closing: null,
    });
  }

  for (const e of params.events) {
    const mf = map.get(e.month);
    if (!mf) continue;
    if (e.direction === "in") {
      mf.inTotal = round2(mf.inTotal + e.amount);
      if (e.scope === "facturado")
        mf.inFacturado = round2(mf.inFacturado + e.amount);
      else if (e.scope === "interno")
        mf.inInterno = round2(mf.inInterno + e.amount);
      else mf.inOtro = round2(mf.inOtro + e.amount);
    } else {
      mf.outTotal = round2(mf.outTotal + e.amount);
      if (e.scope === "facturado")
        mf.outFacturado = round2(mf.outFacturado + e.amount);
      else if (e.scope === "interno")
        mf.outInterno = round2(mf.outInterno + e.amount);
      else mf.outOtro = round2(mf.outOtro + e.amount);
    }
  }

  const ordered = params.months.map((m) => map.get(m.month)!);
  let running = params.cashToday;
  let lowest: number | null = null;
  let deficitMonth: string | null = null;

  for (const mf of ordered) {
    mf.net = round2(mf.inTotal - mf.outTotal);
    if (!mf.realized) {
      running = round2(running + mf.net);
      mf.closing = running;
      if (lowest === null || running < lowest) lowest = running;
      if (deficitMonth === null && running < 0) deficitMonth = mf.month;
    }
  }

  return {
    months: ordered,
    cashToday: round2(params.cashToday),
    lowestClosing: lowest,
    deficitMonth,
  };
}
