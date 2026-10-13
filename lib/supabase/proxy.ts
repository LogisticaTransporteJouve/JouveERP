import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { shouldSkipAuthRedirect } from "@/lib/auth/public-pages";
import type { Database } from "@/lib/db/database";

export async function updateSession(
  request: NextRequest,
  extraRequestHeaders: Headers,
) {
  let response = NextResponse.next({
    request: { headers: extraRequestHeaders },
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({
            request: { headers: extraRequestHeaders },
          });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: DO NOT REMOVE auth.getClaims().
  // It reads the session (refreshing the access_token through the cookie
  // adapter when it is close to expiry — without this call sessions silently
  // expire even with a valid refresh_token) and verifies the JWT. With
  // asymmetric signing keys the signature is checked locally against the
  // cached JWKS, so the proxy no longer pays an Auth-server round trip on
  // every request (getUser() did; requireUserContext() still calls getUser()
  // for the authoritative check). With the legacy symmetric secret it falls
  // back to getUser() internally — same cost as before, never less safe.
  // Don't move logic that depends on `user` — the refresh must run on every
  // request.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims.sub ? claimsData.claims : null;

  const { pathname, search } = request.nextUrl;

  if (!user && !shouldSkipAuthRedirect(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/auth/login";
    loginUrl.search = "";
    if (pathname !== "/" && pathname !== "/dashboard") {
      loginUrl.searchParams.set("redirectTo", `${pathname}${search}`);
    }
    return NextResponse.redirect(loginUrl);
  }

  // Only bounce off /auth/login when logged in. /auth/logout must reach its
  // route handler so the session can actually be cleared.
  if (user && pathname.startsWith("/auth/login")) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}
