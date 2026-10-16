import "server-only";

import {
  isRole,
  userCan,
  type Permission,
  type Role,
} from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import { mintAccessToken, runAsUser } from "./acting-user";

/** A user a background job may act as, with the roles they hold right now. */
export type HeadlessUser = { userId: string; email: string; roles: Role[] };

/** Why a job did not run as its user. */
export type HeadlessSkipReason =
  "user_disabled" | "permission_revoked" | "headless_unavailable";

export type HeadlessUserResult =
  { ok: true; user: HeadlessUser } | { ok: false; reason: HeadlessSkipReason };

/** The auth.users fields the decision reads. */
export type AuthUserState = {
  email: string | null;
  bannedUntil: string | null;
  deletedAt: string | null;
};

/**
 * Whether a job may act as this user now. Fails closed: a missing, banned or
 * deleted user, a user with no email, a role set without `permission`, or a
 * server without the JWT secret all refuse.
 */
export function headlessEligibility(input: {
  userId: string;
  authUser: AuthUserState | null;
  roles: readonly string[];
  permission: Permission;
  hasSecret: boolean;
  now: Date;
}): HeadlessUserResult {
  if (!input.hasSecret) return { ok: false, reason: "headless_unavailable" };
  const auth = input.authUser;
  if (!auth || !auth.email || auth.deletedAt) {
    return { ok: false, reason: "user_disabled" };
  }
  if (auth.bannedUntil && Date.parse(auth.bannedUntil) > input.now.getTime()) {
    return { ok: false, reason: "user_disabled" };
  }
  const roles = input.roles.filter(isRole);
  if (!userCan(roles, input.permission)) {
    return { ok: false, reason: "permission_revoked" };
  }
  return { ok: true, user: { userId: input.userId, email: auth.email, roles } };
}

function jwtSecret(): string | undefined {
  return process.env.SUPABASE_JWT_SECRET || undefined;
}

/**
 * Re-reads the user's account state and roles at run time (never trusts
 * what was true when the job was scheduled) and decides with
 * `headlessEligibility`.
 */
export async function resolveHeadlessUser(
  userId: string,
  permission: Permission,
  now: Date = new Date(),
): Promise<HeadlessUserResult> {
  const service = getServiceClient();
  const [authRes, rolesRes] = await Promise.all([
    service.auth.admin.getUserById(userId),
    service.from("user_roles").select("role_id").eq("user_id", userId),
  ]);
  if (rolesRes.error) throw rolesRes.error;
  // Only a definitive "no such user" means disabled; an Auth outage (5xx,
  // network) throws so the job retries instead of skipping the run.
  if (authRes.error && !isUserNotFound(authRes.error)) throw authRes.error;
  const user = authRes.error ? null : authRes.data.user;
  return headlessEligibility({
    userId,
    authUser: user
      ? {
          email: user.email ?? null,
          bannedUntil: user.banned_until ?? null,
          deletedAt: user.deleted_at ?? null,
        }
      : null,
    roles: (rolesRes.data ?? []).map((r) => r.role_id),
    permission,
    hasSecret: Boolean(jwtSecret()),
    now,
  });
}

/** Auth's answer for an unknown user id (404 `user_not_found`). */
export function isUserNotFound(error: {
  status?: number;
  code?: string;
}): boolean {
  return error.status === 404 || error.code === "user_not_found";
}

/** PostgREST refused the minted token: the project no longer verifies the
 *  legacy HS256 secret (rotated, revoked, or asymmetric keys only). */
export class HeadlessTokenRejectedError extends Error {
  constructor() {
    super("headless token rejected");
    this.name = "HeadlessTokenRejectedError";
  }
}

/** True for PostgREST's JWT errors (401, PGRST30x, JWT/JWS messages). */
export function isTokenRejection(
  status: number,
  error: { code?: string; message?: string } | null,
): boolean {
  if (status === 401) return true;
  if (!error) return false;
  return (
    (error.code ?? "").startsWith("PGRST30") ||
    /\bJW[STK]/i.test(error.message ?? "")
  );
}

/**
 * Runs `fn` as `user`: server actions inside see this user's context and
 * query with this user's token (lib/auth/acting-user.ts). A cheap read with
 * the token first: if PostgREST rejects it, throws
 * `HeadlessTokenRejectedError` before any real work, so the caller can skip
 * instead of reporting a run whose every read failed.
 */
export function runAsHeadlessUser<T>(
  user: HeadlessUser,
  fn: () => Promise<T>,
): Promise<T> {
  const secret = jwtSecret();
  if (!secret) throw new Error("SUPABASE_JWT_SECRET is not set");
  return runAsUser(
    {
      userId: user.userId,
      email: user.email,
      accessToken: mintAccessToken(user, secret),
    },
    async () => {
      const supabase = await createClient();
      const { error, status } = await supabase
        .from("user_roles")
        .select("role_id", { count: "exact", head: true })
        .eq("user_id", user.userId);
      if (isTokenRejection(status, error)) {
        logger.warn("auth.headless.token_rejected", {
          userId: user.userId,
          status,
          code: error?.code,
        });
        throw new HeadlessTokenRejectedError();
      }
      if (error) throw error;
      return fn();
    },
  );
}
