"use server";

import { requireUserContext } from "@/lib/auth/context";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

export type NotificationSetting = {
  notification_type: string;
  enabled: boolean;
};

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
  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_my_notification_setting", {
    p_type: input.type,
    p_enabled: input.enabled,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { updated: true } };
}
