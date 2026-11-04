import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";
import { INVOICE_ISSUE_REQUESTED } from "../events";
import {
  billedEventFor,
  recoverOnFailure,
  STUCK_AFTER_MS,
  type FailureRecovery,
} from "./issue-invoice";

// Resolves emissions issue-invoice left without an outcome:
//
//   * A fiscal invoice stuck in `emitting`: its run failed while AFIP did not
//     answer ("unknown" in recoverOnFailure), or while its last request was
//     too recent for AFIP's "not registered" to count (onFailure), so it was
//     neither emitted nor failed. It holds its billing claims and stops the
//     ARCA import of its (pv, tipo) (sync-issued hasInFlightEmission). Once
//     AFIP answers it is emitted with the CAE AFIP holds, or failed when AFIP
//     has no voucher of it (failed frees its claims).
//   * A draft whose INVOICE_ISSUE_REQUESTED send failed or was never made (the
//     action died, or `inngest.send` threw). The event is sent again with the
//     draft's own key: issue-invoice dedupes on it, so a run started with that
//     key is not doubled. The remito NC is the exception: credit-billed-remito
//     sends it under a per-run key, so a slow first run can get a second one.
//     It is internal, and both converge on one number
//     (next_internal_invoice_numero_atomic) and one guarded mark-emitted.

/** A draft younger than this may still be on its way to Inngest. */
const UNSENT_AFTER_MS = 15 * 60_000;
/** Older drafts are left to a person: re-sending a stale fiscal draft weeks
 *  later would surprise more than it helps. */
const UNSENT_MAX_AGE_MS = 3 * 24 * 60 * 60_000;
const BATCH = 50;

const FAILED_MESSAGE =
  "AFIP no registró el comprobante: la emisión quedó sin respuesta y se marcó fallida.";

async function failIfNotAuthorized(
  row: { id: string; updated_at: string },
  outcome: FailureRecovery["outcome"],
): Promise<string> {
  if (outcome !== "not_authorized") return outcome;
  // Compare-and-set on updated_at: a run that recorded a new attempt after
  // the read keeps the row.
  const { data, error } = await getServiceClient()
    .from("invoices")
    .update({
      status: "failed",
      afip_observaciones: { error: FAILED_MESSAGE },
    })
    .eq("id", row.id)
    .eq("status", "emitting")
    .eq("updated_at", row.updated_at)
    .select("id");
  if (error) throw new Error(`fail-stuck: ${error.message}`);
  return (data ?? []).length > 0 ? "failed" : "changed";
}

async function loadStuck() {
  const { data, error } = await getServiceClient()
    .from("invoices")
    .select("id, updated_at")
    .eq("status", "emitting")
    .is("numero", null)
    .not("cbte_tipo_afip", "is", null)
    // Only a number sent to AFIP leaves the outcome unknown; a run that never
    // sent one fails on its own (onFailure).
    .not("afip_attempted_numero", "is", null)
    .lt("updated_at", new Date(Date.now() - STUCK_AFTER_MS).toISOString())
    .order("updated_at")
    .limit(BATCH);
  if (error) throw new Error(`load-stuck: ${error.message}`);
  return data ?? [];
}

/** Drafts old enough to have missed their send, with at least one item: a
 *  draft with no items is a half-written insert, not a voucher. */
async function loadUnsentWithItems() {
  const supabase = getServiceClient();
  const now = Date.now();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, idempotency_key, channel_id, punto_venta")
    .eq("status", "draft")
    .lt("created_at", new Date(now - UNSENT_AFTER_MS).toISOString())
    .gt("created_at", new Date(now - UNSENT_MAX_AGE_MS).toISOString())
    .order("created_at")
    .limit(BATCH);
  if (error) throw new Error(`load-unsent: ${error.message}`);
  const kept: NonNullable<typeof data> = [];
  for (const draft of data ?? []) {
    const { count, error: itemsError } = await supabase
      .from("invoice_items")
      .select("id", { count: "exact", head: true })
      .eq("invoice_id", draft.id);
    if (itemsError) throw new Error(`load-unsent-items: ${itemsError.message}`);
    if ((count ?? 0) > 0) kept.push(draft);
  }
  return kept;
}

export const issueInvoiceReconcile = inngest.createFunction(
  {
    id: "issue-invoice-reconcile",
    name: "Comprobantes — resolver emisiones sin resultado",
    retries: 2,
    concurrency: { limit: 1 },
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires */15 * * * *" }],
  },
  async ({ step }) => {
    // One step for every read: a run with nothing to do costs two executions
    // (the run and this step), and it runs every 15 minutes.
    const { stuck, resend } = await step.run("load-work", async () => ({
      stuck: await loadStuck(),
      resend: await loadUnsentWithItems(),
    }));

    const outcomes: Record<string, number> = {};
    for (const row of stuck) {
      const { outcome, billsRemito } = await step.run(
        `resolve-${row.id}`,
        async () => {
          const result = await recoverOnFailure(row.id);
          return {
            outcome: await failIfNotAuthorized(row, result.outcome),
            billsRemito: result.billsRemito,
          };
        },
      );
      // Its own step: the resolve step is memoized, and a retry of it would
      // find the row emitted with nothing left to recover.
      if (billsRemito) {
        await step.sendEvent(`remito-billed-${row.id}`, billedEventFor(row.id));
      }
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }

    if (resend.length > 0) {
      await step.sendEvent(
        "resend-unsent",
        resend.map((d) => ({
          name: INVOICE_ISSUE_REQUESTED,
          data: {
            invoice_id: d.id,
            idempotency_key: d.idempotency_key,
            channel_id: d.channel_id,
            punto_venta: d.punto_venta,
          },
        })),
      );
    }

    logger.info("issue_invoice_reconcile.done", {
      stuck: stuck.length,
      outcomes,
      resent: resend.length,
    });
    return { stuck: stuck.length, outcomes, resent: resend.length };
  },
);
