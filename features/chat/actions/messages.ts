"use server";

import { requireUserContext } from "@/lib/auth/context";
import { resolveAvatarUrl } from "@/lib/avatar-url";
import { inngest } from "@/lib/inngest/client";
import { NOTIFICATIONS_DISPATCH } from "@/lib/inngest/events";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

import { CHAT_MESSAGES_PAGE_SIZE } from "../keys";
import {
  EditMessageSchema,
  SendMessageSchema,
  ToggleReactionSchema,
} from "../schema";
import type { Message, MessagesPage, Reaction } from "../types";

type MessageJoin = {
  id: string;
  channel_id: string;
  sender_id: string;
  reply_to_message_id: string | null;
  body: string;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

type ProfileRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_path: string | null;
  avatar_color: string | null;
};

export async function listMessagesAction(input: {
  channelId: string;
  cursor?: string | null;
  limit?: number;
}): Promise<ActionResult<MessagesPage>> {
  await requireUserContext();
  const supabase = await createClient();

  const limit = Math.min(Math.max(input.limit ?? CHAT_MESSAGES_PAGE_SIZE, 1), 200);

  let query = supabase
    .from("chat_messages")
    .select(
      "id, channel_id, sender_id, reply_to_message_id, body, edited_at, deleted_at, created_at",
    )
    .eq("channel_id", input.channelId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (input.cursor) {
    query = query.lt("created_at", input.cursor);
  }

  const { data: rows, error } = await query;
  if (error) return { ok: false, error: error.message };

  const messageRows: MessageJoin[] = rows ?? [];
  const hasMore = messageRows.length > limit;
  const trimmed = hasMore ? messageRows.slice(0, limit) : messageRows;

  // Cargar profiles de senders.
  const senderIds = Array.from(new Set(trimmed.map((m) => m.sender_id)));
  const replyIds = Array.from(
    new Set(
      trimmed
        .map((m) => m.reply_to_message_id)
        .filter((x): x is string => x !== null),
    ),
  );

  const [profilesRes, repliesRes, emailsRes] = await Promise.all([
    senderIds.length > 0
      ? supabase
          .from("user_profiles")
          .select("user_id, first_name, last_name, avatar_path, avatar_color")
          .in("user_id", senderIds)
      : Promise.resolve({ data: [] as ProfileRow[], error: null }),
    replyIds.length > 0
      ? supabase
          .from("chat_messages")
          .select("id, sender_id, body, deleted_at")
          .in("id", replyIds)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            sender_id: string;
            body: string;
            deleted_at: string | null;
          }>,
          error: null,
        }),
    supabase.rpc("list_chat_assignable_users"),
  ]);

  const profileMap = new Map<string, ProfileRow>(
    (profilesRes.data ?? []).map((p) => [p.user_id, p] as const),
  );
  const replyMap = new Map(
    (repliesRes.data ?? []).map((r) => [r.id, r] as const),
  );
  const emailMap = new Map<string, string>();
  for (const u of emailsRes.data ?? []) emailMap.set(u.user_id, u.email);

  const messages: Message[] = trimmed.map((m) => {
    const profile = profileMap.get(m.sender_id);
    const replyRow = m.reply_to_message_id
      ? replyMap.get(m.reply_to_message_id)
      : undefined;
    const replyProfile = replyRow ? profileMap.get(replyRow.sender_id) : undefined;
    return {
      id: m.id,
      channel_id: m.channel_id,
      sender_id: m.sender_id,
      sender_first_name: profile?.first_name ?? null,
      sender_last_name: profile?.last_name ?? null,
      sender_email: emailMap.get(m.sender_id) ?? null,
      sender_avatar_path: profile?.avatar_path ?? null,
      sender_avatar_color: profile?.avatar_color ?? null,
      sender_avatar_url: resolveAvatarUrl(supabase, profile?.avatar_path ?? null),
      reply_to_message_id: m.reply_to_message_id,
      reply_to_body: replyRow?.body ?? null,
      reply_to_sender_first_name: replyProfile?.first_name ?? null,
      reply_to_sender_last_name: replyProfile?.last_name ?? null,
      reply_to_sender_email: replyRow
        ? emailMap.get(replyRow.sender_id) ?? null
        : null,
      reply_to_deleted: replyRow ? replyRow.deleted_at !== null : false,
      body: m.body,
      edited_at: m.edited_at,
      deleted_at: m.deleted_at,
      created_at: m.created_at,
    };
  });

  // Devolvemos en orden cronológico ascendente para que la UI pinte de
  // viejo a nuevo. La pagination paramétrica sigue siendo "más viejo que
  // X".
  messages.reverse();

  const oldest = messages[0];
  return {
    ok: true,
    data: {
      messages,
      nextCursor: hasMore && oldest ? oldest.created_at : null,
    },
  };
}

