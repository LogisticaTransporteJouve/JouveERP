import {
  AGING_BUCKETS,
  type AgingReport,
  type CurrencyAmounts,
} from "@/lib/aging";

/**
 * What an action's `run` returns: a compact, human-readable `summary`
 * (token-disciplined) plus the structured `data` the UI can render as an
 * inline artifact, and whether the figures are partial (a page, a cap, a
 * truncated read). On failure the model receives the error string and can
 * adapt or explain — runs never throw.
 */
export type AiRunResult =
  | {
      ok: true;
      summary: string;
      data: unknown;
      partial?: boolean;
      currency?: string;
      exchangeRate?: { currency: string; rate: number; date: string };
      note?: string;
    }
  | AiErrorResult;

export type AiErrorResult = { ok: false; summary: string; error: string };

/** Provenance every successful tool result carries to the model. */
export type AiToolMeta = {
  /** Tables, views or RPCs the figures come from. */
  sources: readonly string[];
  /** When the server computed the result (ISO timestamp). */
  asOf: string;
  /** True when the figures do not cover the whole requested set. */
  partial: boolean;
  currency?: string;
  exchangeRate?: { currency: string; rate: number; date: string };
  note?: string;
};

/** What the model receives: the run result plus `meta` on success. */
export type AiToolResult =
  | { ok: true; summary: string; data: unknown; meta: AiToolMeta }
  | AiErrorResult;

type OkExtras = {
  partial?: boolean;
  currency?: string;
  exchangeRate?: { currency: string; rate: number; date: string };
  note?: string;
};

export function okResult(
  summary: string,
  data: unknown,
  extras: OkExtras = {},
): AiRunResult {
  return { ok: true, summary, data, ...extras };
}

export function errResult(error: string): AiErrorResult {
  return { ok: false, summary: `Failed: ${error}`, error };
}

/** PostgREST `max_rows` (supabase/config.toml). A single read that is not
 *  drained page by page and returns this many rows may have been cut. */
export const POSTGREST_MAX_ROWS = 1000;

/** True when a capped read came back full, so rows beyond it may exist. */
export function reachedCap(
  rows: number,
  cap: number = POSTGREST_MAX_ROWS,
): boolean {
  return rows >= cap;
}

/** Money formatter for tool summaries (es-AR, no decimals). */
export function money(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

function usdMoney(n: number): string {
  return `US$${Math.round(n).toLocaleString("es-AR")}`;
}

/** "$1.000 + US$500" — pesos always, dollars only when non-zero. */
function amounts(a: CurrencyAmounts): string {
  return a.usd !== 0 ? `${money(a.ars)} + ${usdMoney(a.usd)}` : money(a.ars);
}

/** Aging tool result: totals per currency (never summed) plus the ARS
 *  equivalent at the latest official rate, which travels as exchangeRate. */
export function agingResult(
  report: AgingReport,
  partyPlural: string,
): AiRunResult {
  const t = report.totals;
  const eq =
    t.total.usd === 0
      ? ""
      : t.total_ars_equivalent === null
        ? " (no USD rate loaded: not consolidated)"
        : ` (≈ ${money(t.total_ars_equivalent)} at the official rate)`;
  const rate = report.usd_rate;
  // Flat rows so the inline table and the model read one value per column.
  const rows = report.rows.map((r) => ({
    legal_name: r.legal_name,
    cuit: r.cuit,
    total_ars: r.total.ars,
    total_usd: r.total.usd,
    total_ars_equivalent: r.total_ars_equivalent,
    ...Object.fromEntries(
      AGING_BUCKETS.flatMap((b) => [
        [`bucket_${b}_ars`, r.buckets[b].ars],
        [`bucket_${b}_usd`, r.buckets[b].usd],
      ]),
    ),
    document_count: r.document_count,
    oldest_days: r.oldest_days,
  }));
  return okResult(
    `${t.party_count} ${partyPlural} with balance · total ${amounts(t.total)}${eq} · ` +
      `+90 days ${amounts(t.buckets["90_plus"])} (${t.document_count} documents). ` +
      "Amounts per currency: *_ars in pesos, *_usd in dollars.",
    { totals: t, usd_rate: rate, rows },
    {
      currency: "ARS",
      ...(rate
        ? {
            exchangeRate: {
              currency: "USD",
              rate: rate.rate,
              date: rate.rate_date,
            },
          }
        : {}),
    },
  );
}

/** What a listed document adds to a per-currency total: its amount, its
 *  currency (AFIP or ISO code) and whether it counts (cancelled ones do not;
 *  credit notes pass a negative amount). */
export type CurrencyEntry = {
  amount: number;
  currency: string | null;
  counts: boolean;
};

/** "$1.000 + US$500" over the entries that count, one sum per currency —
 *  never added across currencies. Codes other than pesos and dollars get their
 *  own "<code> n" term. */
export function totalsByCurrency(entries: readonly CurrencyEntry[]): string {
  const sums = new Map<string, number>();
  for (const e of entries) {
    if (!e.counts) continue;
    const raw = (e.currency ?? "ARS").toUpperCase();
    const code = raw === "PES" ? "ARS" : raw === "DOL" ? "USD" : raw;
    sums.set(code, (sums.get(code) ?? 0) + e.amount);
  }
  const ars = sums.get("ARS") ?? 0;
  sums.delete("ARS");
  const parts = [money(ars)];
  const usd = sums.get("USD");
  sums.delete("USD");
  if (usd !== undefined) parts.push(usdMoney(usd));
  for (const [code, n] of [...sums].sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(`${code} ${Math.round(n).toLocaleString("es-AR")}`);
  }
  return parts.join(" + ");
}
