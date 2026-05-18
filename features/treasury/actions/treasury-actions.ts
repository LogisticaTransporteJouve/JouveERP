"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { round2, todayInAR } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

import {
  isCheckAccountType,
  isLiquidAccountType,
  type TreasuryAccountRow,
  type TreasuryCurrency,
  type TreasurySummary,
} from "../schema";
import { isAccountType } from "@/features/accounts/schema";

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function lastDayOfPrevMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  // Día 0 del mes "actual" = último día del mes anterior. Pasamos al primer
  // día del mes actual y restamos 1 día.
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
  // accounting:read es el permiso "ver finanzas". Tesorería entra ahí.
  if (!userCan(ctx.roles, "accounting:read")) {
    return { ok: false, error: "Sin permiso para ver tesorería." };
  }

  const supabase = await createClient();
  const today = todayInAR();
  const prevEom = lastDayOfPrevMonth(today);
  const sevenDays = addDaysIso(today, 7);

  // 1. Todas las cuentas activas (las inactivas no aparecen).
  const { data: accountsRaw, error: accErr } = await supabase
    .from("accounts")
    .select("id, name, type, currency, is_active, opening_balance")
    .eq("is_active", true)
    .order("name");

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

  // 2. Sum signed transactions hasta hoy y hasta fin de mes anterior, por
  // cuenta. PostgREST no soporta sum agregado en select ergonomicamente, así
  // que traemos las rows mínimas y agregamos en JS. Para una flota chica con
  // miles (no millones) de transactions esto es < 100ms.
  const { data: txsRaw, error: txErr } = await supabase
    .from("transactions")
    .select("account_id, kind, amount, transaction_date")
    .lte("transaction_date", today);

  if (txErr) {
    logger.error("treasury.summary.tx_failed", {
      userId: ctx.userId,
      error: txErr,
    });
    return { ok: false, error: "No se pudieron leer movimientos." };
  }

  const signOf = (kind: string): 1 | -1 =>
    kind === "income" || kind === "transfer_in" ? 1 : -1;

  const netNow = new Map<string, number>();
  const netPrevEom = new Map<string, number>();
  const lastMoveByAccount = new Map<string, string>();

  for (const t of txsRaw ?? []) {
    const signed = signOf(t.kind) * Number(t.amount);
    netNow.set(t.account_id, (netNow.get(t.account_id) ?? 0) + signed);
    if (t.transaction_date <= prevEom) {
      netPrevEom.set(
        t.account_id,
        (netPrevEom.get(t.account_id) ?? 0) + signed,
      );
    }
    const prev = lastMoveByAccount.get(t.account_id);
    if (!prev || t.transaction_date > prev) {
      lastMoveByAccount.set(t.account_id, t.transaction_date);
    }
  }

  const accounts: TreasuryAccountRow[] = accountsTyped.map((a) => {
    const opening = Number(a.opening_balance);
    const balance_now = round2(opening + (netNow.get(a.id) ?? 0));
    const balance_prev_eom = round2(opening + (netPrevEom.get(a.id) ?? 0));
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      is_active: a.is_active,
      balance_now,
      balance_prev_eom,
      last_movement_date: lastMoveByAccount.get(a.id) ?? null,
    };
  });

  // 3. Totales por moneda (líquido vs cheques en cartera).
  const totals_now: Record<TreasuryCurrency, { liquid: number; checks: number }> = {
    ARS: { liquid: 0, checks: 0 },
    USD: { liquid: 0, checks: 0 },
  };
  const totals_prev_eom: Record<TreasuryCurrency, { liquid: number; checks: number }> = {
    ARS: { liquid: 0, checks: 0 },
    USD: { liquid: 0, checks: 0 },
  };

  for (const a of accounts) {
    if (isLiquidAccountType(a.type)) {
      totals_now[a.currency].liquid += a.balance_now;
      totals_prev_eom[a.currency].liquid += a.balance_prev_eom;
    } else if (isCheckAccountType(a.type)) {
      // checks/echeq cuentas son tipos de "caja virtual" de cheques.
      totals_now[a.currency].checks += a.balance_now;
      totals_prev_eom[a.currency].checks += a.balance_prev_eom;
    }
  }
  // Redondear totales para evitar drift de float después de la suma.
  for (const cur of ["ARS", "USD"] as const) {
    totals_now[cur].liquid = round2(totals_now[cur].liquid);
    totals_now[cur].checks = round2(totals_now[cur].checks);
    totals_prev_eom[cur].liquid = round2(totals_prev_eom[cur].liquid);
    totals_prev_eom[cur].checks = round2(totals_prev_eom[cur].checks);
  }

  // 4. Cheques en cartera que vencen ≤ 7 días: cuántos hay y por cuánto.
  const { data: chequesRaw, error: chErr } = await supabase
    .from("checks")
    .select("amount, currency")
    .eq("status", "en_cartera")
    .gte("due_date", today)
    .lte("due_date", sevenDays);

  if (chErr) {
    logger.warn("treasury.summary.checks_failed", {
      userId: ctx.userId,
      error: chErr,
    });
  }

  const checks_due_soon: Record<TreasuryCurrency, { count: number; amount: number }> = {
    ARS: { count: 0, amount: 0 },
    USD: { count: 0, amount: 0 },
  };
  for (const c of chequesRaw ?? []) {
    const cur = c.currency as TreasuryCurrency;
    if (cur !== "ARS" && cur !== "USD") continue;
    checks_due_soon[cur].count += 1;
    checks_due_soon[cur].amount += Number(c.amount);
  }
  checks_due_soon.ARS.amount = round2(checks_due_soon.ARS.amount);
  checks_due_soon.USD.amount = round2(checks_due_soon.USD.amount);

  const summary: TreasurySummary = {
    as_of: today,
    prev_eom: prevEom,
    accounts,
    totals_now,
    totals_prev_eom,
    checks_due_soon,
  };

  return { ok: true, data: summary };
}

