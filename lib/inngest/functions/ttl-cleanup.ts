import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// Daily cleanup de tablas con TTL semántico que no se borran solas:
//   - rate_limit_buckets: 1 row por (user, bucket, window). Windows
//     horarias → sin cleanup crece sin límite. Borra > 7 días.
//   - padron_cache: 1 row por CUIT, TTL 24h. Sin cleanup acumula. Borra
//     > 30 días.
//   - afip_ta_cache: NO se limpia — PK es service text y cada llamada
//     upserts la misma row (1-3 rows totales).

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
      return data as unknown as number;
    });

    const padron = await step.run("cleanup-padron-cache", async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase.rpc("cleanup_padron_cache", {
        p_older_than: "30 days",
      });
      if (error) throw new Error(`cleanup_padron_cache: ${error.message}`);
      return data as unknown as number;
    });

    logger.info("ttl_cleanup.ok", { rate_buckets: rate, padron: padron });
    return { rate_buckets: rate, padron: padron };
  },
);
