"use server";

import { requireUserContext } from "@/lib/auth/context";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

import {
  nextDismissed,
  SetGuideCollapsedSchema,
  SetGuideItemDoneSchema,
} from "../schema";

// The viewer's own guide panel state (user_guide_states): a personal
// preference like the dashboard layout, so no permission gate beyond the
// session; RLS keeps each row to its owner.

export async function setGuideCollapsedAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  const parsed = SetGuideCollapsedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_guide_states")
    .upsert(
      { user_id: ctx.userId, collapsed: parsed.data.collapsed },
      { onConflict: "user_id" },
    );
  if (error) {
    logger.error("guide.collapse.save_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo guardar la guía." };
  }
  return { ok: true, data: undefined };
}

/** Marks a checklist item done by hand, or undoes it. */
export async function setGuideItemDoneAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  const parsed = SetGuideItemDoneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { key, done } = parsed.data;

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("user_guide_states")
    .select("dismissed_items")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (readError) {
    logger.error("guide.item.read_failed", {
      userId: ctx.userId,
      error: readError,
    });
    return { ok: false, error: "No se pudo guardar la guía." };
  }
  const { error } = await supabase.from("user_guide_states").upsert(
    {
      user_id: ctx.userId,
      dismissed_items: nextDismissed(current?.dismissed_items ?? [], key, done),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    logger.error("guide.item.save_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo guardar la guía." };
  }
  return { ok: true, data: undefined };
}
