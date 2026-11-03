import "server-only";

import {
  comprobanteLabel,
  computeLateInterest,
} from "@/features/late-interest/lib/late-interest";
import { MONEDA } from "@/lib/afip/codes";
import { logger } from "@/lib/logger";
import { fetchInChunks, paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { liquidArsAccounts, movementTotals, must } from "../gather";
import {
  BANK_LINE_MAX_AGE_DAYS,
  CASH_WINDOW_DAYS,
  COMPARE_DAYS,
  LOAN_HORIZON_DAYS,
  addDays,
  detectCashVsFinancing,
  detectClientMarginDrop,
  detectFuelOutliers,
  detectLateInterestUncharged,
  detectLoanInstallmentsDue,
  detectPendingSettlements,
  detectUnreconciledLines,
  detectVehicleCostPerKm,
  type ClientMarginPair,
  type IndicatorFinding,
  type IndicatorKind,
  type VehicleCostPair,
  type VehicleFuelRow,
} from "./detect";

// Server-only reads for the 6.4 indicators (the analyst cron, service
// client, no user: who sees each card is decided by its kind, see
// insights/lib/visibility.ts). Every figure is summed in SQL or read whole;
// a failed read throws, and the analyst keeps that indicator's previous card
// instead of publishing one computed from a figure that silently became 0.

/** The RPCs' own page cap (ai_client_net_revenue, ai_fleet_margin). */
const RPC_PAGE = 500;

type Range = { from: string; to: string };

function ranges(today: string): { now: Range; prev: Range } {
  return {
    now: { from: addDays(today, -(COMPARE_DAYS - 1)), to: today },
    prev: {
      from: addDays(today, -(2 * COMPARE_DAYS - 1)),
      to: addDays(today, -COMPARE_DAYS),
    },
  };
}

function currencyOf(moneda: string | null): "ARS" | "USD" {
  return !moneda || moneda === MONEDA.PESOS || moneda === "ARS" ? "ARS" : "USD";
}

// ─── Margin per client ───────────────────────────────────────────────────────

/** Net revenue in pesos per client (every page of ai_client_net_revenue). */
async function netRevenueByClient(
  range: Range,
): Promise<Map<string, { name: string; revenue: number }>> {
  const service = getServiceClient();
  const out = new Map<string, { name: string; revenue: number }>();
  for (let offset = 0; ; offset += RPC_PAGE) {
    const { data, error } = await service.rpc("ai_client_net_revenue", {
      p_from: range.from,
      p_to: range.to,
      p_limit: RPC_PAGE,
      p_offset: offset,
    });
    const rows = must({ data, error }, "client_net_revenue");
    for (const r of rows) {
      out.set(r.client_id, {
        name: r.legal_name,
        revenue: Number(r.net_revenue_ars),
      });
    }
    if (rows.length < RPC_PAGE) break;
  }
  return out;
}

/** Direct cost per group key (trips + the fuel imputed to them), as
 *  getClientMargin and the profitability report count it. */
async function fleetCostBy(
  groupBy: "client" | "vehicle",
  range: Range,
  withMaintenance: boolean,
): Promise<Map<string, number>> {
  const { data, error } = await getServiceClient().rpc("ai_fleet_margin", {
    p_from: range.from,
    p_to: range.to,
    p_group_by: groupBy,
    p_limit: RPC_PAGE,
  });
  const rows = must({ data, error }, `fleet_margin_${groupBy}`);
  if ((rows[0]?.total_groups ?? 0) > rows.length) {
    logger.warn("ai.insights.fleet_margin_capped", { groupBy });
  }
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.group_key) continue;
    out.set(
      r.group_key,
      Number(r.trip_cost) +
        Number(r.fuel_cost) +
        (withMaintenance ? Number(r.maintenance_cost) : 0),
    );
  }
  return out;
}

