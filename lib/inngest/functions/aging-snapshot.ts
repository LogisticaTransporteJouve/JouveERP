import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// Daily photo of the client aging (aging_snapshots), so the analyst can
// compare the overdue debt with 30 days before ("la mora creció X %").
// capture_aging_snapshot sums v_aging_documents in SQL and replaces today's
// row, so a retry or a second run the same day leaves one row.
export const agingSnapshot = inngest.createFunction(
  {
    id: "aging-snapshot",
    name: "Aging — foto diaria de la deuda de clientes",
    retries: 2,
    // Before the Monday analyst (07:00), and outside the morning peak.
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 37 5 * * *" }],
  },
  async ({ step }) => {
    const snapshotDate = await step.run("capture-aging-snapshot", async () => {
      const { data, error } = await getServiceClient().rpc(
        "capture_aging_snapshot",
      );
      if (error) throw new Error(`capture_aging_snapshot: ${error.message}`);
      return data;
    });
    logger.info("aging_snapshot.ok", { snapshot_date: snapshotDate });
    return { snapshot_date: snapshotDate };
  },
);
