"use server";

import { requireUserContext } from "@/lib/auth/context";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

const MAX_BYTES = 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function uploadAvatarAction(
  formData: FormData,
): Promise<ActionResult<{ path: string }>> {
  const ctx = await requireUserContext();
  const supabase = await createClient();

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Falta archivo." };
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Máx 1 MB. Probá con una imagen más chica." };
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return { ok: false, error: "Solo PNG, JPG o WebP." };
  }

  const ext =
    file.type === "image/png"
      ? "png"
      : file.type === "image/webp"
        ? "webp"
        : "jpg";
  const path = `${ctx.userId}/${Date.now()}.${ext}`;

  const previousPath = ctx.profile.avatarPath;

  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: false });
  if (upErr) {
    logger.warn("profile.avatar_upload_storage_failed", {
      userId: ctx.userId,
      err: upErr.message,
    });
    return { ok: false, error: "No se pudo subir la imagen." };
  }

  const { error: dbErr } = await supabase
    .from("user_profiles")
    .update({ avatar_path: path })
    .eq("user_id", ctx.userId);
  if (dbErr) {
    await supabase.storage.from("avatars").remove([path]);
    logger.warn("profile.avatar_upload_db_failed", {
      userId: ctx.userId,
      err: dbErr.message,
    });
    return { ok: false, error: "No se pudo guardar la imagen." };
  }

  if (previousPath && previousPath !== path) {
    await supabase.storage.from("avatars").remove([previousPath]);
  }

  return { ok: true, data: { path } };
}

export async function removeAvatarAction(): Promise<
  ActionResult<{ removed: true }>
> {
  const ctx = await requireUserContext();
  if (!ctx.profile.avatarPath) return { ok: true, data: { removed: true } };
  const supabase = await createClient();

  const { error: dbErr } = await supabase
    .from("user_profiles")
    .update({ avatar_path: null })
    .eq("user_id", ctx.userId);
  if (dbErr) return { ok: false, error: dbErr.message };

  await supabase.storage.from("avatars").remove([ctx.profile.avatarPath]);
  return { ok: true, data: { removed: true } };
}
