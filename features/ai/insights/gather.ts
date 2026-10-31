import "server-only";

import { isAccountType, isCheckAccount } from "@/features/accounts/schema";
import { arsEquivalent, fetchLatestUsdRate } from "@/lib/fx";
import { paginateRange, type PageError } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import {
  expandRecurringPayment,
  type CashEvent,
  type Frequency,
} from "./cashflow";

// Server-only data gathering for the analyst (runs in the Inngest cron with the
// service client, no user context). ARS-only for the MVP — FX projection is a
// follow-up. Aging is placed at coarse representative weeks (more overdue =
// collected/paid sooner); commitments (recurring payments, checks) are dated.

/** A failed read throws: the cron step fails and retries instead of
 *  publishing an insight computed from a figure that silently became 0. */
function must<T>(
  res: { data: T | null; error: PageError | null },
  op: string,
): T {
  if (res.error || res.data === null) {
    throw new Error(
      `insights.gather.${op}: ${res.error?.message ?? "no data"}`,
    );
  }
  return res.data;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isFrequency = (v: string): v is Frequency =>
  v === "weekly" || v === "monthly" || v === "quarterly" || v === "yearly";

export type CashFlowInputs = {
  startingBalance: number;
  events: CashEvent[];
};

/** Current ARS cash: opening balances + signed movements to date of the
 *  active liquid accounts. Check accounts stay out: the checks they hold are
 *  projected as inflows by due date below. */
async function arsCashBalance(today: string): Promise<number> {
  const service = getServiceClient();
  const accounts = must(
    await paginateRange((from, to) =>
      service
        .from("accounts")
        .select("id, opening_balance, type")
        .eq("currency", "ARS")
        .eq("is_active", true)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    "accounts",
  ).filter((a) => !(isAccountType(a.type) && isCheckAccount(a.type)));
  const liquid = new Set(accounts.map((a) => a.id));
  let balance = accounts.reduce((s, a) => s + Number(a.opening_balance), 0);
  if (liquid.size > 0) {
    // Summed in Postgres: a plain transactions read stops at max_rows.
    const totals = must(
      await paginateRange((from, to) =>
        service
          .rpc("account_movement_totals", { p_until: today, p_split: today })
          .order("account_id", { ascending: true })
          .range(from, to),
      ),
      "movement_totals",
    );
    for (const t of totals) {
      if (liquid.has(t.account_id)) balance += Number(t.net_until);
    }
  }
  return Math.round(balance * 100) / 100;
}

export async function gatherCashFlow(
  today: string,
  weeks: number,
): Promise<CashFlowInputs> {
  const service = getServiceClient();
  const toDate = addDays(today, weeks * 7);
  const events: CashEvent[] = [];

  // Recurring payments (ARS, active) → dated outflows.
  const recurring = must(
    await paginateRange((from, to) =>
      service
        .from("recurring_payments")
        .select("id, description, amount, frequency, next_due_date, end_date")
        .eq("is_active", true)
        .eq("currency", "ARS")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    "recurring",
  );
  for (const rp of recurring) {
    if (!isFrequency(rp.frequency)) continue;
    events.push(
      ...expandRecurringPayment({
        nextDueDate: rp.next_due_date,
        frequency: rp.frequency,
        endDate: rp.end_date,
        amount: Number(rp.amount),
        fromDate: today,
        toDate,
        label: rp.description,
      }),
    );
  }

  // NOTE: issued checks (cheques propios) are deliberately NOT counted as future
  // outflows — issuing one is recorded as a cash transaction via its payment
  // order at issuance (the `issued_check` row is informative only,
  // 20260514194207_issued_checks.sql), so the cash already left the balance.
  // Counting them again would double-count the outflow.

  // Received checks in portfolio due in the horizon (ARS) → inflows. These do
  // NOT hit cash until deposited/accredited, so en_cartera is a real pending
  // inflow (no double-count: the balance leaves the check accounts out).
  const received = must(
    await paginateRange((from, to) =>
      service
        .from("checks")
        .select("id, check_number, amount, due_date, status, currency")
        .eq("status", "en_cartera")
        .eq("currency", "ARS")
        .gte("due_date", today)
        .lt("due_date", toDate)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    "checks",
  );
  for (const c of received) {
    events.push({
      date: c.due_date,
      amount: Math.abs(Number(c.amount)),
      label: `Cheque a depositar ${c.check_number}`,
    });
  }

  // Client aging in pesos → expected collections (coarse timing: overdue
  // sooner). Dollar balances stay out, like the USD accounts. Drained past
  // max_rows (1000): a capped read would understate the forecast.
  const clientAging = must(
    await paginateRange((from, to) =>
      service
        .from("v_client_aging")
        .select(
          "client_id, ars_bucket_0_30, ars_bucket_30_60, ars_bucket_60_90, ars_bucket_90_plus",
        )
        .order("client_id", { ascending: true })
        .range(from, to),
    ),
    "client_aging",
  );
  const ca = clientAging.reduce(
    (acc, r) => ({
      b0: acc.b0 + Number(r.ars_bucket_0_30 ?? 0),
      b1: acc.b1 + Number(r.ars_bucket_30_60 ?? 0),
      b2: acc.b2 + Number(r.ars_bucket_60_90 ?? 0),
      b3: acc.b3 + Number(r.ars_bucket_90_plus ?? 0),
    }),
    { b0: 0, b1: 0, b2: 0, b3: 0 },
  );
  pushAging(events, today, ca, 1, "Cobranzas esperadas");

  // Supplier aging in pesos → expected payments (same coarse timing).
  const supplierAging = must(
    await paginateRange((from, to) =>
      service
        .from("v_supplier_aging")
        .select(
          "supplier_id, ars_bucket_0_30, ars_bucket_30_60, ars_bucket_60_90, ars_bucket_90_plus",
        )
        .order("supplier_id", { ascending: true })
        .range(from, to),
    ),
    "supplier_aging",
  );
  const sa = supplierAging.reduce(
    (acc, r) => ({
      b0: acc.b0 + Number(r.ars_bucket_0_30 ?? 0),
      b1: acc.b1 + Number(r.ars_bucket_30_60 ?? 0),
      b2: acc.b2 + Number(r.ars_bucket_60_90 ?? 0),
      b3: acc.b3 + Number(r.ars_bucket_90_plus ?? 0),
    }),
    { b0: 0, b1: 0, b2: 0, b3: 0 },
  );
  pushAging(events, today, sa, -1, "Pagos a proveedores");

  return { startingBalance: await arsCashBalance(today), events };
}

/** Places aging buckets at representative weeks: more overdue = sooner. */
function pushAging(
  events: CashEvent[],
  today: string,
  buckets: { b0: number; b1: number; b2: number; b3: number },
  sign: 1 | -1,
  label: string,
): void {
  const place = (amount: number, weekIndex: number) => {
    if (amount > 0.005) {
      events.push({
        date: addDays(today, weekIndex * 7 + 3),
        amount: sign * amount,
        label,
      });
    }
  };
  // 60-90 + 90+ overdue → week 0; 30-60 → week 1; 0-30 → week 3.
  place(buckets.b2 + buckets.b3, 0);
  place(buckets.b1, 1);
  place(buckets.b0, 3);
}

export type ReceivablesRisk = {
  total90Plus: number;
  clientCount: number;
  top: { name: string; amount: number }[];
};

/** Clients with a 90+ overdue balance, for the receivables-risk card. Dollars
 *  count at the latest official rate; without one, only pesos are counted. */
export async function gatherReceivablesRisk(): Promise<ReceivablesRisk> {
  const service = getServiceClient();
  const [riskRes, usdRate] = await Promise.all([
    paginateRange((from, to) =>
      service
        .from("v_client_aging")
        .select(
          "client_id, ars_bucket_90_plus, usd_bucket_90_plus, clients!inner(legal_name)",
        )
        .or("ars_bucket_90_plus.gt.0,usd_bucket_90_plus.gt.0")
        .order("client_id", { ascending: true })
        .range(from, to),
    ),
    fetchLatestUsdRate(service),
  ]);

  const rows = must(riskRes, "receivables_risk")
    .map((r) => {
      const ars = Number(r.ars_bucket_90_plus ?? 0);
      const usd = Number(r.usd_bucket_90_plus ?? 0);
      return {
        name: r.clients.legal_name,
        amount: arsEquivalent(ars, usd, usdRate?.rate ?? null) ?? ars,
      };
    })
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  return {
    total90Plus: Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100,
    clientCount: rows.length,
    top: rows.slice(0, 5),
  };
}
