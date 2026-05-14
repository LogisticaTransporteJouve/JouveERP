import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database";

// Resuelve un avatar_path (key dentro del bucket "avatars") a la URL
// pública. El bucket está marcado público en la migración — los
// publicURLs no expiran y tienen cache CDN agresivo.
//
// Devolvemos string | null para que el caller pase el null a `<img src>`
// sin un wrapper. Si nunca subiste foto, `avatarPath` es null y los
// componentes de avatar caen al fallback de iniciales.
export function resolveAvatarUrl(
  supabase: SupabaseClient<Database>,
  avatarPath: string | null,
): string | null {
  if (!avatarPath) return null;
  const { data } = supabase.storage.from("avatars").getPublicUrl(avatarPath);
  return data?.publicUrl ?? null;
}
