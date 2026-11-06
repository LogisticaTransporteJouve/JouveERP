import "server-only";

import { logger } from "@/lib/logger";

/** The chat RPCs' own refusals (raised as bare codes), in Spanish. */
const KNOWN_REFUSALS: Record<string, string> = {
  not_channel_admin: "Solo un administrador del grupo puede hacer eso.",
  channel_not_found: "No se encontró la conversación.",
  only_groups_can_have_members_added:
    "Solo se pueden sumar personas a un grupo.",
  only_groups_can_be_renamed: "Solo se puede renombrar un grupo.",
  name_required: "El nombre es obligatorio.",
  members_required: "Elegí al menos una persona.",
  other_user_not_found: "No se encontró a esa persona.",
  use_self_channel_for_self_dm: "Para escribirte a vos usá «Mis notas».",
};

/**
 * What the user reads when a chat read or write fails: a known refusal of
 * the chat RPCs in Spanish, otherwise `fallback`. The database's own text
 * never reaches the UI; it is logged under `slug`.
 */
export function chatActionError(
  slug: string,
  error: { message: string; code?: string | null },
  fallback: string,
): string {
  const known = KNOWN_REFUSALS[error.message];
  if (known) {
    logger.warn(slug, { code: error.message });
    return known;
  }
  logger.error(slug, { error });
  return fallback;
}