async function clientMarginPairs(today: string): Promise<ClientMarginPair[]> {
  const { now, prev } = ranges(today);
  const [revNow, revPrev, costNow, costPrev] = await Promise.all([
    netRevenueByClient(now),
    netRevenueByClient(prev),
    fleetCostBy("client", now, false),
    fleetCostBy("client", prev, false),
  ]);
  return [...revNow.entries()].flatMap(([id, r]) => {
    const before = revPrev.get(id);
    if (!before) return [];
    return [
      {
        client_id: id,
        name: r.name,
        revenueNow: r.revenue,
        costNow: costNow.get(id) ?? 0,
        revenuePrev: before.revenue,
        costPrev: costPrev.get(id) ?? 0,
      },
    ];
  });
}

// ─── Vehicles ────────────────────────────────────────────────────────────────

type VehicleActivity = {
  patente: string;
  km: number;
  liters: number;
};

/** Km (odometer when both readings exist, else trips) and liters per
 *  vehicle (ai_vehicle_activity, the same figures getVehicleEconomics uses). */
async function vehicleActivity(
  range: Range,
): Promise<Map<string, VehicleActivity>> {
  const { data, error } = await getServiceClient().rpc("ai_vehicle_activity", {
    p_from: range.from,
    p_to: range.to,
    p_include_fuel: true,
    p_include_km: true,
    p_include_revenue: false,
  });
  const out = new Map<string, VehicleActivity>();
  for (const r of must({ data, error }, "vehicle_activity")) {
    if (!r.vehicle_id || !r.patente) continue;
    const odometer = r.odometer_km === null ? null : Number(r.odometer_km);
    out.set(r.vehicle_id, {
      patente: r.patente,
      km: odometer !== null && odometer > 0 ? odometer : Number(r.trip_km ?? 0),
      liters: Number(r.fuel_liters ?? 0),
    });
  }
  return out;
}

async function vehicleFigures(
  today: string,
): Promise<{ cost: VehicleCostPair[]; fuel: VehicleFuelRow[] }> {
  const { now, prev } = ranges(today);
  const [actNow, actPrev, costNow, costPrev] = await Promise.all([
    vehicleActivity(now),
    vehicleActivity(prev),
    fleetCostBy("vehicle", now, true),
    fleetCostBy("vehicle", prev, true),
  ]);
  const cost: VehicleCostPair[] = [];
  const fuel: VehicleFuelRow[] = [];
  for (const [id, a] of actNow) {
    fuel.push({
      vehicle_id: id,
      patente: a.patente,
      km: a.km,
      liters: a.liters,
    });
    const before = actPrev.get(id);
    if (!before) continue;
    cost.push({
      vehicle_id: id,
      patente: a.patente,
      kmNow: a.km,
      costNow: costNow.get(id) ?? 0,
      kmPrev: before.km,
      costPrev: costPrev.get(id) ?? 0,
    });
  }
  return { cost, fuel };
}

// ─── Late interest ───────────────────────────────────────────────────────────

async function lateInterest(today: string): Promise<IndicatorFinding[]> {
  const service = getServiceClient();
  const rows = must(
    await paginateRange((from, to) =>
      service
        .rpc("late_interest_candidates", { p_as_of: today })
        .order("invoice_id")
        .range(from, to),
    ),
    "late_interest_candidates",
  );
  return detectLateInterestUncharged(
    rows.map((r) => {
      const rate = r.monthly_rate === null ? null : Number(r.monthly_rate);
      return {
        invoice_id: r.invoice_id,
        client_name: r.client_name,
        comprobante: comprobanteLabel(r),
        currency: currencyOf(r.moneda),
        monthly_rate: rate,
        interest:
          rate === null
            ? 0
            : computeLateInterest({
                balanceDays: Number(r.balance_days),
                monthlyRate: rate,
                from: r.charge_from,
                to: today,
              }).interest,
      };
    }),
    today,
  );
}

