"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { round2, todayInAR } from "@/lib/format";
import { fetchLatestUsdRate } from "@/lib/fx";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import {
  isCheckAccountType,
  isLiquidAccountType,
  type TreasuryAccountRow,
  type TreasuryCurrency,
  type TreasurySummary,
} from "../schema";
import { isAccountType } from "@/features/accounts/schema";
import { indexMovementTotals } from "../lib/movement-totals";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function lastDayOfPrevMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  // Day 0 of the "current" month = last day of the previous month. We move to the
  // first day of the current month and subtract 1 day.
  const d = new Date(Date.UTC(y!, m! - 1, 1));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export async function getTreasurySummaryAction(): Promise<
  ActionResult<TreasurySummary>
> {
  const ctx = await requireUserContext();
  // accounting:read is the "view finances" permission. Treasury falls under it.
  if (!userCan(ctx.access, "accounting:read")) {
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

  // 3. Liquid totals per currency + ARS checks in portfolio. Checks only exist
  // in ARS in this business, so they are not tracked per currency.
  const liquid_now: Record<TreasuryCurrency, number> = { ARS: 0, USD: 0 };
  const liquid_prev_eom: Record<TreasuryCurrency, number> = { ARS: 0, USD: 0 };
  let checks_now = 0;
  let checks_prev_eom = 0;

  for (const a of accounts) {
    if (isLiquidAccountType(a.type)) {
      liquid_now[a.currency] += a.balance_now;
      liquid_prev_eom[a.currency] += a.balance_prev_eom;
    } else if (isCheckAccountType(a.type) && a.currency === "ARS") {
      // checks/echeq accounts are "virtual cash box" types for checks (ARS only).
      checks_now += a.balance_now;
      checks_prev_eom += a.balance_prev_eom;
    }
  }
  // Round totals to avoid float drift after summing.
  for (const cur of ["ARS", "USD"] as const) {
    liquid_now[cur] = round2(liquid_now[cur]);
    liquid_prev_eom[cur] = round2(liquid_prev_eom[cur]);
  }
  checks_now = round2(checks_now);
  checks_prev_eom = round2(checks_prev_eom);

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
    logger.warn("treasury.summary.checks_failed", {
      userId: ctx.userId,
      error: chErr,
    });
  }

  const checks_due_soon = { count: 0, amount: 0 };
  for (const c of chequesRaw ?? []) {
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
    liquid_now,
    liquid_prev_eom,
    checks_now,
    checks_prev_eom,
    checks_due_soon,
    usd_rate,
  };

  return { ok: true, data: summary };
}
