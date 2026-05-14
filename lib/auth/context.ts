import "server-only";

import { cache } from "react";

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

/**
 * Single point of entry for "who is calling this server action / RSC".
 * Wrapped in React's `cache()` so multiple callers in the same request
 * share one round-trip to Supabase.
 */
export const getCurrentUserContext = cache(
  async (): Promise<UserContext | null> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const [rolesResult, profileResult] = await Promise.all([
      supabase.from("user_roles").select("role_id").eq("user_id", user.id),
      supabase
        .from("user_profiles")
        .select("first_name, last_name, avatar_path, avatar_color")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    if (rolesResult.error) throw rolesResult.error;

    const roles = (rolesResult.data ?? [])
      .map((row) => row.role_id)
      .filter(isRole);

    // El trigger handle_new_user_profile crea la fila al insertar en
    // auth.users. Para users existentes anteriores a la migración hay
    // backfill en el SQL. Si por algo no existe, devolvemos defaults
    // seguros para no romper la UI.
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

    return {
      userId: user.id,
      email: user.email ?? "",
      roles,
      profile,
    };
  },
);

export async function requireUserContext(): Promise<UserContext> {
  const ctx = await getCurrentUserContext();
  if (!ctx) {
    throw new Error("Unauthenticated");
  }
  return ctx;
}
