"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { round2, todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

import {
  buildCashFlow,
  type CashFlow,
  type CashFlowEvent,
  type CashScope,
} from "../lib/cash-flow";

const BALANCE_SIGN: Record<string, number> = {
  income: 1,
  transfer_in: 1,
  expense: -1,
  transfer_out: -1,
};

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
};

/**
 * Monthly cash flow (ARS) for internal control — includes blanco (canal fiscal)
 * y negro (canal interno). Past + current months are realized from cash
 * movements; future months project recurring payments (dated), open client
 * receivables and supplier payables (placed in the first projected month), and
 * received checks (by due date). Gated on accounting:read.
 */
export async function getCashFlowAction(input: {
  monthsBack?: number;
  monthsFwd?: number;
}): Promise<ActionResult<CashFlowResult>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
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

  const { data: accounts, error: accErr } = await supabase
    .from("accounts")
    .select("id, opening_balance")
    .eq("currency", "ARS");
  if (accErr) {
    logger.error("cashflow.accounts.failed", {
      userId: ctx.userId,
      error: accErr,
    });
    return { ok: false, error: "No se pudo calcular el flujo de caja." };
  }
  const accountIds = (accounts ?? []).map((a) => a.id);
  let cashToday = (accounts ?? []).reduce(
    (s, a) => s + Number(a.opening_balance),
    0,
  );

  if (accountIds.length > 0) {
    const { data: txs, error: txErr } = await supabase
      .from("transactions")
      .select(
        "kind, amount, transaction_date, channel:invoicing_channels(is_fiscal)",
      )
      .in("account_id", accountIds)
      .lte("transaction_date", today);
    if (txErr) {
      logger.error("cashflow.tx.failed", { userId: ctx.userId, error: txErr });
      return { ok: false, error: "No se pudo calcular el flujo de caja." };
    }
    for (const tx of txs ?? []) {
      const amt = Number(tx.amount);
      cashToday += (BALANCE_SIGN[tx.kind] ?? 0) * amt;
      if (
        (tx.kind === "income" || tx.kind === "expense") &&
        tx.transaction_date >= rangeStartDate
      ) {
        const m = monthKey(tx.transaction_date);
        if (monthSet.has(m)) {
          events.push({
            month: m,
            direction: tx.kind === "income" ? "in" : "out",
            amount: Math.abs(amt),
            scope: readFiscal(tx.channel),
          });
        }
      }
    }
  }
  cashToday = round2(cashToday);

  // Recurring payments → future outflows (dated), channel-split.
  const { data: recurring } = await supabase
    .from("recurring_payments")
    .select(
      "amount, frequency, next_due_date, end_date, channel:invoicing_channels(is_fiscal)",
    )
    .eq("is_active", true)
    .eq("currency", "ARS");
  for (const rp of recurring ?? []) {
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
            amount: Math.abs(Number(rp.amount)),
            scope: readFiscal(rp.channel),
          });
        }
      }
      occ = addByFrequency(occ, rp.frequency);
    }
  }

  // Open client receivables → expected collection (first projected month).
  const { data: recv } = await supabase
    .from("v_aging_documents")
    .select("open_amount, channel_is_fiscal");
  for (const r of recv ?? []) {
    const amt = Number(r.open_amount);
    if (amt > 0.005) {
      events.push({
        month: firstFwd,
        direction: "in",
        amount: amt,
        scope: r.channel_is_fiscal ? "facturado" : "interno",
      });
    }
  }

  // Open supplier payables → expected payment (first projected month).
  const { data: pay } = await supabase
    .from("v_supplier_aging_documents")
    .select("open_amount, channel_is_fiscal");
  for (const p of pay ?? []) {
    const amt = Number(p.open_amount);
    if (amt > 0.005) {
      events.push({
        month: firstFwd,
        direction: "out",
        amount: amt,
        scope: p.channel_is_fiscal ? "facturado" : "interno",
      });
    }
  }

  // Received checks in portfolio → inflow by due month (no channel → otro).
  const { data: checks } = await supabase
    .from("checks")
    .select("amount, due_date")
    .eq("status", "en_cartera")
    .eq("currency", "ARS")
    .gte("due_date", `${firstFwd}-01`);
  for (const c of checks ?? []) {
    const m = monthKey(c.due_date);
    if (monthSet.has(m)) {
      events.push({
        month: m,
        direction: "in",
        amount: Math.abs(Number(c.amount)),
        scope: "otro",
      });
    }
  }

  // Pending loan / leasing installments → projected outflows by due month,
  // classified by the loan's channel (blanco / negro).
  const { data: activeLoans } = await supabase
    .from("loans")
    .select("id, channel:invoicing_channels(is_fiscal)")
    .eq("status", "active");
  const loanScope = new Map<string, CashScope>();
  for (const l of activeLoans ?? []) loanScope.set(l.id, readFiscal(l.channel));
  if (loanScope.size > 0) {
    const { data: loanInst } = await supabase
      .from("loan_installments")
      .select("loan_id, due_date, amount")
      .eq("status", "pendiente")
      .gte("due_date", `${firstFwd}-01`)
      .lte("due_date", rangeEndDate);
    for (const li of loanInst ?? []) {
      const scope = loanScope.get(li.loan_id);
      if (!scope) continue;
      const m = monthKey(li.due_date);
      if (monthSet.has(m)) {
        events.push({
          month: m,
          direction: "out",
          amount: Math.abs(Number(li.amount)),
          scope,
        });
      }
    }
  }

  const flow = buildCashFlow({ months, events, cashToday });
  return {
    ok: true,
    data: { ...flow, currency: "ARS", monthsBack, monthsFwd, pendingMonth: firstFwd },
  };
}
