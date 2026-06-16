"use server";

import { validateUIMessages, type UIMessage } from "ai";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { ActionResult } from "@/lib/query/run-action";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export type AiSessionSummary = {
  id: string;
  title: string | null;
  message_count: number;
  updated_at: string;
};

/** Lists the caller's chat sessions (RLS also lets ai:admin see all). */
export async function listAiSessionsAction(): Promise<
  ActionResult<AiSessionSummary[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:chat")) {
    return { ok: false, error: "No tenés permiso para usar el chat de IA." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("ai_chat_sessions")
    .select("id, title, message_count, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    logger.error("ai.sessions.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar las conversaciones." };
  }

  return { ok: true, data: data ?? [] };
}

/** Loads one session's messages as validated UIMessage[] (RLS-gated). */
export async function getAiSessionMessagesAction(
  sessionId: string,
): Promise<ActionResult<UIMessage[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:chat")) {
    return { ok: false, error: "No tenés permiso para usar el chat de IA." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("ai_chat_messages")
    .select("content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("ai.sessions.messages.failed", {
      userId: ctx.userId,
      sessionId,
      error,
    });
    return { ok: false, error: "No se pudo cargar la conversación." };
  }

  try {
    const messages = await validateUIMessages({
      messages: (data ?? []).map((row) => row.content),
    });
    return { ok: true, data: messages };
  } catch (err) {
    logger.error("ai.sessions.messages.invalid", { sessionId, error: err });
    return { ok: false, error: "La conversación está dañada." };
  }
}

/** Deletes a session (cascade removes its messages). RLS-gated. */
export async function deleteAiSessionAction(
  sessionId: string,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:chat")) {
    return { ok: false, error: "No tenés permiso para usar el chat de IA." };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("ai_chat_sessions")
    .delete()
    .eq("id", sessionId);

  if (error) {
    logger.error("ai.sessions.delete.failed", {
      userId: ctx.userId,
      sessionId,
      error,
    });
    return { ok: false, error: "No se pudo borrar la conversación." };
  }

  await logAudit("ai.session.deleted", ctx.userId, {}, sessionId);
  return { ok: true, data: undefined };
}
