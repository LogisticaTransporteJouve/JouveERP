import "server-only";

import { cache } from "react";

import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

export type InvoicingChannelRow = {
  id: string;
  name: string;
  division: string;
  is_fiscal: boolean;
  is_active: boolean;
};

/**
 * Every invoicing channel the caller can see (RLS user client), ordered by
 * name. Wrapped in React `cache()` so the dashboard layout and the page of the
 * same request share one round trip — callers filter/sort in memory. A read
 * error degrades to an empty list, as the inline queries it replaces did.
 */
export const getInvoicingChannels = cache(
  async (): Promise<InvoicingChannelRow[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("invoicing_channels")
      .select("id, name, division, is_fiscal, is_active")
      .order("name", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      logger.warn("invoicing_channels.read_failed", { error });
      return [];
    }
    return data ?? [];
  },
);

/** Active channels, ordered by name (the pickers' list). */
export async function getActiveInvoicingChannels(): Promise<
  InvoicingChannelRow[]
> {
  return (await getInvoicingChannels()).filter((c) => c.is_active);
}
