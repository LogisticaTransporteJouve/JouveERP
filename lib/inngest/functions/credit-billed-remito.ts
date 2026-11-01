import { NonRetriableError } from "inngest";

import { JOUVE_GUARD_HINT } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { inngest } from "../client";
import {
  INVOICE_ISSUE_REQUESTED,
  INVOICE_REMITO_BILLED,
  InvoiceRemitoBilledSchema,
} from "../events";

/**
 * Settles a remito interno once the factura that bills it is emitted
 * (docs/otras-ventas.md §4–5): `settle_billed_remito` moves its recibos
 * internos to the fiscal side and drafts the nota de crédito interna for what
 * is left open, in one transaction; this job then issues the NC on the
 * internal side. Sent by issue-invoice after the CAE / CAEA, and again by
 * "Reintentar acreditación" on the factura when a run failed.
 *
 * Idempotent: the NC's idempotency key is the factura's id, so a rerun finds
 * the NC it already drafted. The issue event is keyed per run, so an NC that
 * failed can be issued again.
 */
export const creditBilledRemito = inngest.createFunction(
  {
    id: "credit-billed-remito",
    name: "Settle a billed remito interno",
    triggers: [{ event: INVOICE_REMITO_BILLED }],
    retries: 4,
    // A retry click while the CAE's own run is still going: one at a time.
    concurrency: { key: "event.data.factura_id", limit: 1 },
    onFailure: async ({ event, error }) => {
      const parsed = InvoiceRemitoBilledSchema.safeParse(
        (event.data as { event?: { data?: unknown } }).event?.data,
      );
      // The factura is emitted and the remito still open: the sale counts on
      // both sides until someone retries from the factura.
      logger.error("credit_billed_remito.failed", {
        factura_id: parsed.success ? parsed.data.factura_id : null,
        err: error.message,
      });
    },
  },
  async ({ event, step }) => {
    const { factura_id } = InvoiceRemitoBilledSchema.parse(event.data);

    const ncId = await step.run("settle", async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase.rpc("settle_billed_remito", {
        p_factura_id: factura_id,
      });
      if (error) {
        // A guard's refusal is deterministic: retrying cannot help.
        if (error.hint === JOUVE_GUARD_HINT) {
          throw new NonRetriableError(error.message);
        }
        throw new Error(`settle: ${error.message}`);
      }
      return data;
    });
    if (!ncId) {
      logger.info("credit_billed_remito.nothing_open", { factura_id });
      return { nc_id: null };
    }

    const nc = await step.run("load-nc", async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase
        .from("invoices")
        .select("id, status, channel_id, punto_venta, idempotency_key")
        .eq("id", ncId)
        .single();
      if (error) throw new Error(`load-nc: ${error.message}`);
      return data;
    });

    if (nc.status === "draft") {
      await step.sendEvent("issue-remito-nc", {
        name: INVOICE_ISSUE_REQUESTED,
        data: {
          invoice_id: nc.id,
          // issue-invoice dedupes on this key for 24h: a re-issue after a
          // failed NC (a retry) needs its own, so it is keyed by this run.
          idempotency_key: `${nc.idempotency_key}:${event.id ?? "first"}`,
          channel_id: nc.channel_id,
          punto_venta: nc.punto_venta,
        },
      });
    }
    logger.info("credit_billed_remito.settled", {
      factura_id,
      nc_id: nc.id,
      nc_status: nc.status,
    });
    return { nc_id: nc.id };
  },
);
