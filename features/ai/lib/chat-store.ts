import "server-only";

import { generateText, validateUIMessages, type UIMessage } from "ai";

import type { Json } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { buildTitleModel } from "../model";

const MAX_TITLE_LEN = 60;

/** Serialize a value (e.g. a UIMessage) to a jsonb-safe payload. */
function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value));
}

/** Concatenated text of a UIMessage's text parts (for title generation). */
export function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

/**
 * Ensures the session row exists and belongs to `userId`. Creates it on the
 * first turn. Throws `"forbidden_session"` if the id is owned by someone else
 * (the session id is client-supplied, so ownership must be enforced here — the
 * route runs the persistence path with the service client, bypassing RLS).
 */
export async function ensureAiSession(
  userId: string,
  sessionId: string,
): Promise<{ created: boolean }> {
  const service = getServiceClient();
  const { data: existing, error } = await service
    .from("ai_chat_sessions")
    .select("user_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;

  if (existing) {
    if (existing.user_id !== userId) throw new Error("forbidden_session");
    return { created: false };
  }

  const { error: insertError } = await service
    .from("ai_chat_sessions")
    .insert({ id: sessionId, user_id: userId });
  if (insertError) throw insertError;
  return { created: true };
}

/**
 * Loads a session's persisted messages as `UIMessage[]`, validated against the
 * AI SDK shape so a corrupt row can't crash the conversation. Returns `[]` for
 * a session that isn't owned by `userId` or that has no messages yet.
 */
export async function loadAiSessionMessages(
  userId: string,
  sessionId: string,
): Promise<UIMessage[]> {
  const service = getServiceClient();
  const { data: session, error: sessionError } = await service
    .from("ai_chat_sessions")
    .select("user_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session || session.user_id !== userId) return [];

  const { data, error } = await service
    .from("ai_chat_messages")
    .select("content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  try {
    return await validateUIMessages({
      messages: (data ?? []).map((row) => row.content),
    });
  } catch (err) {
    logger.error("ai.chat.load.invalid", { sessionId, error: err });
    return [];
  }
}

/** Persists one message; the DB trigger bumps message_count + updated_at. */
export async function appendAiMessage(
  sessionId: string,
  message: UIMessage,
): Promise<void> {
  const service = getServiceClient();
  const { error } = await service.from("ai_chat_messages").insert({
    session_id: sessionId,
    role: message.role,
    content: toJson(message),
  });
  if (error) throw error;
}

/**
 * Generates a short title from the first user message (Haiku) if the session
 * doesn't have one yet. Best-effort: falls back to a truncation of the user's
 * text and never throws, so a title failure can't break persistence.
 */
export async function maybeTitleAiSession(
  sessionId: string,
  firstUserText: string,
): Promise<void> {
  if (!firstUserText) return;
  const service = getServiceClient();
  const { data, error } = await service
    .from("ai_chat_sessions")
    .select("title")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !data || data.title) return;

  let title = firstUserText.slice(0, MAX_TITLE_LEN).trim();
  try {
    const { text } = await generateText({
      model: buildTitleModel(),
      prompt: `Resumí en un título corto (máximo 6 palabras, en español, sin comillas ni punto final) esta consulta a un ERP contable:\n\n"${firstUserText.slice(0, 400)}"`,
    });
    const clean = text.trim().replace(/^["']|["']$/g, "");
    if (clean) title = clean.slice(0, MAX_TITLE_LEN);
  } catch (err) {
    logger.warn("ai.chat.title.failed", { sessionId, error: err });
  }

  await service.from("ai_chat_sessions").update({ title }).eq("id", sessionId);
}
