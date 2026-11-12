import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";

// Daily carga start: sync_shipment_trip_status puts «En curso» every carga
// whose trip (not cancelled) is dated today or earlier, Argentina time. It is
// idempotent, so a retry or a second run changes nothing; it never moves a
// carga backward (the trip and assignment actions do that for the cargas they
// touch).
export const shipmentsAutoStart = inngest.createFunction(
  {
    id: "shipments-auto-start",
    name: "Cargas — En curso el día del viaje",
    retries: 2,
    // 00:07 Argentina: right after the day changes, off the hour.
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 7 0 * * *" }],
  },
  async ({ step }) => {
    const started = await step.run("start-due-shipments", async () => {
      const { data, error } = await getServiceClient().rpc(
        "sync_shipment_trip_status",
        {},
      );
      if (error) {
        throw new Error(`sync_shipment_trip_status: ${error.message}`);
      }
      return data;
    });
    logger.info("shipments_auto_start.ok", { started });
    return { started };
  },
);
