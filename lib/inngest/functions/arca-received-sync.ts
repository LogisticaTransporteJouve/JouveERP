import { getAfipCuit } from "@/lib/afip/env";
import { runReceivedSync } from "@/lib/afip/received-sync";
import { DAILY_LOOKBACK_DAYS } from "@/lib/afip/received-sync-limits";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";
import {
  ARCA_RECEIVED_SYNC_REQUESTED,
  ArcaReceivedSyncRequestedSchema,
} from "../events";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

// Brings ARCA → Mis Comprobantes → Recibidos into the purchases tray, daily
// for the last 60 days and on demand («Traer de ARCA») for a chosen period.
// No retries and one run at a time: every retry is another sign-in, and
// repeated failed sign-ins can lock the user in ARCA. Sign-in and queries run
// in one step so the clave and the session never reach Inngest's stored
// step output.
export const arcaReceivedSync = inngest.createFunction(
  {
    id: "arca-received-sync",
    name: "ARCA — traer comprobantes recibidos",
    retries: 0,
    concurrency: { limit: 1 },
    triggers: [
      { cron: "TZ=America/Argentina/Buenos_Aires 23 5 * * *" },
      { event: ARCA_RECEIVED_SYNC_REQUESTED },
    ],
  },
  async ({ event, step }) => {
    const manual = ArcaReceivedSyncRequestedSchema.safeParse(event.data);
    const range = manual.success
      ? { from: manual.data.from, to: manual.data.to }
      : { from: isoDaysAgo(DAILY_LOOKBACK_DAYS), to: isoDaysAgo(0) };
    return step.run("sync", () =>
      runReceivedSync(getServiceClient(), range, {
        representedCuit: getAfipCuit(),
      }),
    );
  },
);
