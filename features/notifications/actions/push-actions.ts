"use server";

import { requireUserContext } from "@/lib/auth/context";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

export async function subscribePushAction(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<ActionResult<{ subscribed: true }>> {
  const ctx = await requireUserContext();
  const supabase = await createClient();

  // upsert por endpoint (unique). Si el browser regenera la subscription
  // con un endpoint nuevo se inserta otra fila — el cleanup de la vieja
  // pasa cuando el server intenta enviar y recibe 410.
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: ctx.userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth_key: input.auth,
        user_agent: input.userAgent ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { subscribed: true } };
}

export async function unsubscribePushAction(
  endpoint: string,
): Promise<ActionResult<{ unsubscribed: true }>> {
  const ctx = await requireUserContext();
  const supabase = await createClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", ctx.userId)
    .eq("endpoint", endpoint);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { unsubscribed: true } };
}
