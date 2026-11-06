import {
  chunk,
  mergeBulkProgress,
} from "@/features/purchase-invoices/lib/arca-bulk-accept";
import { logger } from "@/lib/logger";
import {
  acceptVoucherChunk,
  applyBulkOpeningBalances,
  asBulkOwner,
  createMissingSuppliers,
  failBulkRun,
  finishBulkRun,
  listBulkWork,
  progressWithTotals,
  saveBulkProgress,
  startBulkRun,
} from "@/lib/purchases/arca-bulk-accept";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";
import {
  ARCA_BULK_ACCEPT_REQUESTED,
  ArcaBulkAcceptRequestedSchema,
  failedEventData,
} from "../events";

// Padrón takes a second or two per CUIT and an accept a dozen round trips:
// these keep each step well under the 300 s function timeout, so a retry
// redoes one chunk (memoized steps are not run again).
const SUPPLIERS_PER_STEP = 25;
const VOUCHERS_PER_STEP = 40;
const OPENINGS_PER_STEP = 25;

// «Aceptar todos los pendientes» in Compras › Recibidos de ARCA: creates the
// missing suppliers from padrón, loads every pending voucher (facturas, then
// ND, then NC) as a purchase and sets each affected supplier's opening
// balance at 0 on BULK_OPENING_DATE, as the owner who asked. Progress goes to
// arca_bulk_accept_runs, which the tray polls.
export const arcaBulkAccept = inngest.createFunction(
  {
    id: "arca-bulk-accept",
    name: "ARCA — aceptar todos los recibidos pendientes",
    retries: 2,
    concurrency: { limit: 1 },
    idempotency: "event.data.run_id",
    triggers: [{ event: ARCA_BULK_ACCEPT_REQUESTED }],
    onFailure: async ({ event, error }) => {
      const parsed = ArcaBulkAcceptRequestedSchema.safeParse(
        failedEventData(event.data),
      );
      logger.error("arca_bulk_accept.failed", { err: error.message });
      if (parsed.success) {
        await failBulkRun(
          getServiceClient(),
          parsed.data.run_id,
          error.message,
        );
      }
    },
  },
  async ({ event, step }) => {
    const { run_id: runId, requested_by: userId } =
      ArcaBulkAcceptRequestedSchema.parse(event.data);

    const work = await step.run("list", async () => {
      const service = getServiceClient();
      const listed = await listBulkWork(service);
      await startBulkRun(service, runId, progressWithTotals(listed));
      return listed;
    });
    let progress = progressWithTotals(work);

    for (const [i, part] of chunk(work.missing, SUPPLIERS_PER_STEP).entries()) {
      const before = progress;
      const delta = await step.run(`suppliers-${i}`, async () => {
        const d = await asBulkOwner(userId, () =>
          createMissingSuppliers(userId, part),
        );
        await saveBulkProgress(
          getServiceClient(),
          runId,
          "suppliers",
          mergeBulkProgress(before, d),
        );
        return d;
      });
      progress = mergeBulkProgress(progress, delta);
    }

    const affected = new Set<string>();
    for (const [i, part] of chunk(
      work.voucherIds,
      VOUCHERS_PER_STEP,
    ).entries()) {
      const before = progress;
      const result = await step.run(`vouchers-${i}`, async () => {
        const r = await asBulkOwner(userId, () =>
          acceptVoucherChunk(userId, part),
        );
        await saveBulkProgress(
          getServiceClient(),
          runId,
          "vouchers",
          mergeBulkProgress(before, r.delta),
        );
        return r;
      });
      progress = mergeBulkProgress(progress, result.delta);
      for (const id of result.affectedSupplierIds) affected.add(id);
    }

    const suppliers = [...affected].sort();
    for (const [i, part] of chunk(suppliers, OPENINGS_PER_STEP).entries()) {
      const before = progress;
      const delta = await step.run(`opening-${i}`, async () => {
        const d = await asBulkOwner(userId, () =>
          applyBulkOpeningBalances(userId, part),
        );
        await saveBulkProgress(
          getServiceClient(),
          runId,
          "opening_balances",
          mergeBulkProgress(before, d),
        );
        return d;
      });
      progress = mergeBulkProgress(progress, delta);
    }

    const final = progress;
    await step.run("finish", () =>
      finishBulkRun(getServiceClient(), runId, final),
    );
    logger.info("arca_bulk_accept.done", {
      runId,
      accepted: final.vouchers.accepted,
      linked: final.vouchers.linked,
      suppliersCreated: final.suppliers.created,
      openingBalances: final.openingBalances.applied,
    });
    return {
      accepted: final.vouchers.accepted,
      linked: final.vouchers.linked,
      suppliersCreated: final.suppliers.created,
    };
  },
);
