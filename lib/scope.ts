import type { Database } from "@/lib/db/database.types";

export const FISCAL_FILTERS = ["all", "fiscal", "internal"] as const;
export type FiscalFilter = (typeof FISCAL_FILTERS)[number];

export const SCOPE_LABEL: Record<FiscalFilter, string> = {
  all: "Todos los canales",
  fiscal: "Solo fiscal",
  internal: "Solo interno",
};

/** Cookie the dashboard layout reads to render the scope without a flash. */
export const SCOPE_COOKIE = "jouve_scope";

export type InvoicingChannel =
  Database["public"]["Tables"]["invoicing_channels"]["Row"];

export type InvoicingChannelSummary = Pick<
  InvoicingChannel,
  "id" | "name" | "is_fiscal" | "is_active"
>;

export function isFiscalFilter(value: unknown): value is FiscalFilter {
  return FISCAL_FILTERS.some((f) => f === value);
}

/** The only writer of the scope cookie and localStorage value. An object, so a
 *  reader from before this shape (`{division, fiscalFilter}`) still parses it. */
export function serializeFiscalFilter(filter: FiscalFilter): string {
  return JSON.stringify({ fiscalFilter: filter });
}

/** The only reader: accepts what `serializeFiscalFilter` writes, the old
 *  `{division, fiscalFilter}` object and a bare value; anything else → "all". */
export function parseFiscalFilter(
  raw: string | null | undefined,
): FiscalFilter {
  if (!raw) return "all";
  if (isFiscalFilter(raw)) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isFiscalFilter(parsed)) return parsed;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "fiscalFilter" in parsed
    ) {
      return isFiscalFilter(parsed.fiscalFilter) ? parsed.fiscalFilter : "all";
    }
  } catch {
    // Not JSON: falls through to the default.
  }
  return "all";
}

/** Whether a channel is fiscal, looked up among ALL channels (an inactive one
 *  still classifies). `null` when the id is unknown — callers must not guess. */
export function channelIsFiscal(
  channelId: string | null | undefined,
  allChannels: readonly Pick<InvoicingChannelSummary, "id" | "is_fiscal">[],
): boolean | null {
  if (!channelId) return null;
  return allChannels.find((c) => c.id === channelId)?.is_fiscal ?? null;
}

/** The read filter a scope stands for: `null` is every channel, rows without
 *  a channel included; otherwise only channels with that `is_fiscal`. */
export function isFiscalFor(filter: FiscalFilter): boolean | null {
  if (filter === "fiscal") return true;
  if (filter === "internal") return false;
  return null;
}

/** The channel a new-record form pre-selects: the only active channel the
 *  scope allows, or `null` (the user picks) when there are several or none. */
export function defaultChannelFor(
  filter: FiscalFilter,
  channels: readonly Pick<
    InvoicingChannelSummary,
    "id" | "is_fiscal" | "is_active"
  >[],
): string | null {
  const isFiscal = isFiscalFor(filter);
  const eligible = channels.filter(
    (c) => c.is_active && (isFiscal === null || c.is_fiscal === isFiscal),
  );
  return eligible.length === 1 ? (eligible[0]?.id ?? null) : null;
}
