"use server";

import { addDaysIso } from "@/lib/date-range";
import { requireUserContext } from "@/lib/auth/context";
import { TREASURY_PERMISSIONS, userCanAll } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { round2, todayInAR } from "@/lib/format";
import { fetchLatestUsdRate } from "@/lib/fx";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import {
  type TreasuryAccountRow,
  type TreasuryCurrency,
  type TreasurySummary,
} from "../schema";
import { isAccountType } from "@/features/accounts/schema";
import { indexMovementTotals } from "../lib/movement-totals";
import { treasuryTotals } from "../lib/treasury-totals";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function lastDayOfPrevMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  // Day 0 of the "current" month = last day of the previous month. We move to the
  // first day of the current month and subtract 1 day.
  const d = new Date(Date.UTC(y!, m! - 1, 1));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function getTreasurySummaryAction(): Promise<
  ActionResult<TreasurySummary>
> {
  const ctx = await requireUserContext();
  // accounting:read is the "view finances" permission. Treasury falls under it.
  if (!userCanAll(ctx.access, TREASURY_PERMISSIONS)) {
    return { ok: false, error: "Sin permiso para ver tesorería." };
  }

  const supabase = await createClient();
  const today = todayInAR();
  const prevEom = lastDayOfPrevMonth(today);
  const sevenDays = addDaysIso(today, 7);

  // 1. All active accounts (inactive ones don't show up).
  const { data: accountsRaw, error: accErr } = await paginateRange((from, to) =>
    supabase
      .from("accounts")
      .select("id, name, type, currency, is_active, opening_balance")
      .eq("is_active", true)
      .order("name")
      .order("id")
      .range(from, to),
  );

  if (accErr) {
    logger.error("treasury.summary.accounts_failed", {
      userId: ctx.userId,
      error: accErr,
    });
    return { ok: false, error: "No se pudo leer cuentas." };
  }

  type NarrowedAccount = {
    id: string;
    name: string;
    type: import("@/features/accounts/schema").AccountType;
    currency: TreasuryCurrency;
    is_active: boolean;
    opening_balance: number | string;
  };
  const accountsTyped: NarrowedAccount[] = (accountsRaw ?? []).flatMap((a) =>
    isAccountType(a.type) && (a.currency === "ARS" || a.currency === "USD")
      ? [{ ...a, type: a.type, currency: a.currency }]
      : [],
  );

  // 2. Signed transaction totals per account up to today and up to the end of
  // the previous month, summed in Postgres (account_movement_totals). Summing
  // fetched rows in JS silently truncated at PostgREST's max_rows (1000); the
  // RPC returns one row per account, still drained in case accounts > 1000.
  const totalsRes = await paginateRange((from, to) =>
    supabase
      .rpc("account_movement_totals", { p_until: today, p_split: prevEom })
      .order("account_id", { ascending: true })
      .range(from, to),
  );

  if (totalsRes.error) {
    logger.error("treasury.summary.tx_failed", {
      userId: ctx.userId,
      error: totalsRes.error,
    });
    return { ok: false, error: "No se pudieron leer movimientos." };
  }

  const totals = indexMovementTotals(totalsRes.data);

  const accounts: TreasuryAccountRow[] = accountsTyped.map((a) => {
    const opening = Number(a.opening_balance);
    const t = totals.get(a.id);
    const balance_now = round2(opening + (t?.netUntil ?? 0));
    const balance_prev_eom = round2(opening + (t?.netUntilSplit ?? 0));
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      is_active: a.is_active,
      balance_now,
      balance_prev_eom,
      last_movement_date: t?.lastMovementDate ?? null,
    };
  });

  // 3. Liquid totals and check carteras, each per currency.
  const portfolio = treasuryTotals(accounts);

  // 4. ARS checks in portfolio due in ≤ 7 days: how many and for how much.
  const { data: chequesRaw, error: chErr } = await paginateRange((from, to) =>
    supabase
      .from("checks")
      .select("amount")
      .eq("status", "en_cartera")
      .eq("currency", "ARS")
      .gte("due_date", today)
      .lte("due_date", sevenDays)
      .order("id")
      .range(from, to),
  );

  if (chErr) {
    logger.error("treasury.summary.checks_failed", {
      userId: ctx.userId,
      error: chErr,
    });
    return { ok: false, error: "No se pudieron leer los cheques en cartera." };
  }

  const checks_due_soon = { count: 0, amount: 0 };
  for (const c of chequesRaw) {
    checks_due_soon.count += 1;
    checks_due_soon.amount += Number(c.amount);
  }
  checks_due_soon.amount = round2(checks_due_soon.amount);

  // 5. Latest USD→ARS exchange rate to show the ARS equivalent of dollar
  // balances (M.2). "Current value" → the most recent exchange rate.
  const usd_rate = await fetchLatestUsdRate(supabase);

  const summary: TreasurySummary = {
    as_of: today,
    prev_eom: prevEom,
    accounts,
    liquid_now: portfolio.liquid_now,
    liquid_prev_eom: portfolio.liquid_prev_eom,
    checks_now: portfolio.checks_now.ARS,
    checks_prev_eom: portfolio.checks_prev_eom.ARS,
    checks_usd_now: portfolio.checks_now.USD,
    checks_usd_prev_eom: portfolio.checks_prev_eom.USD,
    checks_due_soon,
    usd_rate,
  };

  return { ok: true, data: summary };
}
