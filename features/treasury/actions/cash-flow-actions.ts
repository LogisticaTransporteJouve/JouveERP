"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { round2, todayInAR } from "@/lib/format";
import { fetchLatestUsdRate, toArs } from "@/lib/fx";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import {
  buildCashFlow,
  placementMonth,
  type CashFlow,
  type CashFlowEvent,
  type CashScope,
} from "../lib/cash-flow";
import { monthlyFlowsToEvents } from "../lib/movement-totals";

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addByFrequency(iso: string, freq: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  if (freq === "weekly") dt.setUTCDate(dt.getUTCDate() + 7);
  else if (freq === "quarterly") dt.setUTCMonth(dt.getUTCMonth() + 3);
  else if (freq === "yearly") dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  else dt.setUTCMonth(dt.getUTCMonth() + 1); // monthly (default)
  return dt.toISOString().slice(0, 10);
}

/** Embedded to-one relations can arrive as an object or a 1-element array. */
function readFiscal(
  channel: { is_fiscal: boolean } | { is_fiscal: boolean }[] | null,
): CashScope {
  const c = Array.isArray(channel) ? channel[0] : channel;
  if (!c) return "otro";
  return c.is_fiscal ? "facturado" : "interno";
}

export type CashFlowResult = CashFlow & {
  currency: "ARS";
  monthsBack: number;
  monthsFwd: number;
  /** First projected month (where pending receivables/payables are placed). */
  pendingMonth: string;
  /** Latest official USD→ARS rate used to convert USD items (null = no rate → USD skipped). */
  usdRate: number | null;
};

/**
 * Monthly cash flow expressed in ARS for internal control — includes blanco
 * (canal fiscal) y negro (canal interno). Past + current months are realized
 * from cash movements; future months project recurring payments (dated), open
 * client receivables and supplier payables (by due date), received checks and
 * loan installments. USD accounts/documents/checks are converted at the latest
 * official rate (exchange_rates); without a loaded rate they're skipped, as
 * before. Gated on accounting:read.
 */
