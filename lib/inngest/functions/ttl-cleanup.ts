import { rpcAs } from "@/lib/db/rpc";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// Daily cleanup of tables with semantic TTL that don't delete themselves:
//   - rate_limit_buckets: 1 row per (user, bucket, window). Hourly
//     windows → without cleanup it grows unbounded. Deletes > 7 days.
//   - padron_cache: 1 row per CUIT, TTL 24h. Without cleanup it accumulates.
//     Deletes > 30 days.
//   - afip_ta_cache: NOT cleaned — PK is service text and every call
//     upserts the same row (1-3 rows total).

export const ttlCleanup = inngest.createFunction(
  {
    id: "ttl-cleanup",
    name: "TTL cleanup — rate_limit_buckets + padron_cache",
    retries: 1,
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 15 3 * * *" }],
  },
  async ({ step }) => {
    const rate = await step.run("cleanup-rate-limit-buckets", async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase.rpc("cleanup_rate_limit_buckets", {
        p_older_than: "7 days",
      });
      if (error) throw new Error(`cleanup_rate_limit_buckets: ${error.message}`);
      return rpcAs<number>(data);
    });

    const padron = await step.run("cleanup-padron-cache", async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase.rpc("cleanup_padron_cache", {
        p_older_than: "30 days",
      });
      if (error) throw new Error(`cleanup_padron_cache: ${error.message}`);
      return rpcAs<number>(data);
    });

    logger.info("ttl_cleanup.ok", { rate_buckets: rate, padron: padron });
    return { rate_buckets: rate, padron: padron };
  },
);
