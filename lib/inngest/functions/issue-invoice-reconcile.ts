import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";
import { INVOICE_ISSUE_REQUESTED } from "../events";
import { recoverOnFailure } from "./issue-invoice";

// Resolves emissions issue-invoice left without an outcome:
//
//   * A fiscal invoice stuck in `emitting`: its run failed while AFIP did not
//     answer ("unknown" in recoverOnFailure), so it was neither emitted nor
//     failed. It holds its billing claims and stops the ARCA import of its
//     (pv, tipo) (sync-issued hasInFlightEmission). Once AFIP answers it is
//     emitted with the CAE AFIP holds, or failed when AFIP has no voucher of
//     it (failed frees its claims).
//   * A draft whose INVOICE_ISSUE_REQUESTED send failed or was never made (the
//     action died, or `inngest.send` threw). The event is sent again with the
//     draft's own key: issue-invoice dedupes on it, so a run that already
//     started is not doubled.

/** Longer than one CAE step (maxDuration 300 s): every CAE request of a run
 *  follows a write that bumps updated_at (record-attempt), so a row older than
 *  this has no request of its own in flight. */
const STUCK_AFTER_MS = 30 * 60_000;
/** A draft younger than this may still be on its way to Inngest. */
const UNSENT_AFTER_MS = 15 * 60_000;
/** Older drafts are left to a person: re-sending a stale fiscal draft weeks
 *  later would surprise more than it helps. */
const UNSENT_MAX_AGE_MS = 3 * 24 * 60 * 60_000;
const BATCH = 50;

const FAILED_MESSAGE =
  "AFIP no registró el comprobante: la emisión quedó sin respuesta y se marcó fallida.";

export const issueInvoiceReconcile = inngest.createFunction(
  {
    id: "issue-invoice-reconcile",
    name: "Comprobantes — resolver emisiones sin resultado",
    retries: 2,
    concurrency: { limit: 1 },
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires */15 * * * *" }],
  },
  async ({ step }) => {
    const stuck = await step.run("load-stuck", async () => {
      const { data, error } = await getServiceClient()
        .from("invoices")
        .select("id, updated_at")
        .eq("status", "emitting")
        .is("numero", null)
        .not("cbte_tipo_afip", "is", null)
        // Only a number sent to AFIP leaves the outcome unknown; a run that
        // never sent one fails on its own (onFailure).
        .not("afip_attempted_numero", "is", null)
        .lt("updated_at", new Date(Date.now() - STUCK_AFTER_MS).toISOString())
        .order("updated_at")
        .limit(BATCH);
      if (error) throw new Error(`load-stuck: ${error.message}`);
      return data ?? [];
    });

    const outcomes: Record<string, number> = {};
    for (const row of stuck) {
      const outcome = await step.run(`resolve-${row.id}`, async () => {
        const result = await recoverOnFailure(row.id);
        if (result !== "not_authorized") return result;
        // Compare-and-set on updated_at: a run that recorded a new attempt
        // after the read keeps the row.
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
      });
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }

    const unsent = await step.run("load-unsent", async () => {
      const now = Date.now();
      const { data, error } = await getServiceClient()
        .from("invoices")
        .select("id, idempotency_key, channel_id, punto_venta")
        .eq("status", "draft")
        .lt("created_at", new Date(now - UNSENT_AFTER_MS).toISOString())
        .gt("created_at", new Date(now - UNSENT_MAX_AGE_MS).toISOString())
        .order("created_at")
        .limit(BATCH);
      if (error) throw new Error(`load-unsent: ${error.message}`);
      return data ?? [];
    });

    const resend = await step.run("filter-unsent", async () => {
      // A draft with no items is a half-written insert, not a voucher.
      const supabase = getServiceClient();
      const kept: typeof unsent = [];
      for (const draft of unsent) {
        const { count, error } = await supabase
          .from("invoice_items")
          .select("id", { count: "exact", head: true })
          .eq("invoice_id", draft.id);
        if (error) throw new Error(`load-unsent-items: ${error.message}`);
        if ((count ?? 0) > 0) kept.push(draft);
      }
      return kept;
    });

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
