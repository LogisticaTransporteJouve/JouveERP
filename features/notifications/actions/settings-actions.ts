"use server";

import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

export type NotificationSetting = {
  notification_type: string;
  enabled: boolean;
};

const UpsertSettingInput = z.object({
  // type is free-form because notification_types are extensible from the DB.
  // Defensive cap of 64 chars + safe characters for keys.
  type: z
    .string()
    .trim()
    .min(1, "Tipo requerido.")
    .max(64, "Tipo demasiado largo.")
    .regex(/^[a-z0-9_-]+$/i, "Solo letras, números, _ y -."),
  enabled: z.boolean(),
});

export async function getMyNotificationSettingsAction(): Promise<
  ActionResult<NotificationSetting[]>
> {
  await requireUserContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_notification_settings");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

export async function upsertNotificationSettingAction(input: {
  type: string;
  enabled: boolean;
}): Promise<ActionResult<{ updated: true }>> {
  await requireUserContext();
  const parsed = UpsertSettingInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input inválido." };
  }
  input = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_my_notification_setting", {
    p_type: input.type,
    p_enabled: input.enabled,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { updated: true } };
}
