"use server";

import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { resolveAvatarUrl } from "@/lib/avatar-url";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";
import { UuidSchema } from "@/lib/validation/common";

import type { Notification } from "../types";

const ListNotificationsInput = z.object({
  filter: z.enum(["all", "unread"]).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export async function listNotificationsAction(input: {
  filter?: "all" | "unread";
  limit?: number;
}): Promise<ActionResult<Notification[]>> {
  await requireUserContext();
  const parsed = ListNotificationsInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input inválido." };
  }
  input = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_my_notifications", {
    p_filter: input.filter ?? "all",
    p_limit: input.limit ?? 50,
  });
  if (error) return { ok: false, error: error.message };

  const items: Notification[] = (data ?? []).map((row) => {
    const metadataObj =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    return {
      id: row.id,
      recipient_id: row.recipient_id,
      sender_id: row.sender_id,
      type: row.type,
      metadata: metadataObj,
      read_at: row.read_at,
      created_at: row.created_at,
      sender_first_name: row.sender_first_name,
      sender_last_name: row.sender_last_name,
      sender_email: row.sender_email,
      sender_avatar_path: row.sender_avatar_path,
      sender_avatar_color: row.sender_avatar_color,
      sender_avatar_url: resolveAvatarUrl(supabase, row.sender_avatar_path),
    };
  });

  return { ok: true, data: items };
}

export async function getUnreadCountAction(): Promise<ActionResult<number>> {
  await requireUserContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "get_my_unread_notification_count",
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? 0 };
}

export async function markNotificationReadAction(
  id: string,
): Promise<ActionResult<{ marked: true }>> {
  const ctx = await requireUserContext();
  const parsed = UuidSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "ID inválido." };
  }
  id = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("recipient_id", ctx.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { marked: true } };
}

export async function markAllReadAction(): Promise<ActionResult<{ count: number }>> {
  await requireUserContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_all_my_notifications_read");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { count: data ?? 0 } };
}
