import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";

type FileStorageLocation = {
  bucket: string;
  bucket_path: string;
};

// Removes the blob + the registry row when no attachments remain for this
// file. The orphan cron (lib/inngest/functions/files-sweep-orphans.ts) is
// the safety net; this is the happy-path cleanup called inline by
// `detachFileAction` after a successful attachment delete.
export async function deleteFileIfOrphaned(
  supabase: SupabaseClient<Database>,
  fileId: string,
  file: FileStorageLocation,
): Promise<void> {
  const { count } = await supabase
    .from("file_attachments")
    .select("id", { count: "exact", head: true })
    .eq("file_id", fileId);

  if (count !== 0) return;

  await supabase.storage.from(file.bucket).remove([file.bucket_path]);
  await supabase.from("files").delete().eq("id", fileId);
}
