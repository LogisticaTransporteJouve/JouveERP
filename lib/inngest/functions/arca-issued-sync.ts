import { consultarPadron } from "@/lib/afip/padron";
import {
  listSyncTargets,
  SYNC_CBTE_TIPOS,
  syncIssuedPair,
  type PairSyncResult,
} from "@/lib/afip/sync-issued";
import { getLastAuthorizedNumber, getVoucherInfo } from "@/lib/afip/wsfev1";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";
import { ARCA_ISSUED_SYNC_REQUESTED } from "../events";

// One FECompConsultar per voucher: a batch of 100 keeps each step well under
// the function timeout. Up to 10 batches per (pv, cbte tipo) and run, so a
// long history (~1000/h) catches up within a day; day to day it is a handful.
const VOUCHERS_PER_BATCH = 100;
const BATCHES_PER_PAIR = 10;

function hasPending(r: PairSyncResult): boolean {
  return (
    r.last_local + r.imported + r.missing + r.skipped_no_origin <
    r.last_authorized
  );
}

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
        for (let batch = 0; batch < BATCHES_PER_PAIR; batch++) {
          const result = await step.run(
            `sync-${target.punto_venta}-${cbteTipo}-${batch}`,
            () =>
              syncIssuedPair(
                getServiceClient(),
                {
                  getLastAuthorizedNumber,
                  getVoucherInfo,
                  lookupContributor: consultarPadron,
                },
                target,
                cbteTipo,
                VOUCHERS_PER_BATCH,
                // Once per run: later batches would re-query the same gaps.
                { retryGaps: batch === 0 },
              ),
          );
          results.push(result);
          // A batch that imported nothing (gaps, NC/ND without origin) would
          // walk the same numbers again.
          if (
            result.stopped ||
            result.imported + result.recovered === 0 ||
            !hasPending(result)
          ) {
            break;
          }
        }
      }
    }

    const imported = results.reduce((n, r) => n + r.imported + r.recovered, 0);
    logger.info("arca_sync.done", {
      imported,
      pending: results.some(hasPending),
    });
    return { imported, results };
  },
);
