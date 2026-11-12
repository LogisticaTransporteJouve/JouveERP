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

/** A channel as the client knows it. The segregated-channel fields are
 *  optional so a channel without them reads as one of the main app. */
export type InvoicingChannelSummary = Pick<
  InvoicingChannel,
  "id" | "name" | "is_fiscal" | "is_active"
> &
  Partial<
    Pick<
      InvoicingChannel,
      "is_segregated" | "short_label" | "purchase_account_id"
    >
  >;

/** Whether a channel belongs to the main app. A segregated channel (DZ
 *  Instalaciones) shows only in its own section of the menu; the SQL twin is
 *  `public.channel_in_main_scope`. */
export function isMainChannel(
  channel: Pick<InvoicingChannelSummary, "is_segregated">,
): boolean {
  return channel.is_segregated !== true;
}

/** What a list reads: the side (`isFiscal`, pinned for a fiscal-only user)
 *  and, inside a segregated channel's section, that channel. `channelId: null`
 *  is the main app, without segregated channels. */
export type ChannelScope = {
  isFiscal: boolean | null;
  channelId: string | null;
};

/** The search param that puts a page inside a segregated channel's section.
 *  It travels in the URL, not in a cookie, so a plain link (mobile tab bar,
 *  breadcrumbs, global search) always opens the main app. */
export const CHANNEL_PARAM = "channel";

/** `path` inside a segregated channel's section, or `path` itself. */
export function scopedHref(path: string, channelId: string | null): string {
  if (!channelId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${CHANNEL_PARAM}=${encodeURIComponent(channelId)}`;
}

/** The active segregated channel a raw param names, or `null`: unknown,
 *  inactive or main ids do not open a section, and a fiscal-only user only
 *  opens fiscal ones. */
export function segregatedChannelFor<
  C extends Pick<
    InvoicingChannelSummary,
    "id" | "is_fiscal" | "is_active" | "is_segregated"
  >,
>(
  channels: readonly C[],
  raw: string | null | undefined,
  locked: boolean,
): C | null {
  if (!raw) return null;
  const channel = channels.find((c) => c.id === raw);
  if (!channel || !channel.is_active || isMainChannel(channel)) return null;
  if (locked && !channel.is_fiscal) return null;
  return channel;
}

/** The channels a page works with: the section's channel, else every
 *  channel of the main app. */
export function channelsForScope<
  C extends Pick<InvoicingChannelSummary, "is_segregated">,
>(channels: readonly C[], channel: C | null): C[] {
  return channel ? [channel] : channels.filter(isMainChannel);
}

/** A side of the business: Ventas/Compras (fiscal) or Otras ventas/compras. */
export type ScopeSide = Exclude<FiscalFilter, "all">;

/** Pages split by side. Everything else (treasury, dashboard, accounting…) is
 *  shared and always reads every channel. */
const SCOPED_ROUTES = [
  "/clients",
  "/invoices",
  "/receipts",
  "/aging",
  "/suppliers",
  "/purchases",
  "/payment-orders",
  "/aging-suppliers",
] as const;

export function isScopedPath(pathname: string): boolean {
  return SCOPED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/** A stored scope as a side; the retired "all" reads as fiscal. */
export function toScopeSide(filter: FiscalFilter): ScopeSide {
  return filter === "internal" ? "internal" : "fiscal";
}

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
