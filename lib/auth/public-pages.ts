// Routes that should NOT redirect to /auth/login when there is no session.
// This is ONLY for the redirect decision in the proxy. Data access is gated
// by RLS on the database, never by this list.
//
// `/api/inngest`: Inngest's dev runtime polls and signs requests without
// cookies, so redirecting it to /auth/login breaks discovery and webhook
// delivery. In production the route is protected by the Inngest signing
// key, not session auth.
export const DONT_AUTH_REDIRECT_PREFIXES = [
  "/auth",
  "/api/auth",
  "/api/inngest",
] as const;

export function shouldSkipAuthRedirect(pathname: string): boolean {
  return DONT_AUTH_REDIRECT_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
}
