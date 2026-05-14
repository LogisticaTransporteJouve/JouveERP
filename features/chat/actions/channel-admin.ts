"use server";

import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

const UpdateChannelSchema = z.object({
  channelId: z.string().uuid(),
  name: z.string().trim().min(1, "Nombre requerido.").max(60),
  description: z.string().trim().max(280).optional().nullable(),
});

export async function updateChannelAction(
  input: unknown,
): Promise<ActionResult<{ updated: true }>> {
  await requireUserContext();
  const parsed = UpdateChannelSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return { ok: false, error: firstIssue?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_chat_channel", {
    p_channel: parsed.data.channelId,
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? "",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { updated: true } };
}

const AddMembersSchema = z.object({
  channelId: z.string().uuid(),
  userIds: z.array(z.string().uuid()).min(1).max(50),
});

export async function addChannelMembersAction(
  input: unknown,
): Promise<ActionResult<{ added: number }>> {
  await requireUserContext();
  const parsed = AddMembersSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_chat_channel_members", {
    p_channel: parsed.data.channelId,
    p_user_ids: parsed.data.userIds,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { added: data ?? 0 } };
}

export async function removeChannelMemberAction(input: {
  channelId: string;
  userId: string;
}): Promise<ActionResult<{ removed: true }>> {
  await requireUserContext();
  const supabase = await createClient();
  // RLS members_delete_self_or_admin se encarga de validar.
  const { error } = await supabase
    .from("chat_channel_members")
    .delete()
    .eq("channel_id", input.channelId)
    .eq("user_id", input.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { removed: true } };
}

export async function leaveChannelAction(
  channelId: string,
): Promise<ActionResult<{ removed: true }>> {
  const ctx = await requireUserContext();
  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_channel_members")
    .delete()
    .eq("channel_id", channelId)
    .eq("user_id", ctx.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { removed: true } };
}

export async function toggleChannelMuteAction(input: {
  channelId: string;
  muted: boolean;
}): Promise<ActionResult<{ muted: boolean }>> {
  const ctx = await requireUserContext();
  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_channel_members")
    .update({ is_muted: input.muted })
    .eq("channel_id", input.channelId)
    .eq("user_id", ctx.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { muted: input.muted } };
}
