import "server-only";

import { logger } from "@/lib/logger";

/** A failed read or write: the database text goes to the log, not the UI. */
export function failed(
  event: string,
  error: unknown,
  message: string,
): { ok: false; error: string } {
  logger.error(event, { error });
  return { ok: false, error: message };
}
