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

    // The delete re-checks each file is still an orphan (one attached since
    // find-orphans keeps its row and its bytes) and returns what it removed.
    // New step ids: a run started before this order holds memoized results
    // for "remove-blobs" / "delete-rows" that do not fit it.
    const deleted = await step.run("delete-still-orphans", async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase.rpc("delete_orphan_files", {
        p_ids: orphans.map((o) => o.id),
        p_max_age: "1 hour",
      });
      if (error) throw new Error(`delete-still-orphans: ${error.message}`);
      return data ?? [];
    });

    // Group storage paths by bucket so we can remove in batched calls.
    const pathsByBucket = new Map<string, string[]>();
    for (const file of deleted) {
      const list = pathsByBucket.get(file.bucket) ?? [];
      list.push(file.bucket_path);
      pathsByBucket.set(file.bucket, list);
    }

    await step.run("remove-deleted-blobs", async () => {
      const supabase = getServiceClient();
      for (const [bucket, paths] of pathsByBucket) {
        const { error } = await supabase.storage.from(bucket).remove(paths);
        if (error) {
          // Best effort: the rows are gone, so no signed URL is ever made
          // for these bytes; they are only left behind.
          logger.warn("files.sweep_orphans.storage_remove_failed", {
            bucket,
            count: paths.length,
            message: error.message,
          });
        }
      }
    });

    logger.info("files.sweep_orphans.done", {
      found: orphans.length,
      swept: deleted.length,
    });
    return { swept: deleted.length };
  },
);
