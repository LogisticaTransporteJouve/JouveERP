import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// Refresca el FTS materialized view si está dirty. Reemplaza el refresh
// sincronico que disparaba en cada DML de 7 source tables y agregaba
// 200-500ms a cada write. Ahora corre cada 1 min y solo refresca si la
// flag dirty está activa (set por triggers via pg_notify).

export const searchIndexRefresh = inngest.createFunction(
  {
    id: "search-index-refresh",
    name: "FTS — refresh search_index if dirty",
    retries: 1,
    triggers: [{ cron: "*/1 * * * *" }],
  },
  async ({ step }) => {
    const refreshed = await step.run("refresh-if-dirty", async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase.rpc("refresh_search_index_if_dirty");
      if (error) throw new Error(`refresh_search_index_if_dirty: ${error.message}`);
      return data as unknown as boolean;
    });

    if (refreshed) {
      logger.info("search_index.refreshed");
    }
    return { refreshed };
  },
);
