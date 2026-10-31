"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { round2, todayInAR } from "@/lib/format";
import { readLatestUsdRate, toArs } from "@/lib/fx";
import { getInvoicingChannels } from "@/lib/channels";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { channelIsFiscal } from "@/lib/scope";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import { isAccountType, isCheckAccount } from "@/features/accounts/schema";

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

/** No channel, or one we can't classify → "otro"; never guessed. */
function cashScope(isFiscal: boolean | null): CashScope {
  if (isFiscal === null) return "otro";
  return isFiscal ? "facturado" : "interno";
}

export type CashFlowResult = CashFlow & {
  currency: "ARS";
  monthsBack: number;
  monthsFwd: number;
  /** First projected month (where pending receivables/payables are placed). */
  pendingMonth: string;
  /** Latest official USD→ARS rate used to convert USD items (null = none loaded). */
  usdRate: number | null;
  /** True when USD items were left out because no rate is loaded: the
   *  figures are partial and the UI says so. */
  usdSkipped: boolean;
};

/**
 * Monthly cash flow expressed in ARS for internal control — includes blanco
 * (canal fiscal) y negro (canal interno). Past + current months are realized
 * from cash movements; future months project recurring payments (dated), open
 * client receivables and supplier payables (by due date), received checks and
 * loan installments. USD accounts/documents/checks are converted at the latest
 * official rate (exchange_rates); without a loaded rate they're left out and
 * the result is flagged `usdSkipped`, and a failed rate read fails the whole
 * flow. Gated on accounting:read.
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

  // A projection built on a failed read would show a believable but wrong
  // balance: every read fails the whole flow instead of counting as zero.
  const failed = (op: string, error: unknown): ActionResult<never> => {
    logger.error(`cashflow.${op}.failed`, { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo calcular el flujo de caja." };
  };

  const supabase = await createClient();
  const events: CashFlowEvent[] = [];
  // Every channel, inactive included, so history keeps its classification.
  const allChannels = await getInvoicingChannels();
  const scopeOfChannel = (channelId: string | null) =>
    cashScope(channelIsFiscal(channelId, allChannels));

  // Latest official USD rate — everything USD is valued at this rate (it's a
  // projection tool, not accounting; the ledger converts per-document).
  const usdRateRes = await readLatestUsdRate(supabase);
  if (!usdRateRes.ok) return failed("usd_rate", "exchange_rates read failed");
  const usdRate = usdRateRes.rate?.rate ?? null;
  let usdSkipped = false;
  /** null = USD without a loaded rate → caller skips (and the flow is flagged). */
  const arsAtRate = (amount: number, currency: string | null) => {
    const ars = toArs(amount, currency, usdRate);
    if (ars === null) usdSkipped = true;
    return ars;
  };

  const { data: accounts, error: accErr } = await paginateRange((from, to) =>
    supabase
      .from("accounts")
      .select("id, opening_balance, currency, type, is_active")
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (accErr) return failed("accounts", accErr);
  // Every account's movements count as realized flow, but today's cash is
  // only what active liquid accounts hold: checks in portfolio (checks /
  // echeq accounts) are projected below by due date, so counting their
  // account balance too would add them twice.
  const accountCurrency = new Map<string, string>();
  const liquidAccounts = new Set<string>();
  let cashToday = 0;
  for (const a of accounts) {
    const opening = arsAtRate(Number(a.opening_balance), a.currency);
    if (opening === null) continue; // USD sin cotización → afuera, como antes
    accountCurrency.set(a.id, a.currency);
    if (!a.is_active || (isAccountType(a.type) && isCheckAccount(a.type))) {
      continue;
    }
    liquidAccounts.add(a.id);
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
      return failed("tx", totalsRes.error ?? flowsRes.error);
    }
    for (const t of totalsRes.data) {
      if (!liquidAccounts.has(t.account_id)) continue;
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
  const { data: recurring, error: recurringErr } = await paginateRange(
    (from, to) =>
      supabase
        .from("recurring_payments")
        .select(
          "id, amount, currency, frequency, next_due_date, end_date, channel_id",
        )
        .eq("is_active", true)
        .order("id", { ascending: true })
        .range(from, to),
  );
  if (recurringErr) return failed("recurring", recurringErr);
  for (const rp of recurring) {
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
            scope: scopeOfChannel(rp.channel_id),
          });
        }
      }
      occ = addByFrequency(occ, rp.frequency);
    }
  }

  // Open client receivables → expected collection in the month of their due
  // date (overdue ones clamp to the first projected month), channel-split.
  // Drained past max_rows (1000): open documents grow with the business.
  const { data: recv, error: recvErr } = await paginateRange((from, to) =>
    supabase
      .from("v_aging_documents")
      .select("open_amount, channel_is_fiscal, fch_vto_pago, fecha, moneda")
      .order("document_id", { ascending: true })
      .range(from, to),
  );
  if (recvErr) return failed("receivables", recvErr);
  for (const r of recv) {
    const amt = arsAtRate(Number(r.open_amount), r.moneda);
    if (amt === null || amt <= 0.005) continue;
    const m = placementMonth(r.fch_vto_pago, r.fecha, firstFwd);
    if (monthSet.has(m)) {
      events.push({
        month: m,
        direction: "in",
        amount: amt,
        scope: cashScope(r.channel_is_fiscal),
      });
    }
  }

  // Open supplier payables → expected payment in the month of their due date
  // (overdue ones clamp to the first projected month), channel-split.
  const { data: pay, error: payErr } = await paginateRange((from, to) =>
    supabase
      .from("v_supplier_aging_documents")
      .select("open_amount, channel_is_fiscal, fch_vto_pago, fecha, moneda")
      .order("purchase_invoice_id", { ascending: true })
      .range(from, to),
  );
  if (payErr) return failed("payables", payErr);
  for (const p of pay) {
    const amt = arsAtRate(Number(p.open_amount), p.moneda);
    if (amt === null || amt <= 0.005) continue;
    const m = placementMonth(p.fch_vto_pago, p.fecha, firstFwd);
    if (monthSet.has(m)) {
      events.push({
        month: m,
        direction: "out",
        amount: amt,
        scope: cashScope(p.channel_is_fiscal),
      });
    }
  }

  // Received checks in portfolio → inflow by due month (due or overdue ones
  // clamp to the first projected month), by the check's channel (a
  // historical manual check with no channel → otro). They are the only place
  // the portfolio counts: cashToday leaves the check accounts out.
  const { data: checks, error: checksErr } = await paginateRange((from, to) =>
    supabase
      .from("checks")
      .select("id, amount, currency, due_date, channel_id")
      .eq("status", "en_cartera")
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (checksErr) return failed("checks", checksErr);
  for (const c of checks) {
    const amt = arsAtRate(Math.abs(Number(c.amount)), c.currency);
    if (amt === null) continue;
    const m = placementMonth(c.due_date, null, firstFwd);
    if (monthSet.has(m)) {
      events.push({
        month: m,
        direction: "in",
        amount: amt,
        scope: scopeOfChannel(c.channel_id),
      });
    }
  }

  // Pending loan / leasing installments → projected outflows by due month,
  // classified by the loan's channel (blanco / negro).
  const { data: activeLoans, error: loansErr } = await paginateRange(
    (from, to) =>
      supabase
        .from("loans")
        .select("id, currency, channel_id")
        .eq("status", "active")
        .order("id", { ascending: true })
        .range(from, to),
  );
  if (loansErr) return failed("loans", loansErr);
  const loanInfo = new Map<string, { scope: CashScope; currency: string }>();
  for (const l of activeLoans) {
    loanInfo.set(l.id, {
      scope: scopeOfChannel(l.channel_id),
      currency: l.currency,
    });
  }
  if (loanInfo.size > 0) {
    const { data: loanInst, error: instErr } = await paginateRange((from, to) =>
      supabase
        .from("loan_installments")
        .select("id, loan_id, due_date, amount")
        .eq("status", "pendiente")
        .gte("due_date", `${firstFwd}-01`)
        .lte("due_date", rangeEndDate)
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (instErr) return failed("installments", instErr);
    for (const li of loanInst) {
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
      usdSkipped,
    },
  };
}
