import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/db/database.types";

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
  await supabase.auth.getUser();

  return response;
}
