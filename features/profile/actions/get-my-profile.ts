"use server";

import { requireUserContext } from "@/lib/auth/context";
import { resolveAvatarUrl } from "@/lib/avatar-url";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

export type MyProfile = {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  avatarPath: string | null;
  avatarColor: string;
};

export async function getMyProfileAction(): Promise<ActionResult<MyProfile>> {
  const ctx = await requireUserContext();
  const supabase = await createClient();

  return {
    ok: true,
    data: {
      userId: ctx.userId,
      email: ctx.email,
      firstName: ctx.profile.firstName,
      lastName: ctx.profile.lastName,
      avatarUrl: resolveAvatarUrl(supabase, ctx.profile.avatarPath),
      avatarPath: ctx.profile.avatarPath,
      avatarColor: ctx.profile.avatarColor,
    },
  };
}
