import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database";

// Resolves an avatar_path (key within the "avatars" bucket) to the public
// URL. The bucket is marked public in the migration — the publicURLs
// don't expire and have aggressive CDN caching.
//
// We return string | null so the caller can pass the null straight to
// `<img src>` without a wrapper. If you never uploaded a photo, `avatarPath`
// is null and the avatar components fall back to initials.
export function resolveAvatarUrl(
  supabase: SupabaseClient<Database>,
  avatarPath: string | null,
): string | null {
  if (!avatarPath) return null;
  const { data } = supabase.storage.from("avatars").getPublicUrl(avatarPath);
  return data?.publicUrl ?? null;
}
