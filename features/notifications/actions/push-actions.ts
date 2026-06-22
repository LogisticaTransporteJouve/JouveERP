"use server";

import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

const SubscribePushInput = z.object({
  endpoint: z.string().url("Endpoint inválido.").max(2000),
  p256dh: z.string().min(1).max(500),
  auth: z.string().min(1).max(500),
  userAgent: z.string().max(500).nullable().optional(),
});

export async function subscribePushAction(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<ActionResult<{ subscribed: true }>> {
  const ctx = await requireUserContext();
  const parsed = SubscribePushInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input inválido." };
  }
  input = parsed.data;
  const supabase = await createClient();

  // upsert by endpoint (unique). If the browser regenerates the subscription
  // with a new endpoint, another row is inserted — the cleanup of the old one
  // happens when the server attempts to send and receives a 410.
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
  const parsed = z.string().url().max(2000).safeParse(endpoint);
  if (!parsed.success) {
    return { ok: false, error: "Endpoint inválido." };
  }
  endpoint = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", ctx.userId)
    .eq("endpoint", endpoint);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { unsubscribed: true } };
}
