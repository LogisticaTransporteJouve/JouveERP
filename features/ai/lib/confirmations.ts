import "server-only";

import type { Json } from "@/lib/db/database.types";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import type {
  AiProposalRevisionInput,
  AiProposalStore,
} from "../registry/define";
import {
  CONFIRMATION_COLUMNS,
  confirmationRowSchema,
  type AiConfirmation,
} from "./confirmation-schema";

/**
 * ai_chat_confirmations through the service client. `authenticated` may only
 * read its own rows, so every write lands here after the caller's gate, and
 * every query filters by the acting user's id itself.
 */

/** Thrown when another revision of the same proposal won the race. */
export class ConcurrentRevisionError extends Error {
  constructor() {
    super("concurrent_revision");
  }
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null));
}

export function parseConfirmationRows(rows: unknown[]): AiConfirmation[] {
  const out: AiConfirmation[] = [];
  for (const row of rows) {
    const parsed = confirmationRowSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
    else logger.error("ai.confirmations.invalid_row", { error: parsed.error });
  }
  return out;
}

/**
 * Stores a new revision of a proposal: supersedes the pending revision with
 * the same key (only this user's, in this session), then inserts the next
 * revision as pending. The partial unique index allows one pending revision
 * per key, so a concurrent writer fails here instead of leaving two.
 */
export async function createConfirmationRevision(
  userId: string,
  sessionId: string,
  input: AiProposalRevisionInput,
  origin: "assistant" | "user",
): Promise<{ id: string; revision: number }> {
  const service = getServiceClient();
  const { error: supersedeError } = await service
    .from("ai_chat_confirmations")
    .update({ status: "superseded", decided_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .eq("revision_key", input.revisionKey)
    .eq("status", "pending");
  if (supersedeError) throw supersedeError;

  const { data: last, error: lastError } = await service
    .from("ai_chat_confirmations")
    .select("revision")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .eq("revision_key", input.revisionKey)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw lastError;

  const revision = (last?.revision ?? 0) + 1;
  const { data, error } = await service
    .from("ai_chat_confirmations")
    .insert({
      user_id: userId,
      session_id: sessionId,
      tool_call_id: input.toolCallId,
      action: input.action,
      revision_key: input.revisionKey,
      revision,
      origin,
      draft: toJson(input.draft),
      labels: toJson(input.labels),
      summary: toJson(input.summary),
    })
    .select("id, revision")
    .single();
  if (error?.code === PG_UNIQUE_VIOLATION) throw new ConcurrentRevisionError();
  if (error || !data) throw error ?? new Error("insert_failed");
  return data;
}

/** The proposal store a chat turn hands its tools: bound to the caller and
 *  the session the route already verified they own. */
export function chatProposalStore(
  userId: string,
  sessionId: string,
): AiProposalStore {
  return {
    createRevision: (input) =>
      createConfirmationRevision(userId, sessionId, input, "assistant"),
  };
}

/** The latest revisions (up to 200) of one of the user's sessions, oldest
 *  first. */
export async function listSessionConfirmations(
  userId: string,
  sessionId: string,
): Promise<AiConfirmation[]> {
  const service = getServiceClient();
  const { data, error } = await service
    .from("ai_chat_confirmations")
    .select(CONFIRMATION_COLUMNS)
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return parseConfirmationRows(data ?? []).reverse();
}

export async function getConfirmation(
  userId: string,
  id: string,
): Promise<AiConfirmation | null> {
  const service = getServiceClient();
  const { data, error } = await service
    .from("ai_chat_confirmations")
    .select(CONFIRMATION_COLUMNS)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? (parseConfirmationRows([data])[0] ?? null) : null;
}

/**
 * Compare-and-set: moves a revision out of `pending` only if it is still
 * pending, so of two confirms (a double click, two tabs, a stale card) exactly
 * one gets the row back and the other gets null.
 */
export async function claimConfirmation(
  userId: string,
  id: string,
  status: "confirmed" | "declined",
): Promise<AiConfirmation | null> {
  const service = getServiceClient();
  const { data, error } = await service
    .from("ai_chat_confirmations")
    .update({ status, decided_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", id)
    .eq("status", "pending")
    .select(CONFIRMATION_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? (parseConfirmationRows([data])[0] ?? null) : null;
}

/** Records what the confirmed write produced: the created id, or the error
 *  that turned the revision into `failed`. */
export async function recordConfirmationOutcome(
  userId: string,
  id: string,
  outcome: { resultId: string } | { error: string },
): Promise<void> {
  const service = getServiceClient();
  const patch =
    "resultId" in outcome
      ? { result_id: outcome.resultId }
      : { status: "failed", error: outcome.error.slice(0, 500) };
  const { error } = await service
    .from("ai_chat_confirmations")
    .update(patch)
    .eq("user_id", userId)
    .eq("id", id)
    .eq("status", "confirmed");
  if (error) {
    logger.error("ai.confirmations.outcome_failed", { userId, id, error });
  }
}

const STATUS_NOTE: Record<AiConfirmation["status"], string> = {
  pending: "pendiente: espera la decisión del usuario en la tarjeta",
  confirmed: "confirmada por el usuario y registrada",
  declined: "descartada por el usuario",
  superseded: "reemplazada por una versión más nueva",
  failed: "confirmada por el usuario pero la escritura falló",
};

/**
 * The state of the session's proposals for the system prompt, latest
 * revision per proposal: the model learns what the user decided on the cards
 * (and whether they edited a draft) from the database, not from the
 * transcript, which never changes after a tool result.
 */
export function proposalStatusNote(rows: readonly AiConfirmation[]): string {
  const latest = new Map<string, AiConfirmation>();
  for (const row of rows) {
    const prev = latest.get(row.revision_key);
    if (!prev || row.revision > prev.revision)
      latest.set(row.revision_key, row);
  }
  if (latest.size === 0) return "";
  const lines = [...latest.values()].slice(-20).map((r) => {
    const parts = [
      `- ${r.action} (revisionKey ${r.revision_key}, revision ${r.revision}): ${STATUS_NOTE[r.status]}`,
    ];
    if (r.origin === "user")
      parts.push("el usuario editó el borrador en la tarjeta");
    if (r.result_id) parts.push(`id creado ${r.result_id}`);
    return parts.join("; ");
  });
  return `Propuestas en esta conversación (estado real; las decisiones de las tarjetas las toma el usuario, no vos):\n${lines.join("\n")}`;
}
