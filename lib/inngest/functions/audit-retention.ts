import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// Daily retention of audit_events (decision D13): purge_audit_events deletes
// the events older than 400 days. The cutoff lives in the function, so this
// job cannot shorten it; nothing else is touched (accounting documents keep
// every row).
export const auditRetention = inngest.createFunction(
  {
    id: "audit-retention",
    name: "Auditoría — borra eventos de más de 400 días",
    retries: 2,
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 41 3 * * *" }],
  },
  async ({ step }) => {
    const deleted = await step.run("purge-audit-events", async () => {
      const { data, error } =
        await getServiceClient().rpc("purge_audit_events");
      if (error) throw new Error(`purge_audit_events: ${error.message}`);
      return data;
    });
    logger.info("audit_retention.ok", { deleted });
    return { deleted };
  },
);
