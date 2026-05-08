// Routes that should NOT redirect to /auth/login when there is no session.
// This is ONLY for the redirect decision in the proxy. Data access is gated
// by RLS on the database, never by this list.
export const DONT_AUTH_REDIRECT_PREFIXES = ["/auth", "/api/auth"] as const;

export function shouldSkipAuthRedirect(pathname: string): boolean {
  return DONT_AUTH_REDIRECT_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
}
