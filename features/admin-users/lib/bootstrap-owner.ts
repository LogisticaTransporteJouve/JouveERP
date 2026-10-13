import "server-only";

import type { UserContext } from "@/lib/auth/context";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

/**
 * Promotes the signed-in user to `owner` when no owner exists yet and they
 * are the first user ever created, so a fresh install can be administered
 * without DB access. Returns whether the user was promoted.
 *
 * Deliberately NOT a server action (every export of a "use server" module is
 * a POST endpoint): only the admin users page calls it, with the context from
 * requireUserContext(). The check-and-insert is atomic in
 * public.bootstrap_first_owner (advisory lock), which is service-role only.
 */
export async function bootstrapOwnerIfNeeded(
  ctx: Pick<UserContext, "userId" | "roles">,
): Promise<boolean> {
  if (ctx.roles.includes("owner")) return false;

  const service = getServiceClient();
  const { data, error } = await service.rpc("bootstrap_first_owner", {
    p_user_id: ctx.userId,
  });
  if (error) {
    logger.error("bootstrap.owner.failed", { userId: ctx.userId, error });
    return false;
  }
  return data === true;
}
