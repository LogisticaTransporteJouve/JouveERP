import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { isMainChannel } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

export type InvoicingChannelRow = {
  id: string;
  name: string;
  is_fiscal: boolean;
  is_active: boolean;
  is_segregated: boolean;
  short_label: string | null;
  purchase_account_id: string | null;
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
      .select(
        "id, name, is_fiscal, is_active, is_segregated, short_label, purchase_account_id",
      )
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

/** Active channels of the main app, ordered by name (the pickers' list). A
 *  segregated channel is offered only inside its own section. */
export async function getActiveInvoicingChannels(): Promise<
  InvoicingChannelRow[]
> {
  return (await getInvoicingChannels()).filter(
    (c) => c.is_active && isMainChannel(c),
  );
}

/** Active segregated channels: each has its own section of the menu. */
export async function getSegregatedChannels(): Promise<InvoicingChannelRow[]> {
  return (await getInvoicingChannels()).filter(
    (c) => c.is_active && !isMainChannel(c),
  );
}

/** The fiscal channel of the main app that a process with no channel of its
 *  own books to (reconciliation, the eCheq listing): the first active one by
 *  id, never a segregated one. `null` when there is none. */
export async function readMainFiscalChannelId(
  client: SupabaseClient<Database>,
): Promise<ActionResult<string | null>> {
  const { data, error } = await client
    .from("invoicing_channels")
    .select("id")
    .eq("is_fiscal", true)
    .eq("is_active", true)
    .eq("is_segregated", false)
    .order("id")
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.warn("invoicing_channels.main_fiscal_read_failed", { error });
    return { ok: false, error: "No se pudo leer el canal fiscal." };
  }
  return { ok: true, data: data?.id ?? null };
}
