import "server-only";

import type { Json } from "@/lib/db/database.types";
import {
  PG_CHECK_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { pinRequestSchema, type PinRequest } from "../artifacts/spec";

/**
 * ai_pinned_artifacts through the service client. `authenticated` may only
 * read its own rows, so every write lands here after the caller's gate, and
 * every query filters by the acting user's id itself.
 */

const PIN_COLUMNS = "id, kind, title, action, input, config, created_at";

/** A pin as the list shows it (no data: the card loads it). */
export type AiPinnedArtifact = {
  id: string;
  kind: PinRequest["kind"];
  title: string;
  action: string;
  createdAt: string;
  request: PinRequest;
};

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null));
}

/** A stored row back into a pin; null (and logged) when its jsonb no longer
 *  matches the schema. */
function parsePin(row: {
  id: string;
  kind: string;
  title: string;
  action: string;
  input: Json;
  config: Json;
  created_at: string;
}): AiPinnedArtifact | null {
  const parsed = pinRequestSchema.safeParse({
    kind: row.kind,
    source: { action: row.action, input: row.input },
    config: row.config,
  });
  if (!parsed.success) {
    logger.error("ai.pins.invalid_row", { id: row.id, error: parsed.error });
    return null;
  }
  return {
    id: row.id,
    kind: parsed.data.kind,
    title: row.title,
    action: row.action,
    createdAt: row.created_at,
    request: parsed.data,
  };
}

export async function listPins(userId: string): Promise<AiPinnedArtifact[]> {
  const { data, error } = await getServiceClient()
    .from("ai_pinned_artifacts")
    .select(PIN_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).flatMap((row) => parsePin(row) ?? []);
}

export async function getPin(
  userId: string,
  id: string,
): Promise<AiPinnedArtifact | null> {
  const { data, error } = await getServiceClient()
    .from("ai_pinned_artifacts")
    .select(PIN_COLUMNS)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? parsePin(data) : null;
}

export type InsertPinResult =
  { ok: true; id: string } | { ok: false; reason: "duplicate" | "limit" };

/** Stores a pin. `request.source.input` must already be the action's
 *  parsed input. The database refuses a second copy of the same pin (unique
 *  index) and a pin past the per-user cap (insert trigger). */
export async function insertPin(
  userId: string,
  request: PinRequest,
): Promise<InsertPinResult> {
  const { data, error } = await getServiceClient()
    .from("ai_pinned_artifacts")
    .insert({
      user_id: userId,
      kind: request.kind,
      title: request.config.title,
      action: request.source.action,
      input: toJson(request.source.input),
      config: toJson(request.config),
    })
    .select("id")
    .single();
  if (error?.code === PG_UNIQUE_VIOLATION) {
    return { ok: false, reason: "duplicate" };
  }
  if (error?.code === PG_CHECK_VIOLATION) return { ok: false, reason: "limit" };
  if (error) throw error;
  return { ok: true, id: data.id };
}

/** Deletes one of the user's pins; false when there was none. */
export async function deletePin(userId: string, id: string): Promise<boolean> {
  const { data, error } = await getServiceClient()
    .from("ai_pinned_artifacts")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}