// ─── Bank lines ──────────────────────────────────────────────────────────────

async function unreconciledLines(today: string): Promise<IndicatorFinding[]> {
  const service = getServiceClient();
  const rows = must(
    await paginateRange((from, to) =>
      service
        .from("bank_statement_lines")
        .select("id, line_date, amount, account:accounts(name)")
        .eq("status", "open")
        .lt("line_date", addDays(today, -BANK_LINE_MAX_AGE_DAYS))
        .order("id")
        .range(from, to),
    ),
    "bank_statement_lines",
  );
  return detectUnreconciledLines(
    rows.map((r) => ({
      id: r.id,
      account_name: r.account?.name ?? "—",
      line_date: r.line_date,
      amount: Number(r.amount),
    })),
    today,
  );
}

// ─── Driver rendiciones ──────────────────────────────────────────────────────

/** The rule listCodPendingAction applies: a delivered carga with a
 *  cash-on-delivery amount that is in no live rendición. */
async function pendingSettlements(today: string): Promise<IndicatorFinding[]> {
  const service = getServiceClient();
  const [ships, live, drafts] = await Promise.all([
    paginateRange((from, to) =>
      service
        .from("shipments")
        .select(
          "id, delivery_date, cod_amount, trip:trips(driver:drivers(full_name))",
        )
        .not("cod_amount", "is", null)
        .eq("status", "delivered")
        .order("id")
        .range(from, to),
    ),
    paginateRange((from, to) =>
      service
        .from("driver_settlement_items")
        .select("shipment_id")
        .eq("released", false)
        .order("id")
        .range(from, to),
    ),
    paginateRange((from, to) =>
      service
        .from("driver_settlements")
        .select("id, settlement_date, driver:drivers(full_name)")
        .eq("status", "draft")
        .order("id")
        .range(from, to),
    ),
  ]);
  const taken = new Set(
    must(live, "driver_settlement_items").map((l) => l.shipment_id),
  );
  return detectPendingSettlements(
    must(ships, "cod_shipments")
      .filter((s) => !taken.has(s.id) && s.cod_amount !== null)
      .map((s) => ({
        shipment_id: s.id,
        driver_name: s.trip?.driver?.full_name ?? null,
        delivery_date: s.delivery_date,
        cod_amount: Number(s.cod_amount),
      })),
    must(drafts, "draft_settlements").map((d) => ({
      id: d.id,
      driver_name: d.driver?.full_name ?? "—",
      settlement_date: d.settlement_date,
    })),
    today,
  );
}

// ─── Loans ───────────────────────────────────────────────────────────────────

async function loanInstallments(today: string): Promise<IndicatorFinding[]> {
  const service = getServiceClient();
  const rows = must(
    await paginateRange((from, to) =>
      service
        .from("loan_installments")
        .select(
          "id, number, due_date, amount, loan:loans!inner(description, currency, status)",
        )
        .eq("status", "pendiente")
        .eq("loan.status", "active")
        .lte("due_date", addDays(today, LOAN_HORIZON_DAYS))
        .order("id")
        .range(from, to),
    ),
    "loan_installments",
  );
  return detectLoanInstallmentsDue(
    rows.map((r) => ({
      id: r.id,
      loan_description: r.loan.description,
      number: r.number,
      due_date: r.due_date,
      amount: Number(r.amount),
      currency: currencyOf(r.loan.currency),
    })),
    today,
  );
}

// ─── Cash vs financing ───────────────────────────────────────────────────────

/** Sum of the given transactions that moved a liquid ARS account inside the
 *  window (each id once). */
async function sumLiquid(
  ids: readonly string[],
  liquid: ReadonlySet<string>,
  from: string,
  to: string,
): Promise<number> {
  const service = getServiceClient();
  const res = await fetchInChunks(ids, (chunk) =>
    service
      .from("transactions")
      .select("id, account_id, amount, transaction_date")
      .in("id", chunk)
      .gte("transaction_date", from)
      .lte("transaction_date", to),
  );
  return must(res, "financing_transactions")
    .filter((t) => liquid.has(t.account_id))
    .reduce((s, t) => s + Number(t.amount), 0);
}

