"use server";

import { requireUserContext } from "@/lib/auth/context";
import { resolveAvatarUrl } from "@/lib/avatar-url";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

import type { ChannelListItem } from "../types";

export async function listChannelsAction(): Promise<
  ActionResult<ChannelListItem[]>
> {
  await requireUserContext();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_chat_channels_for_user");
  if (error) return { ok: false, error: error.message };

  const items: ChannelListItem[] = (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    display_name: row.display_name ?? "Sin nombre",
    other_user_id: row.other_user_id,
    other_first_name: row.other_first_name ?? null,
    other_last_name: row.other_last_name ?? null,
    other_email: row.other_email ?? null,
    avatar_path: row.avatar_path,
    avatar_color: row.avatar_color,
    avatar_url: resolveAvatarUrl(supabase, row.avatar_path),
    last_message_at: row.last_message_at,
    last_message_preview: row.last_message_preview,
    last_message_sender_id: row.last_message_sender_id,
    unread_count: row.unread_count,
    is_muted: row.is_muted,
    member_count: row.member_count,
  }));

  return { ok: true, data: items };
}
