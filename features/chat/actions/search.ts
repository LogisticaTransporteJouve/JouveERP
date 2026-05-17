"use server";

import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { resolveAvatarUrl } from "@/lib/avatar-url";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";
import { UuidSchema } from "@/lib/validation/common";

import type { SearchResult } from "../types";

const SearchInput = z.object({
  query: z.string().trim().max(200, "Búsqueda demasiado larga."),
  channelId: UuidSchema.nullable().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export async function searchChatMessagesAction(input: {
  query: string;
  channelId?: string | null;
  limit?: number;
}): Promise<ActionResult<SearchResult[]>> {
  await requireUserContext();
  const parsed = SearchInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input inválido." };
  }
  input = parsed.data;
  const trimmed = input.query.trim();
  if (trimmed.length === 0) return { ok: true, data: [] };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_chat_messages", {
    p_query: trimmed,
    p_limit: input.limit ?? 30,
    p_channel: input.channelId ?? undefined,
  });
  if (error) return { ok: false, error: error.message };

  const results: SearchResult[] = (data ?? []).map((row) => ({
    id: row.id,
    channel_id: row.channel_id,
    channel_kind: row.channel_kind,
    channel_display_name: row.channel_display_name ?? "Chat",
    sender_id: row.sender_id,
    sender_first_name: row.sender_first_name,
    sender_last_name: row.sender_last_name,
    sender_email: row.sender_email,
    sender_avatar_path: row.sender_avatar_path,
    sender_avatar_color: row.sender_avatar_color,
    sender_avatar_url: resolveAvatarUrl(supabase, row.sender_avatar_path),
    body: row.body,
    created_at: row.created_at,
  }));

  return { ok: true, data: results };
}
