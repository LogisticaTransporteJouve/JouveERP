import { rpcAs } from "@/lib/db/rpc";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// Refreshes the FTS materialized view if it's dirty. Replaces the
// synchronous refresh that fired on every DML across 7 source tables and
// added 200-500ms to each write. Now it runs every 1 min and only refreshes
// if the dirty flag is set (set by triggers via pg_notify).

export const searchIndexRefresh = inngest.createFunction(
  {
    id: "search-index-refresh",
    name: "FTS — refresh search_index if dirty",
    retries: 1,
    // A refresh that outlasts the minute must not overlap the next one.
    concurrency: { limit: 1 },
    triggers: [{ cron: "*/1 * * * *" }],
  },
  async ({ step }) => {
    const refreshed = await step.run("refresh-if-dirty", async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase.rpc(
        "refresh_search_index_if_dirty",
      );
      if (error)
        throw new Error(`refresh_search_index_if_dirty: ${error.message}`);
      return rpcAs<boolean>(data);
    });

    if (refreshed) {
      logger.info("search_index.refreshed");
    }
    return { refreshed };
  },
);
