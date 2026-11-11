import "server-only";

import { cache } from "react";

import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

export type InvoicingChannelRow = {
  id: string;
  name: string;
  is_fiscal: boolean;
  is_active: boolean;
};

/**
 * Every invoicing channel the caller can see (RLS user client), ordered by
 * name, or `ok: false` when the read fails. Wrapped in React `cache()` so the
 * dashboard layout and the page of the same request share one round trip —
 * callers filter/sort in memory. A caller that computes from the list (cash
 * flow) fails on the error.
 */
export const readInvoicingChannels = cache(
  async (): Promise<
    { ok: true; channels: InvoicingChannelRow[] } | { ok: false }
  > => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("invoicing_channels")
      .select("id, name, is_fiscal, is_active")
      .order("name", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      logger.warn("invoicing_channels.read_failed", { error });
      return { ok: false };
    }
    return { ok: true, channels: data ?? [] };
  },
);

/** The channels for a picker or a label: a read error degrades to an empty
 *  list, as the inline queries it replaced did. */
export async function getInvoicingChannels(): Promise<InvoicingChannelRow[]> {
  const res = await readInvoicingChannels();
  return res.ok ? res.channels : [];
}

/** Active channels, ordered by name (the pickers' list). */
export async function getActiveInvoicingChannels(): Promise<
  InvoicingChannelRow[]
> {
  return (await getInvoicingChannels()).filter((c) => c.is_active);
}
