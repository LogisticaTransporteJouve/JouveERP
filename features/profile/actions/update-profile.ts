"use server";

import { requireUserContext } from "@/lib/auth/context";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

import { UpdateProfileSchema } from "../schema";

export async function updateProfileAction(
  input: unknown,
): Promise<ActionResult<{ updated: true }>> {
  const ctx = await requireUserContext();
  const parsed = UpdateProfileSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      ok: false,
      error: firstIssue?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_profiles")
    .update({
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      avatar_color: parsed.data.color,
    })
    .eq("user_id", ctx.userId);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { updated: true } };
}
