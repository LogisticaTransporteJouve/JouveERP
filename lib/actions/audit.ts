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

/**
 * Inserts an audit event using the service-role client. Failures are logged
 * but never thrown, so audit logging can't break the calling action.
 */
export async function logAudit(
  eventType: string,
  actorId: string,
  payload: { [k: string]: JsonValue | undefined },
  targetResourceId?: string,
) {
  const service = getServiceClient();
  const { error } = await service.from("audit_events").insert({
    actor_id: actorId,
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
