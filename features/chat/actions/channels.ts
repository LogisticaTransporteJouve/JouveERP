"use server";

import { requireUserContext } from "@/lib/auth/context";
import { resolveAvatarUrl } from "@/lib/avatar-url";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

import { CreateGroupSchema } from "../schema";
import type { ChannelHeader, ChannelMember } from "../types";

export async function getOrCreateSelfChannelAction(): Promise<
  ActionResult<{ channelId: string }>
> {
  await requireUserContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_or_create_self_channel");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { channelId: data } };
}

export async function openOrCreateDmAction(
  otherUserId: string,
): Promise<ActionResult<{ channelId: string }>> {
  await requireUserContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_or_create_dm", {
    p_other: otherUserId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { channelId: data } };
}

export async function createGroupAction(
  input: unknown,
): Promise<ActionResult<{ channelId: string }>> {
  await requireUserContext();
  const parsed = CreateGroupSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return { ok: false, error: firstIssue?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_chat_group", {
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? "",
    p_member_ids: parsed.data.memberIds,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { channelId: data } };
}

export async function getChannelHeaderAction(
  channelId: string,
): Promise<ActionResult<ChannelHeader>> {
  const ctx = await requireUserContext();
  const supabase = await createClient();

  const { data: channel, error } = await supabase
    .from("chat_channels")
    .select("id, kind, name, description, created_by, created_at")
    .eq("id", channelId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!channel) return { ok: false, error: "Canal no encontrado." };

  const { data: membersRows, error: memErr } = await supabase
    .from("chat_channel_members")
    .select("user_id, role")
    .eq("channel_id", channelId);
  if (memErr) return { ok: false, error: memErr.message };

  const memberIds = (membersRows ?? []).map((m) => m.user_id);
  // user_profiles select está abierto a authenticated por RLS.
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("user_id, first_name, last_name, avatar_path, avatar_color")
    .in("user_id", memberIds.length > 0 ? memberIds : ["00000000-0000-0000-0000-000000000000"]);

  // Email solo lo podemos sacar de auth.users vía un RPC; reusamos
  // list_chat_assignable_users para los demás miembros + mi propio email
  // del contexto.
  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.user_id, p] as const),
  );

  const { data: assignable } = await supabase.rpc("list_chat_assignable_users");
  const emailMap = new Map<string, string>([[ctx.userId, ctx.email]]);
  for (const u of assignable ?? []) emailMap.set(u.user_id, u.email);

  const members: ChannelMember[] = (membersRows ?? []).map((m) => {
    const p = profileMap.get(m.user_id);
    return {
      user_id: m.user_id,
      email: emailMap.get(m.user_id) ?? "",
      first_name: p?.first_name ?? null,
      last_name: p?.last_name ?? null,
      avatar_path: p?.avatar_path ?? null,
      avatar_color: p?.avatar_color ?? null,
      avatar_url: resolveAvatarUrl(supabase, p?.avatar_path ?? null),
      role: m.role === "admin" ? "admin" : "member",
    };
  });

  let displayName = "";
  if (channel.kind === "self") displayName = "Mis notas";
  else if (channel.kind === "group") displayName = channel.name ?? "Grupo";
  else {
    const other = members.find((m) => m.user_id !== ctx.userId);
    displayName = other
      ? `${other.first_name ?? ""} ${other.last_name ?? ""}`.trim() || other.email
      : "DM";
  }

  return {
    ok: true,
    data: {
      id: channel.id,
      kind: channel.kind,
      name: channel.name,
      description: channel.description,
      created_by: channel.created_by,
      created_at: channel.created_at,
      display_name: displayName,
      members,
    },
  };
}

export async function markChannelReadAction(
  channelId: string,
): Promise<ActionResult<{ marked: true }>> {
  await requireUserContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_chat_channel_read", {
    p_channel: channelId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { marked: true } };
}
