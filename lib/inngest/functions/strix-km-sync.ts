import { addDaysIso } from "@/lib/date-range";
import { todayInAR } from "@/lib/format";
import { runStrixKmSync } from "@/lib/strix/km-sync";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";
import { STRIX_KM_SYNC_REQUESTED, StrixKmSyncRequestedSchema } from "../events";

/** Days the daily run reads again: yesterday's km settle after midnight. */
const DAILY_LOOKBACK_DAYS = 7;

// Brings the km driven per vehicle and day from Strix Flotas, daily for the
// last week and on demand («Traer de Strix») for a chosen period. No retries
// and one run at a time: every retry is another sign-in. Sign-in and reports
// run in one step so the password and the token never reach Inngest's
// stored step output.
export const strixKmSync = inngest.createFunction(
  {
    id: "strix-km-sync",
    name: "Strix — traer km recorridos",
    retries: 0,
    concurrency: { limit: 1 },
    triggers: [
      { cron: "TZ=America/Argentina/Buenos_Aires 41 5 * * *" },
      { event: STRIX_KM_SYNC_REQUESTED },
    ],
  },
  async ({ event, step }) => {
    const manual = StrixKmSyncRequestedSchema.safeParse(event.data);
    const today = todayInAR();
    const range = manual.success
      ? { from: manual.data.from, to: manual.data.to }
      : { from: addDaysIso(today, -DAILY_LOOKBACK_DAYS), to: today };
    return step.run("sync", () => runStrixKmSync(getServiceClient(), range));
  },
);