async function cashVsFinancing(today: string): Promise<IndicatorFinding[]> {
  const service = getServiceClient();
  const from = addDays(today, -(CASH_WINDOW_DAYS - 1));
  const accounts = await liquidArsAccounts();
  const liquid = new Set(accounts.map((a) => a.id));
  if (liquid.size === 0) return [];

  const [totals, loans, paid] = await Promise.all([
    movementTotals(today, addDays(from, -1)),
    paginateRange((f, t) =>
      service
        .from("loans")
        .select("id, disbursement_transaction_id")
        .not("disbursement_transaction_id", "is", null)
        .order("id")
        .range(f, t),
    ),
    paginateRange((f, t) =>
      service
        .from("loan_installments")
        .select("id, transaction_id")
        .eq("status", "pagada")
        .not("transaction_id", "is", null)
        .gte("paid_date", from)
        .lte("paid_date", today)
        .order("id")
        .range(f, t),
    ),
  ]);
  const cashChange = totals
    .filter((t) => liquid.has(t.account_id))
    .reduce((s, t) => s + (t.net_until - t.net_until_split), 0);
  const disbursementIds = must(loans, "loans").flatMap((l) =>
    l.disbursement_transaction_id ? [l.disbursement_transaction_id] : [],
  );
  const installmentIds = must(paid, "paid_installments").flatMap((i) =>
    i.transaction_id ? [i.transaction_id] : [],
  );
  const [disbursements, installmentsPaid] = await Promise.all([
    sumLiquid(disbursementIds, liquid, from, today),
    sumLiquid(installmentIds, liquid, from, today),
  ]);
  return detectCashVsFinancing({ cashChange, disbursements, installmentsPaid });
}

// ─── All indicators ──────────────────────────────────────────────────────────

export type IndicatorRun = {
  findings: IndicatorFinding[];
  /** Kinds whose reads failed: the analyst keeps their previous cards. */
  failed: IndicatorKind[];
};

/**
 * Runs every indicator; one whose reads fail is logged and reported in
 * `failed` instead of sinking the others.
 */
export async function gatherIndicators(today: string): Promise<IndicatorRun> {
  const jobs: {
    kinds: IndicatorKind[];
    run: () => Promise<IndicatorFinding[]>;
  }[] = [
    {
      kinds: ["client_margin_drop"],
      run: async () => detectClientMarginDrop(await clientMarginPairs(today)),
    },
    {
      kinds: ["vehicle_cost_per_km", "fuel_consumption_outlier"],
      run: async () => {
        const { cost, fuel } = await vehicleFigures(today);
        return [...detectVehicleCostPerKm(cost), ...detectFuelOutliers(fuel)];
      },
    },
    { kinds: ["late_interest_uncharged"], run: () => lateInterest(today) },
    { kinds: ["unreconciled_bank_lines"], run: () => unreconciledLines(today) },
    {
      kinds: ["pending_driver_settlements"],
      run: () => pendingSettlements(today),
    },
    { kinds: ["loan_installments_due"], run: () => loanInstallments(today) },
    { kinds: ["cash_vs_financing"], run: () => cashVsFinancing(today) },
  ];
  const settled = await Promise.allSettled(jobs.map((j) => j.run()));
  const out: IndicatorRun = { findings: [], failed: [] };
  settled.forEach((res, i) => {
    const job = jobs[i];
    if (!job) return;
    if (res.status === "fulfilled") {
      out.findings.push(...res.value);
    } else {
      logger.error("ai.insights.indicator_failed", {
        kinds: job.kinds,
        error: res.reason,
      });
      out.failed.push(...job.kinds);
    }
  });
  return out;
}
