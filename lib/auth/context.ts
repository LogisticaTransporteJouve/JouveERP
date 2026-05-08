import "server-only";

import { cache } from "react";

import { isRole, type Role } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export type UserContext = {
  userId: string;
  email: string;
  roles: Role[];
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

    const { data, error } = await supabase
      .from("user_roles")
      .select("role_id")
      .eq("user_id", user.id);
    if (error) throw error;

    const roles = (data ?? [])
      .map((row) => row.role_id)
      .filter(isRole);

    return {
      userId: user.id,
      email: user.email ?? "",
      roles,
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
