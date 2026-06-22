import type { Database } from "@/lib/db/database.types";

/** ID of the default channel pre-selected in forms (receipts, checks,
 *  transactions, payment orders, comprobantes). Matches Jouve's fiscal channel
 *  (`00003 Jouve fiscal`). If the channel does not exist in the available list,
 *  forms fall back to the first active channel. */
export const DEFAULT_CHANNEL_ID = "jouve_fiscal";

export type Division = "dz" | "jouve";
export type FiscalFilter = "all" | "fiscal" | "internal";

export type Scope = {
  division: Division | null;
  fiscalFilter: FiscalFilter;
};

export type InvoicingChannel =
  Database["public"]["Tables"]["invoicing_channels"]["Row"];

// Narrow `division` to the union enforced by the DB CHECK constraint —
// Supabase's generated types report it as `string`.
export type InvoicingChannelSummary = Omit<
  Pick<InvoicingChannel, "id" | "name" | "division" | "is_fiscal" | "is_active">,
  "division"
> & { division: Division };

/**
 * Resolves a scope to the list of channel ids that should be visible. Returns
 * `null` when the scope means "everything" (no division pinned and `all`
 * fiscal filter) — callers should treat null as "do not filter".
 */
export function channelsForScope(
  scope: Scope,
  channels: readonly InvoicingChannelSummary[],
): string[] | null {
  if (scope.division === null && scope.fiscalFilter === "all") return null;

  return channels
    .filter((channel) => {
      if (!channel.is_active) return false;
      if (scope.division !== null && channel.division !== scope.division) {
        return false;
      }
      if (scope.fiscalFilter === "fiscal" && !channel.is_fiscal) return false;
      if (scope.fiscalFilter === "internal" && channel.is_fiscal) return false;
      return true;
    })
    .map((channel) => channel.id);
}

export function isDivision(value: unknown): value is Division {
  return value === "dz" || value === "jouve";
}

export function isFiscalFilter(value: unknown): value is FiscalFilter {
  return value === "all" || value === "fiscal" || value === "internal";
}
