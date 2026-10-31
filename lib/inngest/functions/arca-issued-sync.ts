import { consultarPadron } from "@/lib/afip/padron";
import {
  listSyncTargets,
  SYNC_CBTE_TIPOS,
  syncIssuedPair,
} from "@/lib/afip/sync-issued";
import { getLastAuthorizedNumber, getVoucherInfo } from "@/lib/afip/wsfev1";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";
import { ARCA_ISSUED_SYNC_REQUESTED } from "../events";

// Each run imports at most this many vouchers per (pv, cbte tipo): one
// FECompConsultar per voucher keeps a step well under the function timeout,
// and a long history catches up over successive runs.
const VOUCHERS_PER_PAIR = 100;

// Brings the vouchers issued in ARCA outside the ERP into `invoices`. Runs
// hourly and on demand (button in Comprobantes); one run at a time so two
// runs never walk the same numbers.
export const arcaIssuedSync = inngest.createFunction(
  {
    id: "arca-issued-sync",
    name: "ARCA — importar comprobantes emitidos",
    retries: 2,
    concurrency: { limit: 1 },
    triggers: [
      { cron: "TZ=America/Argentina/Buenos_Aires 0 * * * *" },
      { event: ARCA_ISSUED_SYNC_REQUESTED },
    ],
  },
  async ({ step }) => {
    const targets = await step.run("list-targets", () =>
      listSyncTargets(getServiceClient()),
    );

    const results = [];
    for (const target of targets) {
      for (const cbteTipo of SYNC_CBTE_TIPOS) {
        results.push(
          await step.run(`sync-${target.punto_venta}-${cbteTipo}`, () =>
            syncIssuedPair(
              getServiceClient(),
              {
                getLastAuthorizedNumber,
                getVoucherInfo,
                lookupContributor: consultarPadron,
              },
              target,
              cbteTipo,
              VOUCHERS_PER_PAIR,
            ),
          ),
        );
      }
    }

    const imported = results.reduce((n, r) => n + r.imported, 0);
    logger.info("arca_sync.done", {
      imported,
      pending: results.some(
        (r) => r.last_local + r.imported < r.last_authorized,
      ),
    });
    return { imported, results };
  },
);