export async function sendMessageAction(
  input: unknown,
): Promise<ActionResult<{ message: Message }>> {
  const ctx = await requireUserContext();
  const parsed = SendMessageSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return { ok: false, error: firstIssue?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      channel_id: parsed.data.channelId,
      sender_id: ctx.userId,
      body: parsed.data.body,
      reply_to_message_id: parsed.data.replyToId ?? null,
    })
    .select("id, channel_id, sender_id, reply_to_message_id, body, edited_at, deleted_at, created_at")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Error" };

  // Insert mentions (best-effort). Si falla, el mensaje ya está en BD —
  // no abortar la operación; el usuario lo va a ver igual.
  const mentions = (parsed.data.mentionUserIds ?? []).filter(
    (id) => id !== ctx.userId,
  );
  if (mentions.length > 0) {
    await supabase.from("chat_message_mentions").insert(
      mentions.map((user_id) => ({ message_id: data.id, user_id })),
    );
  }

  // Disparar push dispatch vía Inngest. Idempotente por message_id —
  // si el action se retry-ea, Inngest dedupea. Fire-and-forget: el
  // mensaje ya está persistido, los push no son críticos para el
  // response. La función carga las notifs (creadas por trigger) y
  // las distribuye a los devices suscriptos.
  try {
    await inngest.send({
      name: NOTIFICATIONS_DISPATCH,
      data: { message_id: data.id },
    });
  } catch {
    // Log silencioso: el bell del header sigue funcionando por
    // realtime aunque el push falle.
  }

  const profile = ctx.profile;
  const message: Message = {
    id: data.id,
    channel_id: data.channel_id,
    sender_id: data.sender_id,
    sender_first_name: profile.firstName,
    sender_last_name: profile.lastName,
    sender_email: ctx.email,
    sender_avatar_path: profile.avatarPath,
    sender_avatar_color: profile.avatarColor,
    sender_avatar_url: resolveAvatarUrl(supabase, profile.avatarPath),
    reply_to_message_id: data.reply_to_message_id,
    reply_to_body: null,
    reply_to_sender_first_name: null,
    reply_to_sender_last_name: null,
    reply_to_sender_email: null,
    reply_to_deleted: false,
    body: data.body,
    edited_at: data.edited_at,
    deleted_at: data.deleted_at,
    created_at: data.created_at,
  };
  return { ok: true, data: { message } };
}

export async function editMessageAction(
  input: unknown,
): Promise<ActionResult<{ updated: true }>> {
  const ctx = await requireUserContext();
  const parsed = EditMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_messages")
    .update({ body: parsed.data.body, edited_at: new Date().toISOString() })
    .eq("id", parsed.data.messageId)
    .eq("sender_id", ctx.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { updated: true } };
}

export async function deleteMessageAction(
  messageId: string,
): Promise<ActionResult<{ deleted: true }>> {
  const ctx = await requireUserContext();
  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_messages")
    .update({ deleted_at: new Date().toISOString(), body: "" })
    .eq("id", messageId)
    .eq("sender_id", ctx.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { deleted: true } };
}

// Reactions ----------------------------------------------------------------

export async function listReactionsAction(
  channelId: string,
): Promise<ActionResult<Reaction[]>> {
  await requireUserContext();
  const supabase = await createClient();

  // Para evitar un join pesado, buscamos primero los ids de mensajes del
  // canal y después sus reactions. La RLS ya nos filtra automáticamente
  // los que no podemos ver.
  const { data: messages, error: msgErr } = await supabase
    .from("chat_messages")
    .select("id")
    .eq("channel_id", channelId)
    .limit(500); // cap suficiente para chat activo
  if (msgErr) return { ok: false, error: msgErr.message };

  const ids = (messages ?? []).map((m) => m.id);
  if (ids.length === 0) return { ok: true, data: [] };

  const { data, error } = await supabase
    .from("chat_message_reactions")
    .select("message_id, user_id, emoji, created_at")
    .in("message_id", ids);
  if (error) return { ok: false, error: error.message };

  return { ok: true, data: data ?? [] };
}

export async function toggleReactionAction(
  input: unknown,
): Promise<ActionResult<{ state: "added" | "removed" }>> {
  const ctx = await requireUserContext();
  const parsed = ToggleReactionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("chat_message_reactions")
    .select("message_id")
    .eq("message_id", parsed.data.messageId)
    .eq("user_id", ctx.userId)
    .eq("emoji", parsed.data.emoji)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("chat_message_reactions")
      .delete()
      .eq("message_id", parsed.data.messageId)
      .eq("user_id", ctx.userId)
      .eq("emoji", parsed.data.emoji);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: { state: "removed" } };
  }

  const { error } = await supabase.from("chat_message_reactions").insert({
    message_id: parsed.data.messageId,
    user_id: ctx.userId,
    emoji: parsed.data.emoji,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { state: "added" } };
}
