import "server-only";

import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue | undefined }
  | JsonValue[];

/** audit_events.actor_type (check constraint in 20260616130000). */
export type AuditActorType = "user" | "ai-agent" | "system";

/**
 * Inserts an audit event using the service-role client. Failures are logged
 * but never thrown, so audit logging can't break the calling action.
 * `actorType` defaults to the column default ('user'); AI-originated events
 * pass 'ai-agent' (actor_id stays the user the agent acted for).
 */
export async function logAudit(
  eventType: string,
  actorId: string,
  payload: { [k: string]: JsonValue | undefined },
  targetResourceId?: string,
  opts: { actorType?: AuditActorType } = {},
) {
  const service = getServiceClient();
  const { error } = await service.from("audit_events").insert({
    actor_id: actorId,
    ...(opts.actorType ? { actor_type: opts.actorType } : {}),
    event_type: eventType,
    target_resource_id: targetResourceId ?? null,
    payload,
  });
  if (error) {
    logger.error("audit.insert.failed", {
      userId: actorId,
      eventType,
      targetResourceId,
      error,
    });
  }
}
