"use server";

import { requireUserContext } from "@/lib/auth/context";
import { resolveAvatarUrl } from "@/lib/avatar-url";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

import type { AssignableUser } from "../types";

export async function listAssignableUsersAction(): Promise<
  ActionResult<AssignableUser[]>
> {
  await requireUserContext();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_chat_assignable_users");
  if (error) return { ok: false, error: error.message };

  const users: AssignableUser[] = (data ?? []).map((row) => ({
    user_id: row.user_id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    avatar_path: row.avatar_path,
    avatar_color: row.avatar_color,
    avatar_url: resolveAvatarUrl(supabase, row.avatar_path),
  }));

  return { ok: true, data: users };
}
