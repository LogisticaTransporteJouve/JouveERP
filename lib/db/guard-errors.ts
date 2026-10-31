import { logger } from "@/lib/logger";

/** Hint every business-rule guard in the database raises with. */
export const JOUVE_GUARD_HINT = "jouve_guard";

interface DbError {
  message: string;
  hint?: string | null;
  code?: string | null;
}

interface GuardContext {
  /** Literal telemetry slug, e.g. `"receipts.update.rejected"`. */
  slug: string;
  userId: string;
  id?: string | null;
}

/**
 * A database guard's rejection (raised with hint `jouve_guard`) becomes the
 * guard's own Spanish message, logged as a warning with ids only. Any other
 * error returns null so the caller keeps its own handling.
 */
export function mapDbGuardError(
  error: DbError | null | undefined,
  { slug, userId, id }: GuardContext,
): string | null {
  if (!error || error.hint !== JOUVE_GUARD_HINT) return null;
  logger.warn(slug, { userId, id: id ?? null, code: error.code ?? null });
  return error.message;
}
