import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// K.10a — Daily sweep of orphan files. An orphan is a `files` row with
// no `file_attachments` referencing it. The upload action rolls back on
// failure (storage → files → attachment), but crashes mid-flow or
// cascade-deletes of parents can still leave bytes behind. This cron is
// the defence-in-depth that keeps the bucket from growing forever.
//
// Age filter (1 hour) on the RPC ensures uploads currently in flight
// don't get killed; unsent AI chat attachments get 24 hours (the RPC
// applies it), and sent ones live while their message does.

type OrphanRow = {
  id: string;
  bucket: string;
  bucket_path: string;
};

export const filesSweepOrphans = inngest.createFunction(
  {
    id: "files-sweep-orphans",
    name: "Files — sweep orphans",
    retries: 1,
    // Daily at 03:00 Buenos Aires.
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 0 3 * * *" }],
  },
  async ({ step }) => {
    const orphans = await step.run("find-orphans", async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase.rpc("find_orphan_files", {
        p_max_age: "1 hour",
      });
      if (error) throw new Error(`find-orphans: ${error.message}`);
      return (data ?? []) as OrphanRow[];
    });

    if (orphans.length === 0) {
      logger.info("files.sweep_orphans.noop", { swept: 0 });
      return { swept: 0 };
    }

    // Group storage paths by bucket so we can remove in batched calls.
    const pathsByBucket = new Map<string, string[]>();
    const idsToDelete: string[] = [];
    for (const orphan of orphans) {
      idsToDelete.push(orphan.id);
      const list = pathsByBucket.get(orphan.bucket) ?? [];
      list.push(orphan.bucket_path);
      pathsByBucket.set(orphan.bucket, list);
    }

    await step.run("remove-blobs", async () => {
      const supabase = getServiceClient();
      for (const [bucket, paths] of pathsByBucket) {
        const { error } = await supabase.storage.from(bucket).remove(paths);
        if (error) {
          // Don't throw — best-effort cleanup. The row deletion below
          // will leave the bytes behind but the DB stays consistent
          // (no row → no signed URL ever generated).
          logger.warn("files.sweep_orphans.storage_remove_failed", {
            bucket,
            count: paths.length,
            message: error.message,
          });
        }
      }
    });

    await step.run("delete-rows", async () => {
      const supabase = getServiceClient();
      const { error } = await supabase
        .from("files")
        .delete()
        .in("id", idsToDelete);
      if (error) throw new Error(`delete-rows: ${error.message}`);
    });

    logger.info("files.sweep_orphans.done", { swept: orphans.length });
    return { swept: orphans.length };
  },
);
