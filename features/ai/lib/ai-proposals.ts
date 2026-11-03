import "server-only";

import { createHash } from "node:crypto";

import type { Json } from "@/lib/db/database.types";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import {
  AI_PROPOSAL_COLUMNS,
  aiProposalRowSchema,
  type AiProposalRow,
} from "./ai-proposal-schema";

/**
 * ai_proposals through the service client. `authenticated` may only read its
 * own rows, so every write lands here after the caller's gate, and every
 * query filters by the acting user's id itself.
 */

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null));
}

/** JSON with object keys sorted, so equal inputs hash equal. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** One key per action and input: the same insight clicked twice. */
export function proposalDedupeKey(action: string, input: unknown): string {
  const digest = createHash("sha256").update(stableJson(input)).digest("hex");
  return `${action}:${digest.slice(0, 40)}`;
}

function parseRow(row: unknown): AiProposalRow | null {
  const parsed = aiProposalRowSchema.safeParse(row);
  if (parsed.success) return parsed.data;
  logger.error("ai.proposals.invalid_row", { error: parsed.error });
  return null;
}

/** The user's latest proposal with this key, if any. */
export async function latestProposalByKey(
  userId: string,
  dedupeKey: string,
): Promise<AiProposalRow | null> {
  const { data, error } = await getServiceClient()
    .from("ai_proposals")
    .select(AI_PROPOSAL_COLUMNS)
    .eq("user_id", userId)
    .eq("dedupe_key", dedupeKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? parseRow(data) : null;
}

export async function getProposal(
  userId: string,
  id: string,
): Promise<AiProposalRow | null> {
  const { data, error } = await getServiceClient()
    .from("ai_proposals")
    .select(AI_PROPOSAL_COLUMNS)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? parseRow(data) : null;
}

export type NewProposal = {
  action: string;
  insightId: string;
  insightKind: string;
  dedupeKey: string;
  input: unknown;
  draft: unknown;
  labels: Record<string, string>;
  summary: { label: string; value: string }[];
  title: string;
  expiresAt: string;
};

/** Inserts a pending proposal; returns null when one with the same key is
 *  already pending (a concurrent prepare won: read it instead). */
export async function insertProposal(
  userId: string,
  p: NewProposal,
): Promise<AiProposalRow | null> {
  const { data, error } = await getServiceClient()
    .from("ai_proposals")
    .insert({
      user_id: userId,
      action: p.action,
      source: "insight",
      insight_id: p.insightId,
      insight_kind: p.insightKind,
      dedupe_key: p.dedupeKey,
      input: toJson(p.input),
      draft: toJson(p.draft),
      labels: toJson(p.labels),
      summary: toJson(p.summary),
      title: p.title,
      expires_at: p.expiresAt,
    })
    .select(AI_PROPOSAL_COLUMNS)
    .single();
  if (error?.code === PG_UNIQUE_VIOLATION) return null;
  if (error || !data) throw error ?? new Error("insert_failed");
  return parseRow(data);
}

/**
 * Compare-and-set out of `pending`: the UPDATE takes the row lock and
 * re-checks `status = 'pending'` (and, to accept, that it has not expired),
 * so of two clicks exactly one gets the row back and the other gets null.
 * guard_ai_proposal refuses any other transition in the database too.
 */
export async function claimProposal(
  userId: string,
  id: string,
  status: "accepted" | "dismissed" | "expired",
): Promise<AiProposalRow | null> {
  const now = new Date().toISOString();
  let q = getServiceClient()
    .from("ai_proposals")
    .update({ status, decided_at: now })
    .eq("user_id", userId)
    .eq("id", id)
    .eq("status", "pending");
  if (status === "accepted") q = q.gt("expires_at", now);
  if (status === "expired") q = q.lte("expires_at", now);
  const { data, error } = await q.select(AI_PROPOSAL_COLUMNS).maybeSingle();
  if (error) throw error;
  return data ? parseRow(data) : null;
}

/** What the accepted write produced, or the error that made it `failed`. */
export async function recordProposalOutcome(
  userId: string,
  id: string,
  outcome: { result: { id: string; note?: string } } | { error: string },
): Promise<void> {
  const patch =
    "result" in outcome
      ? { result: toJson(outcome.result) }
      : { status: "failed", error: outcome.error.slice(0, 500) };
  const { error } = await getServiceClient()
    .from("ai_proposals")
    .update(patch)
    .eq("user_id", userId)
    .eq("id", id)
    .eq("status", "accepted");
  if (error) {
    logger.error("ai.proposals.outcome_failed", { userId, id, error });
  }
}
