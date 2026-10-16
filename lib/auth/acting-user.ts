import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";

/**
 * A background job acting as one user: the user id, their email and a
 * short-lived access token for that user. While a job runs inside
 * `runAsUser`, `createClient()` (lib/supabase/server.ts) sends that token
 * instead of reading cookies and `requireUserContext()` resolves that user, so
 * every server action keeps its own `userCan` gate and RLS sees the user, the
 * same as in a browser request.
 */
export type ActingUser = {
  userId: string;
  email: string;
  accessToken: string;
};

const storage = new AsyncLocalStorage<ActingUser>();

export function getActingUser(): ActingUser | undefined {
  return storage.getStore();
}

export function runAsUser<T>(
  acting: ActingUser,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(acting, fn);
}

/** Long enough for one agent run (AI_MAX_STEPS model turns), short enough
 *  that a leaked token is useless soon. */
export const ACTING_TOKEN_TTL_SECONDS = 15 * 60;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * An HS256 access token for `userId` with the `authenticated` role, signed
 * with the project's JWT secret, as Supabase Auth would issue it. PostgREST
 * verifies the signature, so `auth.uid()` and `user_has_role()` see this
 * user. It never leaves the server process.
 */
export function mintAccessToken(
  user: { userId: string; email: string },
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: user.userId,
      email: user.email,
      role: "authenticated",
      aud: "authenticated",
      iat: nowSeconds,
      exp: nowSeconds + ACTING_TOKEN_TTL_SECONDS,
    }),
  );
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}
