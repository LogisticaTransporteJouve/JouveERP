import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database";
import type { PageError } from "@/lib/supabase/paginate";

import type { LibroIvaHeader } from "./book-layout";

type Db = SupabaseClient<Database>;

/**
 * The book's title block: the company and CUIT of the fiscal channels'
 * business unit (the chosen channel's, or the first fiscal one's) and whether
 * the period is closed (Definitivo) or still open (Previo).
 */
export async function fetchLibroIvaHeader(
  supabase: Db,
  period: string,
  channelId: string | null,
): Promise<
  { data: LibroIvaHeader; error: null } | { data: null; error: PageError }
> {
  const [channels, closed] = await Promise.all([
    supabase
      .from("invoicing_channels")
      .select("id, business_unit_id")
      .eq("is_fiscal", true)
      .not("business_unit_id", "is", null)
      .order("id"),
    supabase
      .from("accounting_closed_periods")
      .select("period")
      .eq("period", period)
      .maybeSingle(),
  ]);
  if (channels.error) return { data: null, error: channels.error };
  if (closed.error) return { data: null, error: closed.error };

  const channel =
    channels.data.find((c) => c.id === channelId) ?? channels.data[0];
  let companyName = "";
  let cuit = "";
  if (channel?.business_unit_id) {
    const bu = await supabase
      .from("business_units")
      .select("name, cuit")
      .eq("id", channel.business_unit_id)
      .maybeSingle();
    if (bu.error) return { data: null, error: bu.error };
    companyName = bu.data?.name ?? "";
    cuit = bu.data?.cuit ?? "";
  }
  return {
    data: { companyName, cuit, closed: closed.data !== null },
    error: null,
  };
}
