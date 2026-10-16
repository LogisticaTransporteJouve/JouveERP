import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getActingUser } from "@/lib/auth/acting-user";
import type { Database } from "@/lib/db/database";

export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // A background job acting as a user (lib/auth/acting-user.ts): no cookies,
  // the user's own access token on every request, so RLS still applies.
  const acting = getActingUser();
  if (acting) {
    return createServerClient<Database>(url, anonKey, {
      cookies: { getAll: () => [], setAll: () => {} },
      global: { headers: { Authorization: `Bearer ${acting.accessToken}` } },
    });
  }

  const cookieStore = await cookies();
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll was called from a Server Component. Safe to ignore — the
          // root proxy refreshes the session before any RSC renders.
        }
      },
    },
  });
}
