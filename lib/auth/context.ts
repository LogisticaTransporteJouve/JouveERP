import "server-only";

import { cache } from "react";

import { getActingUser } from "@/lib/auth/acting-user";
import { isRole, type Role } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export type UserProfile = {
  firstName: string | null;
  lastName: string | null;
  avatarPath: string | null;
  avatarColor: string;
};

export type UserContext = {
  userId: string;
  email: string;
  roles: Role[];
  profile: UserProfile;
};

type ServerClient = Awaited<ReturnType<typeof createClient>>;

async function loadUserContext(
  supabase: ServerClient,
  userId: string,
  email: string,
): Promise<UserContext> {
  const [rolesResult, profileResult] = await Promise.all([
    supabase.from("user_roles").select("role_id").eq("user_id", userId),
    supabase
      .from("user_profiles")
      .select("first_name, last_name, avatar_path, avatar_color")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (rolesResult.error) throw rolesResult.error;

  const roles = (rolesResult.data ?? [])
    .map((row) => row.role_id)
    .filter(isRole);

  // The handle_new_user_profile trigger creates the row on insert into
  // auth.users. For existing users predating the migration, the SQL
  // includes a backfill. If for some reason it doesn't exist, we return
  // safe defaults so the UI doesn't break.
  const profile: UserProfile = profileResult.data
    ? {
        firstName: profileResult.data.first_name,
        lastName: profileResult.data.last_name,
        avatarPath: profileResult.data.avatar_path,
        avatarColor: profileResult.data.avatar_color,
      }
    : {
        firstName: null,
        lastName: null,
        avatarPath: null,
        avatarColor: "gray",
      };

  return { userId, email, roles, profile };
}

/**
 * Wrapped in React's `cache()` so multiple callers in the same request
 * share one round-trip to Supabase.
 */
const getCookieUserContext = cache(async (): Promise<UserContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return loadUserContext(supabase, user.id, user.email ?? "");
});

/**
 * Single point of entry for "who is calling this server action / RSC": the
 * session cookie's user, or the user a background job is acting as
 * (lib/auth/acting-user.ts). Roles are read with that user's own client, so
 * they are the ones RLS sees.
 */
export async function getCurrentUserContext(): Promise<UserContext | null> {
  const acting = getActingUser();
  if (acting) {
    return loadUserContext(await createClient(), acting.userId, acting.email);
  }
  return getCookieUserContext();
}

export async function requireUserContext(): Promise<UserContext> {
  const ctx = await getCurrentUserContext();
  if (!ctx) {
    throw new Error("Unauthenticated");
  }
  return ctx;
}
