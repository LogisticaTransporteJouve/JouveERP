import { rpcAs } from "@/lib/db/rpc";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// Refreshes the FTS materialized view if it's dirty. Replaces the
// synchronous refresh that fired on every DML across 7 source tables and
// added 200-500ms to each write. It runs every 5 min and only refreshes if
// the dirty flag is set (set by triggers via pg_notify). No step: Inngest
// bills the run and each step, and every minute with one step was ~86k
// executions a month, over the free 50k. A failed refresh is retried by the
// function's own retry.

export const searchIndexRefresh = inngest.createFunction(
  {
    id: "search-index-refresh",
    name: "FTS — refresh search_index if dirty",
    retries: 1,
    // A refresh that outlasts the interval must not overlap the next one.
    concurrency: { limit: 1 },
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async () => {
    const { data, error } = await getServiceClient().rpc(
      "refresh_search_index_if_dirty",
    );
    if (error) {
      throw new Error(`refresh_search_index_if_dirty: ${error.message}`);
    }
    const refreshed = rpcAs<boolean>(data);

    if (refreshed) {
      logger.info("search_index.refreshed");
    }
    return { refreshed };
  },
);
