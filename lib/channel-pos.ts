import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * The punto de venta a receipt or a payment order of `channelId` is numbered
 * in: the channel's lowest enabled one, read with the caller's session. Null
 * when the channel has none (or the read fails): the caller refuses.
 */
export async function loadChannelPos(
  channelId: string,
): Promise<{ punto_venta: number } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_points")
    .select("numero, channel_id, is_enabled")
    .eq("channel_id", channelId)
    .eq("is_enabled", true)
    .order("numero", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { punto_venta: data.numero };
}