export async function getCashFlowAction(input: {
  monthsBack?: number;
  monthsFwd?: number;
}): Promise<ActionResult<CashFlowResult>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "Sin permiso para ver el flujo de caja." };
  }
  const monthsBack = Math.min(Math.max(input.monthsBack ?? 3, 0), 24);
  const monthsFwd = Math.min(Math.max(input.monthsFwd ?? 6, 1), 24);

  const today = todayInAR();
  const curMonth = monthKey(today);
  const firstFwd = addMonths(curMonth, 1);
  const rangeStartDate = `${addMonths(curMonth, -monthsBack)}-01`;
  const rangeEndDate = `${addMonths(curMonth, monthsFwd)}-31`;

  const months: { month: string; realized: boolean }[] = [];
  for (let i = -monthsBack; i <= monthsFwd; i++) {
    months.push({ month: addMonths(curMonth, i), realized: i <= 0 });
  }
  const monthSet = new Set(months.map((m) => m.month));

  const supabase = await createClient();
  const events: CashFlowEvent[] = [];

  // Latest official USD rate — everything USD is valued at this rate (it's a
  // projection tool, not accounting; the ledger converts per-document).
  const usdRate = (await fetchLatestUsdRate(supabase))?.rate ?? null;
  /** null = USD without a loaded rate → caller skips. */
  const arsAtRate = (amount: number, currency: string | null) =>
    toArs(amount, currency, usdRate);

  const { data: accounts, error: accErr } = await supabase
    .from("accounts")
    .select("id, opening_balance, currency");
  if (accErr) {
    logger.error("cashflow.accounts.failed", {
      userId: ctx.userId,
      error: accErr,
    });
    return { ok: false, error: "No se pudo calcular el flujo de caja." };
  }
  const accountCurrency = new Map<string, string>();
  let cashToday = 0;
  for (const a of accounts ?? []) {
    const opening = arsAtRate(Number(a.opening_balance), a.currency);
    if (opening === null) continue; // USD sin cotización → afuera, como antes
    accountCurrency.set(a.id, a.currency);
    cashToday += opening;
  }

  if (accountCurrency.size > 0) {
    // Summed in Postgres: fetching every transaction and summing in JS was
    // silently truncated at PostgREST's max_rows (1000). Both RPCs return
    // aggregated rows, still drained page by page with a total order.
    const [totalsRes, flowsRes] = await Promise.all([
      paginateRange((from, to) =>
        supabase
          .rpc("account_movement_totals", { p_until: today, p_split: today })
          .order("account_id", { ascending: true })
          .range(from, to),
      ),
      paginateRange((from, to) =>
        supabase
          .rpc("transaction_monthly_flows", {
            p_from: rangeStartDate,
            p_until: today,
          })
          .order("account_id", { ascending: true })
          .order("month", { ascending: true })
          .order("kind", { ascending: true })
          .order("scope", { ascending: true })
          .range(from, to),
      ),
    ]);
    if (totalsRes.error || flowsRes.error) {
      logger.error("cashflow.tx.failed", {
        userId: ctx.userId,
        error: totalsRes.error ?? flowsRes.error,
      });
      return { ok: false, error: "No se pudo calcular el flujo de caja." };
    }
    for (const t of totalsRes.data) {
      const currency = accountCurrency.get(t.account_id);
      if (currency === undefined) continue; // excluded above (USD sin cotización)
      const net = arsAtRate(Number(t.net_until), currency);
      if (net !== null) cashToday += net;
    }
    events.push(
      ...monthlyFlowsToEvents(flowsRes.data, {
        accountCurrency,
        toArs: arsAtRate,
        monthSet,
      }),
    );
  }
  cashToday = round2(cashToday);

  // Recurring payments → future outflows (dated), channel-split.
  const { data: recurring } = await supabase
    .from("recurring_payments")
    .select(
      "amount, currency, frequency, next_due_date, end_date, channel:invoicing_channels(is_fiscal)",
    )
    .eq("is_active", true);
  for (const rp of recurring ?? []) {
    const amount = arsAtRate(Math.abs(Number(rp.amount)), rp.currency);
    if (amount === null) continue;
    let occ = rp.next_due_date;
    let guard = 0;
    while (occ <= rangeEndDate && guard < 400) {
      guard++;
      if (occ >= `${firstFwd}-01` && (!rp.end_date || occ <= rp.end_date)) {
        const m = monthKey(occ);
        if (monthSet.has(m)) {
          events.push({
            month: m,
            direction: "out",
            amount,
            scope: readFiscal(rp.channel),
          });
        }
      }
      occ = addByFrequency(occ, rp.frequency);
    }
  }

  // Open client receivables → expected collection in the month of their due
  // date (overdue ones clamp to the first projected month), channel-split.
  // Drained past max_rows (1000): open documents grow with the business.
  const { data: recv } = await paginateRange((from, to) =>
    supabase
      .from("v_aging_documents")
      .select("open_amount, channel_is_fiscal, fch_vto_pago, fecha, moneda")
      .order("invoice_id", { ascending: true })
      .range(from, to),
  );
  for (const r of recv ?? []) {
    const amt = arsAtRate(Number(r.open_amount), r.moneda);
    if (amt === null || amt <= 0.005) continue;
    const m = placementMonth(r.fch_vto_pago, r.fecha, firstFwd);
    if (monthSet.has(m)) {
      events.push({
        month: m,
        direction: "in",
        amount: amt,
        scope: r.channel_is_fiscal ? "facturado" : "interno",
      });
    }
  }

  // Open supplier payables → expected payment in the month of their due date
  // (overdue ones clamp to the first projected month), channel-split.
  const { data: pay } = await paginateRange((from, to) =>
    supabase
      .from("v_supplier_aging_documents")
      .select("open_amount, channel_is_fiscal, fch_vto_pago, fecha, moneda")
      .order("purchase_invoice_id", { ascending: true })
      .range(from, to),
  );
  for (const p of pay ?? []) {
    const amt = arsAtRate(Number(p.open_amount), p.moneda);
    if (amt === null || amt <= 0.005) continue;
    const m = placementMonth(p.fch_vto_pago, p.fecha, firstFwd);
    if (monthSet.has(m)) {
      events.push({
        month: m,
        direction: "out",
        amount: amt,
        scope: p.channel_is_fiscal ? "facturado" : "interno",
      });
    }
  }

  // Received checks in portfolio → inflow by due month (no channel → otro).
  const { data: checks } = await paginateRange((from, to) =>
    supabase
      .from("checks")
      .select("id, amount, currency, due_date")
      .eq("status", "en_cartera")
      .gte("due_date", `${firstFwd}-01`)
      .order("id", { ascending: true })
      .range(from, to),
  );
  for (const c of checks ?? []) {
    const amt = arsAtRate(Math.abs(Number(c.amount)), c.currency);
    if (amt === null) continue;
    const m = monthKey(c.due_date);
    if (monthSet.has(m)) {
      events.push({
        month: m,
        direction: "in",
        amount: amt,
        scope: "otro",
      });
    }
  }

  // Pending loan / leasing installments → projected outflows by due month,
  // classified by the loan's channel (blanco / negro).
  const { data: activeLoans } = await supabase
    .from("loans")
    .select("id, currency, channel:invoicing_channels(is_fiscal)")
    .eq("status", "active");
  const loanInfo = new Map<string, { scope: CashScope; currency: string }>();
  for (const l of activeLoans ?? []) {
    loanInfo.set(l.id, { scope: readFiscal(l.channel), currency: l.currency });
  }
  if (loanInfo.size > 0) {
    const { data: loanInst } = await supabase
      .from("loan_installments")
      .select("loan_id, due_date, amount")
      .eq("status", "pendiente")
      .gte("due_date", `${firstFwd}-01`)
      .lte("due_date", rangeEndDate);
    for (const li of loanInst ?? []) {
      const loan = loanInfo.get(li.loan_id);
      if (!loan) continue;
      const amt = arsAtRate(Math.abs(Number(li.amount)), loan.currency);
      if (amt === null) continue;
      const m = monthKey(li.due_date);
      if (monthSet.has(m)) {
        events.push({
          month: m,
          direction: "out",
          amount: amt,
          scope: loan.scope,
        });
      }
    }
  }

  const flow = buildCashFlow({ months, events, cashToday });
  return {
    ok: true,
    data: {
      ...flow,
      currency: "ARS",
      monthsBack,
      monthsFwd,
      pendingMonth: firstFwd,
      usdRate,
    },
  };
}
