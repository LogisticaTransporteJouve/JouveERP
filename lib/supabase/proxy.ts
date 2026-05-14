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

  // IMPORTANT: DO NOT REMOVE auth.getUser().
  // This call is what triggers the JWT refresh when the access_token is close
  // to expiry. Without it, sessions silently expire even with a valid
  // refresh_token. Don't move logic that depends on `user` either — the
  // refresh side-effect must run on every request.
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
